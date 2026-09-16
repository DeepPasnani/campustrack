const axios = require('axios');
const http = require('http');
const crypto = require('crypto');
const logger = require('./logger');

// Maps the app's internal language keys to the Piston runtime that must be
// installed (see infra/piston/README.md + install-packages.sh). These
// versions correspond 1:1 to the packages shipped in infra/piston/packages.
const LANGUAGE_MAP = {
  python:     { language: 'python',  version: '3.10.0' },
  javascript: { language: 'javascript', version: '18.15.0' },
  java:       { language: 'java',    version: '15.0.2' },
  cpp:        { language: 'c++',     version: '10.2.0' },
  c:          { language: 'c',       version: '10.2.0' },
  sql:        { language: 'sqlite3', version: '3.36.0' },
};

// Kept for anything that still imports the old numeric-id shape (nothing in
// this codebase does anymore, but this avoids a hard crash if a stray
// reference slips through) — Piston itself has no notion of numeric ids.
const LANGUAGE_IDS = Object.fromEntries(Object.keys(LANGUAGE_MAP).map((k) => [k, k]));

const TIMEOUT = parseInt(process.env.PISTON_TIMEOUT, 10) || 30000;
const MAX_RETRIES = 2;

// PISTON_API_URL should point at the internal load balancer in front of the
// piston1/piston2/piston3 replicas (see docker-compose.yml + infra/piston),
// e.g. http://piston-lb:2000/api/v2. Falls back to a local single instance
// for bare-metal / dev setups.
const pistonClient = axios.create({
  baseURL: process.env.PISTON_API_URL || 'http://localhost:2000/api/v2',
  headers: { 'Content-Type': 'application/json' },
  timeout: TIMEOUT,
  // Same keep-alive tuning the old codebox client used — matters a lot
  // once you have ~200 students hitting "Run Code" around the same time.
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 200, scheduling: 'fifo' }),
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function outputsMatch(actual, expected, tolerance = 0) {
  if (expected === null || expected === undefined) return true;
  if (actual === null || actual === undefined) return false;

  const tokenize = (str) => String(str)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/[ \t\n\r]+/)
    .filter((tok) => tok.length > 0);

  const a = tokenize(actual);
  const b = tokenize(expected);

  if (a.length !== b.length) return false;

  const tol = Number(tolerance) || 0;
  for (let i = 0; i < a.length; i++) {
    if (tol > 0) {
      const na = Number(a[i]);
      const nb = Number(b[i]);
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        if (Math.abs(na - nb) > tol) return false;
        continue;
      }
    }
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// SQL has no "stdin" concept in Piston's sqlite3 package — the whole script
// (setup statements + the student's query) is run as a single file, exactly
// like the old codebox/Judge0 integration did.
function buildSubmissionSource(code, language, stdin) {
  if (language === 'sql' && stdin) return `${stdin}\n${code}`;
  return code;
}

function toErrorWithStatus(err) {
  const status = err.response ? err.response.status : 'N/A';
  const detail = err.response?.data?.message || err.message;
  return new Error(`Piston API error (HTTP ${status}): ${detail}`);
}

async function retryRequest(fn) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && !err.response) {
        logger.warn({ attempt: attempt + 1, err: err.message }, 'Piston network error, retrying');
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw toErrorWithStatus(err);
    }
  }
  throw toErrorWithStatus(lastError);
}

// Normalizes a raw Piston /execute response into the same result shape the
// rest of the app (controllers, frontend) already expects from the old
// Judge0-style codebox integration.
//
// NOTE on `time` / `memory`: Piston's v2 REST API does not report CPU time
// or peak memory usage the way Judge0/codebox did. `time` below is the
// wall-clock round-trip time measured around the HTTP call (a reasonable
// proxy, not exact CPU time); `memory` is always null. The frontend already
// renders both defensively.
function normalizeResult(pistonResponse, elapsedSeconds, expected, tolerance) {
  const compile = pistonResponse.compile;
  const run = pistonResponse.run || {};

  const compileFailed = !!compile && compile.code !== 0 && compile.code !== null;
  const runtimeFailed = !compileFailed && run.code !== 0 && run.code !== null;
  const timedOut = !compileFailed && run.signal === 'SIGKILL';

  let status = 'Accepted';
  let statusId = 3; // 3 == success, mirrors the old Judge0-derived convention the app already used
  if (compileFailed) { status = 'Compilation Error'; statusId = 6; }
  else if (timedOut) { status = 'Time Limit Exceeded'; statusId = 5; }
  else if (runtimeFailed) { status = 'Runtime Error'; statusId = 11; }

  const actual = run.stdout || '';
  const expectedStr = expected != null ? String(expected) : null;

  return {
    status,
    statusId,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    compileOutput: compile ? (compile.stderr || compile.output || '') : '',
    time: elapsedSeconds,
    memory: null,
    expected: expectedStr,
    actual,
    passed: statusId === 3 && (expectedStr === null || outputsMatch(actual, expectedStr, tolerance)),
  };
}

async function pistonExecute({ code, language, stdin, timeLimit, memoryLimit }) {
  const lang = LANGUAGE_MAP[language];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  const isSql = language === 'sql';
  const memBytes = Math.min(Math.max(Math.round(memoryLimit * 1024 * 1024), 1024 * 1024), 512 * 1024 * 1024);
  const runTimeoutMs = Math.max(1000, Math.round(timeLimit * 1000));

  const started = Date.now();
  const { data } = await retryRequest(() =>
    pistonClient.post('/execute', {
      language: lang.language,
      version: lang.version,
      files: [{ content: buildSubmissionSource(code, language, stdin) }],
      stdin: isSql ? '' : (stdin || ''),
      run_timeout: runTimeoutMs,
      compile_timeout: Math.max(runTimeoutMs, 10000),
      run_cpu_time: runTimeoutMs,
      compile_cpu_time: Math.max(runTimeoutMs, 10000),
      run_memory_limit: memBytes,
      compile_memory_limit: memBytes,
    })
  );
  const elapsedSeconds = Math.round(((Date.now() - started) / 1000) * 1000) / 1000;
  return { data, elapsedSeconds };
}

async function runCode({ code, language, stdin = '', timeLimit = 5, memoryLimit = 256, expectedOutput = null, tolerance = 0 }) {
  const { data, elapsedSeconds } = await pistonExecute({ code, language, stdin, timeLimit, memoryLimit });
  return normalizeResult(data, elapsedSeconds, expectedOutput, tolerance);
}

// Piston has no concept of an async token/queue — a call to /execute runs
// and returns the finished result directly. To keep the exact same
// submit-then-poll contract the controllers (submissions.js) already use for
// pushing results over the websocket, we run the job immediately and stash
// the finished result under a generated token that pollSubmissionStatus can
// look up.
const completedJobs = new Map();
const JOB_TTL_MS = 5 * 60 * 1000;

function stashJob(token, result) {
  completedJobs.set(token, { result, expiresAt: Date.now() + JOB_TTL_MS });
  // Best-effort cleanup so this map doesn't grow unbounded under load.
  if (completedJobs.size > 5000) {
    const now = Date.now();
    for (const [k, v] of completedJobs) {
      if (v.expiresAt < now) completedJobs.delete(k);
    }
  }
}

async function submitRunCode({ code, language, stdin = '', timeLimit = 5, memoryLimit = 256 }) {
  const token = crypto.randomUUID();
  // Fire the execution but return the token immediately so callers that
  // expect a submit/poll flow keep working; the result is stashed as soon
  // as Piston responds, which pollSubmissionStatus will then find.
  pistonExecute({ code, language, stdin, timeLimit, memoryLimit })
    .then(({ data, elapsedSeconds }) => stashJob(token, normalizeResult(data, elapsedSeconds, null, 0)))
    .catch((err) => stashJob(token, {
      status: 'Error', statusId: 0, stdout: '', stderr: '',
      compileOutput: '', time: null, memory: null, passed: false,
      error: err.message,
    }));
  return token;
}

async function pollSubmissionStatus(token) {
  const entry = completedJobs.get(token);
  if (!entry) return null; // still running (or unknown token) — caller keeps polling
  return entry.result;
}

async function waitForResult(token, pollIntervalMs = 1000, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await pollSubmissionStatus(token).catch(() => null);
    if (result) return result;
    await sleep(pollIntervalMs);
  }
  return {
    status: 'Error', statusId: 0, stdout: '', stderr: '',
    compileOutput: '', time: null, memory: null, passed: false,
    error: 'Execution timed out after ' + (pollIntervalMs * maxAttempts / 1000) + 's',
  };
}

async function judgeSubmission({ code, language, testCases, timeLimit = 5, memoryLimit = 256 }) {
  if (!Array.isArray(testCases) || testCases.length === 0) return [];

  const lang = LANGUAGE_MAP[language];
  if (!lang) {
    return testCases.map((tc) => ({
      status: 'Error', passed: false, error: `Unsupported language: ${language}`,
      input: tc.input, hidden: tc.isHidden || false,
    }));
  }

  // Piston has no batch-submission endpoint like Judge0/codebox did, so test
  // cases are run concurrently against the piston-lb pool instead — this is
  // actually a better fit for horizontal scaling across piston1/2/3 than a
  // single sequential batch call would be.
  const results = await Promise.all(testCases.map(async (tc) => {
    try {
      const { data, elapsedSeconds } = await pistonExecute({
        code, language, stdin: tc.input || '', timeLimit, memoryLimit,
      });
      const normalized = normalizeResult(data, elapsedSeconds, tc.output, tc.tolerance);
      const actualOutput = normalized.actual.trim();
      const expectedOutput = (tc.output || '').trim();
      return {
        ...normalized,
        actual: actualOutput,
        expected: expectedOutput,
        input: tc.input,
        passed: normalized.statusId === 3 && outputsMatch(actualOutput, expectedOutput, tc.tolerance),
        hidden: tc.isHidden || false,
      };
    } catch (err) {
      return {
        status: 'Error', passed: false, error: err.message,
        input: tc.input, hidden: tc.isHidden || false,
      };
    }
  }));

  return results;
}

async function isPistonAvailable() {
  try {
    await pistonClient.get('/runtimes', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  runCode,
  submitRunCode,
  pollSubmissionStatus,
  waitForResult,
  judgeSubmission,
  isPistonAvailable,
  // Back-compat alias — codeOps.js / health checks used this name under the
  // codebox integration.
  isCodeboxAvailable: isPistonAvailable,
  outputsMatch,
  LANGUAGE_MAP,
  LANGUAGE_IDS,
};
