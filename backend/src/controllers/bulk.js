const { query } = require('../db');

async function bulkDeleteTests(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Test IDs required' });

  const { rowCount } = await query('DELETE FROM tests WHERE id = ANY($1::uuid[])', [ids]);
  res.json({ deleted: rowCount });
}

async function bulkArchiveTests(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Test IDs required' });

  const { rowCount } = await query('UPDATE tests SET status=$1 WHERE id = ANY($2::uuid[])', ['archived', ids]);
  res.json({ archived: rowCount });
}

async function bulkDeleteQuestions(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Question IDs required' });

  const { rowCount } = await query('DELETE FROM bank_questions WHERE id = ANY($1::uuid[])', [ids]);
  res.json({ deleted: rowCount });
}

async function bulkDeleteUsers(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'User IDs required' });

  const { rowCount } = await query('DELETE FROM users WHERE id = ANY($1::uuid[]) AND role=$2', [ids, 'student']);
  res.json({ deleted: rowCount });
}

async function bulkUpdateQuestionMarks(req, res) {
  const { ids, marks } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Question IDs required' });
  if (marks === undefined || marks === null || Number.isNaN(Number(marks)) || Number(marks) < 0) {
    return res.status(400).json({ error: 'A non-negative numeric marks value is required' });
  }

  const { rowCount } = await query(
    'UPDATE bank_questions SET marks=$1 WHERE id = ANY($2::uuid[])',
    [Number(marks), ids]
  );
  res.json({ updated: rowCount });
}

module.exports = { bulkDeleteTests, bulkArchiveTests, bulkDeleteQuestions, bulkDeleteUsers, bulkUpdateQuestionMarks };
