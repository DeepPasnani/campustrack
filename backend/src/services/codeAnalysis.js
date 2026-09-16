const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function countLines(code) {
  const lines = code.split('\n');
  const totalLines = lines.length;
  const blankLines = lines.filter(l => l.trim() === '').length;
  const commentLines = countComments(code);
  const codeLines = totalLines - blankLines - commentLines;
  return { totalLines, blankLines, commentLines, codeLines };
}

function countComments(code) {
  let count = 0;
  const lines = code.split('\n');

  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (inBlock) {
      count++;
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      count++;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      count++;
      if (!trimmed.includes('*/')) {
        inBlock = true;
      }
      continue;
    }

    if (trimmed.startsWith('--') && !trimmed.startsWith('-- ')) {
      continue;
    }

    if (trimmed.startsWith('/*') && trimmed.includes('*/')) {
      if (trimmed.replace(/\/\*[\s\S]*?\*\//g, '').trim() === '') {
        count++;
      }
    }
  }

  return count;
}

function extractFunctions(code, language) {
  const patterns = {
    javascript: /(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|async\s+function\s+\w+|\w+\s*\([^)]*\)\s*{)/g,
    python: /(?:def\s+\w+|class\s+\w+)/g,
    java: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?\w+\s+\w+\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*{/g,
    cpp: /(?:public|private|protected)?\s*\w+\s+\w+\s*\([^)]*\)\s*(?:const)?\s*{/g,
    c: /\w+\s+\w+\s*\([^)]*\)\s*{/g,
  };

  const pattern = patterns[language] || patterns.javascript;
  const matches = code.match(pattern) || [];
  return matches.length;
}

function extractClasses(code, language) {
  const patterns = {
    javascript: /(?:class\s+\w+)/g,
    python: /(?:class\s+\w+)/g,
    java: /(?:class\s+\w+)/g,
    cpp: /(?:class\s+\w+)/g,
  };

  const pattern = patterns[language] || patterns.javascript;
  const matches = code.match(pattern) || [];
  return matches.length;
}

function calculateCyclomaticComplexity(code, language) {
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\b/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\b\?\s*/g,
    /\b&&\s*/g,
    /\b\|\|\s*/g,
    /\bdefault\s*:/g,
  ];

  let complexity = 1;
  for (const pattern of decisionPatterns) {
    const matches = code.match(pattern);
    if (matches) complexity += matches.length;
  }

  return complexity;
}

function maxNestingDepth(code) {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of code) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

function calculateMaintainabilityIndex(code, language) {
  const { totalLines, codeLines, commentLines } = countLines(code);
  const cyclomaticComplexity = calculateCyclomaticComplexity(code, language);
  const totalFunctions = extractFunctions(code, language);

  const HAL_VOLUME = totalLines > 0 ? totalLines * Math.log2(totalLines + 1) : 1;

  const MI = Math.max(
    0,
    Math.min(100,
      171 - 5.2 * Math.log(HAL_VOLUME || 1) -
        0.23 * (cyclomaticComplexity || 1) -
        16.2 * Math.log((codeLines || 1))
    )
  );

  return Math.round(MI);
}

function analyzeCode(code, language) {
  if (!code || !code.trim()) {
    return {
      linesOfCode: 0,
      commentRatio: 0,
      cyclomaticComplexity: 0,
      numFunctions: 0,
      numClasses: 0,
      maxNestingDepth: 0,
      maintainabilityIndex: 100,
      readabilityScore: 0,
    };
  }

  const { totalLines, blankLines, commentLines, codeLines } = countLines(code);
  const numFunctions = extractFunctions(code, language);
  const numClasses = extractClasses(code, language);
  const cyclomaticComplexity = calculateCyclomaticComplexity(code, language);
  const nestingDepth = maxNestingDepth(code);
  const maintainabilityIndex = calculateMaintainabilityIndex(code, language);
  const commentRatio = totalLines > 0 ? commentLines / totalLines : 0;

  const locScore = Math.min(100, (codeLines / 500) * 100);
  const commentScore = Math.min(100, (commentRatio / 0.3) * 100);
  const complexityScore = Math.max(0, 100 - Math.max(0, cyclomaticComplexity - 5) * 5);
  const nestingScore = Math.max(0, 100 - Math.max(0, nestingDepth - 3) * 15);

  const readabilityScore = Math.round(
    locScore * 0.15 +
    commentScore * 0.15 +
    maintainabilityIndex * 0.35 +
    complexityScore * 0.2 +
    nestingScore * 0.15
  );

  return {
    linesOfCode: codeLines,
    totalLines,
    commentLines,
    blankLines,
    commentRatio: Math.round(commentRatio * 100),
    cyclomaticComplexity,
    numFunctions,
    numClasses,
    maxNestingDepth: nestingDepth,
    maintainabilityIndex: Math.round(maintainabilityIndex),
    readabilityScore: Math.min(100, Math.max(0, readabilityScore)),
  };
}

module.exports = { analyzeCode, countLines, calculateCyclomaticComplexity, maxNestingDepth };
