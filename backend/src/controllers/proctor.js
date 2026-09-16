const { query } = require('../db');
const { getWebSocket } = require('../services/websocket');

async function getLiveSessions(req, res) {
  const { testId } = req.query;
  const params = [];
  let where = 'WHERE s.status = $1';
  params.push('in_progress');

  if (testId) { params.push(testId); where += ` AND s.test_id=$${params.length}`; }

  if (req.user.role === 'dept_admin' && req.user.department) {
    params.push(req.user.department);
    where += ` AND t.department=$${params.length}`;
  }

  const { rows } = await query(
    `SELECT s.id, s.test_id, s.user_id, s.started_at, s.tab_switch_count,
            s.fullscreen_exit_count, s.paste_attempts, s.flagged_questions,
            t.title as test_title, t.duration_minutes,
            u.name as student_name, u.email as student_email, u.roll_number,
            EXTRACT(EPOCH FROM (NOW() - s.started_at)) as elapsed_seconds
     FROM submissions s
     JOIN tests t ON s.test_id = t.id
     JOIN users u ON s.user_id = u.id
     ${where}
     ORDER BY s.started_at DESC`,
    params
  );

  const sessions = rows.map(s => ({
    ...s,
    remaining_seconds: Math.max(0, (s.duration_minutes * 60) - parseInt(s.elapsed_seconds)),
    elapsed_seconds: parseInt(s.elapsed_seconds),
  }));

  res.json({ sessions });
}

async function terminateSession(req, res) {
  const { submissionId } = req.params;

  const { rows } = await query(
    `UPDATE submissions SET status='submitted', submitted_at=NOW()
     WHERE id=$1 AND status='in_progress' RETURNING id, test_id, user_id`,
    [submissionId]
  );

  if (!rows.length) return res.status(404).json({ error: 'Active session not found' });

  const wss = getWebSocket();
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === 1 && client.submissionId === submissionId) {
        client.send(JSON.stringify({ type: 'force_terminate', submissionId }));
      }
    });
  }

  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,'proctor_terminate','submission',$2,$3)`,
    [req.user.id, submissionId, JSON.stringify({ terminated_by: req.user.name })]
  );

  res.json({ message: 'Session terminated', submissionId });
}

async function getAttendanceReport(req, res) {
  const { testId } = req.params;

  const { rows: [test] } = await query('SELECT * FROM tests WHERE id=$1', [testId]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const { rows: submissions } = await query(
    `SELECT s.id, s.status, s.started_at, s.submitted_at, s.score, s.max_score,
            u.id as user_id, u.name, u.email, u.roll_number, u.branch, u.department, u.class_name
     FROM submissions s
     JOIN users u ON s.user_id = u.id
     WHERE s.test_id=$1
     ORDER BY u.name`,
    [testId]
  );

  const { rows: allStudents } = await query(
    `SELECT id, name, email, roll_number, branch, department, class_name
     FROM users WHERE role='student' AND is_active=true
     AND (department=$1 OR $1 IS NULL OR $1='')
     ORDER BY name`,
    [test.department || null]
  );

  const submittedSet = new Set(submissions.map(s => s.user_id));
  const absentStudents = allStudents.filter(s => !submittedSet.has(s.id));

  const roomMap = {};
  for (const s of submissions) {
    const room = s.branch || s.department || 'Unknown';
    if (!roomMap[room]) roomMap[room] = { present: 0, absent: 0, total: 0, submissions: [] };
    roomMap[room].present++;
    roomMap[room].total++;
    roomMap[room].submissions.push(s);
  }
  for (const s of absentStudents) {
    const room = s.branch || s.department || 'Unknown';
    if (!roomMap[room]) roomMap[room] = { present: 0, absent: 0, total: 0, submissions: [] };
    roomMap[room].absent++;
    roomMap[room].total++;
  }

  res.json({
    test,
    summary: {
      total: allStudents.length,
      submitted: submissions.filter(s => s.status === 'submitted' || s.status === 'auto_submitted').length,
      in_progress: submissions.filter(s => s.status === 'in_progress').length,
      absent: absentStudents.length,
    },
    room_wise: Object.entries(roomMap).map(([room, data]) => ({ room, ...data })),
    absent_students: absentStudents,
    submissions,
  });
}

module.exports = { getLiveSessions, terminateSession, getAttendanceReport };
