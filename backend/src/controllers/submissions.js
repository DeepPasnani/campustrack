const logger = require('../services/logger');
const { query, getClient } = require('../db');
const { setActiveSession, getActiveSession, deleteActiveSession, trackActiveUser, getActiveUserCount } = require('../db/redis');
const { judgeSubmission: codeJudge, submitRunCode, pollSubmissionStatus } = require('../services/runner');
const { resultsVisibleToStudent } = require('../services/resultsVisibility');

// Strips score/answer-correctness data from a submission row that isn't
// cleared for release yet, leaving only what's needed to show "submitted,
// results pending" in the UI.
function withheldSubmissionView(sub) {
  return {
    ...sub,
    score: null,
    max_score: null,
    code_results: null,
    resultsAvailable: false,
  };
}

function studentCanAccessTest(test, userDepartment, userClass, userYear) {
  const depts = Array.isArray(test.departments) && test.departments.length
    ? test.departments
    : (test.department ? [test.department] : []);
  if (depts.length && !depts.includes('all')) {
    const deptOk = depts.includes(userDepartment) || test.department === userDepartment;
    if (!deptOk) return false;
  }
  const classList = Array.isArray(test.classes) ? test.classes.filter(Boolean) : [];
  if (classList.length && !classList.includes('all')) {
    if (!userClass || !classList.includes(userClass)) return false;
  }
  const years = Array.isArray(test.years) ? test.years.filter(y => y !== null && y !== '') : [];
  if (years.length && !years.includes('all')) {
    const yStr = String(userYear);
    if (!userYear || !years.map(String).includes(yStr)) return false;
  }
  return true;
}

// POST /api/submissions/start
async function startTest(req, res) {
  const { testId } = req.body;
  const userId = req.user.id;

  // Check existing submission
  const { rows: existing } = await query(
    "SELECT * FROM submissions WHERE test_id=$1 AND user_id=$2",
    [testId, userId]
  );

  if (existing[0]?.status === 'submitted' || existing[0]?.status === 'auto_submitted') {
    return res.status(400).json({ error: 'You have already submitted this test.' });
  }

  // Validate test is active
  const { rows: testRows } = await query(
    "SELECT * FROM tests WHERE id=$1 AND status='published'", [testId]
  );
  const test = testRows[0];
  if (!test) return res.status(404).json({ error: 'Test not found or not available.' });

  if (!studentCanAccessTest(test, req.user.department, req.user.class_name, req.user.year_of_study)) {
    return res.status(403).json({ error: 'This test is not available for your class.' });
  }

  const now = new Date();
  if (test.start_time && now < new Date(test.start_time)) return res.status(400).json({ error: 'Test has not started yet.' });
  if (test.end_time && now > new Date(test.end_time)) return res.status(400).json({ error: 'Test has ended.' });

  // Create or resume submission
  let submission;
  if (existing[0]) {
    submission = existing[0];
  } else {
    const { rows } = await query(
      `INSERT INTO submissions (test_id, user_id, status, ip_address, class_snapshot, year_snapshot)
       VALUES ($1,$2,'in_progress',$3,$4,$5) RETURNING *`,
      [testId, userId, req.ip, req.user.class_name || null, req.user.year_of_study || null]
    );
    submission = rows[0];
  }

  // Track in Redis
  const startedAt = submission.started_at;
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const remaining = (test.duration_minutes * 60) - elapsed;

  await setActiveSession(userId, testId, {
    submissionId: submission.id, startedAt, remainingSeconds: remaining
  });
  await trackActiveUser(testId, userId);

  const activeCount = await getActiveUserCount(testId);

  res.json({
    submission,
    remainingSeconds: Math.max(0, remaining),
    activeUsers: activeCount,
  });
}

// POST /api/submissions/save-answers  (auto-save every 30s)
async function saveAnswers(req, res) {
  const { testId, answers, codeSolutions, flaggedQuestions, tabSwitchCount, selectedProblems } = req.body;
  const userId = req.user.id;

  const session = await getActiveSession(userId, testId);
  if (!session) return res.status(400).json({ error: 'No active test session found.' });

  const updateFields = [];
  const params = [];
  let idx = 0;

  if (answers !== undefined) { params.push(JSON.stringify(answers || {})); updateFields.push(`answers=$${++idx}`); }
  if (codeSolutions !== undefined) { params.push(JSON.stringify(codeSolutions || {})); updateFields.push(`code_solutions=$${++idx}`); }
  if (flaggedQuestions !== undefined) { params.push(JSON.stringify(flaggedQuestions || [])); updateFields.push(`flagged_questions=$${++idx}`); }
  // GREATEST, not a raw overwrite — a client resending a lower count
  // (accidentally, or to erase a real violation right before submitting)
  // must never move the stored count backwards.
  if (tabSwitchCount !== undefined) { params.push(tabSwitchCount); updateFields.push(`tab_switch_count=GREATEST(tab_switch_count, $${++idx})`); }
  if (selectedProblems !== undefined) { params.push(JSON.stringify(selectedProblems || [])); updateFields.push(`selected_problems=$${++idx}`); }

  if (!updateFields.length) return res.status(400).json({ error: 'Nothing to save' });

  params.push(testId, userId);
  await query(
    `UPDATE submissions SET ${updateFields.join(', ')}
     WHERE test_id=$${idx+1} AND user_id=$${idx+2} AND status='in_progress'`,
    params
  );

  res.json({ saved: true });
}

// Shared grading pipeline — used by a student's own submit and by an
// admin force-stopping a student's in-progress test (POST
// /submissions/:id/force-stop), so both paths score coding problems and
// MCQs identically instead of the admin path leaving a submission
// permanently unscored.
async function gradeAnswers({ sections, answers, codeSolutions, test }) {
  let totalScore = 0;
  let maxScore = 0;
  const detailedResults = {};

  for (const section of sections) {
    if (section.type === 'aptitude') {
      const { rows: questions } = await query(
        'SELECT id, type, correct_answer, marks FROM questions WHERE section_id=$1', [section.id]
      );
      for (const q of questions) {
        maxScore += q.marks;
        const userAnswer = (answers || {})[q.id];
        if (userAnswer === undefined || userAnswer === null || userAnswer === '') continue;

        const correct = q.correct_answer;
        let earned = 0;

        if (q.type === 'msq') {
          const ua = (Array.isArray(userAnswer) ? userAnswer : [userAnswer]).map(String).sort();
          const ca = (Array.isArray(correct) ? correct : [correct]).map(String).sort();
          if (JSON.stringify(ua) === JSON.stringify(ca)) earned = q.marks;
          else if (test.settings?.negativeMarking) earned = -(q.marks * (test.settings.negativeFraction || 0.25));
        } else {
          if (String(userAnswer) === String(correct)) earned = q.marks;
          else if (test.settings?.negativeMarking) earned = -(q.marks * (test.settings.negativeFraction || 0.25));
        }

        totalScore += earned;
        detailedResults[q.id] = { earned, correct };
      }
    } else {
      const { rows: problems } = await query(
        'SELECT id, marks, test_cases, time_limit_seconds, memory_limit_mb FROM coding_problems WHERE section_id=$1', [section.id]
      );
      for (const p of problems) {
        maxScore += p.marks;
        const sol = (codeSolutions || {})[p.id];
        if (!sol) continue;

        const lang = Object.keys(sol).find(l => sol[l]?.trim());
        if (!lang || !sol[lang]?.trim()) continue;

        // Run against hidden + visible test cases using the built-in runner
        try {
          const testCases = Array.isArray(p.test_cases) ? p.test_cases : [];
          const results = await codeJudge({
            code: sol[lang], language: lang,
            testCases,
            timeLimit: p.time_limit_seconds,
            memoryLimit: p.memory_limit_mb,
          });

          const total = results.length || 1;
          // Default scoring: honestly divide the problem's marks equally across
          // all test cases. If the creator set an explicit `marks` on a test case,
          // that per-case value is used instead for that test case.
          const equalShare = p.marks / total;
          let anyCustomMarks = false;
          let earned = 0;

          const enriched = results.map((r, i) => {
            const tc = testCases[i] || {};
            const custom = Number(tc.marks);
            const hasCustom = Number.isFinite(custom) && custom > 0;
            if (hasCustom) anyCustomMarks = true;
            const weight = hasCustom ? custom : equalShare;
            const isHidden = !!tc.isHidden;
            const earnedCase = r.passed ? weight : 0;
            earned += earnedCase;
            // Strip hidden test-case inputs/expected outputs so grading
            // stays confidential, while keeping the error the student hit.
            return {
              ...r,
              hidden: isHidden,
              marks: weight,
              earned: earnedCase,
              ...(isHidden ? { input: '', expected: '', actual: r.actual || r.stdout || '' } : {}),
            };
          });

          const passed = results.filter(r => r.passed).length;
          const visiblePassed = results.filter(r => !r.hidden && r.passed).length;
          const hiddenPassed = results.filter(r => r.hidden && r.passed).length;

          earned = Math.round(earned);
          totalScore += earned;
          detailedResults[p.id] = {
            earned, passed, total,
            problemMarks: p.marks,
            visiblePassed, hiddenPassed,
            perCaseMarks: anyCustomMarks,
            results: enriched,
          };
        } catch (e) {
          logger.error({ err: e }, 'Code execution error');
          const earned = Math.round(p.marks * 0.1);
          totalScore += earned;
          detailedResults[p.id] = { earned, error: 'Execution service unavailable' };
        }
      }
    }
  }

  return { totalScore, maxScore, detailedResults };
}

// POST /api/submissions/submit
async function submitTest(req, res) {
  const { testId, answers, codeSolutions, flaggedQuestions, tabSwitchCount, selectedProblems, autoSubmitted } = req.body;
  const userId = req.user.id;

  const { rows: subRows } = await query(
    "SELECT * FROM submissions WHERE test_id=$1 AND user_id=$2", [testId, userId]
  );
  const submission = subRows[0];
  if (!submission) return res.status(404).json({ error: 'Submission not found.' });
  if (submission.status !== 'in_progress') return res.status(400).json({ error: 'Test already submitted.' });

  // Load test + correct answers for grading
  const { rows: testRows } = await query('SELECT * FROM tests WHERE id=$1', [testId]);
  const test = testRows[0];
  const { rows: sections } = await query('SELECT * FROM sections WHERE test_id=$1 ORDER BY order_index', [testId]);

  // Server-authoritative timer check
  const elapsedSec = Math.floor((Date.now() - new Date(submission.started_at).getTime()) / 1000);
  const maxDurationSec = test.duration_minutes * 60;
  const timeExpired = elapsedSec >= maxDurationSec;

  // Server-side tab-switch limit check
  const effectiveTabCount = tabSwitchCount !== undefined ? tabSwitchCount : submission.tab_switch_count;
  const tabSwitchLimit = 5;
  const tabLimitExceeded = effectiveTabCount >= tabSwitchLimit;

  if (timeExpired || tabLimitExceeded) {
    const reason = timeExpired ? 'Time expired' : 'Tab switch limit exceeded';
    // Grade whatever the client sent (or, failing that, the last auto-saved
    // state) instead of forcing a 0 — see gradeAnswers' comment above; this
    // path used to skip grading entirely and left every timer/tab-limit
    // auto-submit permanently scored 0 regardless of what was answered.
    const finalAnswers = answers !== undefined ? answers : (submission.answers || {});
    const finalCodeSolutions = codeSolutions !== undefined ? codeSolutions : (submission.code_solutions || {});
    const { totalScore, maxScore, detailedResults } = await gradeAnswers({
      sections, answers: finalAnswers, codeSolutions: finalCodeSolutions, test
    });
    const finalScore = Math.max(0, totalScore);
    const finalTabCount = Math.max(effectiveTabCount, submission.tab_switch_count);
    const finalSelectedProblems = selectedProblems !== undefined ? selectedProblems : submission.selected_problems;

    const { rows: [autoSub] } = await query(
      `UPDATE submissions SET
         status='auto_submitted', score=$1, max_score=$2, answers=$3, code_solutions=$4,
         flagged_questions=$5, code_results=$6, tab_switch_count=$7, selected_problems=$8,
         submitted_at=NOW(), time_taken_seconds=$9
       WHERE id=$10 RETURNING *`,
      [finalScore, maxScore, JSON.stringify(finalAnswers), JSON.stringify(finalCodeSolutions),
       JSON.stringify(flaggedQuestions || []), JSON.stringify(detailedResults), finalTabCount,
       JSON.stringify(finalSelectedProblems || []), elapsedSec, submission.id]
    );
    await deleteActiveSession(userId, testId);

    const pct = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0;
    const passed = pct >= (test.settings?.passingScore ?? 40);

    return res.json({
      submission: autoSub,
      score: finalScore, maxScore, percentage: pct, passed,
      autoSubmitted: true,
      reason,
      details: test.settings?.showResults === 'after_submit' ? detailedResults : null,
    });
  }

  // Server-side validation of coding problem selection
  for (const section of sections) {
    if (section.type === 'coding') {
      const { rows: problems } = await query(
        'SELECT id, difficulty FROM coding_problems WHERE section_id=$1', [section.id]
      );
      if (problems.length > 3) {
        const selectedForSection = (selectedProblems || []).filter(pid =>
          problems.some(p => p.id === pid)
        );
        if (selectedForSection.length > 3) {
          return res.status(400).json({ error: 'Cannot select more than 3 coding problems.' });
        }
        const easySelected = problems.filter(p =>
          p.difficulty === 'easy' && selectedForSection.includes(p.id)
        ).length;
        const hardSelected = problems.filter(p =>
          p.difficulty === 'hard' && selectedForSection.includes(p.id)
        ).length;
        if (easySelected > 2) {
          return res.status(400).json({ error: 'Cannot select more than 2 easy coding problems.' });
        }
        if (hardSelected > 1) {
          return res.status(400).json({ error: 'Cannot select more than 1 hard coding problem.' });
        }
        // Store validated selection
        if (!req.body.codeSolutions) req.body.codeSolutions = {};
        if (req.body.codeSolutions && typeof req.body.codeSolutions === 'object') {
          // Only grade selected problems
          const validatedSolutions = {};
          for (const pid of selectedForSection) {
            if (req.body.codeSolutions[pid]) {
              validatedSolutions[pid] = req.body.codeSolutions[pid];
            }
          }
          // Merge back
          for (const pid of Object.keys(req.body.codeSolutions)) {
            if (!selectedForSection.includes(pid) || !problems.some(p => p.id === pid)) {
              delete req.body.codeSolutions[pid];
            }
          }
        }
      }
    }
  }

  const { totalScore, maxScore, detailedResults } = await gradeAnswers({ sections, answers, codeSolutions, test });

  const finalScore = Math.max(0, totalScore);
  const elapsed = Math.floor((Date.now() - new Date(submission.started_at).getTime()) / 1000);
  const newStatus = autoSubmitted ? 'auto_submitted' : 'submitted';
  const finalTabCount = Math.max(submission.tab_switch_count || 0, tabSwitchCount !== undefined ? tabSwitchCount : 0);

  const finalSelectedProblems = selectedProblems !== undefined ? selectedProblems : submission.selected_problems;

  const { rows: [updated] } = await query(
    `UPDATE submissions SET
       status=$1, score=$2, max_score=$3, answers=$4, code_solutions=$5,
       flagged_questions=$6, code_results=$7, submitted_at=NOW(), time_taken_seconds=$8,
       tab_switch_count=$9, selected_problems=$10
     WHERE id=$11 RETURNING *`,
    [newStatus, finalScore, maxScore, JSON.stringify(answers || {}), JSON.stringify(codeSolutions || {}),
     JSON.stringify(flaggedQuestions || []), JSON.stringify(detailedResults), elapsed, finalTabCount,
     JSON.stringify(finalSelectedProblems || []), submission.id]
  );

  await deleteActiveSession(userId, testId);

  const pct = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0;
  const passed = pct >= (test.settings?.passingScore ?? 40);

  res.json({
    submission: updated,
    score: finalScore,
    maxScore,
    percentage: pct,
    passed,
    details: test.settings?.showResults === 'after_submit' ? detailedResults : null,
  });
}

// GET /api/submissions/my
async function getMySubmissions(req, res) {
  const { rows } = await query(
    `SELECT s.*, t.title as test_title, t.settings as test_settings,
       t.end_time as test_end_time, t.results_published_at
     FROM submissions s JOIN tests t ON s.test_id = t.id
     WHERE s.user_id=$1 ORDER BY s.submitted_at DESC NULLS LAST`,
    [req.user.id]
  );
  const submissions = rows.map(sub =>
    resultsVisibleToStudent({ settings: sub.test_settings, end_time: sub.test_end_time, results_published_at: sub.results_published_at })
      ? sub
      : withheldSubmissionView(sub)
  );
  res.json({ submissions });
}

// PUT /api/submissions/test/:testId/publish-results (admin) — releases
// results early for 'manual'/'after_end' tests. Idempotent.
async function publishResults(req, res) {
  const { rows } = await query(
    `UPDATE tests SET results_published_at=NOW() WHERE id=$1 AND results_published_at IS NULL RETURNING results_published_at`,
    [req.params.testId]
  );
  if (!rows.length) {
    const { rows: existing } = await query('SELECT results_published_at FROM tests WHERE id=$1', [req.params.testId]);
    if (!existing.length) return res.status(404).json({ error: 'Test not found' });
    return res.json({ results_published_at: existing[0].results_published_at });
  }
  res.json({ results_published_at: rows[0].results_published_at });
}

// PUT /api/submissions/test/:testId/unpublish-results (admin) — puts a
// manually-released test's results back behind the showResults gate.
async function unpublishResults(req, res) {
  const { rows } = await query(
    'UPDATE tests SET results_published_at=NULL WHERE id=$1 RETURNING id',
    [req.params.testId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Test not found' });
  res.json({ results_published_at: null });
}

// GET /api/submissions/test/:testId (admin)
async function getTestSubmissions(req, res) {
  const { rows } = await query(
    `SELECT s.*, u.name as user_name, u.email as user_email, u.branch, u.roll_number,
       u.department as user_department, u.class_name as user_class, u.year_of_study as user_year,
       COALESCE(s.class_snapshot, u.class_name) as class_display,
       COALESCE(s.year_snapshot, u.year_of_study) as year_display
     FROM submissions s JOIN users u ON s.user_id = u.id
     WHERE s.test_id=$1 ORDER BY s.score DESC NULLS LAST`,
    [req.params.testId]
  );
  res.json({ submissions: rows });
}

// GET /api/submissions/:id (detail)
async function getSubmission(req, res) {
  const { rows } = await query(
    `SELECT s.*, u.name as user_name, t.title as test_title, t.settings as test_settings,
       t.end_time as test_end_time, t.results_published_at
     FROM submissions s JOIN users u ON s.user_id=u.id JOIN tests t ON s.test_id=t.id
     WHERE s.id=$1`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
  const sub = rows[0];
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  // Students can only see their own
  if (!isAdmin && sub.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Score/breakdown release is gated by test.settings.showResults — a direct
  // API call must not let a student see this any earlier than the admin
  // configured, even though they own the submission.
  if (!isAdmin && !resultsVisibleToStudent({ settings: sub.test_settings, end_time: sub.test_end_time, results_published_at: sub.results_published_at })) {
    return res.json({ submission: withheldSubmissionView(sub), questionInfo: {} });
  }

  // code_results (see submitTest) is keyed by question/coding_problem id with
  // no text attached, so the result page has nothing to render but raw ids
  // unless we also hand back what each id actually is.
  const { rows: qRows } = await query(
    `SELECT q.id, q.text, q.type, q.options, q.correct_answer, q.explanation
     FROM questions q JOIN sections sec ON q.section_id = sec.id
     WHERE sec.test_id = $1`,
    [sub.test_id]
  );
  const { rows: cpRows } = await query(
    `SELECT cp.id, cp.title, cp.description, cp.explanation
     FROM coding_problems cp JOIN sections sec ON cp.section_id = sec.id
     WHERE sec.test_id = $1`,
    [sub.test_id]
  );
  const questionInfo = {};
  for (const q of qRows) {
    questionInfo[q.id] = {
      text: q.text,
      type: q.type,
      options: q.options,
      correctAnswer: q.correct_answer,
      explanation: q.explanation || null,
      // The student's own answer lives in sub.answers (JSONB keyed by
      // question id) — surfaced here so the frontend doesn't need to
      // cross-reference two objects to show "your answer" vs "correct".
      studentAnswer: (sub.answers || {})[q.id] ?? null,
    };
  }
  for (const cp of cpRows) questionInfo[cp.id] = { title: cp.title, description: cp.description, explanation: cp.explanation || null };

  res.json({ submission: sub, questionInfo });
}

const { v4: uuidv4 } = require('uuid');

// ── In-memory cache for async run-code results ────────────────
const pendingRunCodeResults = new Map();

// POST /api/submissions/run-code (live code testing)
// Also supports testCases array for per-test-case results. When a problemId is
// supplied the full suite (hidden + visible) is judged so the student can see
// their progress against every test case, while hidden-case contents stay
// confidential — only pass counts for those are returned.
async function runCode(req, res) {
  const { code, language, stdin, testCases, timeLimit, memoryLimit, problemId } = req.body;
  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  const hasVisibleTests = testCases && Array.isArray(testCases) && testCases.length > 0;
  if (hasVisibleTests || problemId) {
    let suite = hasVisibleTests ? testCases.filter(tc => !tc.isHidden) : [];
    let timeLimitSec = timeLimit || 5;
    let memoryLimitMb = memoryLimit || 256;

    if (problemId) {
      const { rows } = await query(
        `SELECT cp.test_cases, cp.time_limit_seconds, cp.memory_limit_mb
         FROM coding_problems cp
         JOIN sections s ON s.id = cp.section_id
         JOIN submissions sub ON sub.test_id = s.test_id
         WHERE cp.id=$1 AND sub.user_id=$2 AND sub.status='in_progress'
         LIMIT 1`,
        [problemId, req.user.id]
      );
      if (!rows.length) {
        return res.status(403).json({ error: 'Problem not available in an active test.' });
      }
      const full = Array.isArray(rows[0].test_cases) ? rows[0].test_cases : [];
      if (full.length) {
        suite = full;
        if (rows[0].time_limit_seconds) timeLimitSec = rows[0].time_limit_seconds;
        if (rows[0].memory_limit_mb) memoryLimitMb = rows[0].memory_limit_mb;
      }
    }

    const emptySummary = {
      results: [],
      summary: { passed: 0, total: 0, visiblePassed: 0, visibleTotal: 0, hiddenPassed: 0, hiddenTotal: 0 },
    };
    if (!suite.length) return res.json(emptySummary);

    const results = await codeJudge({
      code, language,
      testCases: suite,
      timeLimit: timeLimitSec,
      memoryLimit: memoryLimitMb,
    });

    const visible = results.filter(r => !r.hidden);
    const hidden = results.filter(r => r.hidden);

    return res.json({
      results: visible,
      summary: {
        passed: results.filter(r => r.passed).length,
        total: results.length,
        visiblePassed: visible.filter(r => r.passed).length,
        visibleTotal: visible.length,
        hiddenPassed: hidden.filter(r => r.passed).length,
        hiddenTotal: hidden.length,
      },
    });
  }

  const id = uuidv4();
  const entry = {
    userId: req.user.id, result: null,
    code, language, stdin: stdin || '',
    timeLimit: timeLimit || 5,
    memoryLimit: memoryLimit || 256,
  };
  pendingRunCodeResults.set(id, entry);

  res.json({ id });

  submitAndPushRunCodeResult(id, entry);
}

async function submitAndPushRunCodeResult(id, entry) {
  let token;
  try {
    token = await submitRunCode({
      code: entry.code, language: entry.language,
      stdin: entry.stdin, timeLimit: entry.timeLimit,
      memoryLimit: entry.memoryLimit,
    });
  } catch (err) {
    const errorResult = {
      status: 'Error', statusId: 0, stdout: '', stderr: '',
      compileOutput: '', time: null, memory: null, passed: false,
      error: err.message,
    };
    pendingRunCodeResults.set(id, { userId: entry.userId, result: errorResult });
    try {
      const { sendToUser } = require('../services/websocket');
      sendToUser(entry.userId, { type: 'CODE_EXECUTION_RESULT', id, ...errorResult });
    } catch {}
    return;
  }

  pendingRunCodeResults.set(id, { userId: entry.userId, result: null, execToken: token });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const result = await pollSubmissionStatus(token);
      if (!result) continue;

      pendingRunCodeResults.set(id, { userId: entry.userId, result });

      const { sendToUser } = require('../services/websocket');
      sendToUser(entry.userId, {
        type: 'CODE_EXECUTION_RESULT',
        id,
        ...result,
      });
      return;
    } catch {
      // transient error, keep polling
    }
  }

  const errorResult = {
    status: 'Error', statusId: 0, stdout: '', stderr: '',
    compileOutput: '', time: null, memory: null, passed: false,
    error: 'Execution timed out',
  };
  pendingRunCodeResults.set(id, { userId: entry.userId, result: errorResult });

  try {
    const { sendToUser } = require('../services/websocket');
    sendToUser(entry.userId, {
      type: 'CODE_EXECUTION_RESULT',
      id,
      ...errorResult,
    });
  } catch {}
}

// GET /api/submissions/run-code/result/:id (fallback if WS message missed)
async function getRunCodeResult(req, res) {
  const entry = pendingRunCodeResults.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (!entry.result) return res.json({ status: 'pending' });
  res.json(entry.result);
}

// ── POST /api/submissions/resume/:id (admin only) ──────────
// Admin can resume a student's auto-submitted test, preserving remaining time
async function resumeTest(req, res) {
  const { id } = req.params;

  const { rows: subRows } = await query('SELECT * FROM submissions WHERE id = $1', [id]);
  if (!subRows.length) return res.status(404).json({ error: 'Submission not found' });

  const sub = subRows[0];
  if (sub.status !== 'auto_submitted' && sub.status !== 'submitted') {
    return res.status(400).json({ error: 'Only submitted/auto-submitted tests can be resumed' });
  }

  // Calculate remaining time: original duration - time already taken
  const { rows: [test] } = await query('SELECT * FROM tests WHERE id = $1', [sub.test_id]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const elapsed = sub.time_taken_seconds || 0;
  const remaining = Math.max(0, (test.duration_minutes * 60) - elapsed);

  if (remaining <= 0) {
    return res.status(400).json({ error: 'Test duration has already expired. Cannot resume.' });
  }

  // Reset to in_progress, update resumed_at
  const { rows: [updated] } = await query(
    `UPDATE submissions SET
       status = 'in_progress',
       resumed_at = NOW(),
       submitted_at = NULL
     WHERE id = $1 RETURNING *`,
    [id]
  );

  // Re-activate Redis session
  const { setActiveSession, trackActiveUser } = require('../db/redis');
  await setActiveSession(sub.user_id, sub.test_id, {
    submissionId: sub.id,
    startedAt: sub.started_at,
    remainingSeconds: remaining,
  });
  await trackActiveUser(sub.test_id, sub.user_id);

  res.json({
    submission: updated,
    remainingSeconds: remaining,
    message: 'Test resumed successfully. Student can continue from where they left off.',
  });
}

// ── POST /api/submissions/:id/force-stop (admin/super_admin only) ──────
// Ends a student's in-progress test right now — e.g. a device needs to be
// reclaimed, or the student needs to be pulled from the exam hall. Grades
// whatever was last auto-saved (periodic saves run every 30s during the
// test, more often on newer clients), the same way a normal submit would,
// so the submission is never left permanently unscored the way the
// time-expiry/tab-limit auto-submit path used to leave it.
async function forceStopTest(req, res) {
  const { id } = req.params;

  const { rows: subRows } = await query('SELECT * FROM submissions WHERE id = $1', [id]);
  if (!subRows.length) return res.status(404).json({ error: 'Submission not found' });
  const sub = subRows[0];

  if (sub.status !== 'in_progress') {
    return res.status(400).json({ error: 'Only a test that is currently in progress can be stopped.' });
  }

  const { rows: [test] } = await query('SELECT * FROM tests WHERE id=$1', [sub.test_id]);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const { rows: sections } = await query('SELECT * FROM sections WHERE test_id=$1 ORDER BY order_index', [sub.test_id]);

  const answers = sub.answers || {};
  const codeSolutions = sub.code_solutions || {};
  const { totalScore, maxScore, detailedResults } = await gradeAnswers({ sections, answers, codeSolutions, test });
  const finalScore = Math.max(0, totalScore);

  const elapsed = Math.floor((Date.now() - new Date(sub.started_at).getTime()) / 1000);

  const { rows: [updated] } = await query(
    `UPDATE submissions SET
       status='auto_submitted', score=$1, max_score=$2, code_results=$3,
       submitted_at=NOW(), time_taken_seconds=$4, ended_by=$5
     WHERE id=$6 RETURNING *`,
    [finalScore, maxScore, JSON.stringify(detailedResults), elapsed, req.user.id, id]
  );

  await deleteActiveSession(sub.user_id, sub.test_id);

  const pct = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0;

  res.json({
    submission: updated,
    score: finalScore,
    maxScore,
    percentage: pct,
    message: 'Test stopped and graded from the student’s last saved answers.',
  });
}

// ── PATCH /api/submissions/:id/marks (admin/super_admin only) ─────────
// Manual score override — for partial-credit cases the auto-grader can't
// see (a coding solution that's correct but stylistically flagged, an
// essay-style answer, a dispute resolution, etc).
async function updateMarks(req, res) {
  const { id } = req.params;
  const { score, maxScore, note } = req.body;

  if (score === undefined || score === null || Number.isNaN(Number(score))) {
    return res.status(400).json({ error: 'A numeric score is required' });
  }

  const fields = ['score=$1', 'graded_by=$2', 'graded_at=NOW()'];
  const params = [Number(score), req.user.id];

  if (maxScore !== undefined && maxScore !== null && !Number.isNaN(Number(maxScore))) {
    params.push(Number(maxScore));
    fields.push(`max_score=$${params.length}`);
  }
  if (note !== undefined) {
    params.push(note || null);
    fields.push(`grading_note=$${params.length}`);
  }

  params.push(id);
  const { rows } = await query(
    `UPDATE submissions SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Submission not found' });

  res.json({ submission: rows[0] });
}

// PATCH /api/submissions/test/:testId/adjust-marks — moderation-style curve:
// add (or subtract) the same amount to every graded submission for a test,
// e.g. +2 to credit a question that turned out to be ambiguous for
// everyone, or -1 across the board after a re-check. Clamped to
// [0, max_score] per submission so a flat bonus/penalty can't push anyone
// negative or above their own max.
async function adjustAllMarks(req, res) {
  const { testId } = req.params;
  const { amount, note } = req.body;

  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
    return res.status(400).json({ error: 'A numeric amount is required' });
  }
  const delta = Number(amount);
  if (delta === 0) return res.status(400).json({ error: 'Amount must be non-zero' });

  const { rows } = await query(
    `UPDATE submissions
       SET score = LEAST(max_score, GREATEST(0, score + $1)),
           graded_by = $2, graded_at = NOW(),
           grading_note = COALESCE($3, grading_note)
     WHERE test_id = $4 AND status IN ('submitted', 'auto_submitted')
     RETURNING id`,
    [delta, req.user.id, note || null, testId]
  );

  res.json({ updated: rows.length, delta });
}

// ── Bulk marks import (admin/super_admin only) ─────────────────────────
// Matches rows by roll number or email against submissions for one test.
async function applyBulkMarks(testId, entries, adminId) {
  const results = { updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    const identifier = (row.rollNumber || row.roll_number || row.email || '').toString().trim();
    const scoreVal = row.score !== undefined ? row.score : row.marks;

    if (!identifier) { results.errors.push({ row: i + 2, message: 'Missing email or roll number' }); continue; }
    if (scoreVal === undefined || scoreVal === '' || Number.isNaN(Number(scoreVal))) {
      results.errors.push({ row: i + 2, message: `${identifier}: missing or invalid score` });
      continue;
    }

    const params = [testId, identifier.toLowerCase()];
    const { rows: subRows } = await query(
      `SELECT s.id FROM submissions s JOIN users u ON s.user_id = u.id
       WHERE s.test_id = $1 AND (LOWER(u.email) = $2 OR LOWER(u.roll_number) = $2)
       LIMIT 1`,
      params
    );

    if (!subRows.length) {
      results.errors.push({ row: i + 2, message: `${identifier}: no submission found for this test` });
      results.skipped++;
      continue;
    }

    const updateParams = [Number(scoreVal), adminId];
    const setFields = ['score=$1', 'graded_by=$2', 'graded_at=NOW()'];
    if (row.maxScore !== undefined && !Number.isNaN(Number(row.maxScore))) {
      updateParams.push(Number(row.maxScore));
      setFields.push(`max_score=$${updateParams.length}`);
    }
    updateParams.push(subRows[0].id);

    await query(`UPDATE submissions SET ${setFields.join(', ')} WHERE id=$${updateParams.length}`, updateParams);
    results.updated++;
  }

  return results;
}

// CSV columns: rollNumber (or email), score, maxScore (optional)
function parseMarksCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j]; });
    rows.push(row);
  }
  return rows;
}

// POST /api/submissions/bulk-marks/csv  { testId, csv }
async function bulkMarksCsv(req, res) {
  const { testId, csv } = req.body;
  if (!testId || !csv) return res.status(400).json({ error: 'testId and csv are required' });

  const rows = parseMarksCsv(csv);
  if (!rows.length) return res.status(400).json({ error: 'No valid rows found in CSV' });

  const results = await applyBulkMarks(testId, rows, req.user.id);
  res.json(results);
}

// POST /api/submissions/bulk-marks/json  { testId, entries: [{ rollNumber|email, score, maxScore? }] }
async function bulkMarksJson(req, res) {
  const { testId, entries } = req.body;
  if (!testId || !Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'testId and a non-empty entries array are required' });
  }

  const results = await applyBulkMarks(testId, entries, req.user.id);
  res.json(results);
}

// GET /api/submissions/test/:testId/export-pdf (admin) — formatted summary report
async function exportResultsPdf(req, res) {
  const { testId } = req.params;

  const { rows: testRows } = await query('SELECT * FROM tests WHERE id=$1', [testId]);
  if (!testRows.length) return res.status(404).json({ error: 'Test not found' });
  const test = testRows[0];

  const { rows: submissions } = await query(
    `SELECT s.*, u.name as user_name, u.email as user_email, u.branch, u.roll_number,
       COALESCE(s.class_snapshot, u.class_name) as class_display
     FROM submissions s JOIN users u ON s.user_id = u.id
     WHERE s.test_id=$1 ORDER BY s.score DESC NULLS LAST`,
    [testId]
  );

  const classNames = [...new Set(submissions.map(s => s.class_display).filter(Boolean))].sort();
  const classBreakdown = classNames.map(c => {
    const rows = submissions.filter(s => s.class_display === c && s.status === 'submitted' && s.max_score > 0);
    const avg = rows.length ? Math.round(rows.reduce((a, s) => a + (s.score / s.max_score) * 100, 0) / rows.length) : 0;
    const passed = rows.filter(s => (s.score / s.max_score) * 100 >= (test.settings?.passingScore ?? 40)).length;
    return { class: c, count: rows.length, avg, passRate: rows.length ? Math.round((passed / rows.length) * 100) : 0 };
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="campustrack_${test.title.replace(/[^a-z0-9]+/gi, '_')}_results.pdf"`);

  const { buildResultsPdf } = require('../services/pdfReport');
  buildResultsPdf({ test, submissions, classBreakdown }, res);
}

// GET /api/submissions/test/:testId/export-csv (admin)
async function exportResultsCsv(req, res) {
  const { testId } = req.params;
  const { class_name: classFilter } = req.query;

  const { rows: testRows } = await query('SELECT * FROM tests WHERE id=$1', [testId]);
  if (!testRows.length) return res.status(404).json({ error: 'Test not found' });
  const test = testRows[0];

  let subQuery = `
    SELECT s.*, u.name as user_name, u.email as user_email, u.branch, u.roll_number,
           COALESCE(s.class_snapshot, u.class_name) as class_display,
           COALESCE(s.year_snapshot, u.year_of_study) as year_display
    FROM submissions s JOIN users u ON s.user_id = u.id
    WHERE s.test_id=$1`;
  const params = [testId];

  if (classFilter && classFilter !== 'all') {
    params.push(classFilter);
    subQuery += ` AND COALESCE(s.class_snapshot, u.class_name)=$${params.length}`;
  }

  subQuery += ' ORDER BY s.score DESC NULLS LAST';

  const { rows: submissions } = await query(subQuery, params);

  const csvRows = [];
  csvRows.push(['Rank', 'Name', 'Email', 'Roll No', 'Branch', 'Class', 'Year',
    'Score', 'Max', 'Percentage', 'Result', 'Time Taken (s)', 'Submitted At', 'Status',
    'Tab Switches'].join(','));

  const ranked = [...submissions].sort((a, b) => {
    const aScore = a.status === 'submitted' ? (a.score || 0) : -1;
    const bScore = b.status === 'submitted' ? (b.score || 0) : -1;
    return bScore - aScore;
  });

  ranked.forEach((s, i) => {
    const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0;
    const escaped = (v) => {
      const str = String(v ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };
    csvRows.push([
      escaped(i + 1),
      escaped(s.user_name),
      escaped(s.user_email),
      escaped(s.roll_number),
      escaped(s.branch),
      escaped(s.class_display),
      escaped(s.year_display),
      escaped(s.score),
      escaped(s.max_score),
      escaped(`${pct}%`),
      escaped(pct >= (test.settings?.passingScore ?? 40) ? 'Pass' : s.status === 'submitted' ? 'Fail' : '—'),
      escaped(s.time_taken_seconds),
      escaped(s.submitted_at ? new Date(s.submitted_at).toISOString() : ''),
      escaped(s.status),
      escaped(s.tab_switch_count),
    ].join(','));
  });

  const csv = csvRows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="campustrack_${test.title.replace(/[^a-z0-9]+/gi, '_')}_results.csv"`);
  res.send(csv);
}

// DELETE /api/submissions/:id (admin only)
async function deleteSubmission(req, res) {
  const { id } = req.params;
  
  const { rows } = await query('SELECT id FROM submissions WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
  
  await query('DELETE FROM submissions WHERE id = $1', [id]);
  
  res.json({ message: 'Submission deleted successfully' });
}

// ── GET /api/submissions/question-analytics ─────────────────
// Question difficulty analytics — flag MCQs that students
// consistently answer incorrectly.
async function getQuestionAnalytics(req, res) {
  const { test_id, threshold } = req.query;
  const incorrectThreshold = parseFloat(threshold) || 0.6;

  let whereClause = "WHERE s.status='submitted' AND q.type='mcq'";
  const params = [];

  if (test_id) {
    params.push(test_id);
    whereClause += ` AND s.test_id=$${params.length}`;
  }

  const { rows: questions } = await query(`
    SELECT q.id, q.text, q.genre, q.difficulty, q.marks, q.explanation,
           COUNT(DISTINCT s.id) as total_attempts,
           SUM(CASE WHEN (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1 ELSE 0 END) as correct_count,
           SUM(CASE WHEN (s.answers->>q.id::text) IS NOT NULL AND (s.answers->>q.id::text) != '' THEN 1 ELSE 0 END) as attempted_count
    FROM questions q
    JOIN sections sec ON q.section_id = sec.id
    JOIN submissions s ON s.test_id IN (SELECT id FROM tests WHERE id IN (SELECT test_id FROM sections WHERE id = sec.id))
    ${whereClause}
    GROUP BY q.id, q.text, q.genre, q.difficulty, q.marks, q.explanation
    HAVING COUNT(DISTINCT s.id) >= 3
    ORDER BY (COUNT(DISTINCT s.id) - SUM(CASE WHEN (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1 ELSE 0 END))::float / NULLIF(COUNT(DISTINCT s.id), 0) DESC
  `, params);

  const flagged = questions.map(q => {
    const total = parseInt(q.total_attempts) || 0;
    const correct = parseInt(q.correct_count) || 0;
    const incorrectRate = total > 0 ? (total - correct) / total : 0;
    return {
      id: q.id,
      text: q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text,
      genre: q.genre,
      difficulty: q.difficulty,
      marks: q.marks,
      explanation: q.explanation,
      total_attempts: total,
      correct_count: correct,
      attempted_count: parseInt(q.attempted_count) || 0,
      incorrect_rate: Math.round(incorrectRate * 100),
      flagged: incorrectRate >= incorrectThreshold,
    };
  });

  res.json({
    threshold: incorrectThreshold,
    total_questions: flagged.length,
    flagged_count: flagged.filter(q => q.flagged).length,
    questions: flagged,
  });
}

// ── GET /api/submissions/plagiarism-check/:testId ──────────
// Plagiarism/similarity detection across code submissions.
function normalizeCode(code) {
  return code
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'.*?'/g, '')
    .replace(/".*?"/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(public|private|protected|static|final|const|let|var|function|def|int|float|double|char|void|string|boolean|return|if|else|for|while|do|switch|case|break|continue|import|from|class|struct|enum|interface|extends|implements|new|this|super|try|catch|throw|throws|package)\b/g, '')
    .trim()
    .toLowerCase();
}

function tokenize(source) {
  return source
    .replace(/[{}();,.[\]<>!=+\-*/%&|^~?:]/g, ' $& ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - (dp[a.length][b.length] / maxLen);
}

// Pairs an admin has already reviewed with "Ignore" — plagiarism pairs
// aren't stored rows, they're recomputed fresh on every check, so without
// this an ignored pair would just reappear on the next page load. Keyed by
// the two submission ids (order-independent) + problem id, since that's
// what uniquely identifies a match.
function ignoredPairKey(subIdA, subIdB, problemId) {
  return [subIdA, subIdB].sort().join('|') + '|' + problemId;
}

async function checkPlagiarism(req, res) {
  const { testId } = req.params;
  const { threshold = 0.7, minTabSwitches = 0 } = req.query;
  const similarityThreshold = parseFloat(threshold);
  const minTabsFilter = parseInt(minTabSwitches, 10) || 0;

  let ignoredQuery = `
    SELECT submission_id, metadata->>'pairedWithSubmissionId' as paired_with, metadata->>'problemId' as problem_id
    FROM suspicious_flags WHERE flag_type='plagiarism' AND action_taken='ignore'
  `;
  const ignoredParams = [];
  if (testId && testId !== 'all') {
    ignoredParams.push(testId);
    ignoredQuery += ` AND test_id=$1`;
  }
  const { rows: ignoredRows } = await query(ignoredQuery, ignoredParams);
  const ignoredPairs = new Set(
    ignoredRows.filter(r => r.paired_with).map(r => ignoredPairKey(r.submission_id, r.paired_with, r.problem_id))
  );

  let subQuery = `
    SELECT s.id, s.user_id, s.test_id, s.code_solutions, s.selected_problems,
           COALESCE(s.tab_switch_count, 0) as tab_switch_count,
           COALESCE(s.fullscreen_exit_count, 0) as fullscreen_exit_count,
           u.name as user_name, u.email, u.roll_number,
           t.title as test_title
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    JOIN tests t ON s.test_id = t.id
    WHERE s.status='submitted'
  `;
  const subParams = [];
  if (testId && testId !== 'all') {
    subParams.push(testId);
    subQuery += ` AND s.test_id=$${subParams.length}`;
  }

  const { rows: submissions } = await query(subQuery, subParams);

  const codeEntries = [];
  for (const sub of submissions) {
    const solutions = sub.code_solutions || {};
    for (const probId of Object.keys(solutions)) {
      const sol = solutions[probId];
      if (!sol) continue;
      const lang = Object.keys(sol).find(l => sol[l]?.trim());
      if (!lang || !sol[lang]?.trim()) continue;
      codeEntries.push({
        submissionId: sub.id,
        testId: sub.test_id,
        testTitle: sub.test_title,
        userId: sub.user_id,
        userName: sub.user_name,
        email: sub.email,
        rollNumber: sub.roll_number,
        tabSwitchCount: parseInt(sub.tab_switch_count) || 0,
        fullscreenExitCount: parseInt(sub.fullscreen_exit_count) || 0,
        problemId: probId,
        language: lang,
        code: sol[lang],
      });
    }
  }

  const pairs = [];
  for (let i = 0; i < codeEntries.length; i++) {
    for (let j = i + 1; j < codeEntries.length; j++) {
      const a = codeEntries[i], b = codeEntries[j];
      if (a.problemId !== b.problemId || a.language !== b.language) continue;

      const maxTabSwitches = Math.max(a.tabSwitchCount, b.tabSwitchCount);
      if (minTabsFilter > 0 && maxTabSwitches < minTabsFilter) continue;

      const normA = normalizeCode(a.code);
      const normB = normalizeCode(b.code);
      if (normA.length < 20 || normB.length < 20) continue;

      const jaccard = jaccardSimilarity(tokenize(normA), tokenize(normB));
      const levenshtein = levenshteinSimilarity(normA, normB);
      const combined = (jaccard * 0.5 + levenshtein * 0.5);

      if (combined >= similarityThreshold) {
        if (ignoredPairs.has(ignoredPairKey(a.submissionId, b.submissionId, a.problemId))) continue;
        pairs.push({
          test_id: a.testId,
          test_title: a.testTitle,
          student_a: {
            name: a.userName,
            email: a.email,
            roll: a.rollNumber,
            submissionId: a.submissionId,
            tabSwitches: a.tabSwitchCount,
            fullscreenExits: a.fullscreenExitCount,
          },
          student_b: {
            name: b.userName,
            email: b.email,
            roll: b.rollNumber,
            submissionId: b.submissionId,
            tabSwitches: b.tabSwitchCount,
            fullscreenExits: b.fullscreenExitCount,
          },
          max_tab_switches: maxTabSwitches,
          problem_id: a.problemId,
          language: a.language,
          similarity: Math.round(combined * 100),
          jaccard: Math.round(jaccard * 100),
          levenshtein: Math.round(levenshtein * 100),
          code_a: a.code.substring(0, 500),
          code_b: b.code.substring(0, 500),
        });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  const flaggedWithTabSwitches = pairs.filter(p => p.student_a.tabSwitches > 0 || p.student_b.tabSwitches > 0).length;

  res.json({
    total_submissions: submissions.length,
    total_code_entries: codeEntries.length,
    threshold: similarityThreshold,
    min_tab_switches: minTabsFilter,
    flagged_pairs: pairs.length,
    flagged_with_tab_switches: flaggedWithTabSwitches,
    pairs: pairs.slice(0, 200),
  });
}

// POST /api/submissions/plagiarism-check/:testId/bulk-action (admin)
// body: { pairs: [{ submissionIdA, submissionIdB, similarity, problemId, testId? }], action: 'ignore'|'warn'|'disqualify' }
async function plagiarismBulkAction(req, res) {
  const { testId } = req.params;
  const { pairs, action } = req.body;

  if (!['ignore', 'warn', 'disqualify'].includes(action)) {
    return res.status(400).json({ error: 'Action must be ignore, warn, or disqualify' });
  }
  if (!Array.isArray(pairs) || !pairs.length) {
    return res.status(400).json({ error: 'At least one pair is required' });
  }

  const severityFor = (similarity) => (similarity >= 85 ? 'critical' : similarity >= 70 ? 'high' : 'medium');

  let flagsCreated = 0, disqualified = 0, warned = 0;

  for (const pair of pairs) {
    const { submissionIdA, submissionIdB, similarity, problemId, testId: pairTestId } = pair;
    if (!submissionIdA || !submissionIdB) continue;
    const targetTestId = pairTestId || (testId !== 'all' ? testId : null);
    if (!targetTestId) continue;

    for (const [subId, otherId] of [[submissionIdA, submissionIdB], [submissionIdB, submissionIdA]]) {
      await query(
        `INSERT INTO suspicious_flags (test_id, submission_id, flag_type, severity, reasons, metadata, reviewed, reviewed_by, action_taken)
         VALUES ($1, $2, 'plagiarism', $3, $4, $5, TRUE, $6, $7)`,
        [
          targetTestId, subId, severityFor(similarity || 0),
          JSON.stringify([{ type: 'plagiarism_match', detail: `${similarity ?? '?'}% code similarity`, timestamp: new Date().toISOString() }]),
          JSON.stringify({ pairedWithSubmissionId: otherId, similarity, problemId }),
          req.user.id, action,
        ]
      );
      flagsCreated++;
    }

    if (action === 'disqualify') {
      const { rowCount } = await query(
        "UPDATE submissions SET status='disqualified' WHERE id = ANY($1::uuid[]) AND status != 'disqualified'",
        [[submissionIdA, submissionIdB]]
      );
      disqualified += rowCount;
      const { rows: subs } = await query('SELECT id, user_id, test_id FROM submissions WHERE id = ANY($1::uuid[])', [[submissionIdA, submissionIdB]]);
      for (const sub of subs) {
        try { await deleteActiveSession(sub.user_id, sub.test_id); } catch { /* not an active session, fine */ }
      }
    }

    if (action === 'warn') {
      const { sendNotification } = require('../services/websocket');
      const { rows: subs } = await query('SELECT id, user_id FROM submissions WHERE id = ANY($1::uuid[])', [[submissionIdA, submissionIdB]]);
      for (const sub of subs) {
        const { rows: [notif] } = await query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'plagiarism_warning', 'Code similarity flagged', $2, $3)
           RETURNING id, type, title, body, data, is_read, created_at`,
          [
            sub.user_id,
            `Your submission was flagged for ${similarity ?? '?'}% code similarity with another student's. This has been logged — make sure future submissions are your own original work.`,
            JSON.stringify({ testId: targetTestId, submissionId: sub.id }),
          ]
        );
        warned++;
        try { sendNotification(sub.user_id, notif); } catch { /* student not connected, notification is still saved */ }
      }
    }
  }

  res.json({ pairsProcessed: pairs.length, flagsCreated, disqualified, warned, action });
}

// ── POST /api/submissions/fingerprint ──────────────────────
async function submitFingerprint(req, res) {
  const { submissionId, fingerprint } = req.body;
  if (!submissionId || !fingerprint) {
    return res.status(400).json({ error: 'submissionId and fingerprint required' });
  }

  const { rows: [sub] } = await query('SELECT user_id FROM submissions WHERE id=$1', [submissionId]);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (sub.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  const fpHash = require('crypto').createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');

  await query(
    `UPDATE submissions SET fingerprint_hash=$1, device_fingerprint=$2 WHERE id=$3`,
    [fpHash, JSON.stringify(fingerprint), submissionId]
  );

  res.json({ hash: fpHash, stored: true });
}

// ── POST /api/submissions/fingerprint/verify ──────────────
async function verifyFingerprint(req, res) {
  const { submissionId, fingerprint, previousFingerprint } = req.body;
  if (!submissionId || !fingerprint) {
    return res.status(400).json({ error: 'submissionId and fingerprint required' });
  }

  const { rows } = await query('SELECT user_id, fingerprint_hash, device_fingerprint FROM submissions WHERE id=$1', [submissionId]);
  if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  const stored = rows[0];
  const fpHash = require('crypto').createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  const match = fpHash === stored.fingerprint_hash;

  if (!match && stored.fingerprint_hash) {
    await query(
      `INSERT INTO suspicious_flags (test_id, submission_id, suspicion_score, reasons)
       VALUES ($1, $2, 50, $3)`,
      [
        req.body.testId || 'unknown',
        submissionId,
        JSON.stringify([{ type: 'fingerprint_mismatch', detail: 'Device fingerprint changed during test', timestamp: new Date().toISOString() }])
      ]
    );
  }

  res.json({ valid: match, hash: fpHash });
}

// ── POST /api/submissions/fullscreen-violation ──────────
async function logFullscreenViolation(req, res) {
  const { submissionId, exitCount } = req.body;
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

  const { rows: [sub] } = await query('SELECT user_id, fullscreen_exit_count FROM submissions WHERE id=$1', [submissionId]);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (sub.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  // Never let a reported count go DOWN from what's already on record — a
  // client resending a lower number (accidentally or otherwise) shouldn't
  // erase real violations already logged this session.
  const newCount = Math.max(sub.fullscreen_exit_count || 0, exitCount || 0);

  await query(
    `UPDATE submissions SET fullscreen_exit_count=$1 WHERE id=$2`,
    [newCount, submissionId]
  );

  if (newCount >= 3) {
    await query(
      `INSERT INTO suspicious_flags (test_id, submission_id, suspicion_score, reasons)
       VALUES ($1, $2, 80, $3)`,
      [
        req.body.testId || 'unknown',
        submissionId,
        JSON.stringify([{ type: 'fullscreen_violation', detail: `Fullscreen exited ${newCount} times`, timestamp: new Date().toISOString() }])
      ]
    );
  }

  res.json({ logged: true, exitCount: newCount });
}

// ── GET /api/submissions/time-bomb-status ────────────────
async function getTimeBombStatus(req, res) {
  const { testId } = req.query;
  if (!testId) return res.status(400).json({ error: 'testId required' });

  const { rows: sections } = await query(
    'SELECT id FROM sections WHERE test_id=$1 AND type=$2',
    [testId, 'aptitude']
  );

  const bombs = [];
  for (const section of sections) {
    const { rows: questions } = await query(
      "SELECT id, time_bomb FROM questions WHERE section_id=$1 AND time_bomb->>'enabled' = 'true'",
      [section.id]
    );
    for (const q of questions) {
      const tb = q.time_bomb || {};
      bombs.push({
        questionId: q.id,
        enabled: tb.enabled || false,
        durationSeconds: tb.duration_seconds || 0,
      });
    }
  }

  const { rows: [sub] } = await query(
    'SELECT started_at FROM submissions WHERE test_id=$1 AND user_id=$2 AND status=$3 ORDER BY started_at DESC LIMIT 1',
    [testId, req.user.id, 'in_progress']
  );

  const startedAt = sub ? new Date(sub.started_at).getTime() : Date.now();
  const now = Date.now();
  const elapsed = Math.floor((now - startedAt) / 1000);

  const bombStatus = bombs.map(b => ({
    ...b,
    expiresInSeconds: Math.max(0, b.durationSeconds - elapsed),
    expired: elapsed >= b.durationSeconds,
  }));

  res.json({ bombs: bombStatus, elapsedSeconds: elapsed });
}

module.exports = { startTest, saveAnswers, submitTest, getMySubmissions, getTestSubmissions, getSubmission, runCode, getRunCodeResult, deleteSubmission, resumeTest, forceStopTest, updateMarks, adjustAllMarks, bulkMarksCsv, bulkMarksJson, exportResultsPdf, exportResultsCsv, getQuestionAnalytics, checkPlagiarism, plagiarismBulkAction, submitFingerprint, verifyFingerprint, logFullscreenViolation, getTimeBombStatus, publishResults, unpublishResults, gradeAnswers };
