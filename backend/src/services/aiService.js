const axios = require('axios');
const logger = require('./logger');
const { query } = require('../db');
const { getRedis, cacheGet, cacheSet } = require('../db/redis');

function getLLMConfig() {
  const provider = process.env.LLM_PROVIDER || 'openai';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  const configs = {
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      model,
    },
  };

  return configs[provider] || configs.openai;
}

async function callLLM(systemPrompt, userMessage, temperature = 0.7) {
  const config = getLLMConfig();
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  try {
    const { data } = await axios.post(config.url, {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      response_format: { type: 'json_object' },
    }, { headers: config.headers, timeout: 60000 });
    return JSON.parse(data.choices[0].message.content);
  } catch (err) {
    logger.error({ err: err.response?.data || err.message }, 'LLM API call failed');
    throw new Error('AI service unavailable');
  }
}

async function generateMCQFromTopic(topic, count = 5, difficulty = 'medium', genre = 'general') {
  const systemPrompt = 'You are an expert question generator for placement exams. Return ONLY valid JSON.';
  const userMessage = `Generate ${count} MCQ questions about "${topic}" at ${difficulty} level in genre "${genre}". 
Each question must have: "text" (question), "options" (array of 4 strings), "correctAnswer" (0-3 index), "explanation" (brief).
Return: { "questions": [ { "text": "...", "options": [...], "correctAnswer": N, "explanation": "..." } ] }`;

  const result = await callLLM(systemPrompt, userMessage, 0.8);
  return (result.questions || []).map(q => ({
    type: 'mcq',
    data: { text: q.text, options: q.options, correctAnswer: q.correctAnswer },
    genre,
    difficulty,
    marks: 2,
    tags: [topic, genre, difficulty].filter(Boolean).join(', '),
  }));
}

async function generateMCQFromPDF(pdfBuffer) {
  const text = pdfBuffer.toString('utf-8').replace(/\0/g, '').trim();
  if (!text || text.length < 50) throw new Error('Could not extract enough text from PDF');

  const systemPrompt = 'You are an expert question generator. Return ONLY valid JSON.';
  const userMessage = `Based on the following syllabus/text, generate 10 MCQ questions.
Text: "${text.substring(0, 8000)}"
Each question: "text", "options"[4], "correctAnswer"(0-3), "explanation", "difficulty"("easy"|"medium"|"hard"), "genre".
Return: { "questions": [ { "text": "...", "options": [...], "correctAnswer": N, "explanation": "...", "difficulty": "medium", "genre": "general" } ] }`;

  const result = await callLLM(systemPrompt, userMessage, 0.8);
  return (result.questions || []).map(q => ({
    type: 'mcq',
    data: { text: q.text, options: q.options, correctAnswer: q.correctAnswer },
    genre: q.genre || 'general',
    difficulty: q.difficulty || 'medium',
    marks: 2,
    tags: 'pdf-generated',
  }));
}

async function getCodingHint(problemId, studentCode, hintLevel) {
  const { rows } = await query('SELECT title, description, constraints, sample_input, sample_output FROM coding_problems WHERE id=$1', [problemId]);
  if (!rows.length) throw new Error('Problem not found');
  const problem = rows[0];

  const levels = {
    1: 'Give a very subtle nudge — hint at what to think about without revealing any approach.',
    2: 'Suggest the general approach/algorithm to use.',
    3: 'Provide pseudo-code or step-by-step logic to solve the problem.',
  };

  const systemPrompt = 'You are a helpful coding tutor. Give progressive hints. Return ONLY JSON.';
  const userMessage = `Problem: "${problem.title}"
Description: "${problem.description}"
Constraints: "${problem.constraints || 'None'}"
Sample Input: "${problem.sample_input || ''}"
Sample Output: "${problem.sample_output || ''}"
Student's current code: "${(studentCode || '').substring(0, 2000)}"

Hint Level ${hintLevel}: ${levels[hintLevel] || levels[1]}
Return: { "hint": "your hint text here", "code_snippet": "optional code snippet" }`;

  const result = await callLLM(systemPrompt, userMessage, 0.5);
  return { hint: result.hint || '', codeSnippet: result.code_snippet || '', level: hintLevel };
}

async function autoTagQuestion(questionText, options) {
  const systemPrompt = 'You are an expert at classifying exam questions. Return ONLY valid JSON.';
  const userMessage = `Classify this MCQ question:
Text: "${questionText}"
Options: ${JSON.stringify(options || [])}

Return: { "topic": "single topic word", "difficulty": "easy|medium|hard", "bloom_level": "remember|understand|apply|analyze|evaluate|create", "genre": "general|quantitative|technical|verbal|logical|data_interpretation|aptitude", "tags": ["tag1", "tag2"] }`;

  return await callLLM(systemPrompt, userMessage, 0.3);
}

async function generatePerformanceFeedback(userId, testId) {
  const { rows: [sub] } = await query(`
    SELECT s.*, t.title as test_title, t.settings
    FROM submissions s JOIN tests t ON s.test_id = t.id
    WHERE s.user_id=$1 AND s.test_id=$2`, [userId, testId]);

  if (!sub) throw new Error('Submission not found');

  const { rows: questions } = await query(`
    SELECT q.genre, q.difficulty, q.text, q.correct_answer, q.explanation,
           sub.answers->>q.id::text as user_answer
    FROM submissions sub
    JOIN sections sec ON sec.test_id = sub.test_id
    JOIN questions q ON q.section_id = sec.id
    WHERE sub.id=$1`, [sub.id]);

  const correct = questions.filter(q => String(q.user_answer) === String(q.correct_answer)).length;
  const total = questions.length;
  const genreBreakdown = {};
  for (const q of questions) {
    if (!genreBreakdown[q.genre]) genreBreakdown[q.genre] = { correct: 0, total: 0 };
    genreBreakdown[q.genre].total++;
    if (String(q.user_answer) === String(q.correct_answer)) genreBreakdown[q.genre].correct++;
  }

  const systemPrompt = 'You are a placement coach providing feedback. Return ONLY valid JSON.';
  const userMessage = `Student scored ${correct}/${total} (${total > 0 ? Math.round(correct/total*100) : 0}%) on "${sub.test_title}".
Genre breakdown: ${JSON.stringify(genreBreakdown)}

Return: {
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "recommended_topics": ["topic1", "topic2"],
  "suggested_resources": ["resource1", "resource2"],
  "overall_assessment": "2-3 sentence summary"
}`;

  return await callLLM(systemPrompt, userMessage, 0.5);
}

async function adaptiveNextDifficulty(userId, testId) {
  const r = await getRedis();
  const key = `adaptive:${userId}:${testId}`;
  let session = await cacheGet(key);
  if (!session) session = { streak: 0, currentDifficulty: 'medium', history: [] };

  const { rows: recent } = await query(`
    SELECT score, max_score FROM submissions
    WHERE user_id=$1 AND test_id=$2 AND status='submitted'
    ORDER BY submitted_at DESC LIMIT 5`, [userId, testId]);

  for (const sub of recent) {
    const pct = sub.max_score > 0 ? sub.score / sub.max_score : 0;
    session.history.push(pct);
    if (pct >= 0.8) session.streak++;
    else if (pct < 0.4) session.streak = Math.max(0, session.streak - 1);
    else session.streak = 0;
  }

  const diffMap = { easy: 0, medium: 1, hard: 2 };
  const revMap = ['easy', 'medium', 'hard'];
  let currentIdx = diffMap[session.currentDifficulty] || 1;

  if (session.streak >= 3) currentIdx = Math.min(2, currentIdx + 1);
  else if (session.streak <= -2) currentIdx = Math.max(0, currentIdx - 1);

  session.currentDifficulty = revMap[currentIdx];
  session.streak = session.streak > 0 ? Math.min(session.streak, 5) : Math.max(session.streak, -5);
  if (session.history.length > 20) session.history = session.history.slice(-20);

  await r.set(key, JSON.stringify(session), { EX: 86400 });

  return {
    recommendedDifficulty: session.currentDifficulty,
    streak: session.streak,
    recentPerformance: session.history.slice(-5),
  };
}

async function naturalLanguageQuery(queryText, userId) {
  const systemPrompt = `You are a database analyst for a placement testing platform. The database has these tables:
users(id, name, email, role, branch, class_name, year_of_study, is_active, created_at)
submissions(id, test_id, user_id, status, score, max_score, submitted_at, time_taken_seconds, tab_switch_count)
tests(id, title, department, status, duration_minutes)
sections(id, test_id, name, type, order_index)
questions(id, section_id, genre, difficulty, text, correct_answer, marks)
coding_problems(id, section_id, title, difficulty, marks)
classes(id, name, department, year_of_study)
student_classes(user_id, class_id)

Generate a safe PostgreSQL query (SELECT only, no INSERT/UPDATE/DELETE) to answer the question.
Return ONLY valid JSON: { "query": "SQL query here", "explanation": "what this query does in simple terms" }`;

  const userMessage = `Question: "${queryText}"
Return JSON with "query" (SQL) and "explanation".`;

  const result = await callLLM(systemPrompt, userMessage, 0.2);
  const sql = result.query;

  const forbidden = /(\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bALTER\b|\bCREATE\b|\bEXECUTE\b|\bEXEC\b)/i;
  if (forbidden.test(sql)) throw new Error('Only SELECT queries are allowed');

  const { rows } = await query(sql);
  return { query: sql, explanation: result.explanation, results: rows };
}

async function analyzeCheating(testId) {
  const { rows: submissions } = await query(`
    SELECT s.id, s.user_id, s.answers, s.submitted_at, s.time_taken_seconds, s.tab_switch_count,
           u.name as user_name, u.email, u.roll_number
    FROM submissions s JOIN users u ON s.user_id = u.id
    WHERE s.test_id=$1 AND s.status='submitted'`, [testId]);

  const { rows: keystrokes } = await query(
    'SELECT submission_id, event_type, COUNT(*) as count FROM keystroke_logs WHERE test_id=$1 GROUP BY submission_id, event_type',
    [testId]
  );

  const pasteCounts = {};
  for (const k of keystrokes) {
    if (k.event_type === 'paste') {
      pasteCounts[k.submission_id] = parseInt(k.count);
    }
  }

  const flags = [];
  const answerSet = {};

  for (const sub of submissions) {
    const answers = sub.answers || {};
    for (const [qId, ans] of Object.entries(answers)) {
      if (!answerSet[qId]) answerSet[qId] = {};
      const key = String(ans).toLowerCase().trim();
      if (!answerSet[qId][key]) answerSet[qId][key] = [];
      answerSet[qId][key].push(sub.user_id);
    }
  }

  for (let i = 0; i < submissions.length; i++) {
    const a = submissions[i];
    const reasons = [];
    let simScore = 0;

    if (pasteCounts[a.id] > 5) {
      reasons.push(`High paste events: ${pasteCounts[a.id]}`);
      simScore += 20;
    }

    if (a.tab_switch_count >= 5) {
      reasons.push(`Excessive tab switches: ${a.tab_switch_count}`);
      simScore += 15;
    }

    const timeTaken = a.time_taken_seconds || 0;
    if (timeTaken < 60) {
      reasons.push(`Suspiciously fast submission: ${timeTaken}s`);
      simScore += 25;
    }

    const ansA = a.answers || {};
    for (let j = i + 1; j < submissions.length; j++) {
      const b = submissions[j];
      const ansB = b.answers || {};
      let matchCount = 0, totalCount = 0;

      for (const qId of Object.keys(ansA)) {
        if (ansB[qId] !== undefined) {
          totalCount++;
          if (String(ansA[qId]).toLowerCase().trim() === String(ansB[qId]).toLowerCase().trim()) {
            matchCount++;
          }
        }
      }

      if (totalCount >= 5) {
        const jaccard = matchCount / totalCount;
        if (jaccard > 0.8) {
          reasons.push(`High answer similarity (${Math.round(jaccard * 100)}%) with ${b.user_name}`);
          simScore += jaccard * 30;
        }
      }
    }

    if (reasons.length > 0) {
      flags.push({
        submission_id: a.id,
        user_name: a.user_name,
        email: a.email,
        roll_number: a.roll_number,
        suspicion_score: Math.min(100, Math.round(simScore)),
        reasons,
        tab_switch_count: a.tab_switch_count,
        paste_count: pasteCounts[a.id] || 0,
        time_taken_seconds: timeTaken,
      });
    }
  }

  const { rows: existing } = await query('SELECT id FROM suspicious_flags WHERE test_id=$1', [testId]);
  if (existing.length) {
    await query('DELETE FROM suspicious_flags WHERE test_id=$1', [testId]);
  }

  for (const f of flags) {
    await query(
      `INSERT INTO suspicious_flags (test_id, submission_id, user_name, email, roll_number, suspicion_score, reasons, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [testId, f.submission_id, f.user_name, f.email, f.roll_number, f.suspicion_score,
       JSON.stringify(f.reasons), JSON.stringify({ tab_switch_count: f.tab_switch_count, paste_count: f.paste_count, time_taken_seconds: f.time_taken_seconds })]
    );
  }

  return flags.sort((a, b) => b.suspicion_score - a.suspicion_score);
}

module.exports = {
  generateMCQFromTopic,
  generateMCQFromPDF,
  getCodingHint,
  autoTagQuestion,
  generatePerformanceFeedback,
  adaptiveNextDifficulty,
  naturalLanguageQuery,
  analyzeCheating,
};
