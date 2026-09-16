const { query } = require('../db');

// ── POST /api/test-messages ────────────────────────────────
async function sendMessage(req, res) {
  const { testId, submissionId, message } = req.body;

  if (!testId || !message) {
    return res.status(400).json({ error: 'Test ID and message are required' });
  }

  const { rows } = await query(
    `INSERT INTO test_messages (test_id, submission_id, user_id, message, is_from_student)
     VALUES ($1, $2, $3, $4, true) RETURNING *`,
    [testId, submissionId || null, req.user.id, message]
  );

  res.status(201).json({ message: rows[0] });
}

// ── GET /api/test-messages/:testId (admin) ──────────────────
async function getTestMessages(req, res) {
  const { testId } = req.params;

  const { rows } = await query(
    `SELECT tm.*, u.name AS user_name, u.email AS user_email
     FROM test_messages tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.test_id = $1
     ORDER BY tm.created_at ASC`,
    [testId]
  );

  res.json({ messages: rows });
}

// ── GET /api/test-messages/my/:testId ───────────────────────
async function getMyMessages(req, res) {
  const { testId } = req.params;

  const { rows } = await query(
    `SELECT tm.*, u.name AS user_name, u.email AS user_email
     FROM test_messages tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.test_id = $1 AND tm.user_id = $2
     ORDER BY tm.created_at ASC`,
    [testId, req.user.id]
  );

  res.json({ messages: rows });
}

// ── PUT /api/test-messages/:id/resolve (admin) ──────────────
async function resolveMessage(req, res) {
  const { id } = req.params;

  const { rowCount } = await query(
    'UPDATE test_messages SET resolved = true WHERE id = $1',
    [id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Message not found' });
  }

  res.json({ success: true });
}

module.exports = {
  sendMessage,
  getTestMessages,
  getMyMessages,
  resolveMessage,
};
