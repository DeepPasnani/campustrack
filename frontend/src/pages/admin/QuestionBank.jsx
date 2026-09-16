import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { questionBankAPI, uploadAPI } from '../../services/api';
import { Btn, Input, Select, Textarea, Badge, Table, Modal, ConfirmModal, Tabs, Spinner, Alert } from '../../components/shared/UI';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Question Bank — reusable MCQ + coding questions that admins
 * build up over time and pull straight into any test, instead
 * of retyping the same aptitude/DSA questions every drive.
 *
 * Feature ported over from the Next.js UI-redesign prototype
 * and wired to a real Postgres-backed endpoint here.
 * ═══════════════════════════════════════════════════════════ */

const GENRES = [
  { value: 'general', label: 'General' },
  { value: 'quantitative', label: 'Quantitative' },
  { value: 'aptitude', label: 'General Aptitude' },
  { value: 'technical', label: 'Technical' },
  { value: 'verbal', label: 'Verbal Reasoning' },
  { value: 'logical', label: 'Logical' },
  { value: 'data_interpretation', label: 'Data Interpretation' },
];

const SAMPLE_JSON = `[
  {
    "text": "What is the time complexity of inserting into a min-heap?",
    "options": ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
    "correctAnswer": 1,
    "genre": "technical",
    "difficulty": "medium",
    "marks": 2
  },
  {
    "text": "Which diagram shows a valid binary search tree?",
    "imageUrl": "/api/images/<id-from-upload>",
    "options": ["Diagram A", "Diagram B", "Diagram C", "Diagram D"],
    "optionImages": ["/api/images/<id-A>", "/api/images/<id-B>", "", ""],
    "correctAnswer": 0,
    "genre": "technical",
    "difficulty": "medium",
    "marks": 2
  }
]`;

export default function QuestionBank() {
  const [tab, setTab] = useState('mcq');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-display font-bold text-ink">Question Bank</h1>
          <p className="text-xs text-annotation mt-0.5">Reusable MCQ and coding questions — pull them into any test from the Test Creator.</p>
        </div>
      </div>
      <Tabs
        tabs={[{ id: 'mcq', label: 'MCQ Questions' }, { id: 'coding', label: 'Coding Questions' }]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === 'mcq' ? <McqBankTab /> : <CodingBankTab />}
      </div>
    </div>
  );
}

function UsedInBadge({ q }) {
  const usedIn = q.used_in || q.usedIn || [];
  const count = q.usage_count ?? q.usageCount ?? usedIn.length;
  if (!count) return <span className="text-2xs text-annotation/40">Unused</span>;
  const titles = usedIn.map(u => u.testTitle).filter(Boolean).join(', ');
  return (
    <span className="text-2xs text-annotation" title={titles}>
      Used in {count} test{count === 1 ? '' : 's'}
    </span>
  );
}

// Clusters bank questions by the test(s) they've been used in — an
// "Unused" bucket holds anything never pulled into a test. A question
// used in more than one test appears under each of those tests.
function clusterByTest(questions) {
  const clusters = new Map();
  const unused = [];
  for (const q of questions) {
    const usedIn = q.used_in || q.usedIn || [];
    if (!usedIn.length) { unused.push(q); continue; }
    for (const u of usedIn) {
      const key = u.testTitle || 'Untitled test';
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(q);
    }
  }
  const groups = [...clusters.entries()].map(([testTitle, qs]) => ({ testTitle, questions: qs }));
  groups.sort((a, b) => a.testTitle.localeCompare(b.testTitle));
  if (unused.length) groups.push({ testTitle: 'Unused', questions: unused });
  return groups;
}

// Bulk "set marks" modal shared by both the MCQ and Coding bank tabs —
// applies one marks value to every selected bank question at once.
function BulkMarksModal({ isOpen, count, onClose, onConfirm, isLoading }) {
  const [marks, setMarks] = useState('');
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Set marks for selected">
      <p className="text-sm text-annotation mb-3">
        Apply one marks value to all {count} selected question{count === 1 ? '' : 's'}.
      </p>
      <Input
        type="number"
        min="0"
        value={marks}
        onChange={e => setMarks(e.target.value)}
        placeholder="Marks"
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-4">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn
          disabled={marks === '' || Number.isNaN(Number(marks)) || Number(marks) < 0 || isLoading}
          onClick={() => onConfirm(Number(marks))}
        >
          {isLoading ? 'Applying…' : 'Apply'}
        </Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
// MCQ Tab
// ═══════════════════════════════════════════════════════════
function McqBankTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [imagesOpen, setImagesOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkMarksOpen, setBulkMarksOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['question-bank', 'mcq', genre, search],
    queryFn: () => questionBankAPI.list({ type: 'mcq', genre: genre === 'all' ? undefined : genre, search: search || undefined }),
  });

  const deleteMut = useMutation({
    mutationFn: questionBankAPI.delete,
    onSuccess: () => { toast.success('Question removed'); qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] }); },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: questionBankAPI.bulkDelete,
    onSuccess: (res) => {
      toast.success(`${res.deleted} question${res.deleted === 1 ? '' : 's'} removed`);
      setSelected(new Set());
      setBulkDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete questions'),
  });

  const bulkMarksMut = useMutation({
    mutationFn: ({ marks }) => questionBankAPI.bulkUpdateMarks([...selected], marks),
    onSuccess: (res) => {
      toast.success(`Updated marks for ${res.updated} question${res.updated === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkMarksOpen(false);
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update marks'),
  });

  const questions = data?.questions || [];

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allVisibleSelected = questions.length > 0 && questions.every(q => selected.has(q.id));
  const toggleAllVisible = () => setSelected(
    allVisibleSelected ? new Set() : new Set(questions.map(q => q.id))
  );

  const columns = [
    { key: 'select', label: (
      <input
        type="checkbox"
        aria-label="Select all questions"
        checked={allVisibleSelected}
        onChange={toggleAllVisible}
        className="accent-accent w-3.5 h-3.5 cursor-pointer"
      />
    ), render: (r) => (
      <input
        type="checkbox"
        aria-label={`Select ${r.data?.text || 'question'}`}
        checked={selected.has(r.id)}
        onChange={() => toggleOne(r.id)}
        className="accent-accent w-3.5 h-3.5 cursor-pointer"
      />
    ) },
    { key: 'idx', label: '#', render: (_, i) => <span className="text-annotation">{i + 1}</span> },
    { key: 'text', label: 'Question', render: (r) => <span className="line-clamp-2 max-w-md block">{r.data?.text}</span> },
    { key: 'genre', label: 'Genre', render: (r) => <Badge color="clarify">{GENRES.find(g => g.value === r.genre)?.label || r.genre}</Badge> },
    { key: 'difficulty', label: 'Difficulty', render: (r) => <Badge color={r.difficulty === 'hard' ? 'alert' : r.difficulty === 'easy' ? 'verify' : 'accent'}>{r.difficulty}</Badge> },
    { key: 'marks', label: 'Marks' },
    { key: 'usedIn', label: 'Used In', render: (r) => <UsedInBadge q={r} /> },
    { key: 'actions', label: '', align: 'text-right', render: (r) => (
      <button className="text-alert text-xs hover:underline" onClick={() => setDeleteId(r.id)}>Delete</button>
    ) },
  ];

  const clusters = groupBy === 'test' ? clusterByTest(questions) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search questions..." value={search} onChange={e => { setSearch(e.target.value); setSelected(new Set()); }} className="max-w-xs" />
        <Select value={genre} onChange={e => { setGenre(e.target.value); setSelected(new Set()); }} className="w-48">
          <option value="all">All genres</option>
          {GENRES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        <Select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="w-44">
          <option value="none">No grouping</option>
          <option value="test">Group by test used in</option>
        </Select>
        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <>
              <Btn variant="ghost" onClick={() => setBulkMarksOpen(true)}>
                Set Marks ({selected.size})
              </Btn>
              <Btn variant="danger" onClick={() => setBulkDeleteOpen(true)}>
                Delete Selected ({selected.size})
              </Btn>
            </>
          )}
          <Btn variant="ghost" onClick={() => setImagesOpen(true)}>Import Images</Btn>
          <Btn variant="ghost" onClick={() => setImportOpen(true)}>Import JSON</Btn>
          <Btn onClick={() => setCreateOpen(true)}>New Question</Btn>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : clusters ? (
        <div className="space-y-4">
          {clusters.map(cluster => (
            <div key={cluster.testTitle} className="panel p-3">
              <p className="text-xs font-display font-bold text-ink mb-2">
                {cluster.testTitle} <span className="text-annotation font-normal font-mono">({cluster.questions.length})</span>
              </p>
              <Table columns={columns} data={cluster.questions} emptyMessage="No questions." />
            </div>
          ))}
          {!clusters.length && <div className="empty-state"><p className="empty-state-title">No MCQ questions in the bank yet.</p></div>}
        </div>
      ) : (
        <Table columns={columns} data={questions} emptyMessage="No MCQ questions in the bank yet." />
      )}

      <McqCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <McqImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <McqImageImportModal open={imagesOpen} onClose={() => setImagesOpen(false)} />
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Delete question"
        message="Remove this question from the bank? Tests that already used it are unaffected."
      />
      <ConfirmModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => bulkDeleteMut.mutate([...selected])}
        title="Delete selected questions"
        message={`Remove ${selected.size} question${selected.size === 1 ? '' : 's'} from the bank? Tests that already used them are unaffected. This can't be undone.`}
      />
      <BulkMarksModal
        isOpen={bulkMarksOpen}
        count={selected.size}
        onClose={() => setBulkMarksOpen(false)}
        onConfirm={(marks) => bulkMarksMut.mutate({ marks })}
        isLoading={bulkMarksMut.isLoading}
      />
    </div>
  );
}

// Bulk image → draft-question capture: pick several image files (e.g.
// screenshots of quant/DI figures or a scanned worksheet split into
// per-question crops) and each becomes its own draft MCQ bank entry
// with the image attached, ready to fill in text/options afterwards.
function McqImageImportModal({ open, onClose }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState([]);

  const importMut = useMutation({
    mutationFn: (fileList) => {
      const fd = new FormData();
      fileList.forEach(f => fd.append('images', f));
      return questionBankAPI.importImages(fd);
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Images imported');
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
      setFiles([]);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Import failed'),
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="Import Image-Based Questions" width="max-w-xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={() => importMut.mutate(files)} disabled={!files.length || importMut.isLoading}>{importMut.isLoading ? <Spinner size={14} /> : `Add ${files.length || ''} Draft Question(s)`}</Btn></>}>
      <div className="space-y-3">
        <Alert type="info">
          Each image becomes its own draft MCQ in the bank with the image attached — fill in the
          question text, options, and correct answer afterwards. Good for scanned worksheets or
          screenshotted diagram/DI questions.
        </Alert>
        <label className="focus-ring block">
          <span className="input-label">Select images</span>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Select question images"
            onChange={e => setFiles(Array.from(e.target.files || []))}
            className="text-xs text-annotation file:mr-2 file:py-1 file:px-3 file:rounded file:border file:border-rim file:text-xs file:bg-panel file:text-ink hover:file:bg-sunken transition-colors block w-full"
          />
        </label>
        {files.length > 0 && (
          <ul className="text-xs text-annotation space-y-0.5 max-h-32 overflow-y-auto">
            {files.map((f, i) => <li key={i} className="truncate">{f.name}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function McqCreateModal({ open, onClose }) {
  const qc = useQueryClient();
  const [genre, setGenre] = useState('general');
  const [difficulty, setDifficulty] = useState('medium');
  const [text, setText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState(0);
  const [marks, setMarks] = useState(2);

  const reset = () => { setGenre('general'); setDifficulty('medium'); setText(''); setOptions(['', '', '', '']); setCorrect(0); setMarks(2); };

  const createMut = useMutation({
    mutationFn: questionBankAPI.create,
    onSuccess: () => {
      toast.success('Question added to bank');
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
      reset();
      onClose();
    },
  });

  const save = () => {
    if (!text.trim()) return toast.error('Question text is required');
    if (options.some(o => !o.trim())) return toast.error('All four options are required');
    createMut.mutate({
      type: 'mcq',
      genre, difficulty, marks,
      data: { text: text.trim(), options: options.map(o => o.trim()), correctAnswer: correct },
    });
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="New MCQ Question" width="max-w-xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={createMut.isLoading}>{createMut.isLoading ? <Spinner size={14} /> : 'Add to Bank'}</Btn></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Select label="Genre" value={genre} onChange={e => setGenre(e.target.value)}>
            {GENRES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </Select>
          <Select label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
          <Input label="Marks" type="number" min={1} max={20} value={marks} onChange={e => setMarks(+e.target.value)} />
        </div>
        <Textarea label="Question Text" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Enter question..." />
        <div>
          <label className="input-label">Options (select the correct one)</label>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Btn size="sm" variant={correct === i ? 'primary' : 'ghost'} className="w-9 shrink-0" onClick={() => setCorrect(i)}>{'ABCD'[i]}</Btn>
                <Input value={o} onChange={e => setOptions(options.map((x, j) => j === i ? e.target.value : x))} placeholder={`Option ${'ABCD'[i]}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const SAMPLE_CSV = `type,text,optionA,optionB,optionC,optionD,correctAnswer,title,description,sampleInput,sampleOutput,testCases,genre,difficulty,marks,imageUrl,optionAImage,optionBImage,optionCImage,optionDImage
mcq,"What is 2+2?",3,4,5,6,1,,,,,,quantitative,easy,2,,,,,
mcq,"Which diagram shows a valid binary search tree?",Diagram A,Diagram B,Diagram C,Diagram D,0,,,,,,technical,medium,2,,/api/images/<optionA-id>,/api/images/<optionB-id>,,
coding,,,,,,,Two Sum,Find indices summing to target,"9
[2,7,11,15]","[0,1]","[{ ""input"": ""9"", ""output"": ""0 1"" }]",,hard,10,/api/images/<diagram-id>,,,,`;

function McqImportModal({ open, onClose }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(null);
  const [importMode, setImportMode] = useState('json');

  const jsonMut = useMutation({
    mutationFn: questionBankAPI.importJson,
    onSuccess: (data) => {
      toast.success(data.message || 'Questions imported');
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
      setRaw(''); setError(null);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Import failed'),
  });

  const csvMut = useMutation({
    mutationFn: questionBankAPI.importCsv,
    onSuccess: (data) => {
      toast.success(`${data.created || 0} question(s) imported`);
      qc.invalidateQueries({ queryKey: ['question-bank', 'mcq'] });
      qc.invalidateQueries({ queryKey: ['question-bank', 'coding'] });
      setRaw(''); setError(null);
      onClose();
    },
    onError: (e) => {
      const err = e.response?.data;
      const msg = err?.error || 'Import failed';
      const details = err?.errors?.length ? ': ' + err.errors.slice(0, 3).map(e => e.message).join('; ') : '';
      toast.error(msg + details);
    },
  });

  const submitJson = () => {
    setError(null);
    try {
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error('JSON must be an array');
      items.forEach((it, i) => {
        if (!it.text || !Array.isArray(it.options) || typeof it.correctAnswer !== 'number') {
          throw new Error(`Item ${i + 1}: requires "text", "options" array, and numeric "correctAnswer"`);
        }
      });
      jsonMut.mutate({ items });
    } catch (e) {
      setError(e.message);
    }
  };

  const submitCsv = () => {
    setError(null);
    csvMut.mutate({ csv: raw });
  };

  const isJson = importMode === 'json';
  const loading = jsonMut.isLoading || csvMut.isLoading;

  return (
    <Modal isOpen={open} onClose={onClose} title="Import Questions" width="max-w-3xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={isJson ? submitJson : submitCsv} disabled={!raw.trim() || loading}>{loading ? <Spinner size={14} /> : 'Import'}</Btn></>}>
      <div className="space-y-4">
        {/* Format toggle using shared Tabs component */}
        <Tabs
          tabs={[
            { id: 'json', label: 'JSON' },
            { id: 'csv', label: 'CSV' },
          ]}
          active={importMode}
          onChange={setImportMode}
        />

        <ImageUrlHelper />

        {isJson ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="input-label">JSON data — array of question objects</label>
              <button className="text-xs text-accent hover:underline focus-ring rounded px-1" onClick={() => setRaw(SAMPLE_JSON)}>Load sample</button>
            </div>
            <p className="text-2xs text-annotation">
              Add an <code className="font-mono">imageUrl</code> (question figure) and/or an <code className="font-mono">optionImages</code> array
              (same order as <code className="font-mono">options</code>) to attach images — see the sample. Values can be a URL from the uploader
              above, or any publicly reachable image URL.
            </p>
            <Textarea rows={18} value={raw} onChange={e => setRaw(e.target.value)} placeholder={SAMPLE_JSON} className="font-mono text-xs resize-y" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="input-label">CSV data — paste or upload a file</label>
              <button className="text-xs text-accent hover:underline focus-ring rounded px-1" onClick={() => setRaw(SAMPLE_CSV)}>Load sample</button>
            </div>
            <p className="text-2xs text-annotation">
              Optional columns: <code className="font-mono">imageUrl</code> (question figure, both types) and, for MCQs,{' '}
              <code className="font-mono">optionAImage</code>…<code className="font-mono">optionDImage</code>. Leave a cell blank to skip it.
              A cell containing a comma or a quote must be wrapped in double quotes.
            </p>
            <Textarea rows={14} value={raw} onChange={e => setRaw(e.target.value)} placeholder="Paste CSV with type column (mcq/coding)..." className="font-mono text-xs resize-y" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-annotation">Or upload a .csv file:</span>
              <label className="focus-ring">
                <input
                  type="file"
                  accept=".csv"
                  aria-label="Upload CSV file"
                  onChange={e => {
                    const file = e.target.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => setRaw(ev.target.result);
                      reader.readAsText(file);
                    }
                  }}
                  className="text-xs text-annotation file:mr-2 file:py-0.5 file:px-2 file:rounded file:border file:border-rim file:text-xs file:bg-panel file:text-ink hover:file:bg-sunken transition-colors"
                />
              </label>
            </div>
          </div>
        )}

        {error && <Alert type="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ── Image URL helper ───────────────────────────────────────────
// CSV/JSON can't carry image *files*, only text — so to attach an image to
// an imported question, the admin needs a URL to reference. This uploads
// each picked file the same way the manual question editor does and hands
// back a stable /api/images/<id> URL to paste into the imageUrl /
// optionImages column(s) above.
function ImageUrlHelper() {
  const [show, setShow] = useState(false);
  const [uploaded, setUploaded] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files) => {
    setUploading(true);
    const results = [];
    for (const file of files) {
      try {
        const res = await uploadAPI.image(file);
        results.push({ name: file.name, url: res.url });
      } catch {
        results.push({ name: file.name, url: null });
      }
    }
    setUploaded(prev => [...results, ...prev]);
    setUploading(false);
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL copied');
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  return (
    <div className="rounded-lg border border-rim bg-panel p-3">
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="flex items-center justify-between w-full text-xs font-semibold text-ink"
      >
        <span>Need image URLs for the import? Upload images here first</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${show ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {show && (
        <div className="mt-3 space-y-2">
          <p className="text-2xs text-annotation">
            Pick one or more image files. Each is uploaded and given a permanent URL — copy it into the
            <code className="font-mono"> imageUrl</code> / <code className="font-mono">optionImages</code> field(s) for the matching question below.
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Upload images to get URLs"
            disabled={uploading}
            onChange={e => { if (e.target.files.length) handleFiles(Array.from(e.target.files)); e.target.value = ''; }}
            className="text-xs text-annotation file:mr-2 file:py-0.5 file:px-2 file:rounded file:border file:border-rim file:text-xs file:bg-deck file:text-ink hover:file:bg-sunken transition-colors"
          />
          {uploading && <div className="flex items-center gap-2 text-xs text-annotation"><Spinner size={12} /> Uploading…</div>}
          {uploaded.length > 0 && (
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {uploaded.map((u, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-annotation/70 truncate max-w-[35%]">{u.name}</span>
                  {u.url ? (
                    <>
                      <code className="font-mono text-ink bg-deck px-1.5 py-0.5 rounded truncate flex-1">{u.url}</code>
                      <button type="button" onClick={() => copy(u.url)} className="text-accent hover:underline shrink-0">Copy</button>
                    </>
                  ) : (
                    <span className="text-alert">Upload failed</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Coding Tab
// ═══════════════════════════════════════════════════════════
function CodingBankTab() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkMarksOpen, setBulkMarksOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['question-bank', 'coding'],
    queryFn: () => questionBankAPI.list({ type: 'coding' }),
  });
  const deleteMut = useMutation({
    mutationFn: questionBankAPI.delete,
    onSuccess: () => { toast.success('Question removed'); qc.invalidateQueries({ queryKey: ['question-bank', 'coding'] }); },
  });
  const bulkDeleteMut = useMutation({
    mutationFn: questionBankAPI.bulkDelete,
    onSuccess: (res) => {
      toast.success(`${res.deleted} question${res.deleted === 1 ? '' : 's'} removed`);
      setSelected(new Set());
      setBulkDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['question-bank', 'coding'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete questions'),
  });
  const bulkMarksMut = useMutation({
    mutationFn: ({ marks }) => questionBankAPI.bulkUpdateMarks([...selected], marks),
    onSuccess: (res) => {
      toast.success(`Updated marks for ${res.updated} question${res.updated === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkMarksOpen(false);
      qc.invalidateQueries({ queryKey: ['question-bank', 'coding'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update marks'),
  });

  const questions = data?.questions || [];
  const clusters = groupBy === 'test' ? clusterByTest(questions) : null;

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = questions.length > 0 && questions.every(q => selected.has(q.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(questions.map(q => q.id)));

  const renderCard = (q) => (
    <div key={q.id} className="panel p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <label className="flex items-start gap-2 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(q.id)}
            onChange={() => toggleOne(q.id)}
            className="accent-accent w-3.5 h-3.5 cursor-pointer mt-0.5 shrink-0"
          />
          <h4 className="font-display font-bold text-sm text-ink">{q.data?.title}</h4>
        </label>
        <Badge color={q.difficulty === 'hard' ? 'alert' : q.difficulty === 'easy' ? 'verify' : 'accent'}>{q.difficulty}</Badge>
      </div>
      <p className="text-xs text-annotation line-clamp-2 mb-2">{q.data?.description}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge color="annotation">{q.marks} marks</Badge>
        {(q.data?.testCases || []).length > 0 && <Badge color="annotation">{q.data.testCases.length} test case(s)</Badge>}
        <UsedInBadge q={q} />
        <button className="ml-auto text-alert text-xs hover:underline" onClick={() => setDeleteId(q.id)}>Delete</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {questions.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-annotation cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-accent w-3.5 h-3.5 cursor-pointer" />
            Select all
          </label>
        )}
        <Select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="w-44">
          <option value="none">No grouping</option>
          <option value="test">Group by test used in</option>
        </Select>
        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <>
              <Btn variant="ghost" onClick={() => setBulkMarksOpen(true)}>
                Set Marks ({selected.size})
              </Btn>
              <Btn variant="danger" onClick={() => setBulkDeleteOpen(true)}>
                Delete Selected ({selected.size})
              </Btn>
            </>
          )}
          <Btn variant="ghost" onClick={() => setImportOpen(true)}>Import CSV</Btn>
          <Btn onClick={() => setCreateOpen(true)}>New Coding Question</Btn>
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : questions.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No coding questions in the bank yet.</p>
        </div>
      ) : clusters ? (
        <div className="space-y-4">
          {clusters.map(cluster => (
            <div key={cluster.testTitle}>
              <p className="text-xs font-display font-bold text-ink mb-2">
                {cluster.testTitle} <span className="text-annotation font-normal font-mono">({cluster.questions.length})</span>
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {cluster.questions.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {questions.map(renderCard)}
        </div>
      )}

      <CodingCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <McqImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Delete question"
        message="Remove this coding question from the bank? Tests that already used it are unaffected."
      />
      <ConfirmModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => bulkDeleteMut.mutate([...selected])}
        title="Delete selected questions"
        message={`Remove ${selected.size} question${selected.size === 1 ? '' : 's'} from the bank? Tests that already used them are unaffected. This can't be undone.`}
      />
      <BulkMarksModal
        isOpen={bulkMarksOpen}
        count={selected.size}
        onClose={() => setBulkMarksOpen(false)}
        onConfirm={(marks) => bulkMarksMut.mutate({ marks })}
        isLoading={bulkMarksMut.isLoading}
      />
    </div>
  );
}

export function CodingCreateModal({ open, onClose }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('easy');
  const [marks, setMarks] = useState(4);
  const [sampleInput, setSampleInput] = useState('');
  const [sampleOutput, setSampleOutput] = useState('');

  const reset = () => { setTitle(''); setDescription(''); setDifficulty('easy'); setMarks(4); setSampleInput(''); setSampleOutput(''); };

  const createMut = useMutation({
    mutationFn: questionBankAPI.create,
    onSuccess: () => {
      toast.success('Coding question added to bank');
      qc.invalidateQueries({ queryKey: ['question-bank', 'coding'] });
      reset();
      onClose();
    },
  });

  const save = () => {
    if (!title.trim() || !description.trim()) return toast.error('Title and description are required');
    if (!sampleInput.trim() || !sampleOutput.trim()) return toast.error('At least one sample test case is required');
    createMut.mutate({
      type: 'coding',
      genre: 'technical', difficulty, marks,
      data: {
        title: title.trim(),
        description: description.trim(),
        testCases: [{ input: sampleInput, output: sampleOutput, isHidden: false }],
      },
    });
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="New Coding Question" width="max-w-xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={createMut.isLoading}>{createMut.isLoading ? <Spinner size={14} /> : 'Add to Bank'}</Btn></>}>
      <div className="space-y-3">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Two Sum" />
        <Textarea label="Description" rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Problem statement..." />
        <div className="grid grid-cols-2 gap-2">
          <Select label="Difficulty" value={difficulty} onChange={e => { setDifficulty(e.target.value); setMarks(e.target.value === 'easy' ? 4 : 7); }}>
            <option value="easy">Easy</option>
            <option value="hard">Hard</option>
          </Select>
          <Input label="Marks" type="number" value={marks} disabled />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Textarea label="Sample Input" rows={2} value={sampleInput} onChange={e => setSampleInput(e.target.value)} className="font-mono text-xs" />
          <Textarea label="Expected Output" rows={2} value={sampleOutput} onChange={e => setSampleOutput(e.target.value)} className="font-mono text-xs" />
        </div>
      </div>
    </Modal>
  );
}
