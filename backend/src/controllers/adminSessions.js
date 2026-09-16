const { query } = require('../db');

async function listActiveSessions(req, res) {
  const { rows } = await query(
    `    SELECT s.id, s.user_id, s.ip_address, s.started_at,
            u.name as user_name, u.email as user_email, u.role as user_role
     FROM submissions s
     JOIN users u ON s.user_id = u.id
     WHERE s.status = 'in_progress'
     ORDER BY s.started_at DESC`
  );

  const sessions = rows.map(s => ({
    id: s.id,
    userId: s.user_id,
    userName: s.user_name,
    userEmail: s.user_email,
    userRole: s.user_role,
    ip: s.ip_address,
    startedAt: s.started_at,
    lastActive: s.started_at,
    current: s.user_id === req.user.id,
  }));

  res.json({ sessions });
}

async function revokeSession(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    'UPDATE submissions SET status=\'submitted\', submitted_at=NOW() WHERE id=$1 AND status=\'in_progress\' RETURNING id',
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session not found' });

  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,'session_revoked','submission',$2,$3)`,
    [req.user.id, id, JSON.stringify({ revoked_by: req.user.id })]
  );

  res.json({ message: 'Session revoked' });
}

module.exports = { listActiveSessions, revokeSession };
