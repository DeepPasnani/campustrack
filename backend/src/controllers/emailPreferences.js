const { query } = require('../db');
const { EMAIL_TYPES } = require('../services/emailSuppression');
const { ALLOWED_DEPARTMENTS, normalizeDepartment } = require('../config/departments');

const EMAIL_TYPE_LABELS = {
  test_reminder: 'Test Start Reminders (1hr before)',
  result_announcement: 'Result Announcements',
  weekly_digest: 'Weekly Digest',
};

const SCOPE_TYPES = ['global', 'department', 'class', 'year_of_study', 'student'];

// ── GET /api/email-preferences ─────────────────────────────────
// A department admin only sees/manages rules that affect their own
// department: global rules, their own department row, and any class/
// student rule whose target actually belongs to their department.
async function listRules(req, res) {
  const params = [];
  let where = '1=1';

  if (req.user.role !== 'super_admin') {
    params.push(req.user.department);
    where = `(
      scope_type = 'global'
      OR (scope_type = 'department' AND scope_value = $1)
      OR (scope_type = 'class' AND scope_value IN (SELECT name FROM classes WHERE department = $1))
      OR (scope_type = 'student' AND scope_value IN (SELECT id::text FROM users WHERE department = $1))
    )`;
  }

  const { rows } = await query(
    `SELECT r.id, r.email_type, r.scope_type, r.scope_value, r.created_at,
            u.name as created_by_name
     FROM email_suppression_rules r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE ${where}
     ORDER BY r.created_at DESC`,
    params
  );

  const studentIds = rows.filter(r => r.scope_type === 'student').map(r => r.scope_value);
  let studentMap = {};
  if (studentIds.length) {
    const { rows: students } = await query(
      'SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])',
      [studentIds]
    );
    studentMap = Object.fromEntries(students.map(s => [s.id, s]));
  }

  res.json({
    rules: rows.map(r => ({
      ...r,
      student: r.scope_type === 'student' ? (studentMap[r.scope_value] || null) : undefined,
    })),
    emailTypes: EMAIL_TYPES.map(t => ({ value: t, label: EMAIL_TYPE_LABELS[t] })),
  });
}

// ── POST /api/email-preferences ──────────────────────────────
// Disable one automated email type for one scope. A department admin may
// only narrow things down within their own department — disabling
// globally, or by year-of-study alone (not tied to any department in the
// schema), is reserved for a super admin.
async function createRule(req, res) {
  const { emailType, scopeType } = req.body;
  let { scopeValue } = req.body;

  if (!EMAIL_TYPES.includes(emailType)) {
    return res.status(400).json({ error: `emailType must be one of: ${EMAIL_TYPES.join(', ')}` });
  }
  if (!SCOPE_TYPES.includes(scopeType)) {
    return res.status(400).json({ error: `scopeType must be one of: ${SCOPE_TYPES.join(', ')}` });
  }

  const isSuperAdmin = req.user.role === 'super_admin';

  if (scopeType === 'global') {
    if (!isSuperAdmin) return res.status(403).json({ error: 'Only a super admin can disable an email for everyone' });
    scopeValue = '';
  } else if (scopeType === 'department') {
    const dept = normalizeDepartment(scopeValue);
    if (!dept) return res.status(400).json({ error: `department must be one of: ${ALLOWED_DEPARTMENTS.join(', ')}` });
    if (!isSuperAdmin && dept !== req.user.department) {
      return res.status(403).json({ error: 'You can only manage email preferences for your own department' });
    }
    scopeValue = dept;
  } else if (scopeType === 'class') {
    if (!scopeValue) return res.status(400).json({ error: 'scopeValue (class name) required' });
    if (!isSuperAdmin) {
      const { rows } = await query('SELECT 1 FROM classes WHERE name=$1 AND department=$2', [scopeValue, req.user.department]);
      if (!rows.length) return res.status(403).json({ error: 'That class is not in your department' });
    }
  } else if (scopeType === 'year_of_study') {
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only a super admin can disable an email by year of study — it is not department-scoped' });
    }
    const year = parseInt(scopeValue, 10);
    if (!Number.isFinite(year)) return res.status(400).json({ error: 'scopeValue (year) must be a number' });
    scopeValue = String(year);
  } else if (scopeType === 'student') {
    if (!scopeValue) return res.status(400).json({ error: 'scopeValue (student id) required' });
    const { rows: [student] } = await query("SELECT id, department FROM users WHERE id=$1 AND role='student'", [scopeValue]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!isSuperAdmin && student.department !== req.user.department) {
      return res.status(403).json({ error: 'That student is not in your department' });
    }
  }

  const { rows: [rule] } = await query(
    `INSERT INTO email_suppression_rules (email_type, scope_type, scope_value, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email_type, scope_type, scope_value) DO NOTHING
     RETURNING *`,
    [emailType, scopeType, scopeValue, req.user.id]
  );

  if (!rule) return res.status(409).json({ error: 'That email is already disabled for this scope' });
  res.status(201).json({ rule });
}

// ── DELETE /api/email-preferences/:id ────────────────────────
// Re-enable (remove the suppression rule).
async function deleteRule(req, res) {
  const { id } = req.params;
  const { rows: [rule] } = await query('SELECT * FROM email_suppression_rules WHERE id=$1', [id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  if (req.user.role !== 'super_admin') {
    if (rule.scope_type === 'global') {
      return res.status(403).json({ error: 'Only a super admin can re-enable a global rule' });
    }
    if (rule.scope_type === 'year_of_study') {
      return res.status(403).json({ error: 'Only a super admin can manage year-of-study email rules' });
    }
    if (rule.scope_type === 'department' && rule.scope_value !== req.user.department) {
      return res.status(403).json({ error: 'You can only manage email preferences for your own department' });
    }
    if (rule.scope_type === 'class') {
      const { rows } = await query('SELECT 1 FROM classes WHERE name=$1 AND department=$2', [rule.scope_value, req.user.department]);
      if (!rows.length) return res.status(403).json({ error: 'That class is not in your department' });
    }
    if (rule.scope_type === 'student') {
      const { rows: [student] } = await query('SELECT department FROM users WHERE id=$1', [rule.scope_value]);
      if (!student || student.department !== req.user.department) {
        return res.status(403).json({ error: 'That student is not in your department' });
      }
    }
  }

  await query('DELETE FROM email_suppression_rules WHERE id=$1', [id]);
  res.json({ message: 'Email re-enabled for this scope' });
}

module.exports = { listRules, createRule, deleteRule };
