const logger = require('../services/logger');
const { query } = require('../db');
const { deleteActiveSession } = require('../db/redis');

// GET /api/admin/security/alerts
async function getSecurityAlerts(req, res) {
  const { severity, flagType, startDate, endDate, reviewed, limit = 100, offset = 0 } = req.query;

  let sql = 'SELECT sf.*, s.test_id, u.name as user_name, u.email, u.roll_number, t.title as test_title FROM suspicious_flags sf JOIN submissions s ON sf.submission_id = s.id JOIN users u ON s.user_id = u.id JOIN tests t ON s.test_id = t.id WHERE 1=1';
  const params = [];
  let idx = 0;

  if (severity && severity !== 'all') {
    params.push(severity);
    sql += ` AND sf.severity=$${++idx}`;
  }
  if (flagType && flagType !== 'all') {
    params.push(flagType);
    sql += ` AND sf.flag_type=$${++idx}`;
  }
  if (reviewed === 'true') {
    sql += ' AND sf.reviewed=TRUE';
  } else if (reviewed === 'false') {
    sql += ' AND sf.reviewed=FALSE';
  }
  if (startDate) {
    params.push(startDate);
    sql += ` AND sf.created_at>=$${++idx}`;
  }
  if (endDate) {
    params.push(endDate);
    sql += ` AND sf.created_at<=$${++idx}`;
  }

  sql += ' ORDER BY sf.created_at DESC';

  params.push(parseInt(limit));
  sql += ` LIMIT $${++idx}`;
  params.push(parseInt(offset));
  sql += ` OFFSET $${++idx}`;

  const { rows: alerts } = await query(sql, params);

  const { rows: countRows } = await query(
    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE reviewed=FALSE) as unresolved FROM suspicious_flags",
    []
  );

  res.json({
    alerts,
    total: parseInt(countRows[0].total),
    unresolved: parseInt(countRows[0].unresolved),
  });
}

// GET /api/admin/security/alerts/stats
async function getSecurityStats(req, res) {
  const { rows } = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE reviewed=FALSE) as unresolved,
      COUNT(*) FILTER (WHERE severity='critical') as critical,
      COUNT(*) FILTER (WHERE severity='high') as high,
      COUNT(*) FILTER (WHERE severity='medium') as medium,
      COUNT(*) FILTER (WHERE severity='low') as low
    FROM suspicious_flags WHERE reviewed=FALSE
  `, []);
  res.json(rows[0]);
}

// POST /api/admin/security/alerts/:id/review
async function reviewAlert(req, res) {
  const { id } = req.params;
  const { action } = req.body; // warn | disqualify | ignore

  if (!['warn', 'disqualify', 'ignore'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be warn, disqualify, or ignore' });
  }

  const { rows } = await query(
    `UPDATE suspicious_flags SET reviewed=TRUE, reviewed_by=$1, action_taken=$2
     WHERE id=$3 RETURNING *`,
    [req.user.id, action, id]
  );

  if (!rows.length) return res.status(404).json({ error: 'Alert not found' });

  if (action === 'disqualify') {
    const { rows: [flag] } = await query('SELECT submission_id FROM suspicious_flags WHERE id=$1', [id]);
    if (flag) {
      await query(
        "UPDATE submissions SET status='disqualified' WHERE id=$1 AND status!='disqualified'",
        [flag.submission_id]
      );
    }
  }

  res.json({ alert: rows[0] });
}

// POST /api/admin/security/disqualify/:submissionId
async function disqualifySubmission(req, res) {
  const { submissionId } = req.params;

  const { rows: [sub] } = await query('SELECT * FROM submissions WHERE id=$1', [submissionId]);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  await query(
    "UPDATE submissions SET status='disqualified' WHERE id=$1",
    [submissionId]
  );

  await query(
    `INSERT INTO suspicious_flags (submission_id, flag_type, severity, details, reviewed, reviewed_by, action_taken)
     VALUES ($1, 'admin_disqualification', 'critical', $2, TRUE, $3, 'disqualify')`,
    [submissionId, JSON.stringify({ reason: 'Admin disqualification', adminId: req.user.id }), req.user.id]
  );

  try {
    await deleteActiveSession(sub.user_id, sub.test_id);
  } catch {}

  res.json({ message: 'Submission disqualified', submissionId });
}

// GET /api/admin/security/sessions/:submissionId
async function getSessionDetails(req, res) {
  const { submissionId } = req.params;

  const [proctoringFlags, suspiciousFlags, proctoringSnapshots, submission] = await Promise.all([
    query('SELECT * FROM proctoring_flags WHERE submission_id=$1 ORDER BY timestamp DESC', [submissionId]),
    query('SELECT * FROM suspicious_flags WHERE submission_id=$1 ORDER BY created_at DESC', [submissionId]),
    query("SELECT id, timestamp, face_detected, faces_count, gaze_ok FROM proctoring_snapshots WHERE submission_id=$1 ORDER BY timestamp DESC LIMIT 20", [submissionId]),
    query('SELECT * FROM submissions WHERE id=$1', [submissionId]),
  ]);

  res.json({
    submission: submission.rows[0] || null,
    proctoringFlags: proctoringFlags.rows,
    suspiciousFlags: suspiciousFlags.rows,
    snapshots: proctoringSnapshots.rows,
  });
}

module.exports = { getSecurityAlerts, getSecurityStats, reviewAlert, disqualifySubmission, getSessionDetails };
