const { query } = require('../db');

// ── POST /api/announcements (admin) ─────────────────────────
async function createAnnouncement(req, res) {
  const { title, body, priority, targetRole, targetClasses, expiresAt } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  const { rows } = await query(
    `INSERT INTO announcements (title, body, priority, target_role, target_classes, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      title,
      body,
      priority || 'normal',
      targetRole || 'all',
      JSON.stringify(targetClasses || []),
      req.user.id,
      expiresAt || null,
    ]
  );

  // Notify targeted users
  let userIds = [];
  if (targetRole === 'all') {
    const { rows: users } = await query(
      'SELECT id FROM users WHERE is_active = true'
    );
    userIds = users.map(u => u.id);
  } else {
    const { rows: users } = await query(
      'SELECT id FROM users WHERE role = $1 AND is_active = true',
      [targetRole]
    );
    userIds = users.map(u => u.id);
  }

  if (userIds.length > 0) {
    const { createNotification } = require('./notifications');
    for (const userId of userIds) {
      await createNotification(
        userId,
        'admin_announcement',
        `📢 ${title}`,
        body.substring(0, 200),
        { announcementId: rows[0].id, priority }
      );
    }
  }

  res.status(201).json({ announcement: rows[0] });
}

// ── GET /api/announcements ──────────────────────────────────
async function listAnnouncements(req, res) {
  const now = new Date();

  const { rows } = await query(
    `SELECT a.*, u.name AS created_by_name
     FROM announcements a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE (a.expires_at IS NULL OR a.expires_at > $1)
       AND (a.target_role = 'all' OR a.target_role = $2)
     ORDER BY
       CASE a.priority
         WHEN 'urgent' THEN 0
         WHEN 'high' THEN 1
         WHEN 'normal' THEN 2
         WHEN 'low' THEN 3
       END,
       a.created_at DESC`,
    [now, req.user.role]
  );

  res.json({ announcements: rows });
}

// ── PUT /api/announcements/:id (admin) ──────────────────────
async function updateAnnouncement(req, res) {
  const { id } = req.params;
  const { title, body, priority, targetRole, targetClasses, expiresAt } = req.body;

  const { rowCount, rows } = await query(
    `UPDATE announcements
     SET title = COALESCE($1, title),
         body = COALESCE($2, body),
         priority = COALESCE($3, priority),
         target_role = COALESCE($4, target_role),
         target_classes = COALESCE($5, target_classes),
         expires_at = COALESCE($6, expires_at)
     WHERE id = $7
     RETURNING *`,
    [title, body, priority, targetRole, targetClasses ? JSON.stringify(targetClasses) : null, expiresAt, id]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Announcement not found' });
  }

  res.json({ announcement: rows[0] });
}

// ── DELETE /api/announcements/:id (admin) ───────────────────
async function deleteAnnouncement(req, res) {
  const { id } = req.params;

  const { rowCount } = await query('DELETE FROM announcements WHERE id = $1', [id]);

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Announcement not found' });
  }

  res.json({ success: true });
}

module.exports = {
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
};
