const { query } = require('../db');

// ── GET /api/forum/problems/:problemId/threads ──────────────
async function listThreads(req, res) {
  const { problemId } = req.params;

  const { rows } = await query(
    `SELECT ft.*, u.name AS user_name, u.avatar_url AS user_avatar,
            (SELECT COUNT(*)::int FROM forum_replies WHERE thread_id = ft.id) AS reply_count,
            (SELECT MAX(created_at) FROM forum_replies WHERE thread_id = ft.id) AS latest_activity
     FROM forum_threads ft
     JOIN users u ON u.id = ft.user_id
     WHERE ft.problem_id = $1
     ORDER BY latest_activity DESC NULLS LAST, ft.created_at DESC`,
    [problemId]
  );

  res.json({ threads: rows });
}

// ── POST /api/forum/threads ─────────────────────────────────
async function createThread(req, res) {
  const { problemId, title, body } = req.body;

  if (!problemId || !title || !body) {
    return res.status(400).json({ error: 'Problem ID, title, and body are required' });
  }

  const { rows } = await query(
    `INSERT INTO forum_threads (problem_id, user_id, title, body)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [problemId, req.user.id, title, body]
  );

  res.status(201).json({ thread: rows[0] });
}

// ── GET /api/forum/threads/:id ──────────────────────────────
async function getThread(req, res) {
  const { id } = req.params;

  const { rows: [thread] } = await query(
    `SELECT ft.*, u.name AS user_name, u.avatar_url AS user_avatar
     FROM forum_threads ft
     JOIN users u ON u.id = ft.user_id
     WHERE ft.id = $1`,
    [id]
  );

  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const { rows: replies } = await query(
    `SELECT fr.*, u.name AS user_name, u.avatar_url AS user_avatar,
            (SELECT COUNT(*)::int FROM forum_upvotes WHERE reply_id = fr.id) AS upvote_count,
            (SELECT COUNT(*)::int > 0 FROM forum_upvotes WHERE reply_id = fr.id AND user_id = $2) AS has_upvoted
     FROM forum_replies fr
     JOIN users u ON u.id = fr.user_id
     WHERE fr.thread_id = $1
     ORDER BY fr.created_at ASC`,
    [id, req.user.id]
  );

  res.json({ thread, replies });
}

// ── POST /api/forum/threads/:id/reply ───────────────────────
async function replyToThread(req, res) {
  const { id } = req.params;
  const { body, parentReplyId } = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Body is required' });
  }

  const { rows } = await query(
    `INSERT INTO forum_replies (thread_id, user_id, body, parent_reply_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, req.user.id, body, parentReplyId || null]
  );

  res.status(201).json({ reply: rows[0] });
}

// ── POST /api/forum/replies/:id/upvote ──────────────────────
async function upvoteReply(req, res) {
  const { id } = req.params;

  // Check if already upvoted
  const { rows: [existing] } = await query(
    'SELECT id FROM forum_upvotes WHERE reply_id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (existing) {
    // Remove upvote
    await query(
      'DELETE FROM forum_upvotes WHERE reply_id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    await query('UPDATE forum_replies SET upvotes = upvotes - 1 WHERE id = $1', [id]);
    return res.json({ upvoted: false });
  }

  await query(
    'INSERT INTO forum_upvotes (reply_id, user_id) VALUES ($1, $2)',
    [id, req.user.id]
  );
  await query('UPDATE forum_replies SET upvotes = upvotes + 1 WHERE id = $1', [id]);

  res.json({ upvoted: true });
}

// ── PUT /api/forum/replies/:id ──────────────────────────────
async function updateReply(req, res) {
  const { id } = req.params;
  const { body } = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Body is required' });
  }

  const { rowCount, rows } = await query(
    'UPDATE forum_replies SET body = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
    [body, id, req.user.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Reply not found or not yours' });
  }

  res.json({ reply: rows[0] });
}

// ── DELETE /api/forum/replies/:id ───────────────────────────
async function deleteReply(req, res) {
  const { id } = req.params;

  const { rowCount } = await query(
    'DELETE FROM forum_replies WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Reply not found or not yours' });
  }

  res.json({ success: true });
}

module.exports = {
  listThreads,
  createThread,
  getThread,
  replyToThread,
  upvoteReply,
  updateReply,
  deleteReply,
};
