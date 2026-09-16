const { query } = require('../db');
const bcrypt = require('bcryptjs');

async function collectUserData(req, res) {
  const userId = req.params.userId;
  if (req.user.role !== 'super_admin' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { rows: [user] } = await query(
    'SELECT id, name, email, role, department, avatar_url, branch, roll_number, is_active, last_login, created_at FROM users WHERE id=$1',
    [userId]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { rows: submissions } = await query(
    'SELECT id, test_id, status, score, max_score, started_at, submitted_at, time_taken_seconds FROM submissions WHERE user_id=$1',
    [userId]
  );

  const { rows: consentRecords } = await query(
    'SELECT * FROM consent_records WHERE user_id=$1',
    [userId]
  );

  res.json({
    user,
    submissions,
    consent_records: consentRecords,
    exported_at: new Date().toISOString(),
  });
}

async function exportUserData(req, res) {
  const userId = req.user.id;

  const { rows: [user] } = await query(
    'SELECT id, name, email, role, department, branch, roll_number, is_active, last_login, created_at FROM users WHERE id=$1',
    [userId]
  );

  const { rows: submissions } = await query(
    'SELECT id, test_id, status, score, max_score, started_at, submitted_at, time_taken_seconds FROM submissions WHERE user_id=$1',
    [userId]
  );

  const data = {
    exported_at: new Date().toISOString(),
    user,
    submissions,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=user-data-${userId}.json`);
  res.json(data);
}

async function forgetUser(req, res) {
  const userId = req.user.id;

  const hash = await bcrypt.hash(`deleted_${Date.now()}`, 10);

  await query(
    `UPDATE users SET
       name='Deleted User', email=$1, password_hash=NULL, avatar_url=NULL,
       branch=NULL, roll_number=NULL, phone=NULL, google_id=NULL,
       is_active=false
     WHERE id=$2`,
    [`deleted_${userId}@anon.local`, userId]
  );

  await query('DELETE FROM consent_records WHERE user_id=$1', [userId]);

  res.json({ message: 'User data anonymized. Account deactivated.' });
}

async function updateConsent(req, res) {
  const { consent_type, granted } = req.body;
  if (!consent_type) return res.status(400).json({ error: 'consent_type required' });

  const { rows } = await query(
    `INSERT INTO consent_records (user_id, consent_type, granted)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id, consent_type)
     DO UPDATE SET granted=$3, granted_at=NOW()
     RETURNING *`,
    [req.user.id, consent_type, granted !== false]
  );

  res.json({ consent: rows[0] });
}

async function getConsents(req, res) {
  const { rows } = await query('SELECT * FROM consent_records WHERE user_id=$1', [req.user.id]);
  res.json({ consents: rows });
}

module.exports = { collectUserData, exportUserData, forgetUser, updateConsent, getConsents };
