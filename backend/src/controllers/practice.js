const { query } = require('../db');

const GENRES = ['general', 'quantitative', 'logical', 'verbal', 'technical'];

async function startPractice(req, res) {
  const { genre, difficulty } = req.body;
  if (!genre || !GENRES.includes(genre)) return res.status(400).json({ error: 'Valid genre required' });

  const diffClause = difficulty ? 'AND difficulty=$2' : '';
  const diffParams = difficulty ? [genre, difficulty] : [genre];
  const { rows: questions } = await query(
    `SELECT id, text, options, correct_answer, explanation, marks, difficulty, genre
     FROM questions WHERE genre=$1 AND type='mcq' ${diffClause} ORDER BY RANDOM() LIMIT 10`,
    diffParams
  );

  const sanitized = questions.map(q => ({
    id: q.id, text: q.text, options: q.options,
    marks: q.marks, difficulty: q.difficulty, genre: q.genre,
  }));

  res.json({ questions: sanitized, count: sanitized.length });
}

async function submitPracticeAnswer(req, res) {
  const { questionId, answer } = req.body;
  if (!questionId) return res.status(400).json({ error: 'questionId required' });

  const { rows: [question] } = await query(
    'SELECT id, correct_answer, explanation, marks FROM questions WHERE id=$1', [questionId]
  );
  if (!question) return res.status(404).json({ error: 'Question not found' });

  const correct = String(answer) === String(question.correct_answer);
  res.json({
    correct,
    correctAnswer: question.correct_answer,
    explanation: question.explanation,
    marks: question.marks,
  });
}

async function endPractice(req, res) {
  const { genre, questionCount, correctCount, durationSeconds } = req.body;
  if (!genre) return res.status(400).json({ error: 'genre required' });

  const { rows: [session] } = await query(
    `INSERT INTO practice_sessions (user_id, genre, question_count, correct_count, duration_seconds)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, genre, questionCount || 0, correctCount || 0, durationSeconds || 0]
  );
  res.json({ session });
}

async function getPracticeHistory(req, res) {
  const { rows: sessions } = await query(
    'SELECT * FROM practice_sessions WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json({ sessions });
}

module.exports = { startPractice, submitPracticeAnswer, endPractice, getPracticeHistory };