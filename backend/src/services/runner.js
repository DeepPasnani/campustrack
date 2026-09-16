const logger = require('./logger');
const piston = require('./piston');

async function runCode({ code, language, stdin = '', timeLimit = 5, memoryLimit = 256 }) {
  return piston.runCode({ code, language, stdin, timeLimit, memoryLimit });
}

async function submitRunCode({ code, language, stdin = '', timeLimit = 5, memoryLimit = 256 }) {
  return piston.submitRunCode({ code, language, stdin, timeLimit, memoryLimit });
}

async function pollSubmissionStatus(token) {
  return piston.pollSubmissionStatus(token);
}

async function waitForResult(token, pollIntervalMs, maxAttempts) {
  return piston.waitForResult(token, pollIntervalMs, maxAttempts);
}

async function judgeSubmission({ code, language, testCases, timeLimit, memoryLimit }) {
  return piston.judgeSubmission({ code, language, testCases, timeLimit, memoryLimit });
}

module.exports = { runCode, submitRunCode, pollSubmissionStatus, waitForResult, judgeSubmission };
