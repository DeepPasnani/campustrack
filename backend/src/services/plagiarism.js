const { query } = require('../db');

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

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (levenshteinDistance(a, b) / maxLen);
}

function findCommonPassages(codeA, codeB) {
  const linesA = codeA.split('\n');
  const linesB = codeB.split('\n');
  const matches = [];

  for (let i = 0; i < linesA.length; i++) {
    const lineA = linesA[i].trim();
    if (!lineA || lineA.length < 10) continue;
    for (let j = 0; j < linesB.length; j++) {
      const lineB = linesB[j].trim();
      if (lineA === lineB && lineA.length > 10) {
        matches.push({ lineA: i, lineB: j, text: lineA });
      }
    }
  }
  return matches;
}

function asteriskStructure(code, language) {
  const normalized = code
    .replace(/\/\/.*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'.*?'/g, '')
    .replace(/".*?"/g, '')
    .replace(/\b\w+\b/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

async function checkPlagiarismEnhanced(testId, threshold = 0.7) {
  const similarityThreshold = parseFloat(threshold);

  const { rows: submissions } = await query(`
    SELECT s.id, s.user_id, s.code_solutions, s.selected_problems,
           u.name as user_name, u.email, u.roll_number
    FROM submissions s JOIN users u ON s.user_id = u.id
    WHERE s.test_id=$1 AND s.status='submitted'
  `, [testId]);

  const codeEntries = [];
  for (const sub of submissions) {
    const solutions = sub.code_solutions || {};
    for (const probId of Object.keys(solutions)) {
      const sol = solutions[probId];
      if (!sol) continue;
      const lang = Object.keys(sol).find(l => sol[l]?.trim());
      if (!lang || !sol[lang]?.trim()) continue;
      codeEntries.push({
        submissionId: sub.id, userId: sub.user_id,
        userName: sub.user_name, email: sub.email,
        rollNumber: sub.roll_number, problemId: probId,
        language: lang, code: sol[lang],
      });
    }
  }

  const pairs = [];
  for (let i = 0; i < codeEntries.length; i++) {
    for (let j = i + 1; j < codeEntries.length; j++) {
      const a = codeEntries[i], b = codeEntries[j];
      if (a.problemId !== b.problemId || a.language !== b.language) continue;

      const normA = normalizeCode(a.code);
      const normB = normalizeCode(b.code);
      if (normA.length < 20 || normB.length < 20) continue;

      const tokensA = tokenize(normA);
      const tokensB = tokenize(normB);

      const jaccard = jaccardSimilarity(tokensA, tokensB);
      const levenshtein = levenshteinSimilarity(normA, normB);

      const structA = asteriskStructure(a.code, a.language);
      const structB = asteriskStructure(b.code, b.language);
      const astSimilarity = levenshteinSimilarity(structA, structB);

      const combined = (jaccard * 0.35 + levenshtein * 0.35 + astSimilarity * 0.3);

      if (combined >= similarityThreshold) {
        const matches = findCommonPassages(a.code, b.code);
        pairs.push({
          student_a: { name: a.userName, email: a.email, roll: a.rollNumber, submissionId: a.submissionId },
          student_b: { name: b.userName, email: b.email, roll: b.rollNumber, submissionId: b.submissionId },
          problem_id: a.problemId, language: a.language,
          similarity: Math.round(combined * 100),
          jaccard: Math.round(jaccard * 100),
          levenshtein: Math.round(levenshtein * 100),
          ast_similarity: Math.round(astSimilarity * 100),
          matched_passages: matches.slice(0, 20),
          code_a: a.code,
          code_b: b.code,
        });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  return {
    total_submissions: submissions.length,
    total_code_entries: codeEntries.length,
    threshold: similarityThreshold,
    flagged_pairs: pairs.length,
    pairs: pairs.slice(0, 200),
  };
}

module.exports = { checkPlagiarismEnhanced, normalizeCode, tokenize, jaccardSimilarity, levenshteinSimilarity, findCommonPassages };
