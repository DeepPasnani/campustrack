import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { testsAPI, submissionsAPI, shuffleAPI, submissionsAPIExtended } from '../../services/api';
import { useStore } from '../../store';
import Timer from '../../components/shared/Timer';
import { Btn, Modal, Spinner, HelpTip } from '../../components/shared/UI';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';

import AptitudeQuestion from './AptitudeQuestion';
import CodingQuestion from './CodingQuestion';
import QuestionPalette from './QuestionPalette';
import ConfirmSubmitModal from './ConfirmSubmitModal';
import CodingProblemSelection from './CodingProblemSelection';
import FullScreenEnforcer from '../../components/shared/FullScreenEnforcer';
import { lockdownService } from '../../services/lockdown';
import { fingerprintService } from '../../services/fingerprint';

const LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
};

const AUTO_SAVE_INTERVAL = 30000;
const DEBOUNCE_SAVE_DELAY = 3000;
const MAX_TAB_SWITCHES = 5;
const FINGERPRINT_INTERVAL = 60000;

const formatClock = (d) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Local draft backup ────────────────────────────────────────
// A network drop or a browser/tab crash can happen between two server
// saves. Keeping the latest edits mirrored in localStorage means nothing
// typed is ever lost to the server round-trip alone — on the next
// start/resume it's merged back on top of whatever the server has.
const draftKey = (submissionId) => `ct:draft:${submissionId}`;

function saveDraft(submissionId, { answers, codeSolutions, flaggedQuestions }) {
  if (!submissionId) return;
  try {
    localStorage.setItem(draftKey(submissionId), JSON.stringify({
      answers, codeSolutions, flaggedQuestions, savedAt: Date.now(),
    }));
  } catch { /* storage full / unavailable — best effort only */ }
}

function loadDraft(submissionId) {
  if (!submissionId) return null;
  try {
    const raw = localStorage.getItem(draftKey(submissionId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearDraft(submissionId) {
  if (!submissionId) return;
  try { localStorage.removeItem(draftKey(submissionId)); } catch { /* noop */ }
}

export default function TestInterface() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useStore();

  const [answers, setAnswers] = useState({});
  const [codeSolutions, setCodeSolutions] = useState({});
  const [flagged, setFlagged] = useState(new Set());
  const [currentSection, setCurrentSection] = useState(0);
  const [currentQ, setCurrentQ] = useState(0);
  const [activeLang, setActiveLang] = useState('python');
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [testSummary, setTestSummary] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | ok | error
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [showViolationConfirm, setShowViolationConfirm] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [selectedProblems, setSelectedProblems] = useState([]);
  const [showProblemSelection, setShowProblemSelection] = useState(false);
  const [liveRemainingSeconds, setLiveRemainingSeconds] = useState(null);
  const [submissionId, setSubmissionId] = useState(null);

  const [questionOrder, setQuestionOrder] = useState(null);
  const [optionOrders, setOptionOrders] = useState(null);
  const [timeBombs, setTimeBombs] = useState({});



  const [fullscreenExitCount, setFullscreenExitCount] = useState(0);
  const [endScreen, setEndScreen] = useState(null); // { reason, visible }
  const fingerprintRef = useRef(null);

  const autoSaveRef = useRef(null);
  const debounceSaveRef = useRef(null);
  const justSavedRef = useRef(null);
  const lockdownApplied = useRef(false);
  const tabSwitchCountRef = useRef(0);
  // Always-current snapshot for the save/flush callbacks below, so a fixed
  // 30s interval and an online/beforeunload flush never fire against a
  // stale closure of answers/codeSolutions from whenever the effect last ran.
  const latestRef = useRef({ answers: {}, codeSolutions: {}, flagged: new Set(), selectedProblems: [] });
  const handleSubmitRef = useRef(null);
  const autoSubmitTriggeredRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const pendingViolationConfirmRef = useRef(false);
  const endReasonRef = useRef(null);
  const kbRef = useRef({});

  const wsRef = useRef(null);
  const pendingRunRef = useRef(null);

  const { data: testData, isLoading: loadingTest } = useQuery({
    queryKey: ['test-full', testId],
    queryFn: () => testsAPI.get(testId),
  });

  const { data: shuffleData } = useQuery({
    queryKey: ['shuffle', testId],
    queryFn: () => shuffleAPI.get(testId),
    enabled: !!testStarted,
  });

  const startMut = useMutation({
    mutationFn: submissionsAPI.start,
    onSuccess: async (data) => {
      setRemainingSeconds(data.remainingSeconds);
      setTestStarted(true);

      // The API client already parses the JSON response body, so these
      // fields arrive as real objects/arrays — restore them directly. This
      // is what puts a resumed (or refreshed mid-test) student's previous
      // answers back on screen instead of a blank slate.
      const sub = data.submission || {};
      let restoredAnswers = (sub.answers && typeof sub.answers === 'object') ? sub.answers : {};
      let restoredCode = (sub.code_solutions && typeof sub.code_solutions === 'object') ? sub.code_solutions : {};
      if (Array.isArray(sub.selected_problems) && sub.selected_problems.length > 0) {
        setSelectedProblems(sub.selected_problems);
      }
      if (Array.isArray(sub.flagged_questions) && sub.flagged_questions.length > 0) {
        setFlagged(new Set(sub.flagged_questions));
      }
      if (typeof sub.tab_switch_count === 'number' && sub.tab_switch_count > 0) {
        tabSwitchCountRef.current = sub.tab_switch_count;
        setTabSwitchCount(sub.tab_switch_count);
      }

      // A save that failed while offline may have left a newer draft in
      // localStorage than what made it to the server — merge it back in.
      const draft = loadDraft(sub.id);
      if (draft) {
        restoredAnswers = { ...restoredAnswers, ...(draft.answers || {}) };
        restoredCode = { ...restoredCode, ...(draft.codeSolutions || {}) };
        if (Array.isArray(draft.flaggedQuestions) && draft.flaggedQuestions.length) {
          setFlagged(new Set(draft.flaggedQuestions));
        }
      }
      setAnswers(restoredAnswers);
      setCodeSolutions(restoredCode);

      setSubmissionId(data.submission.id);

      await shuffleAPI.assign(testId);
      if (!shuffleData?.shuffled) {
        try {
          const sd = await shuffleAPI.get(testId);
          if (sd.shuffled) {
            setQuestionOrder(sd.questionOrder);
            setOptionOrders(sd.optionOrders);
          }
        } catch {}
      } else {
        setQuestionOrder(shuffleData.questionOrder);
        setOptionOrders(shuffleData.optionOrders);
      }

      try {
        const bombData = await submissionsAPIExtended.getTimeBombStatus(testId);
        if (bombData?.bombs) {
          const bombMap = {};
          bombData.bombs.forEach(b => { bombMap[b.questionId] = b; });
          setTimeBombs(bombMap);
        }
      } catch {}
    },
    onError: (e) => {
      toast.error(e.response?.data?.error || 'Failed to start test');
      navigate('/student');
    },
  });

  const saveMut = useMutation({
    mutationFn: submissionsAPI.save,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onSuccess: () => {
      setLastSaved(new Date());
      setSaveStatus('ok');
      if (justSavedRef.current) clearTimeout(justSavedRef.current);
      justSavedRef.current = setTimeout(() => setSaveStatus('idle'), 10000);
    },
    onError: () => setSaveStatus('error'),
  });
  const submitMut = useMutation({
    mutationFn: submissionsAPI.submit,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onSuccess: () => {
      clearInterval(autoSaveRef.current);
      clearDraft(submissionId);
      setSubmitting(false);
      const reason = endReasonRef.current;
      endReasonRef.current = null;
      if (reason && reason !== 'time') {
        setEndScreen({ reason, visible: true });
        return;
      }
      toast.success('Test submitted!');
      setTimeout(() => navigate('/student/results', { replace: true }), 500);
    },
    onError: (e) => {
      setSubmitting(false);
      toast.error(e.response?.data?.error || 'Submission failed. Please try again.');
    },
  });

  // Pre-start consent is handled in render (staging screen). The timer,
  // lockdown, autosave and fingerprinting all begin only after the student
  // chooses "Start Test", so a slow reader is never already on the clock.

  useEffect(() => {
    if (!testStarted || !submissionId) return;
    fingerprintRef.current = setInterval(async () => {
      try {
        await fingerprintService.verify(submissionId);
      } catch {}
    }, FINGERPRINT_INTERVAL);
    fingerprintService.send(submissionId);
    return () => {
      if (fingerprintRef.current) clearInterval(fingerprintRef.current);
    };
  }, [testStarted, submissionId]);

  useEffect(() => {
    if (!testStarted || !user?.token) return;
    const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:5000/ws'}?token=${user.token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'CODE_EXECUTION_RESULT' && pendingRunRef.current?.id === msg.id) {
          pendingRunRef.current.resolve(msg);
          pendingRunRef.current = null;
        }
      } catch {}
    };
    return () => { wsRef.current = null; ws.close(); };
  }, [testStarted, user?.token]);

  // Keep a ref mirror of the latest answer state so the interval/flush
  // callbacks below always see current data without needing to be torn
  // down and rebuilt (and thus re-timed) on every keystroke.
  useEffect(() => {
    latestRef.current = { answers, codeSolutions, flagged, selectedProblems };
  }, [answers, codeSolutions, flagged, selectedProblems]);

  const saveMutate = saveMut.mutate;
  const flushSave = useCallback(() => {
    if (!testStarted) return;
    const snap = latestRef.current;
    saveMutate({
      testId,
      answers: snap.answers,
      codeSolutions: snap.codeSolutions,
      flaggedQuestions: Array.from(snap.flagged),
      tabSwitchCount: tabSwitchCountRef.current,
      selectedProblems: snap.selectedProblems,
    });
  }, [testId, testStarted, saveMutate]);

  // Fixed-cadence safety net: a real 30s interval, independent of typing
  // activity. (Rebuilding this interval on every answer/code change — as a
  // dependency array of [answers, codeSolutions, ...] would do — restarts
  // the 30s countdown on every keystroke, so a student typing continuously
  // in the code editor could go the whole test without a single autosave.)
  useEffect(() => {
    if (!testStarted) return;
    autoSaveRef.current = setInterval(flushSave, AUTO_SAVE_INTERVAL);
    return () => clearInterval(autoSaveRef.current);
  }, [testStarted, flushSave]);

  // Fast-path: also save shortly after the student stops typing/selecting,
  // instead of always waiting for the next 30s tick — this is what keeps
  // losses down to a few seconds of edits if the tab crashes or the network
  // drops mid-test.
  useEffect(() => {
    if (!testStarted) return;
    if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
    debounceSaveRef.current = setTimeout(flushSave, DEBOUNCE_SAVE_DELAY);
    return () => clearTimeout(debounceSaveRef.current);
  }, [testStarted, answers, codeSolutions, flagged, selectedProblems, flushSave]);

  // Local backup on every change — synchronous and network-independent, so
  // a dropped connection never loses work that hasn't reached the server
  // yet. Restored on the next start/resume (see startMut.onSuccess above).
  useEffect(() => {
    if (!testStarted || !submissionId) return;
    saveDraft(submissionId, {
      answers, codeSolutions, flaggedQuestions: Array.from(flagged),
    });
  }, [testStarted, submissionId, answers, codeSolutions, flagged]);

  // Flush immediately when connectivity returns, rather than waiting for
  // the next scheduled tick.
  useEffect(() => {
    if (!testStarted) return;
    const onOnline = () => flushSave();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [testStarted, flushSave]);

  useEffect(() => {
    if (!testStarted || lockdownApplied.current) return;
    lockdownService.enable((msg) => toast(msg, { icon: '⚠️', duration: 2000 }));
    lockdownApplied.current = true;
    return () => {
      lockdownService.disable();
      lockdownApplied.current = false;
    };
  }, [testStarted]);

  useEffect(() => {
    return () => {
      lockdownService.disable();
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = 'Your progress is auto-saved. Are you sure?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    tabSwitchCountRef.current = tabSwitchCount;
  }, [tabSwitchCount]);

  useEffect(() => {
    if (!testStarted) return;
    const MIN_HIDDEN_MS = 2500; // ignore sub-second visibility blips (false positives)
    let hiddenAt = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      // visible
      if (hiddenAt === null) return; // never wasn't hidden → not a real switch
      const hiddenFor = Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor < MIN_HIDDEN_MS) return; // trusted quick return → no penalty

      // Debounce so concurrent visibilitychange + fullscreenchange never double-count.
      const now = Date.now();
      if (now - lastViolationAtRef.current < 750) return;
      lastViolationAtRef.current = now;

      const newCount = tabSwitchCountRef.current + 1;
      tabSwitchCountRef.current = newCount;
      setTabSwitchCount(newCount);
      if (newCount >= MAX_TAB_SWITCHES) {
        // P0 fairness: never end a test silently. Ask explicitly first.
        if (pendingViolationConfirmRef.current) return;
        pendingViolationConfirmRef.current = true;
        setShowViolationConfirm(true);
      } else {
        setShowTabWarning(true);
        setTimeout(() => setShowTabWarning(false), 3000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [testStarted]);

  useEffect(() => {
    if (!testData || liveRemainingSeconds === null) return;
    const splitTimers = !!testData.settings?.splitTimers;
    const mcqDurationSeconds = (testData.settings?.mcqDurationMinutes || 0) * 60;
    const totalDurationSeconds = (testData.duration_minutes || 0) * 60;
    const elapsedSeconds = totalDurationSeconds - liveRemainingSeconds;
    const locked = splitTimers && mcqDurationSeconds > 0 && elapsedSeconds >= mcqDurationSeconds;
    const currentSec = testData.sections?.[currentSection];
    if (locked && currentSec?.type === 'aptitude') {
      const firstCoding = testData.sections.findIndex(s => s.type === 'coding');
      if (firstCoding >= 0) {
        toast('MCQ time is up — moving you to the coding round.', { icon: '⏱️' });
        setCurrentSection(firstCoding);
        setCurrentQ(0);
      }
    }
  }, [liveRemainingSeconds, testData, currentSection]);

  useEffect(() => {
    if (!testStarted || !submissionId) return;
    const interval = setInterval(async () => {
      try {
        const bombs = await submissionsAPIExtended.getTimeBombStatus(testId);
        if (bombs?.bombs) {
          const bombMap = {};
          bombs.bombs.forEach(b => { bombMap[b.questionId] = b; });
          setTimeBombs(bombMap);
        }
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [testStarted, submissionId, testId]);

  const handleSubmit = useCallback(async (opts = {}) => {
    pendingViolationConfirmRef.current = false;
    setShowViolationConfirm(false);
    if (opts.autoSubmitted && opts.reason) {
      endReasonRef.current = opts.reason;
    }
    if (opts.autoSubmitted) {
      if (autoSubmitTriggeredRef.current) return;
      autoSubmitTriggeredRef.current = true;
    }
    setSubmitting(true);
    setConfirmSubmit(false);
    submitMut.mutate({
      testId,
      answers,
      codeSolutions,
      flaggedQuestions: Array.from(flagged),
      tabSwitchCount,
      selectedProblems,
      autoSubmitted: opts.autoSubmitted || false,
    }, {
      onError: () => {
        // Allow a retry if the auto-submit attempt failed
        autoSubmitTriggeredRef.current = false;
      },
    });
  }, [testId, answers, codeSolutions, flagged, tabSwitchCount, selectedProblems]);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleTimeExpired = useCallback(() => {
    setTimeExpired(true);
    handleSubmit({ autoSubmitted: true, reason: 'time' });
  }, [handleSubmit]);

  const handleFullscreenViolation = useCallback(async (count) => {
    setFullscreenExitCount(count);
    setTabSwitchCount(prev => prev + 1);
    if (submissionId) {
      try {
        await submissionsAPIExtended.fullscreenViolation({ submissionId, exitCount: count, testId });
      } catch {}
    }
  }, [submissionId, testId]);

  const handleFullscreenThresholdExceeded = useCallback(() => {
    toast.error('Fullscreen exit limit exceeded — submitting test.');
    handleSubmit({ autoSubmitted: true, reason: 'fullscreen' });
  }, [handleSubmit]);

  const handleRunAllTests = async () => {
    const q = section?.questions[currentQ];
    if (!q) return;
    const code = codeSolutions[q.id]?.[activeLang] || q.starter_code?.[activeLang] || '';
    if (!code.trim()) { toast.error('Write some code first.'); return; }
    setTestLoading(true);
    setTestResults(null);
    setTestSummary(null);
    try {
      const visibleTests = (q.test_cases || []).filter(tc => !tc.isHidden);
      const result = await submissionsAPI.runCode({
        code,
        language: activeLang,
        testCases: visibleTests,
        problemId: q.id,
        submissionId,
        testId,
      });
      const results = result.results || [];
      if (!results.length) {
        toast.error('No test cases available for this problem.');
        setTestLoading(false);
        return;
      }
      setTestResults(results);
      setTestSummary(result.summary || null);
    } catch (err) {
      if (err?.response?.status === 429) {
        toast.error(err.response.data?.error || 'Too many runs in a short time — wait a few seconds and try again.');
      } else {
        toast.error(err?.response?.data?.error || 'Test execution failed. Please try again.');
      }
    }
    setTestLoading(false);
  };

  const handleRunCode = async () => {
    const q = section?.questions[currentQ];
    if (!q) return;
    const code = codeSolutions[q.id]?.[activeLang] || q.starter_code?.[activeLang] || '';
    if (!code.trim()) { toast.error('Write some code first.'); return; }
    setRunLoading(true);
    setRunResult(null);
    try {
      const { id } = await submissionsAPI.runCode({
        code,
        language: activeLang,
        stdin: q.sample_input || '',
      });
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRunRef.current = null;
          reject(new Error('Execution timed out'));
        }, 65000);
        pendingRunRef.current = {
          id,
          resolve: (res) => { clearTimeout(timeout); resolve(res); },
        };
      });
      setRunResult(result);
    } catch (err) {
      if (err?.response?.status === 429) {
        toast.error(err.response.data?.error || 'Too many runs in a short time — wait a few seconds and try again.');
      } else {
        toast.error(err?.response?.data?.error || 'Code execution failed. Please try again.');
      }
    }
    setRunLoading(false);
  };

  // Exam ergonomics: ←/→ next/prev, F flag, Ctrl+Enter submit, 1–0 palette jump.
  // Guarded so a focused input / Monaco editor is never hijacked.
  // Registered BEFORE any conditional return so the hook order never changes.
  useEffect(() => {
    if (!testStarted) return;
    const onKeyDown = (e) => {
      const kb = kbRef.current;
      const t = e.target;
      const inField = t && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
        || t.isContentEditable || (t.closest && t.closest('.monaco-editor'))
      );
      if (inField) return;

      const hijack = (fn) => { e.preventDefault(); fn(); };

      if (e.key === 'ArrowRight') return hijack(() => kb.goNext?.());
      if (e.key === 'ArrowLeft') return hijack(() => kb.goPrev?.());
      if (e.key.toLowerCase() === 'f') return hijack(() => kb.displayQ?.id && kb.toggleFlag?.(kb.displayQ.id));
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return hijack(() => setConfirmSubmit(true));
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        return hijack(() => {
          const list = kb.sortedDisplayQuestions || [];
          if (idx < list.length) kb.navigateQ?.(kb.currentSection, idx);
        });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testStarted]);

  if (loadingTest) {
    return (
      <div className="min-h-screen bg-deck flex flex-col items-center justify-center gap-4">
        <Spinner size={28} className="text-accent" />
        <p className="text-sm text-annotation">Loading test…</p>
      </div>
    );
  }

  // Pre-start staging: the clock has not started. Full-screen lockdown and
  // the timer engage only after the student presses "Start Test".
  if (testData && !testStarted) {
    const t = testData;
    const sectionCount = t?.sections?.length || 0;
    const totalQuestions = t?.sections?.reduce((n, s) => n + (s.questions?.length || 0), 0) || 0;
    const hasCode = (t?.sections || []).some(s => s.type === 'coding');
    return (
      <div className="min-h-screen bg-deck flex items-center justify-center p-4">
        <div className="panel max-w-lg w-full p-6 sm:p-8 animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mb-5">
            <svg className="w-6 h-6 text-panel" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path strokeLinecap="round" d="M8 8h8M8 12h5" />
            </svg>
          </div>

          <h1 className="font-display font-bold text-xl text-ink">{t.title}</h1>
          <p className="text-sm text-annotation mt-1 mb-6">
            You&rsquo;re about to begin this placement assessment.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="rounded-lg bg-sunken px-3 py-2.5 text-center">
              <div className="text-lg font-display font-bold text-ink mono-nums">{sectionCount}</div>
              <div className="text-2xs text-annotation mt-0.5">Sections</div>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2.5 text-center">
              <div className="text-lg font-display font-bold text-ink mono-nums">{totalQuestions}</div>
              <div className="text-2xs text-annotation mt-0.5">Questions</div>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2.5 text-center">
              <div className="text-lg font-display font-bold text-ink mono-nums">{t.duration_minutes || 0}</div>
              <div className="text-2xs text-annotation mt-0.5">Minutes</div>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-annotation mb-6">
            <div className="flex gap-2.5">
              <svg className="w-4 h-4 shrink-0 text-verify mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>Your answers are auto-saved every 30 seconds.</span>
            </div>
            <div className="flex gap-2.5">
              <svg className="w-4 h-4 shrink-0 text-accent mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>The timer cannot be paused. The test auto-submits when time runs out.</span>
            </div>
            {hasCode && (
              <div className="flex gap-2.5">
                <svg className="w-4 h-4 shrink-0 text-clarify mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Includes coding problems — run your code before submitting.</span>
              </div>
            )}
            <div className="flex gap-2.5">
              <svg className="w-4 h-4 shrink-0 text-alert mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h17a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span>Switching tabs or leaving full-screen may end your session.</span>
            </div>
          </div>

          <p className="text-xs text-annotation font-mono mb-6">
            Keyboard: ← / → navigate · F flag · Ctrl+Enter submit · 1–9 jump
          </p>

          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => navigate('/student')} disabled={startMut.isPending}>
              Exit
            </Btn>
            <Btn
              variant="primary"
              onClick={() => startMut.mutate(testId)}
              disabled={startMut.isPending}
              className="flex-1"
            >
              {startMut.isPending && <Spinner size={14} className="text-panel" />}
              Start Test
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!testStarted || remainingSeconds === null) {
    return (
      <div className="min-h-screen bg-deck flex flex-col items-center justify-center gap-4">
        <Spinner size={28} className="text-accent" />
        <p className="text-sm text-annotation">Starting your session…</p>
      </div>
    );
  }

  const test = testData;
  const section = test?.sections?.[currentSection];
  const isAptitude = section?.type === 'aptitude';

  // Single source of truth for "answered" — shared by the header counter, the
  // submit modal, the section tabs and the palette so they can never disagree.
  const isAnswered = (sec, qq) => {
    if (sec.type === 'coding') {
      return Object.values(codeSolutions[qq.id] || {}).some(c => c?.trim());
    }
    const v = answers[qq.id];
    if (Array.isArray(v)) return v.length > 0; // cleared multi-select => []
    return v !== undefined && v !== null && String(v).trim() !== '';
  };

  const visibleQuestions = (s) =>
    (s.type === 'coding' && selectedProblems.length > 0)
      ? (s.questions || []).filter(q => selectedProblems.includes(q.id))
      : (s.questions || []);

  const totalQ = test?.sections?.reduce((n, s) => n + visibleQuestions(s).length, 0) || 0;
  const answeredCount = test?.sections?.reduce(
    (n, s) => n + visibleQuestions(s).filter(q => isAnswered(s, q)).length,
    0,
  ) || 0;
  const allowedLangs = test?.settings?.allowedLanguages || ['python', 'javascript', 'java', 'cpp'];

  const splitTimers = !!test?.settings?.splitTimers;
  const mcqDurationSeconds = (test?.settings?.mcqDurationMinutes || 0) * 60;
  const totalDurationSeconds = (test?.duration_minutes || 0) * 60;
  const elapsedSeconds = liveRemainingSeconds !== null ? totalDurationSeconds - liveRemainingSeconds : 0;
  const mcqLocked = splitTimers && mcqDurationSeconds > 0 && elapsedSeconds >= mcqDurationSeconds;

  const codingSection = section?.type === 'coding' && section?.questions?.length > 3
    ? section
    : null;
  const hasSelectedCodingProblems = codingSection
    ? selectedProblems.some(id => codingSection.questions.some(q => q.id === id))
    : true;

  const displayQuestions = codingSection && hasSelectedCodingProblems
    ? section.questions.filter(q => selectedProblems.includes(q.id))
    : section?.questions || [];

  const sectionQuestionOrder = questionOrder?.[section?.id] || [];
  const sortedDisplayQuestions = section?.type === 'aptitude' && sectionQuestionOrder.length > 0
    ? [...displayQuestions].sort((a, b) => sectionQuestionOrder.indexOf(a.id) - sectionQuestionOrder.indexOf(b.id))
    : displayQuestions;

  const displayQ = sortedDisplayQuestions[currentQ] || sortedDisplayQuestions[0];

  const navigateQ = (si, qi) => {
    if (mcqLocked && test.sections[si]?.type === 'aptitude') {
      toast.error('MCQ round has ended for this test.');
      return;
    }
    setCurrentSection(si);
    setCurrentQ(qi);
    setRunResult(null);
    setTestResults(null);
    setTestSummary(null);
  };

  const goNext = () => {
    if (currentQ < sortedDisplayQuestions.length - 1) {
      navigateQ(currentSection, currentQ + 1);
    } else if (currentSection < test.sections.length - 1) {
      navigateQ(currentSection + 1, 0);
    }
  };

  const goPrev = () => {
    if (currentQ > 0) {
      navigateQ(currentSection, currentQ - 1);
    } else if (currentSection > 0) {
      const prevSec = test.sections[currentSection - 1];
      const prevQuestions = prevSec?.type === 'aptitude' && questionOrder?.[prevSec.id]
        ? [...(prevSec.questions || [])].sort((a, b) => (questionOrder[prevSec.id].indexOf(a.id) - questionOrder[prevSec.id].indexOf(b.id)))
        : prevSec?.questions || [];
      navigateQ(currentSection - 1, prevQuestions.length - 1);
    }
  };

  const isLastQuestion =
    currentQ === sortedDisplayQuestions.length - 1 &&
    currentSection === test.sections.length - 1;

  const setAnswer = (qId, val) => setAnswers(a => ({ ...a, [qId]: val }));
  const setCode = (qId, lang, code) =>
    setCodeSolutions(cs => ({
      ...cs,
      [qId]: { ...(cs[qId] || {}), [lang]: code },
    }));
  const toggleFlag = (qId) =>
    setFlagged(f => {
      const nf = new Set(f);
      nf.has(qId) ? nf.delete(qId) : nf.add(qId);
      return nf;
    });

  // Exam ergonomics (←/→ next/prev, F flag, Ctrl+Enter submit, 1–0 jump).
  // Executes after the keyboardHandlerRef is populated on active renders.
  kbRef.current = { goNext, goPrev, displayQ, toggleFlag, navigateQ, sortedDisplayQuestions, currentSection, currentQ };

  if (!displayQ && !codingSection) return null;

  if (codingSection && !hasSelectedCodingProblems) {
    return <CodingProblemSelection
      section={codingSection}
      selectedProblems={selectedProblems}
      setSelectedProblems={setSelectedProblems}
      codeSolutions={codeSolutions}
      onConfirm={() => {
        saveMut.mutate({ testId, answers, codeSolutions, flaggedQuestions: Array.from(flagged), selectedProblems });
        setCurrentQ(0);
      }}
    />;
  }

  if (timeExpired) {
    return (
      <div className="min-h-screen bg-deck flex flex-col items-center justify-center gap-4">
        <div className="panel p-8 max-w-sm text-center animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-display font-bold text-ink mb-1">Time's Up</h2>
          <p className="text-sm text-annotation mb-4">Your test has been submitted automatically.</p>
          <Btn variant="primary" onClick={() => navigate('/student/results')}>
            View Results
          </Btn>
        </div>
      </div>
    );
  }

  if (endScreen?.visible) {
    const meta = {
      tab: {
        title: 'Test Ended',
        icon: 'M12 9v3m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h17a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
        body: 'Your test was ended because you reached the tab-switch limit.',
      },
      fullscreen: {
        title: 'Test Ended',
        icon: 'M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4',
        body: 'Your test was ended because you left full-screen too many times.',
      },
    }[endScreen.reason] || null;

    return (
      <div className="min-h-screen bg-deck flex flex-col items-center justify-center p-4">
        <div className="panel max-w-md w-full p-6 sm:p-8 text-center animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-alert/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={(meta || {}).icon || ''} />
            </svg>
          </div>
          <h2 className="text-xl font-display font-bold text-ink mb-1">
            {(meta || {}).title || 'Test Ended'}
          </h2>
          <p className="text-sm text-annotation mb-5">
            {(meta || {}).body || 'This test ended automatically.'}
          </p>

          <div className="rounded-lg bg-sunken px-4 py-3 text-xs text-annotation text-left mb-6">
            <div className="font-semibold text-ink mb-1">Your answers are saved</div>
            If your session ended unexpectedly, ask an invigilator to restore or reset your test. Your progress is preserved.
          </div>

          <div className="flex gap-2">
            <Btn variant="ghost" className="flex-1" onClick={() => navigate('/student')}>
              Back to Tests
            </Btn>
            <Btn variant="ghost" className="flex-1" onClick={() => navigate('/student/results')}>
              View Results
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  const bombInfo = displayQ ? timeBombs[displayQ.id] : null;

  return (
    <div className="h-screen flex flex-col bg-deck text-ink overflow-hidden exam-mode">
      <FullScreenEnforcer
        enabled={testStarted}
        onViolation={handleFullscreenViolation}
        onThresholdExceeded={handleFullscreenThresholdExceeded}
      />

      <header className="h-14 bg-panel border-b border-rim flex items-center justify-between px-3 sm:px-4 shrink-0 z-50">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display font-bold text-sm text-ink truncate max-w-40 sm:max-w-56">
            {test.title}
          </span>
          <span className="text-xs text-annotation font-mono">
            {answeredCount}/{totalQ}
          </span>
          <span
            className="hidden md:inline-flex items-center gap-1.5 text-2xs text-annotation"
            title="Answers are auto-saved locally as you go"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                saveStatus === 'error' ? 'bg-alert' : saveStatus === 'ok' ? 'bg-verify' : 'bg-annotation/40'
              }`}
            />
            {saveStatus === 'error'
              ? 'Save failed'
              : saveStatus === 'ok'
                ? 'Saved just now'
                : lastSaved
                  ? `Saved ${formatClock(lastSaved)}`
                  : 'Auto-save on'}
            <HelpTip text="Answers are auto-saved every 30 seconds. Keep this tab focused and in full-screen — leaving may trigger a penalty." />
          </span>
        </div>

        <div className="flex items-center gap-2">
          {splitTimers && (
            <span className={`hidden md:inline-flex items-center px-2 py-1 rounded-md text-2xs font-mono font-bold ${mcqLocked ? 'bg-accent/15 text-accent' : 'bg-panel text-annotation border border-rim'}`}>
              {mcqLocked ? 'Coding Round' : 'MCQ Round'}
              {' · '}
              {(() => {
                const remainInPhase = mcqLocked
                  ? Math.max(0, totalDurationSeconds - elapsedSeconds)
                  : Math.max(0, mcqDurationSeconds - elapsedSeconds);
                const m = Math.floor(remainInPhase / 60);
                const s = remainInPhase % 60;
                return `${m}:${String(s).padStart(2, '0')}`;
              })()}
            </span>
          )}
          <Timer
            totalSeconds={remainingSeconds}
            onExpire={handleTimeExpired}
            onTick={setLiveRemainingSeconds}
            testId={testId}
            token={token}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {tabSwitchCount > 0 && (
            <div
              className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-mono font-bold ${
                tabSwitchCount >= MAX_TAB_SWITCHES - 1
                  ? 'bg-alert/15 text-alert'
                  : 'bg-accent/15 text-accent'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {Math.max(0, MAX_TAB_SWITCHES - tabSwitchCount)}
              <span className="sr-only">tab switches remaining</span>
              <HelpTip text="Each time you leave this tab or exit full-screen it counts against you. Once you reach the limit you'll be asked to confirm before the test auto-submits." />
            </div>
          )}

          <button
            onClick={() => setShowMobilePalette(true)}
            className="btn-ghost-icon md:hidden"
            aria-label="Open question list"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path strokeLinecap="round" d="M8 8h8M8 12h5" />
            </svg>
          </button>

          <button
            onClick={() => setShowPalette(v => !v)}
            className="btn-ghost-icon hidden md:flex"
            title={showPalette ? 'Hide question list' : 'Show question list'}
            aria-label={showPalette ? 'Hide question list' : 'Show question list'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {showPalette ? (
                <path strokeLinecap="round" d="M9 9h6v6H9zM3 3h18v18H3z" />
              ) : (
                <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          <Btn variant="success" size="sm" onClick={() => setConfirmSubmit(true)}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M5 13l4 4L19 7" />
            </svg>
            Submit
          </Btn>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex gap-1 px-3 pt-2.5 pb-1.5 bg-panel border-b border-rim shrink-0 overflow-x-auto">
            {test.sections.map((sec, si) => {
              const tabLocked = mcqLocked && sec.type === 'aptitude';
              return (
              <button
                key={sec.id}
                onClick={() => navigateQ(si, 0)}
                disabled={tabLocked}
                title={tabLocked ? 'MCQ round has ended' : undefined}
                className={`tab-btn ${currentSection === si ? 'tab-btn--active' : ''} ${tabLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {tabLocked && (
                  <svg className="w-3 h-3 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
                {sec.name}
                <span className="ml-1.5 font-mono text-2xs opacity-60">
                  {sec.type === 'coding' && selectedProblems.length > 0
                    ? sec.questions.filter(qq => selectedProblems.includes(qq.id)).filter(qq => isAnswered(sec, qq)).length
                    : sec.questions.filter(qq => isAnswered(sec, qq)).length
                  }
                  /
                  {sec.type === 'coding' && selectedProblems.length > 0
                    ? sec.questions.filter(qq => selectedProblems.includes(qq.id)).length
                    : sec.questions.length
                  }
                </span>
              </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isAptitude ? (
              <AptitudeQuestion
                q={displayQ}
                qi={currentQ}
                answers={answers}
                setAnswer={setAnswer}
                flagged={flagged}
                toggleFlag={toggleFlag}
                isAnswered={isAnswered(section, displayQ)}
                onPrev={goPrev}
                onNext={goNext}
                isLast={isLastQuestion}
                onConfirmSubmit={() => setConfirmSubmit(true)}
                timeBomb={bombInfo}
              />
            ) : displayQ ? (
              <div>
                {bombInfo?.enabled && bombInfo.expired && (
                  <div className="max-w-3xl mx-auto p-4 sm:p-5">
                    <div className="panel p-6 text-center">
                      <div className="w-12 h-12 rounded-full bg-alert/15 flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-base font-display font-bold text-ink mb-1">Question Expired</h3>
                      <p className="text-sm text-annotation">This time-limited question is no longer available.</p>
                    </div>
                  </div>
                )}
                {(!bombInfo?.enabled || !bombInfo.expired) && (
                  <CodingQuestion
                    q={displayQ}
                    qi={currentQ}
                    section={section}
                    codeSolutions={codeSolutions}
                    setCode={setCode}
                    activeLang={activeLang}
                    setActiveLang={setActiveLang}
                    allowedLangs={allowedLangs}
                    flagged={flagged}
                    toggleFlag={toggleFlag}
                    runResult={runResult}
                    runLoading={runLoading}
                    onRunCode={handleRunCode}
                    testResults={testResults}
                    testSummary={testSummary}
                    testLoading={testLoading}
                    onRunAllTests={handleRunAllTests}
                    onPrev={goPrev}
                    onNext={goNext}
                    isLast={isLastQuestion}
                    onConfirmSubmit={() => setConfirmSubmit(true)}
                    timeBomb={bombInfo}
                    submissionId={submissionId}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>

        {showPalette && (
          <QuestionPalette
            sections={test.sections}
            currentSection={currentSection}
            currentQ={currentQ}
            flagged={flagged}
            isAnswered={isAnswered}
            onNavigate={navigateQ}
            selectedProblems={selectedProblems}
            questionOrder={questionOrder}
            optionOrders={optionOrders}
            timeBombs={timeBombs}
          />
        )}
      </div>

      <div role="alert" aria-live="assertive" className="sr-only">
        {tabSwitchCount > 0 && `Tab switch ${Math.min(tabSwitchCount, MAX_TAB_SWITCHES)} of ${MAX_TAB_SWITCHES}`}
      </div>

      {showMobilePalette && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Question list">
          <button
            aria-label="Close question list"
            className="absolute inset-0 bg-black/40 w-full h-full"
            onClick={() => setShowMobilePalette(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-72 max-w-[82%] bg-panel border-l border-rim shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rim shrink-0">
              <span className="text-xs font-semibold text-ink">Questions</span>
              <button
                onClick={() => setShowMobilePalette(false)}
                className="btn-ghost-icon"
                aria-label="Close question list"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <QuestionPalette
                stacked
                sections={test.sections}
                currentSection={currentSection}
                currentQ={currentQ}
                flagged={flagged}
                isAnswered={isAnswered}
                onNavigate={(si, qi) => { navigateQ(si, qi); setShowMobilePalette(false); }}
                selectedProblems={selectedProblems}
                questionOrder={questionOrder}
                optionOrders={optionOrders}
                timeBombs={timeBombs}
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmSubmitModal
        isOpen={confirmSubmit}
        onClose={() => !submitting && setConfirmSubmit(false)}
        answeredCount={answeredCount}
        totalQ={totalQ}
        submitting={submitting}
        onSubmit={handleSubmit}
        tabSwitchCount={tabSwitchCount}
        fullscreenExitCount={fullscreenExitCount}
      />

      <Modal
        isOpen={showViolationConfirm}
        onClose={() => {
          pendingViolationConfirmRef.current = false;
          setShowViolationConfirm(false);
        }}
        title="Tab-switch limit reached"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-5">
          Your answers are auto-saved. You can submit now, or continue the test.
        </p>
        <div className="flex gap-2 justify-end">
          <Btn
            variant="ghost"
            onClick={() => {
              pendingViolationConfirmRef.current = false;
              setShowViolationConfirm(false);
              toast('You chose to continue. Further switches may end the test.');
            }}
          >
            Continue test
          </Btn>
          <Btn
            variant="danger"
            onClick={() => handleSubmitRef.current?.({ autoSubmitted: true, reason: 'tab' })}
          >
            Submit test now
          </Btn>
        </div>
      </Modal>

    </div>
  );
}
