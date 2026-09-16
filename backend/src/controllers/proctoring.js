const logger = require('../services/logger');
const { query } = require('../db');

// POST /api/proctoring/snapshot
async function uploadSnapshot(req, res) {
  const { submissionId, snapshot, faceDetected, facesCount, gazeOk } = req.body;

  if (!submissionId || !snapshot) {
    return res.status(400).json({ error: 'submissionId and snapshot required' });
  }

  const base64Data = snapshot.replace(/^data:image\/jpeg;base64,/, '');
  const imageUrl = `data:image/jpeg;base64,${base64Data.substring(0, 50)}...`;

  const { rows } = await query(
    `INSERT INTO proctoring_snapshots (submission_id, image_url, face_detected, faces_count, gaze_ok)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [submissionId, imageUrl, faceDetected !== false, facesCount || 0, gazeOk !== false]
  );

  if (!faceDetected || facesCount > 1 || !gazeOk) {
    let flagType = null;
    if (!faceDetected) flagType = 'face_absent';
    else if (facesCount > 1) flagType = 'multiple_faces';
    else if (!gazeOk) flagType = 'gaze_deviation';

    if (flagType) {
      const severity = !faceDetected ? 'high' : facesCount > 1 ? 'medium' : 'low';
      await query(
        `INSERT INTO proctoring_flags (submission_id, flag_type, severity)
         VALUES ($1, $2, $3)`,
        [submissionId, flagType, severity]
      );

      await query(
        `INSERT INTO suspicious_flags (submission_id, flag_type, severity, details)
         VALUES ($1, $2, $3, $4)`,
        [submissionId, flagType, severity, JSON.stringify({ source: 'proctoring', facesCount, gazeOk })]
      );
    }
  }

  res.json({ snapshot: rows[0] });
}

// POST /api/proctoring/heartbeat
async function heartbeat(req, res) {
  const { submissionId, testId, faceDetected, facesCount, gazeOk } = req.body;

  if (!submissionId) {
    return res.status(400).json({ error: 'submissionId required' });
  }

  const { rows } = await query(
    `INSERT INTO proctoring_flags (submission_id, flag_type, severity)
     VALUES ($1, $2, $3) RETURNING *`,
    [
      submissionId,
      !faceDetected ? 'face_absent' : facesCount > 1 ? 'multiple_faces' : !gazeOk ? 'gaze_deviation' : null,
      !faceDetected ? 'high' : facesCount > 1 ? 'medium' : 'low',
    ].filter(v => v !== null)
  );

  if (!faceDetected || facesCount > 1 || !gazeOk) {
    const flagType = !faceDetected ? 'face_absent' : facesCount > 1 ? 'multiple_faces' : 'gaze_deviation';
    const severity = !faceDetected ? 'high' : facesCount > 1 ? 'medium' : 'low';
    await query(
      `INSERT INTO suspicious_flags (submission_id, flag_type, severity, details)
       VALUES ($1, $2, $3, $4)`,
      [submissionId, flagType, severity, JSON.stringify({ source: 'proctoring_heartbeat', facesCount, gazeOk })]
    );
  }

  res.json({ received: true, timestamp: new Date().toISOString() });
}

// GET /api/proctoring/flags/:submissionId
async function getFlags(req, res) {
  const { submissionId } = req.params;

  const { rows: flags } = await query(
    'SELECT * FROM proctoring_flags WHERE submission_id=$1 ORDER BY timestamp DESC',
    [submissionId]
  );

  const { rows: snapshots } = await query(
    "SELECT id, timestamp, face_detected, faces_count, gaze_ok FROM proctoring_snapshots WHERE submission_id=$1 ORDER BY timestamp DESC LIMIT 50",
    [submissionId]
  );

  res.json({ flags, snapshots, total: flags.length });
}

// GET /api/proctoring/sessions/:testId (admin)
async function getSessions(req, res) {
  const { testId } = req.params;

  const { rows } = await query(
    `SELECT
       s.id as submission_id,
       s.user_id,
       u.name as user_name,
       u.email,
       u.roll_number,
       COUNT(pf.id) as total_flags,
       COUNT(*) FILTER (WHERE pf.severity = 'high') as high_severity_flags,
       MAX(pf.timestamp) as last_flag_time
     FROM submissions s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN proctoring_flags pf ON pf.submission_id = s.id
     WHERE s.test_id = $1
     GROUP BY s.id, s.user_id, u.name, u.email, u.roll_number
     ORDER BY total_flags DESC`,
    [testId]
  );

  res.json({ sessions: rows });
}

module.exports = { uploadSnapshot, heartbeat, getFlags, getSessions };
