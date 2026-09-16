const { query } = require('../db');
const { sendNotification } = require('../services/websocket');

// ── GET /api/notifications ──────────────────────────────────
async function listNotifications(req, res) {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT id, type, title, body, data, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );

  const { rows: [countResult] } = await query(
    'SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1',
    [req.user.id]
  );

  res.json({
    notifications: rows,
    total: countResult.total,
    page: parseInt(page),
    limit: parseInt(limit),
  });
}

// ── PUT /api/notifications/:id/read ─────────────────────────
async function markAsRead(req, res) {
  const { id } = req.params;

  const { rowCount } = await query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  res.json({ success: true });
}

// ── PUT /api/notifications/read-all ─────────────────────────
async function markAllRead(req, res) {
  await query(
    'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
    [req.user.id]
  );

  res.json({ success: true });
}

// ── GET /api/notifications/unread-count ─────────────────────
async function getUnreadCount(req, res) {
  const { rows: [result] } = await query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
    [req.user.id]
  );

  res.json({ count: result.count });
}

// ── POST /api/notifications/send (admin) ────────────────────
async function sendNotificationByAdmin(req, res) {
  const { type, title, body, data, targetRole, targetUserIds } = req.body;

  if (!type || !title) {
    return res.status(400).json({ error: 'Type and title are required' });
  }

  let userIds = [];

  if (targetUserIds && targetUserIds.length > 0) {
    userIds = targetUserIds;
  } else if (targetRole) {
    const { rows } = await query(
      'SELECT id FROM users WHERE role = $1 AND is_active = true',
      [targetRole]
    );
    userIds = rows.map(r => r.id);
  } else {
    // Send to all active students by default
    const { rows } = await query(
      "SELECT id FROM users WHERE role = 'student' AND is_active = true"
    );
    userIds = rows.map(r => r.id);
  }

  let sent = 0;
  for (const userId of userIds) {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, type, title, body || '', JSON.stringify(data || {})]
    );

    // Push via WebSocket
    sendNotification(userId, rows[0]);
    sent++;
  }

  // Log to audit
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, metadata, ip_address)
     VALUES ($1, 'notification_sent', 'notification', $2, $3)`,
    [req.user.id, JSON.stringify({ type, title, sent }), req.ip]
  ).catch(() => {});

  res.json({ sent, total: userIds.length });
}

// ── Helper: Create notification (internal) ─────────────────
async function createNotification(userId, type, title, body, data = {}) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, type, title, body, JSON.stringify(data)]
  );
  sendNotification(userId, rows[0]);
  return rows[0];
}

module.exports = {
  listNotifications,
  markAsRead,
  markAllRead,
  getUnreadCount,
  sendNotificationByAdmin,
  createNotification,
};
