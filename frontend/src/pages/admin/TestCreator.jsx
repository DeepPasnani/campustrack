import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { testsAPI } from '../../services/api';
import { Btn, Input, Select, Textarea, Tabs, Spinner, HelpTip } from '../../components/shared/UI';
import toast from 'react-hot-toast';
import BankPickerModal from './BankPickerModal';
import AptQEditor from './AptQEditor';
import CodeQEditor from './CodeQEditor';
import ReviewPanel from './ReviewPanel';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS } from '../../lib/departments';
import { useClassOptions } from '../../hooks/useClassOptions';

/* ═══════════════════════════════════════════════════════════
 * Admin Test Creator — Assessment builder
 *
 * Three-step flow: Configuration → Questions → Review & Publish.
 * ═══════════════════════════════════════════════════════════ */

const genId = () => `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const DEFAULT_TEST = {
  title: '',
  description: '',
  status: 'draft',
  startTime: '',
  endTime: '',
  durationMinutes: 90,
  department: '',
  departments: [],
  years: [],
  classes: [],
  settings: {
    shuffleQuestions: true,
    shuffleOptions: true,
    showResults: 'after_submit',
    passingScore: 40,
    negativeMarking: false,
    negativeFraction: 0.25,
    allowedBranches: '',
    allowedLanguages: ['python', 'javascript', 'java', 'cpp'],
  },
  sections: [],
};

// The backend returns raw DB columns in snake_case (test_cases, starter_code,
// input_format, correct_answer, ...) while AptQEditor/CodeQEditor are built
// around camelCase fields (testCases, starterCode, inputFormat,
// correctAnswer, ...). Without this normalization step, editing any
// previously-saved question loads every one of those fields as `undefined` —
// which crashes outright wherever the editor calls `.map()`/`Object.keys()`
// on them (e.g. opening the Test Cases or Starter Code tab), and silently
// blanks every text field otherwise, so saving the test would wipe that data.
function normalizeQuestion(q, sectionType) {
  if (sectionType === 'aptitude') {
    return {
      ...DEFAULT_APT_Q(),
      ...q,
      imageUrl: q.imageUrl ?? q.image_url ?? '',
      optionImages: q.optionImages ?? q.option_images ?? ['', '', '', ''],
      correctAnswer: q.correctAnswer ?? q.correct_answer ?? 0,
      questionSet: q.questionSet ?? q.question_set ?? 'A',
      bankQuestionId: q.bankQuestionId ?? q.bank_question_id ?? null,
    };
  }
  return {
    ...DEFAULT_CODE_Q(),
    ...q,
    imageUrl: q.imageUrl ?? q.image_url ?? '',
    inputFormat: q.inputFormat ?? q.input_format ?? '',
    outputFormat: q.outputFormat ?? q.output_format ?? '',
    sampleInput: q.sampleInput ?? q.sample_input ?? '',
    sampleOutput: q.sampleOutput ?? q.sample_output ?? '',
    testCases: (q.testCases ?? q.test_cases)?.length
      ? (q.testCases ?? q.test_cases)
      : [{ input: '', output: '', isHidden: false }],
    starterCode: {
      ...DEFAULT_CODE_Q().starterCode,
      ...(q.starterCode ?? q.starter_code ?? {}),
    },
    timeLimit: q.timeLimit ?? q.time_limit_seconds ?? 2,
    memoryLimit: q.memoryLimit ?? q.memory_limit_mb ?? 256,
    bankQuestionId: q.bankQuestionId ?? q.bank_question_id ?? null,
  };
}

const DEFAULT_APT_Q = () => ({
  _id: genId(),
  type: 'mcq',
  text: '',
  imageUrl: '',
  options: ['', '', '', ''],
  optionImages: ['', '', '', ''],
  correctAnswer: 0,
  explanation: '',
  marks: 2,
  difficulty: 'medium',
  genre: 'general',
  questionSet: 'A',
  saveToBank: false,
  bankQuestionId: null,
});

const DEFAULT_CODE_Q = () => ({
  _id: genId(),
  title: '',
  description: '',
  imageUrl: '',
  inputFormat: '',
  outputFormat: '',
  constraints: '',
  sampleInput: '',
  sampleOutput: '',
  explanation: '',
  testCases: [{ input: '', output: '', isHidden: false }],
  starterCode: {
    python: '# Write your solution here\n',
    javascript: '// Write your solution here\n',
    java:
      'public class Solution {\n    public static void main(String[] args) {\n        // Write your solution\n    }\n}\n',
    cpp:
      '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your solution\n    return 0;\n}\n',
    c:
      '#include <stdio.h>\n\nint main() {\n    // Write your solution\n    return 0;\n}\n',
    sql: '-- Write your SQL query here\nSELECT *\nFROM table_name;\n',
  },
  timeLimit: 2,
  memoryLimit: 256,
  marks: 10,
  difficulty: 'medium',
  tags: '',
  saveToBank: false,
  bankQuestionId: null,
});

// ── Main Test Creator ───────────────────────────────────────
export default function TestCreator() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { years: targetYears, classes: targetClasses } = useClassOptions();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(DEFAULT_TEST);
  const [activeSection, setActiveSection] = useState(0);
  const [bankOpen, setBankOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isEdit = !!id;

  // ── Question list filter/sort (view only — never reorders the
  // underlying array, so the exam sequence a student sees is untouched
  // unless the admin explicitly drags/removes/adds questions) ────────
  const DEFAULT_Q_FILTER = { topic: 'all', type: 'all', difficulty: 'all', minMarks: '', maxMarks: '' };
  const [qFilter, setQFilter] = useState(DEFAULT_Q_FILTER);
  const [qSort, setQSort] = useState({ field: 'none', dir: 'asc' });
  const [selectedQs, setSelectedQs] = useState(() => new Set());
  const [bulkMarks, setBulkMarks] = useState('');

  // Filters/sort are scoped to whatever section is being viewed — reset
  // them on section switch so a filter that matched nothing in the new
  // section doesn't silently leave the list looking empty.
  useEffect(() => {
    setQFilter(DEFAULT_Q_FILTER);
    setQSort({ field: 'none', dir: 'asc' });
    setSelectedQs(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // ── Keyboard shortcut: Ctrl+S → save draft ───────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (form.title.trim()) {
          handleSave('draft');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title]);

  const { data: editData, isLoading: loadingTest } = useQuery({
    queryKey: ['test', id],
    queryFn: () => testsAPI.get(id),
    enabled: !!id,
  });

  useEffect(() => {
    if (!editData) return;
    setForm({
      title: editData.title,
      description: editData.description,
      status: editData.status,
      startTime: toLocalDatetimeString(editData.start_time),
      endTime: toLocalDatetimeString(editData.end_time),
      durationMinutes: editData.duration_minutes,
      department: editData.department || '',
      departments: Array.isArray(editData.departments)
        ? editData.departments
        : (editData.department ? [editData.department] : []),
      years: Array.isArray(editData.years) ? editData.years.map(String) : [],
      classes: Array.isArray(editData.classes) ? editData.classes : [],
      settings: editData.settings || DEFAULT_TEST.settings,
      sections: (editData.sections || []).map(s => ({
        ...s,
        questions: (s.questions || []).map(q => ({
          ...normalizeQuestion(q, s.type),
          _id: q.id || genId(),
        })),
      })),
    });
  }, [editData]);

  const saveMut = useMutation({
    mutationFn: (payload) => (isEdit ? testsAPI.update(id, payload) : testsAPI.create(payload)),
    onSuccess: (data) => {
      if (data?.sectionsSkipped) {
        toast.error(data.message, { duration: 8000 });
      } else {
        toast.success(isEdit ? 'Test updated!' : 'Test created!');
      }
      qc.invalidateQueries({ queryKey: ['tests'] });
      navigate('/admin/tests');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const convertToUTC = (localDateTime) => {
    if (!localDateTime) return null;
    return new Date(localDateTime).toISOString();
  };

  const toLocalDatetimeString = (utcStr) => {
    if (!utcStr) return '';
    const d = new Date(utcStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  const upd = (f, v) => setForm(p => ({ ...p, [f]: v }));
  const updSettings = (f, v) =>
    setForm(p => ({ ...p, settings: { ...p.settings, [f]: v } }));

  const addSection = (type) => {
    const sec = {
      _id: genId(),
      name: type === 'aptitude' ? 'Aptitude' : 'Coding',
      type,
      questions: [],
    };
    setForm(p => ({ ...p, sections: [...p.sections, sec] }));
    setActiveSection(form.sections.length);
  };

  const updateSection = (si, f, v) => {
    setForm(p => {
      const s = [...p.sections];
      s[si] = { ...s[si], [f]: v };
      return { ...p, sections: s };
    });
  };

  const addQuestion = (si) => {
    setForm(p => {
      const s = [...p.sections];
      s[si] = {
        ...s[si],
        questions: [
          ...s[si].questions,
          s[si].type === 'aptitude' ? DEFAULT_APT_Q() : DEFAULT_CODE_Q(),
        ],
      };
      return { ...p, sections: s };
    });
  };

  const cloneBankQuestion = (sectionType, bankQ) =>
    sectionType === 'aptitude'
      ? {
          ...DEFAULT_APT_Q(),
          text: bankQ.data.text || '',
          options: bankQ.data.options || ['', '', '', ''],
          correctAnswer: bankQ.data.correctAnswer ?? 0,
          genre: bankQ.genre || 'general',
          difficulty: bankQ.difficulty || 'medium',
          marks: bankQ.marks || 2,
          bankQuestionId: bankQ.id,
        }
      : {
          ...DEFAULT_CODE_Q(),
          title: bankQ.data.title || '',
          description: bankQ.data.description || '',
          testCases: bankQ.data.testCases?.length ? bankQ.data.testCases : [{ input: '', output: '', isHidden: false }],
          difficulty: bankQ.difficulty || 'medium',
          marks: bankQ.marks || 10,
          bankQuestionId: bankQ.id,
        };

  // Accepts one or more bank questions (BankPickerModal's checkbox picker
  // lets the admin select multiple at once) and appends all of them.
  const addQuestionsFromBank = (si, bankQs) => {
    setForm(p => {
      const s = [...p.sections];
      const cloned = bankQs.map(bankQ => cloneBankQuestion(s[si].type, bankQ));
      s[si] = { ...s[si], questions: [...s[si].questions, ...cloned] };
      return { ...p, sections: s };
    });
    toast.success(bankQs.length === 1 ? 'Added from bank' : `Added ${bankQs.length} questions from bank`);
  };

  const updateQuestion = (si, qi, q) => {
    setForm(p => {
      const s = [...p.sections];
      s[si] = { ...s[si], questions: s[si].questions.map((qq, i) => (i === qi ? q : qq)) };
      return { ...p, sections: s };
    });
  };

  // Bulk-set marks on a set of questions (identified by _id/id) within a
  // section in one go, instead of opening each question's editor.
  const setMarksForQuestions = (si, ids, marks) => {
    setForm(p => {
      const s = [...p.sections];
      s[si] = {
        ...s[si],
        questions: s[si].questions.map(q =>
          ids.has(q._id || q.id) ? { ...q, marks } : q
        ),
      };
      return { ...p, sections: s };
    });
  };

  const removeQuestion = (si, qi) => {
    setForm(p => {
      const s = [...p.sections];
      s[si] = { ...s[si], questions: s[si].questions.filter((_, i) => i !== qi) };
      return { ...p, sections: s };
    });
  };

  const removeSection = (si) => {
    setForm(p => {
      const s = p.sections.filter((_, i) => i !== si);
      return { ...p, sections: s };
    });
    setActiveSection(Math.max(0, activeSection - 1));
  };

  const handleSave = (status) => {
    if (!form.title.trim()) {
      toast.error('Test title is required');
      setStep(0);
      return;
    }
    const depts = form.departments || [];
    if (!depts.length && form.department) {
      depts.push(form.department);
    }
    if (depts.length === 0) {
      toast.error('At least one target department is required');
      setStep(0);
      return;
    }

    const payload = {
      title: form.title,
      description: form.description,
      status: status || form.status,
      startTime: convertToUTC(form.startTime),
      endTime: convertToUTC(form.endTime),
      durationMinutes: form.durationMinutes,
      department: depts.includes('all') ? 'all' : depts[0],
      departments: depts,
      years: form.years || [],
      classes: form.classes || [],
      settings: form.settings,
      sections: form.sections.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        questions: s.questions.map(q => ({ ...q, imageUrl: q.imageUrl || q.image_url, optionImages: q.optionImages || q.option_images || [] })),
      })),
    };
    saveMut.mutate(payload);
  };

  // "Topic" means genre for aptitude questions and the free-text tags
  // field for coding problems — both are treated the same way below so
  // one filter bar works for either section type.
  const sec = form.sections[activeSection];
  const topicTokens = (q) =>
    sec?.type === 'aptitude'
      ? [q.genre || 'general']
      : String(q.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const topicOf = (q) => (sec?.type === 'aptitude' ? (q.genre || 'general') : (q.tags || ''));

  // These three hooks — and everything below them, down to `visibleQuestions`
  // — must run on every render, loading or not: React tracks hooks by call
  // order, and the `if (loadingTest) return` below used to sit ABOVE them,
  // so the very first render (loadingTest=true) skipped all three while a
  // later render (loadingTest=false) called them — a different hook count
  // between renders, which is what threw "Rendered more hooks than during
  // the previous render" (React error #310) every time this page opened in
  // edit mode. `sec`/`form.sections` are just empty during that initial
  // loading render, which each memo below already handles via its `!sec`
  // guard, so moving them earlier changes nothing about what they compute.
  const topicOptions = useMemo(() => {
    if (!sec) return [];
    const set = new Set();
    sec.questions.forEach(q => topicTokens(q).forEach(t => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec]);

  const typeOptions = useMemo(() => {
    if (!sec || sec.type !== 'aptitude') return [];
    return [...new Set(sec.questions.map(q => q.type).filter(Boolean))].sort();
  }, [sec]);

  const isQFiltered = qFilter.topic !== 'all' || qFilter.type !== 'all'
    || qFilter.difficulty !== 'all' || qFilter.minMarks !== '' || qFilter.maxMarks !== '';

  const visibleQuestions = useMemo(() => {
    if (!sec) return [];
    let list = sec.questions.map((q, qi) => ({ q, qi }));

    list = list.filter(({ q }) => {
      if (qFilter.topic !== 'all' && !topicTokens(q).includes(qFilter.topic)) return false;
      if (qFilter.type !== 'all' && q.type !== qFilter.type) return false;
      if (qFilter.difficulty !== 'all' && q.difficulty !== qFilter.difficulty) return false;
      if (qFilter.minMarks !== '' && (q.marks || 0) < Number(qFilter.minMarks)) return false;
      if (qFilter.maxMarks !== '' && (q.marks || 0) > Number(qFilter.maxMarks)) return false;
      return true;
    });

    if (qSort.field !== 'none') {
      const dir = qSort.dir === 'asc' ? 1 : -1;
      const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
      list = [...list].sort((a, b) => {
        let av, bv;
        switch (qSort.field) {
          case 'marks': av = a.q.marks || 0; bv = b.q.marks || 0; break;
          case 'difficulty': av = difficultyOrder[a.q.difficulty] ?? 1; bv = difficultyOrder[b.q.difficulty] ?? 1; break;
          case 'topic': av = topicOf(a.q).toLowerCase(); bv = topicOf(b.q).toLowerCase(); break;
          case 'type': av = a.q.type || ''; bv = b.q.type || ''; break;
          default: av = 0; bv = 0;
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec, qFilter, qSort]);

  if (loadingTest)
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} className="text-accent" />
      </div>
    );

  const STEPS = ['Configuration', 'Questions', 'Review & Publish'];
  const totalQ = form.sections.reduce((n, s) => n + s.questions.length, 0);
  const totalM = form.sections.reduce(
    (n, s) => n + s.questions.reduce((m, q) => m + (q.marks || 0), 0),
    0,
  );

  return (
    <div className="animate-fade-up">
      {/* Header — sticky so Save/Publish stay reachable while scrolling
          through a long question list on the Questions step. */}
      <div className="sticky top-11 lg:top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-5 bg-deck/95 backdrop-blur-sm border-b border-rim flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/tests')}
            className="btn-ghost-icon"
            aria-label="Back to tests"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-display font-bold text-ink">
              {isEdit ? 'Edit Test' : 'Create Test'}
            </h1>
            {form.title && (
              <p className="text-xs text-annotation/60">{form.title}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Btn
            variant="ghost"
            onClick={() => handleSave('draft')}
            disabled={saveMut.isLoading}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save Draft
          </Btn>
          <Btn
            variant="primary"
            onClick={() => handleSave('published')}
            disabled={saveMut.isLoading}
          >
            {saveMut.isLoading ? 'Saving…' : 'Publish'}
          </Btn>
        </div>
      </div>

      {/* Step tabs */}
      <Tabs
        tabs={STEPS.map((s, i) => ({ id: i.toString(), label: `${i + 1}. ${s}` }))}
        active={step.toString()}
        onChange={v => setStep(parseInt(v))}
      />

      <div className="mt-5">
        {/* Step 0: Configuration */}
        {step === 0 && (
          <div className="panel p-5 space-y-5">
            <h2 className="text-sm font-display font-bold text-ink">
              Test Configuration
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Test Title *"
                value={form.title}
                onChange={e => upd('title', e.target.value)}
                placeholder="e.g. Campus Placement Drive – Round 1"
              />
              <Select
                label="Status"
                value={form.status}
                onChange={e => upd('status', e.target.value)}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </div>
            <Textarea
              label="Description / Instructions"
              value={form.description}
              onChange={e => upd('description', e.target.value)}
              placeholder="Instructions shown to students before starting..."
              rows={3}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Start Date & Time"
                type="datetime-local"
                value={form.startTime}
                onChange={e => upd('startTime', e.target.value)}
              />
              <Input
                label="End Date & Time"
                type="datetime-local"
                value={form.endTime}
                onChange={e => upd('endTime', e.target.value)}
              />
              <Input
                label="Duration (minutes)"
                type="number"
                min={10}
                max={480}
                value={form.durationMinutes}
                onChange={e => upd('durationMinutes', +e.target.value)}
                disabled={!!form.settings.splitTimers}
                hint={form.settings.splitTimers ? 'Auto-computed from MCQ + Coding limits below' : undefined}
              />
              <div className="col-span-1 md:col-span-3">
                <label className="input-label">Target Departments/Branches *</label>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-panel border border-rim rounded-xl">
                  <label className="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                    <input
                      type="checkbox"
                      checked={form.departments?.includes('all')}
                      onChange={e => {
                        if (e.target.checked) {
                          upd('departments', ['all']);
                          upd('department', 'all');
                        } else {
                          upd('departments', []);
                          upd('department', '');
                        }
                      }}
                      className="accent-accent w-4 h-4 rounded cursor-pointer"
                    />
                    <span className="font-bold text-accent">All Departments</span>
                  </label>
                  {DEPARTMENTS.map(dept => (
                    <label key={dept} className="flex items-center gap-2.5 text-sm text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                      <input
                        type="checkbox"
                        checked={form.departments?.includes(dept)}
                        onChange={e => {
                          let depts = form.departments || [];
                          if (depts.includes('all')) {
                            depts = [];
                          }
                          if (e.target.checked) {
                            depts = [...depts, dept];
                          } else {
                            depts = depts.filter(d => d !== dept);
                          }
                          upd('departments', depts);
                          upd('department', depts[0] || '');
                        }}
                        className="accent-accent w-4 h-4 rounded cursor-pointer"
                      />
                      <span>{dept}</span>
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-annotation/60 mt-1.5">
                  Select "All Departments" to show this test to all students, or choose specific branches.
                </p>
              </div>
            </div>

            {/* Years & Classes targeting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="input-label">Target Years (optional)</label>
                <div className="mt-2 p-4 bg-panel border border-rim rounded-xl">
                  <label className="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                    <input
                      type="checkbox"
                      checked={form.years?.includes('all')}
                      onChange={e => upd('years', e.target.checked ? ['all'] : [])}
                      className="accent-accent w-4 h-4 rounded cursor-pointer"
                    />
                    <span className="font-bold text-accent">All Years</span>
                  </label>
                  {targetYears.map(y => (
                    <label key={y} className="flex items-center gap-2.5 text-sm text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                      <input
                        type="checkbox"
                        checked={form.years?.includes(String(y))}
                        onChange={e => {
                          let ys = form.years?.includes('all') ? [] : (form.years || []);
                          if (e.target.checked) {
                            ys = [...ys, String(y)];
                          } else {
                            ys = ys.filter(v => v !== String(y));
                          }
                          upd('years', ys);
                        }}
                        className="accent-accent w-4 h-4 rounded cursor-pointer"
                      />
                      <span>Year {y}</span>
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-annotation/60 mt-1.5">
                  Leave all unchecked (or select "All Years") to include students from every year.
                </p>
              </div>
              <div>
                <label className="input-label">Target Classes (optional)</label>
                <div className="mt-2 p-4 bg-panel border border-rim rounded-xl">
                  <label className="flex items-center gap-2.5 text-sm font-medium text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                    <input
                      type="checkbox"
                      checked={form.classes?.includes('all')}
                      onChange={e => upd('classes', e.target.checked ? ['all'] : [])}
                      className="accent-accent w-4 h-4 rounded cursor-pointer"
                    />
                    <span className="font-bold text-accent">All Classes</span>
                  </label>
                  {targetClasses.map(c => (
                    <label key={c} className="flex items-center gap-2.5 text-sm text-ink cursor-pointer hover:bg-rim/30 p-1.5 rounded-lg transition-colors">
                      <input
                        type="checkbox"
                        checked={form.classes?.includes(c)}
                        onChange={e => {
                          let cl = form.classes?.includes('all') ? [] : (form.classes || []);
                          if (e.target.checked) {
                            cl = [...cl, c];
                          } else {
                            cl = cl.filter(v => v !== c);
                          }
                          upd('classes', cl);
                        }}
                        className="accent-accent w-4 h-4 rounded cursor-pointer"
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-annotation/60 mt-1.5">
                  Leave all unchecked (or select "All Classes") to include students from every class.
                </p>
              </div>
            </div>

            {/* Independent MCQ / Coding round timers */}
            <div className="border-t border-rim pt-5">
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent w-4 h-4"
                  checked={!!form.settings.splitTimers}
                  onChange={e => {
                    const on = e.target.checked;
                    updSettings('splitTimers', on);
                    if (on) {
                      const mcq = form.settings.mcqDurationMinutes || 60;
                      const coding = form.settings.codingDurationMinutes || 60;
                      updSettings('mcqDurationMinutes', mcq);
                      updSettings('codingDurationMinutes', coding);
                      upd('durationMinutes', mcq + coding);
                    }
                  }}
                />
                <span className="text-sm font-display font-bold text-ink flex items-center gap-1.5">
                  Independent MCQ / Coding time limits
                  <HelpTip text="When enabled, the aptitude and coding rounds each get their own clock. Once the MCQ clock runs out, students are locked out of MCQ questions and moved into coding; the overall Duration field above is kept in sync automatically." />
                </span>
              </label>
              {form.settings.splitTimers && (
                <div className="grid grid-cols-2 gap-4 max-w-md">
                  <Input
                    label="MCQ Time Limit (minutes)"
                    type="number"
                    min={5}
                    max={300}
                    value={form.settings.mcqDurationMinutes || 60}
                    onChange={e => {
                      const mcq = +e.target.value;
                      updSettings('mcqDurationMinutes', mcq);
                      upd('durationMinutes', mcq + (form.settings.codingDurationMinutes || 60));
                    }}
                  />
                  <Input
                    label="Coding Time Limit (minutes)"
                    type="number"
                    min={5}
                    max={300}
                    value={form.settings.codingDurationMinutes || 60}
                    onChange={e => {
                      const coding = +e.target.value;
                      updSettings('codingDurationMinutes', coding);
                      upd('durationMinutes', (form.settings.mcqDurationMinutes || 60) + coding);
                    }}
                  />
                </div>
              )}
            </div>

            {/* Settings section */}
            <div className="border-t border-rim pt-5">
              <h3 className="text-sm font-display font-bold text-ink mb-4">
                Test Settings
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Input
                  label="Passing Score (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={form.settings.passingScore}
                  onChange={e => updSettings('passingScore', +e.target.value)}
                />
                <Select
                  label={
                    <span className="flex items-center gap-1.5">
                      Show Results <HelpTip text="When students can see scores: 'After Submission' (immediate), 'After End' (test window closes), 'Manual' (admin releases), 'Never' (admin only)." />
                    </span>
                  }
                  value={form.settings.showResults}
                  onChange={e => updSettings('showResults', e.target.value)}
                >
                  <option value="after_submit">After Submission</option>
                  <option value="after_end">After Test Ends</option>
                  <option value="manual">Manual (Admin)</option>
                  <option value="never">Never (Admin Only)</option>
                </Select>
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="mt-5 flex items-center gap-2 text-xs font-medium text-annotation/70 hover:text-ink transition-colors w-full text-left"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" d="M9 18l6-6-6-6" />
                </svg>
                Advanced Settings
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-4 animate-fade-up">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label={
                        <span className="flex items-center gap-1.5">
                          Allowed Branches <HelpTip text="Comma-separated branch names. Leave blank for all branches. Example: Computer Engineering, Information Technology" />
                        </span>
                      }
                      value={form.settings.allowedBranches}
                      onChange={e => updSettings('allowedBranches', e.target.value)}
                      placeholder="Computer Engineering, Information Technology"
                    />
                  </div>
                  <div className="flex gap-5 flex-wrap">
                    {[
                      ['shuffleQuestions', 'Shuffle Questions'],
                      ['shuffleOptions', 'Shuffle Options'],
                      ['negativeMarking', <span className="flex items-center gap-1.5">Negative Marking <HelpTip text="Deducts a fraction of the marks for each wrong answer. Only applies to MCQ questions. The fraction is multiplied by the question's marks." /></span>],
                    ].map(([f, l]) => (
                      <label
                        key={f}
                        className="flex items-center gap-2 text-sm text-ink cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={form.settings[f]}
                          onChange={e => updSettings(f, e.target.checked)}
                          className="accent-accent w-4 h-4"
                        />
                        {l}
                      </label>
                    ))}
                    {form.settings.negativeMarking && (
                      <Input
                        label={
                          <span className="flex items-center gap-1.5">
                            Deduction (fraction) <HelpTip text="Portion of the question's marks deducted per wrong answer. E.g. 0.25 on a 2-mark question deducts 0.5 marks. Typical range: 0.25–0.50" />
                          </span>
                        }
                        type="number"
                        step={0.25}
                        min={0}
                        max={1}
                        value={form.settings.negativeFraction}
                        onChange={e => updSettings('negativeFraction', +e.target.value)}
                        className="w-28"
                      />
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <p className="text-2xs text-annotation/70 font-mono uppercase tracking-wider mb-2">
                  Allowed Coding Languages
                </p>
                <div className="flex gap-4 flex-wrap">
                  {['python', 'javascript', 'java', 'cpp', 'c', 'sql'].map(lang => (
                    <label
                      key={lang}
                      className="flex items-center gap-1.5 text-sm text-ink cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.settings.allowedLanguages?.includes(lang)}
                        onChange={e => {
                          const al = form.settings.allowedLanguages || [];
                          updSettings(
                            'allowedLanguages',
                            e.target.checked
                              ? [...al, lang]
                              : al.filter(l => l !== lang),
                          );
                        }}
                        className="accent-accent"
                      />
                      {lang}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Btn variant="primary" onClick={() => setStep(1)}>
                Next: Add Questions →
              </Btn>
            </div>
          </div>
        )}

        {/* Step 1: Questions */}
        {step === 1 && (
          <div>
            {/* Section tabs */}
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              {form.sections.map((s, i) => (
                <div key={s._id || s.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveSection(i)}
                    className={`tab-btn ${
                      activeSection === i
                        ? 'tab-btn--active'
                        : 'tab-btn--inactive border border-rim'
                    }`}
                  >
                    {s.name} ({s.questions.length})
                  </button>
                  <button
                    onClick={() => removeSection(i)}
                    className="btn-ghost-icon text-annotation hover:text-alert"
                    aria-label={`Remove ${s.name}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="flex gap-1 ml-1">
                <Btn variant="ghost" size="sm" onClick={() => addSection('aptitude')}>
                  + Aptitude
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => addSection('coding')}>
                  + Coding
                </Btn>
              </div>
            </div>

            {form.sections.length === 0 && (
              <div className="panel-muted border-dashed border-2 p-12 text-center">
                <p className="text-sm text-annotation/70 mb-4">
                  No sections yet. Add an Aptitude or Coding section to begin.
                </p>
                <div className="flex gap-3 justify-center">
                  <Btn variant="outline" onClick={() => addSection('aptitude')}>
                    + Aptitude Section
                  </Btn>
                  <Btn variant="outline" onClick={() => addSection('coding')}>
                    + Coding Section
                  </Btn>
                </div>
              </div>
            )}

            {sec && (
              <div className="panel p-4">
                <div className="flex gap-3 mb-4 items-center">
                  <Input
                    value={sec.name}
                    onChange={e => updateSection(activeSection, 'name', e.target.value)}
                    placeholder="Section name"
                    className="w-40 text-sm"
                  />
                  <Select
                    value={sec.type}
                    onChange={e => updateSection(activeSection, 'type', e.target.value)}
                    className="w-32 text-sm"
                  >
                    <option value="aptitude">Aptitude</option>
                    <option value="coding">Coding</option>
                  </Select>
                  <span className="text-xs text-annotation/60 font-mono">
                    {sec.questions.length} questions ·{' '}
                    {sec.questions.reduce((m, q) => m + (q.marks || 0), 0)} marks
                  </span>
                </div>

                {sec.questions.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2 mb-4 p-2.5 bg-sunken rounded-lg">
                    <div>
                      <label className="text-2xs text-annotation/60 block mb-1">Topic</label>
                      <Select
                        value={qFilter.topic}
                        onChange={e => setQFilter(f => ({ ...f, topic: e.target.value }))}
                        className="w-36 text-xs py-1"
                      >
                        <option value="all">All topics</option>
                        {topicOptions.map(t => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    </div>
                    {sec.type === 'aptitude' && (
                      <div>
                        <label className="text-2xs text-annotation/60 block mb-1">Type</label>
                        <Select
                          value={qFilter.type}
                          onChange={e => setQFilter(f => ({ ...f, type: e.target.value }))}
                          className="w-32 text-xs py-1"
                        >
                          <option value="all">All types</option>
                          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </Select>
                      </div>
                    )}
                    <div>
                      <label className="text-2xs text-annotation/60 block mb-1">Difficulty</label>
                      <Select
                        value={qFilter.difficulty}
                        onChange={e => setQFilter(f => ({ ...f, difficulty: e.target.value }))}
                        className="w-28 text-xs py-1"
                      >
                        <option value="all">All</option>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </Select>
                    </div>
                    <div>
                      <label className="text-2xs text-annotation/60 block mb-1">Marks</label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={qFilter.minMarks}
                          onChange={e => setQFilter(f => ({ ...f, minMarks: e.target.value }))}
                          placeholder="Min"
                          className="w-16 text-xs py-1"
                        />
                        <span className="text-annotation/40">–</span>
                        <Input
                          type="number"
                          value={qFilter.maxMarks}
                          onChange={e => setQFilter(f => ({ ...f, maxMarks: e.target.value }))}
                          placeholder="Max"
                          className="w-16 text-xs py-1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-2xs text-annotation/60 block mb-1">Sort by</label>
                      <div className="flex items-center gap-1">
                        <Select
                          value={qSort.field}
                          onChange={e => setQSort(s => ({ ...s, field: e.target.value }))}
                          className="w-28 text-xs py-1"
                        >
                          <option value="none">Added order</option>
                          <option value="marks">Marks</option>
                          <option value="difficulty">Difficulty</option>
                          <option value="topic">Topic</option>
                          {sec.type === 'aptitude' && <option value="type">Type</option>}
                        </Select>
                        <button
                          type="button"
                          disabled={qSort.field === 'none'}
                          onClick={() => setQSort(s => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
                          className="btn-ghost-icon disabled:opacity-30 disabled:cursor-not-allowed"
                          title={qSort.dir === 'asc' ? 'Ascending' : 'Descending'}
                          aria-label="Toggle sort direction"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            {qSort.dir === 'asc'
                              ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m6 8V4m0 16l-4-4m4 4l4-4" />
                              : <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h5m-5 4h9m-9 4h13M17 4v16m0 0l-4-4m4 4l4-4" />}
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1" />
                    <span className="text-2xs text-annotation/60 whitespace-nowrap pb-1.5">
                      Showing {visibleQuestions.length} of {sec.questions.length}
                    </span>
                    {isQFiltered && (
                      <button
                        type="button"
                        onClick={() => setQFilter(DEFAULT_Q_FILTER)}
                        className="text-2xs text-accent hover:underline pb-1.5"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}

                {sec.questions.length > 0 && visibleQuestions.length === 0 && (
                  <div className="panel-muted border-dashed border-2 p-6 text-center mb-3">
                    <p className="text-sm text-annotation/70">No questions match these filters.</p>
                  </div>
                )}

                {visibleQuestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-sunken rounded-lg">
                    <label className="flex items-center gap-1.5 text-xs text-annotation cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleQuestions.every(({ q }) => selectedQs.has(q._id || q.id))}
                        onChange={() => {
                          const visIds = visibleQuestions.map(({ q }) => q._id || q.id);
                          const allSelected = visIds.every(qid => selectedQs.has(qid));
                          setSelectedQs(allSelected ? new Set() : new Set(visIds));
                        }}
                        className="accent-accent w-3.5 h-3.5 cursor-pointer"
                      />
                      Select all ({visibleQuestions.length})
                    </label>
                    {selectedQs.size > 0 && (
                      <>
                        <span className="text-2xs text-annotation/60">{selectedQs.size} selected</span>
                        <Input
                          type="number"
                          value={bulkMarks}
                          onChange={e => setBulkMarks(e.target.value)}
                          placeholder="Marks"
                          className="w-20 text-xs py-1"
                        />
                        <Btn
                          size="sm"
                          variant="ghost"
                          disabled={bulkMarks === '' || Number.isNaN(Number(bulkMarks))}
                          onClick={() => {
                            setMarksForQuestions(activeSection, selectedQs, Number(bulkMarks));
                            toast.success(`Set marks to ${bulkMarks} for ${selectedQs.size} question${selectedQs.size === 1 ? '' : 's'}`);
                            setSelectedQs(new Set());
                            setBulkMarks('');
                          }}
                        >
                          Apply to selected
                        </Btn>
                      </>
                    )}
                  </div>
                )}

                {visibleQuestions.map(({ q, qi }) => (
                  <div key={q._id || q.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="checkbox"
                        checked={selectedQs.has(q._id || q.id)}
                        onChange={() => setSelectedQs(prev => {
                          const next = new Set(prev);
                          const key = q._id || q.id;
                          next.has(key) ? next.delete(key) : next.add(key);
                          return next;
                        })}
                        className="accent-accent w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-bold text-annotation/60">
                        Q{qi + 1}
                      </span>
                    </div>
                    {sec.type === 'aptitude' ? (
                      <AptQEditor
                        q={q}
                        index={qi}
                        onChange={nq => updateQuestion(activeSection, qi, nq)}
                        onRemove={() => removeQuestion(activeSection, qi)}
                      />
                    ) : (
                      <CodeQEditor
                        q={q}
                        onChange={nq => updateQuestion(activeSection, qi, nq)}
                        onRemove={() => removeQuestion(activeSection, qi)}
                      />
                    )}
                  </div>
                ))}

                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => addQuestion(activeSection)}
                    className="flex-1 border-2 border-dashed border-rim rounded-xl py-3.5 text-sm text-annotation/60 hover:border-accent hover:text-accent transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add{' '}
                    {sec.type === 'aptitude' ? 'Aptitude Question' : 'Coding Problem'}
                  </button>
                  <button
                    onClick={() => setBankOpen(true)}
                    className="border-2 border-dashed border-rim rounded-xl py-3.5 px-4 text-sm text-annotation/60 hover:border-accent hover:text-accent transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Add from Bank
                  </button>
                </div>

                <BankPickerModal
                  open={bankOpen}
                  onClose={() => setBankOpen(false)}
                  type={sec.type === 'aptitude' ? 'mcq' : 'coding'}
                  alreadyAddedIds={sec.questions.map(q => q.bankQuestionId).filter(Boolean)}
                  onPick={(bankQs) => addQuestionsFromBank(activeSection, bankQs)}
                />
              </div>
            )}

            <div className="flex justify-between mt-4">
              <Btn variant="ghost" onClick={() => setStep(0)}>
                ← Back
              </Btn>
              <Btn variant="primary" onClick={() => setStep(2)}>
                Review & Publish →
              </Btn>
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <ReviewPanel form={form} totalQ={totalQ} totalM={totalM} handleSave={handleSave} saveMut={saveMut} setStep={setStep} />
        )}
      </div>
    </div>
  );
}
