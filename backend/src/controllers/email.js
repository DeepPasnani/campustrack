const { query } = require('../db');
const { sendEmail, wrap, sendTestReminderEmail, sendTestResultEmail } = require('../services/email');

// ── POST /api/email/send ──────────────────────────────────────
async function sendBulkEmail(req, res) {
  const { subject, html, recipients } = req.body;

  if (!subject || !html) {
    return res.status(400).json({ error: 'Subject and body are required' });
  }

  // Resolve recipient list
  let emails = [];

  if (recipients?.allStudents) {
    const { rows } = await query(
      "SELECT email, name FROM users WHERE role='student' AND is_active=true"
    );
    emails = rows;
  } else {
    const conditions = [];
    const params = [];
    let idx = 0;

    if (recipients?.departments?.length) {
      params.push(recipients.departments);
      conditions.push(`department = ANY($${++idx})`);
    }
    if (recipients?.classes?.length) {
      params.push(recipients.classes);
      conditions.push(`id IN (SELECT user_id FROM student_classes WHERE class_id = ANY($${++idx}))`);
    }
    if (recipients?.studentIds?.length) {
      params.push(recipients.studentIds);
      conditions.push(`id = ANY($${++idx})`);
    }

    if (!conditions.length) {
      return res.status(400).json({ error: 'No recipients specified' });
    }

    const { rows } = await query(
      `SELECT email, name FROM users WHERE role='student' AND is_active=true AND (${conditions.join(' OR ')})`,
      params
    );
    emails = rows;
  }

  if (!emails.length) {
    return res.status(400).json({ error: 'No students match the selected criteria' });
  }

  // Deduplicate by email
  const seen = new Set();
  const unique = emails.filter(e => {
    const key = e.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Send
  let sent = 0;
  let errors = 0;
  for (const student of unique) {
    try {
      const personalizedSubject = subject.replaceAll('{name}', student.name);
      const personalizedHtml = html.replaceAll('{name}', student.name);
      await sendEmail({
        to: student.email,
        subject: personalizedSubject,
        html: wrap(personalizedSubject, personalizedHtml),
      });
      sent++;
    } catch {
      errors++;
    }
  }

  // Log to audit
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, metadata, ip_address)
     VALUES ($1, 'email_sent', 'email', $2, $3)`,
    [req.user.id, JSON.stringify({ subject, recipientCount: unique.length, sent, errors }), req.ip]
  ).catch(() => {});

  res.json({ sent, errors, total: unique.length });
}

// ── POST /api/email/test-reminder/:testId ─────────────────────
async function sendTestReminder(req, res) {
  const { testId } = req.params;

  // Fetch test with its class info
  const { rows: [test] } = await query(`
    SELECT t.*, array_agg(DISTINCT c.name) as class_names
    FROM tests t
    LEFT JOIN test_classes tc ON tc.test_id = t.id
    LEFT JOIN classes c ON c.id = tc.class_id
    WHERE t.id = $1
    GROUP BY t.id
  `, [testId]);

  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  // Get invited students
  const { rows: students } = await query(`
    SELECT DISTINCT u.id, u.name, u.email
    FROM users u
    JOIN test_invitations ti ON ti.user_id = u.id
    WHERE ti.test_id = $1 AND u.is_active = true
  `, [testId]);

  if (students.length === 0) {
    return res.status(400).json({ error: 'No students invited to this test' });
  }

  let sent = 0;
  let errors = 0;

  for (const student of students) {
    try {
      await sendTestReminderEmail({
        to: student.email,
        name: student.name,
        test: {
          title: test.title,
          description: test.description,
          department: test.department,
          start_time: test.start_time,
          end_time: test.end_time,
          duration_minutes: test.duration_minutes,
        },
      });
      sent++;
    } catch {
      errors++;
    }
  }

  // Log
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, 'test_reminder_sent', 'test', $2, $3, $4)`,
    [req.user.id, testId, JSON.stringify({ sent, errors }), req.ip]
  ).catch(() => {});

  res.json({ sent, errors, total: students.length });
}

module.exports = { sendBulkEmail, sendTestReminder };
