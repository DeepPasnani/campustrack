const { query } = require('../db');
const { analyzeCode } = require('../services/codeAnalysis');
const { runCode: runnerRunCode } = require('../services/runner');
const { outputsMatch } = require('../services/piston');
const logger = require('../services/logger');

// POST /api/code/lint
async function lintCode(req, res) {
  const { code, language } = req.body;
  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  const warnings = [];

  try {
    const analysis = analyzeCode(code, language);
    if (analysis.cyclomaticComplexity > 10) {
      warnings.push({
        line: 1,
        column: 1,
        message: `Function has high cyclomatic complexity (${analysis.cyclomaticComplexity}). Consider refactoring.`,
        severity: 'warning',
      });
    }
    if (analysis.maxNestingDepth > 4) {
      warnings.push({
        line: 1,
        column: 1,
        message: `Deep nesting detected (${analysis.maxNestingDepth} levels). Consider simplifying.`,
        severity: 'warning',
      });
    }
    if (analysis.numFunctions > 15) {
      warnings.push({
        line: 1,
        column: 1,
        message: `File has ${analysis.numFunctions} functions. Consider splitting into modules.`,
        severity: 'info',
      });
    }
    if (analysis.linesOfCode > 400) {
      warnings.push({
        line: 1,
        column: 1,
        message: `File is ${analysis.linesOfCode} lines long. Consider breaking it up.`,
        severity: 'info',
      });
    }
  } catch (e) {
    warnings.push({ line: 1, column: 1, message: `Analysis error: ${e.message}`, severity: 'error' });
  }

  res.json({ warnings, language });
}

// POST /api/code/format
async function formatCode(req, res) {
  const { code, language } = req.body;
  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  let formattedCode = code;

  try {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const crypto = require('crypto');

    const extMap = {
      javascript: '.js',
      python: '.py',
      java: '.java',
      cpp: '.cpp',
      c: '.c',
    };

    const ext = extMap[language];
    if (!ext) return res.json({ formatted: code, language });

    const id = crypto.randomUUID();
    const dir = path.join(os.tmpdir(), 'fmt-' + id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `source${ext}`);
    fs.writeFileSync(filePath, code);

    const formatterMap = {
      javascript: `npx prettier --write "${filePath}" --parser babel 2>/dev/null && cat "${filePath}"`,
      cpp: `clang-format "${filePath}" 2>/dev/null || cat "${filePath}"`,
      c: `clang-format "${filePath}" 2>/dev/null || cat "${filePath}"`,
      python: `python3 -m black --quiet "${filePath}" 2>/dev/null && cat "${filePath}" || python -m black --quiet "${filePath}" 2>/dev/null && cat "${filePath}"`,
      java: `clang-format "${filePath}" 2>/dev/null || cat "${filePath}"`,
    };

    const cmd = formatterMap[language];
    if (cmd) {
      try {
        formattedCode = require('child_process').execSync(cmd, {
          timeout: 10000,
          cwd: dir,
        }).toString().trim();
        if (!formattedCode) formattedCode = code;
      } catch {
        formattedCode = code;
      }
    }

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  } catch {
    formattedCode = code;
  }

  res.json({ formatted: formattedCode, language });
}

// POST /api/submissions/code-snapshot
async function saveCodeSnapshot(req, res) {
  const { submissionId, problemId, code, language, snapshotType, filePath } = req.body;
  const userId = req.user.id;

  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  if (submissionId) {
    const { rows: [sub] } = await query('SELECT user_id FROM submissions WHERE id=$1', [submissionId]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    // Without this, any student could attach a fabricated snapshot to
    // someone else's submission_id and have it show up in *their* code
    // playback — the same history admins may review for plagiarism.
    if (sub.user_id !== userId) return res.status(403).json({ error: 'Access denied' });
  }

  const { rows } = await query(
    `INSERT INTO code_snapshots (submission_id, problem_id, user_id, code, language, snapshot_type, file_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [submissionId || null, problemId || null, userId, code, language, snapshotType || 'auto', filePath || 'main']
  );

  res.json({ snapshot: rows[0] });
}

// GET /api/submissions/:id/playback
async function getPlayback(req, res) {
  const { id } = req.params;
  const userId = req.user.id;

  const { rows: snapshots } = await query(
    `SELECT id, code, language, snapshot_type, file_path, created_at
     FROM code_snapshots
     WHERE submission_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  const { rows: [sub] } = await query(
    'SELECT user_id FROM submissions WHERE id = $1', [id]
  );

  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && sub.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const stats = {
    totalSnapshots: snapshots.length,
    pasteCount: snapshots.filter(s => s.snapshot_type === 'paste').length,
    keystrokeCount: snapshots.filter(s => s.snapshot_type === 'keystroke').length,
    manualSaveCount: snapshots.filter(s => s.snapshot_type === 'manual').length,
    timeSpentMs: snapshots.length > 1
      ? new Date(snapshots[snapshots.length - 1].created_at).getTime() - new Date(snapshots[0].created_at).getTime()
      : 0,
    linesAdded: 0,
    linesRemoved: 0,
  };

  if (snapshots.length > 1) {
    for (let i = 1; i < snapshots.length; i++) {
      const prevLines = snapshots[i - 1].code.split('\n').length;
      const currLines = snapshots[i].code.split('\n').length;
      if (currLines > prevLines) stats.linesAdded += currLines - prevLines;
      else stats.linesRemoved += prevLines - currLines;
    }
  }

  res.json({ snapshots, stats, submissionId: id });
}

// POST /api/submissions/:id/quality-report
async function getQualityReport(req, res) {
  const { id } = req.params;
  const userId = req.user.id;

  const { rows: [sub] } = await query(
    'SELECT * FROM submissions WHERE id = $1', [id]
  );
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && sub.user_id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { rows: existing } = await query(
    'SELECT * FROM code_quality_reports WHERE submission_id = $1', [id]
  );

  if (existing.length > 0) {
    return res.json({ report: existing[0] });
  }

  const codeSolutions = sub.code_solutions || {};
  const reports = [];

  for (const probId of Object.keys(codeSolutions)) {
    const sol = codeSolutions[probId];
    if (!sol) continue;
    const lang = Object.keys(sol).find(l => sol[l]?.trim());
    if (!lang || !sol[lang]?.trim()) continue;

    const analysis = analyzeCode(sol[lang], lang);

    const { rows: [report] } = await query(
      `INSERT INTO code_quality_reports
       (submission_id, problem_id, user_id, language, lines_of_code, total_lines, comment_lines, blank_lines,
        comment_ratio, cyclomatic_complexity, num_functions, num_classes, max_nesting_depth,
        maintainability_index, readability_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [id, probId, sub.user_id, lang,
       analysis.linesOfCode, analysis.totalLines, analysis.commentLines, analysis.blankLines,
       analysis.commentRatio, analysis.cyclomaticComplexity, analysis.numFunctions, analysis.numClasses,
       analysis.maxNestingDepth, analysis.maintainabilityIndex, analysis.readabilityScore]
    );
    reports.push(report);
  }

  res.json({ reports });
}

// POST /api/submissions/run-custom-test
async function runCustomTest(req, res) {
  const { code, language, stdin, expectedOutput, timeLimit, memoryLimit, tolerance } = req.body;
  if (!code || !language) return res.status(400).json({ error: 'Code and language required' });

  const result = await runnerRunCode({
    code, language, stdin: stdin || '', timeLimit: timeLimit || 5, memoryLimit: memoryLimit || 256,
  });

  let matchesExpected = null;
  if (expectedOutput !== undefined && expectedOutput !== null) {
    const actualOutput = result.stdout || '';
    matchesExpected = outputsMatch(actualOutput, expectedOutput, tolerance);
  }

  res.json({
    ...result,
    matchesExpected,
  });
}

// POST /api/submissions/save-custom-test
async function saveCustomTest(req, res) {
  const { problemId, input, expectedOutput, name } = req.body;
  if (!problemId || input === undefined) return res.status(400).json({ error: 'Problem ID and input required' });

  const { rows } = await query(
    `INSERT INTO saved_custom_tests (user_id, problem_id, input, expected_output, name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, problemId, input, expectedOutput || null, name || null]
  );

  res.json({ customTest: rows[0] });
}

// GET /api/saved-custom-tests/:problemId
async function getSavedCustomTests(req, res) {
  const { problemId } = req.params;

  const { rows } = await query(
    'SELECT id, input, expected_output, name, created_at FROM saved_custom_tests WHERE user_id = $1 AND problem_id = $2 ORDER BY created_at DESC',
    [req.user.id, problemId]
  );

  res.json({ customTests: rows });
}

// DELETE /api/saved-custom-tests/:id
async function deleteSavedCustomTest(req, res) {
  const { id } = req.params;

  await query('DELETE FROM saved_custom_tests WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  res.json({ deleted: true });
}

// GET /api/coding-problems/:id/workspace
async function getWorkspace(req, res) {
  const { id } = req.params;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  const { rows } = await query(
    `SELECT id, title, description, input_format, output_format, constraints, sample_input, sample_output, starter_code, file_structure,
     ${isAdmin ? 'test_cases' : "(SELECT jsonb_agg(tc) FROM jsonb_array_elements(test_cases) tc WHERE NOT (tc->>'isHidden')::boolean) as test_cases"},
     time_limit_seconds, memory_limit_mb FROM coding_problems WHERE id = $1`,
    [id]
  );

  if (!rows.length) return res.status(404).json({ error: 'Problem not found' });

  const problem = rows[0];
  const fileStructure = problem.file_structure || [];

  if (!fileStructure.length) {
    const langs = Object.keys(problem.starter_code || {});
    for (const lang of langs) {
      fileStructure.push({
        filename: `solution.${lang === 'javascript' ? 'js' : lang === 'cpp' ? 'cpp' : lang}`,
        language: lang,
        content: problem.starter_code[lang] || '',
        isEntryPoint: true,
      });
    }
  }

  res.json({ problem, fileStructure });
}

// POST /api/submissions/save-workspace
async function saveWorkspace(req, res) {
  const { problemId, files } = req.body;
  if (!problemId || !files) return res.status(400).json({ error: 'Problem ID and files required' });

  const { rows } = await query(
    'UPDATE coding_problems SET file_structure = $1 WHERE id = $2 RETURNING id',
    [JSON.stringify(files), problemId]
  );

  res.json({ saved: true, problemId });
}

module.exports = {
  lintCode, formatCode, saveCodeSnapshot, getPlayback,
  getQualityReport, runCustomTest, saveCustomTest, getSavedCustomTests,
  deleteSavedCustomTest, getWorkspace, saveWorkspace,
};
