const bcrypt = require('bcryptjs');
const { query }  = require('../db');
const { cacheDel } = require('../db/redis');
const {
  sendAdminCreatedEmail,
  sendBulkImportEmail,
  sendTestScheduledEmail,
  sendTestResultEmail,
} = require('../services/email');
const { normalizeDepartment, ALLOWED_DEPARTMENTS } = require('../config/departments');

// ── GET /api/users ────────────────────────────────────────────
// A department admin only sees users from their own department; a super
// admin sees everyone (same scoping rule as listAdmins below).
async function listUsers(req, res) {
  const { role, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';

  if (req.user.role === 'admin') {
    params.push(req.user.department);
    where += ` AND department=$${params.length}`;
  }

  if (role)   { params.push(role);           where += ` AND role=$${params.length}`; }
  if (search) { params.push(`%${search}%`);  where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`; }

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, name, email, role, branch, department, class_name, year_of_study,
            roll_number, is_active, avatar_url, last_login, created_at
     FROM users ${where} ORDER BY department, year_of_study, class_name, name LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );

  const { rows: [{ count }] } = await query(`SELECT COUNT(*) FROM users ${where}`, params.slice(0, -2));
  res.json({ users: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
}

// ── GET /api/users/stats ──────────────────────────────────────
async function getStats(req, res) {
  const { rows: [stats] } = await query(`
    SELECT
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE role = 'student')        AS students,
      COUNT(*) FILTER (WHERE role = 'admin')          AS admins,
      COUNT(*) FILTER (WHERE is_active = true)        AS active,
      COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '7 days') AS active_this_week
    FROM users
  `);

  // Genre-wise performance (last 30 days)
  const { rows: genreStats } = await query(`
    SELECT q.genre,
      COUNT(DISTINCT q.id) as total_questions,
      AVG(CASE WHEN s.answers->>q.id::text IS NOT NULL AND s.answers->>q.id::text != '' THEN 1 ELSE 0 END) as attempt_rate,
      AVG(CASE
        WHEN s.answers->>q.id::text IS NOT NULL
          AND (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}')
        THEN 1.0 ELSE 0.0
      END) as accuracy
    FROM submissions s
    JOIN tests t ON s.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN questions q ON q.section_id = sec.id AND q.genre IS NOT NULL
    WHERE s.status = 'submitted'
      AND s.submitted_at > NOW() - INTERVAL '30 days'
    GROUP BY q.genre
    ORDER BY q.genre
  `);

  // Difficulty-wise performance
  const { rows: diffStats } = await query(`
    SELECT q.difficulty,
      COUNT(DISTINCT q.id) as total_questions,
      AVG(CASE
        WHEN s.answers->>q.id::text IS NOT NULL
          AND (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}')
        THEN 1.0 ELSE 0.0
      END) as accuracy
    FROM submissions s
    JOIN tests t ON s.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN questions q ON q.section_id = sec.id
    WHERE s.status = 'submitted'
      AND s.submitted_at > NOW() - INTERVAL '30 days'
    GROUP BY q.difficulty
    ORDER BY q.difficulty
  `);

  // Coding problem performance (easy vs hard)
  const { rows: codingStats } = await query(`
    SELECT cp.difficulty,
      COUNT(DISTINCT cp.id) as total_problems,
      AVG(
        CASE WHEN s.code_results ? cp.id::text
          THEN ((s.code_results -> cp.id::text ->> 'earned')::numeric / NULLIF((s.code_results -> cp.id::text ->> 'total')::numeric, 0))
          ELSE NULL
        END
      ) as avg_score_rate
    FROM submissions s
    JOIN tests t ON s.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN coding_problems cp ON cp.section_id = sec.id
    WHERE s.status = 'submitted'
      AND s.submitted_at > NOW() - INTERVAL '30 days'
    GROUP BY cp.difficulty
    ORDER BY cp.difficulty
  `);

  // Recent submissions with scores for dashboard
  const { rows: recentSubmissionsRaw } = await query(`
    SELECT s.id, s.score, s.max_score, s.submitted_at, s.status,
      u.name as user_name, t.title as test_title, t.settings as test_settings,
      u.department as user_department, u.class_name as user_class, u.year_of_study as user_year
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    JOIN tests t ON s.test_id = t.id
    WHERE s.status = 'submitted'
    ORDER BY s.submitted_at DESC NULLS LAST
    LIMIT 10
  `);
  // Each test can have its own passing score — surface it per submission
  // (COALESCE-style ?? so an explicit 0% threshold isn't treated as unset).
  const recentSubmissions = recentSubmissionsRaw.map(({ test_settings, ...s }) => ({
    ...s,
    passing_score: test_settings?.passingScore ?? 40,
  }));

  res.json({ ...stats, genreStats, diffStats, codingStats, recentSubmissions });
}

// ── POST /api/users/admin ─────────────────────────────────────
// Only super admins can reach this route (see routes/index.js). A super
// admin can create either a department-scoped admin or another super
// admin — this is the only way a new super admin ever gets made.
async function createAdmin(req, res) {
  const { name, email, password, department, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const finalRole = role === 'super_admin' ? 'super_admin' : 'admin';

  let finalDepartment = null;
  if (finalRole === 'admin') {
    finalDepartment = normalizeDepartment(department);
    if (!finalDepartment) {
      return res.status(400).json({ error: `Department is required for an admin account. Choose one of: ${ALLOWED_DEPARTMENTS.join(', ')}` });
    }
  }

  const existing = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
  if (existing.rows.length) return res.status(400).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const { rows: [user] } = await query(
    `INSERT INTO users (name, email, password_hash, role, department, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, department, created_at`,
    [name, email.toLowerCase(), hash, finalRole, finalDepartment, req.user.id]
  );

  // Email the new admin their credentials
  sendAdminCreatedEmail({ to: email.toLowerCase(), name, tempPassword: password }).catch(() => {});

  res.status(201).json({ user });
}

// ── POST /api/users/bulk-import ───────────────────────────────
async function bulkImport(req, res) {
  const { students } = req.body;
  if (!Array.isArray(students) || !students.length) return res.status(400).json({ error: 'Student list required' });

  const results = { created: 0, skipped: 0, errors: [] };

  for (const s of students) {
    if (!s.email) { results.errors.push(`Missing email for ${s.name}`); continue; }

    const dept = normalizeDepartment(s.department || s.branch);
    if (s.department || s.branch) {
      if (!dept) {
        results.errors.push(
          `${s.email}: Only ${ALLOWED_DEPARTMENTS.join(' and ')} students can be imported`
        );
        continue;
      }
    }

    try {
      const tempPass = Math.random().toString(36).slice(2, 10);
      const hash     = await bcrypt.hash(tempPass, 10);
      const result   = await query(
        `INSERT INTO users (name, email, password_hash, role, branch, department, roll_number)
         VALUES ($1,$2,$3,'student',$4,$5,$6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [s.name, s.email.toLowerCase(), hash, dept || s.branch, dept || null, s.rollNumber]
      );

      if (result.rows.length) {
        results.created++;
        // Email each student their credentials
        sendBulkImportEmail({ to: s.email.toLowerCase(), name: s.name, tempPassword: tempPass }).catch(() => {});
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push(`${s.email}: ${err.message}`);
    }
  }

  res.json(results);
}

// ── PATCH /api/users/:id ──────────────────────────────────────
// Regular admins may edit any student's profile; editing an admin or
// super_admin account (any field, not just role) is super-admin-only.
async function updateUser(req, res) {
  const { id } = req.params;
  const body = req.body;
  // Accept both namings — the frontend historically sent isActive/rollNumber
  // in some places and is_active/roll_number in others (the "Activate" /
  // "Deactivate" toggle was actually silently broken by this exact
  // mismatch: it sent isActive but this handler only ever read is_active).
  const name = body.name;
  const email = body.email;
  const role = body.role;
  const isActive = body.is_active !== undefined ? body.is_active : body.isActive;
  const branch = body.branch;
  const rollNumber = body.roll_number !== undefined ? body.roll_number : body.rollNumber;
  const department = body.department;
  const className = body.class_name !== undefined ? body.class_name : body.className;
  const yearOfStudy = body.year_of_study !== undefined ? body.year_of_study : body.yearOfStudy;

  const { rows: [target] } = await query('SELECT role FROM users WHERE id=$1', [id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const targetIsAdmin = target.role === 'admin' || target.role === 'super_admin';

  // Changing a role is a privilege-escalation vector — requireAdmin alone
  // would let any department admin PATCH their own row to 'super_admin'.
  // Only a super admin may change anyone's role, and never their own (same
  // "can't act on yourself" rule deleteUser already applies below).
  if (role !== undefined) {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can change roles' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
  }

  // Same super-admin-only boundary extends to every other field once the
  // target is an admin account — a department admin can fix a student's
  // roll number, but not another admin's profile.
  if (targetIsAdmin && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can edit admin accounts' });
  }

  const fields = [];
  const params = [];
  const set = (col, val) => { params.push(val); fields.push(`${col}=$${params.length}`); };

  if (name !== undefined) set('name', name);
  if (email !== undefined) set('email', String(email).toLowerCase().trim());
  if (role !== undefined) set('role', role);
  if (isActive !== undefined) set('is_active', isActive);
  if (branch !== undefined) set('branch', branch);
  if (rollNumber !== undefined) set('roll_number', rollNumber);
  if (department !== undefined) set('department', department);
  if (className !== undefined) set('class_name', className);
  if (yearOfStudy !== undefined) set('year_of_study', yearOfStudy === '' || yearOfStudy === null ? null : Number(yearOfStudy));

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  const { rows: [user] } = await query(
    `UPDATE users SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length}
     RETURNING id, name, email, role, is_active, branch, roll_number, department, class_name, year_of_study`,
    params
  );

  if (!user) return res.status(404).json({ error: 'User not found' });
  await cacheDel(`user:${id}`);
  res.json({ user });
}

// ── DELETE /api/users/:id ─────────────────────────────────────
async function deleteUser(req, res) {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const { rows } = await query('DELETE FROM users WHERE id=$1 RETURNING id', [id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });

  await cacheDel(`user:${id}`);
  res.json({ message: 'User deleted' });
}

// ── GET /api/admins ───────────────────────────────────────────
// Super admins see every admin account. A department admin only sees
// admins from their own department (plus super admins, so they always
// know who to escalate to) — admin accounts are not visible across
// departments.
async function listAdmins(req, res) {
  if (req.user.role === 'super_admin') {
    const { rows } = await query(
      `SELECT id, name, email, role, department, is_active, created_at, last_login
       FROM users WHERE role IN ('admin','super_admin') ORDER BY created_at DESC`
    );
    return res.json({ admins: rows });
  }

  const { rows } = await query(
    `SELECT id, name, email, role, department, is_active, created_at, last_login
     FROM users
     WHERE role = 'super_admin' OR (role = 'admin' AND department = $1)
     ORDER BY created_at DESC`,
    [req.user.department]
  );
  res.json({ admins: rows });
}

// ── POST /api/users/notify-test ───────────────────────────────
// Send test scheduled email to all students in a department
async function notifyTestScheduled(req, res) {
  const { test_id } = req.body;
  if (!test_id) return res.status(400).json({ error: 'test_id required' });

  const { rows: [test] } = await query('SELECT * FROM tests WHERE id=$1', [test_id]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const { rows: students } = await query(
    `SELECT name, email FROM users
     WHERE role='student' AND is_active=true
     AND (department=$1 OR $1='All Departments')`,
    [test.department]
  );

  let sent = 0;
  for (const s of students) {
    sendTestScheduledEmail({ to: s.email, name: s.name, test }).catch(() => {});
    sent++;
  }

  res.json({ message: `Notifications queued for ${sent} students.`, sent });
}


// ── POST /api/users/send-results ─────────────────────────────
// Email each student their individual test result
async function sendResults(req, res) {
  const { test_id } = req.body;
  if (!test_id) return res.status(400).json({ error: 'test_id required' });

  const { rows: [test] } = await query('SELECT * FROM tests WHERE id=$1', [test_id]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  // Get all submitted submissions with student info
  const { rows: submissions } = await query(`
    SELECT s.id, s.score, s.max_score, s.submitted_at, s.time_taken_seconds,
           u.name, u.email
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    WHERE s.test_id=$1 AND s.status='submitted'
  `, [test_id]);

  if (!submissions.length) {
    return res.status(400).json({ error: 'No submitted results found for this test' });
  }

  let sent = 0;
  for (const sub of submissions) {
    sendTestResultEmail({
      to:   sub.email,
      name: sub.name,
      result: {
        test_title:   test.title,
        score:        sub.score,
        total_marks:  sub.max_score,
        submitted_at: sub.submitted_at,
      },
    }).catch(() => {});
    sent++;
  }

  res.json({ message: `Results queued for ${sent} student${sent !== 1 ? 's' : ''}.`, sent });
}

// ── POST /api/users/bulk-update-class ────────────────────────
// Bulk update student class and year_of_study via CSV data.
// For semester-start re-shuffling. Accepts array of { email, class_name, year_of_study }.
async function bulkUpdateClass(req, res) {
  const { students } = req.body;
  if (!Array.isArray(students) || !students.length) {
    return res.status(400).json({ error: 'Student list required' });
  }

  const results = { updated: 0, skipped: 0, errors: [] };

  for (const s of students) {
    if (!s.email) { results.errors.push('Missing email for entry'); continue; }
    try {
      const fields = [];
      const params = [];
      if (s.class_name !== undefined) { params.push(s.class_name); fields.push(`class_name=$${params.length}`); }
      if (s.year_of_study !== undefined) { params.push(parseInt(s.year_of_study)); fields.push(`year_of_study=$${params.length}`); }
      if (!fields.length) { results.errors.push(`${s.email}: No fields to update`); continue; }

      params.push(s.email.toLowerCase());
      const { rowCount } = await query(
        `UPDATE users SET ${fields.join(', ')}, updated_at=NOW() WHERE email=$${params.length} AND role='student'`,
        params
      );

      if (rowCount > 0) results.updated++;
      else results.skipped++;
    } catch (err) {
      results.errors.push(`${s.email}: ${err.message}`);
    }
  }

  res.json(results);
}

// ── POST /api/users/bulk-update-attribute ────────────────────
// Set one attribute across every student the caller can see — their own
// department for a department admin, all students for a super admin —
// optionally narrowed by the same name/email search the Students page uses.
const BULK_EDITABLE_FIELDS = {
  department:    { column: 'department',    superAdminOnly: true },
  class_name:    { column: 'class_name',    superAdminOnly: false },
  year_of_study: { column: 'year_of_study', superAdminOnly: false },
  branch:        { column: 'branch',        superAdminOnly: false },
  is_active:     { column: 'is_active',     superAdminOnly: false },
};

async function bulkUpdateAttribute(req, res) {
  const { attribute, value, search } = req.body;
  const field = BULK_EDITABLE_FIELDS[attribute];
  if (!field) {
    return res.status(400).json({ error: `Attribute must be one of: ${Object.keys(BULK_EDITABLE_FIELDS).join(', ')}` });
  }
  if (field.superAdminOnly && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can bulk-update department' });
  }

  const params = [];
  let where = "WHERE role='student'";

  if (req.user.role === 'admin') {
    params.push(req.user.department);
    where += ` AND department=$${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
  }

  let normalizedValue = value;
  if (attribute === 'year_of_study') normalizedValue = (value === '' || value === null) ? null : Number(value);
  if (attribute === 'is_active') normalizedValue = value === true || value === 'true';
  if (attribute === 'department') normalizedValue = normalizeDepartment(value) || value;

  params.push(normalizedValue);
  const { rowCount } = await query(
    `UPDATE users SET ${field.column}=$${params.length}, updated_at=NOW() ${where}`,
    params
  );

  res.json({ updated: rowCount });
}

// ── GET /api/users/:id/analytics ────────────────────────────
// Individual student drill-down analytics
async function getStudentAnalytics(req, res) {
  const { id } = req.params;
  const { rows: [student] } = await query('SELECT id, name, email, branch, roll_number, class_name, year_of_study FROM users WHERE id=$1 AND role=\'student\'', [id]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // Overall stats — pass/fail is judged against each submission's own
  // test's passing score (tests.settings.passingScore), not a fixed 40%.
  // COALESCE (unlike JS `||`) correctly keeps an explicit 0 threshold.
  const { rows: [overall] } = await query(`
    SELECT
      COUNT(*) as total_tests,
      COUNT(*) FILTER (WHERE s.status = 'submitted') as submitted_count,
      COUNT(*) FILTER (WHERE s.status = 'auto_submitted') as auto_submitted_count,
      AVG(CASE WHEN s.max_score > 0 THEN (s.score / s.max_score) * 100 END) as avg_percentage,
      SUM(CASE WHEN s.max_score > 0 AND (s.score / s.max_score) * 100 >= COALESCE((t.settings->>'passingScore')::numeric, 40) THEN 1 ELSE 0 END) as passed_count,
      SUM(s.score) as total_score,
      SUM(s.max_score) as total_max_score
    FROM submissions s JOIN tests t ON s.test_id = t.id
    WHERE s.user_id=$1`, [id]);

  // Per-test breakdown
  const { rows: testBreakdown } = await query(`
    SELECT s.id as submission_id, s.score, s.max_score, s.status, s.submitted_at,
           s.time_taken_seconds, s.tab_switch_count,
           t.id as test_id, t.title as test_title, t.department, t.settings
    FROM submissions s JOIN tests t ON s.test_id = t.id
    WHERE s.user_id=$1 ORDER BY s.submitted_at DESC NULLS LAST`, [id]);

  // Genre-wise accuracy for this student
  const { rows: genreAccuracy } = await query(`
    SELECT q.genre,
      COUNT(q.id) as total_questions,
      SUM(CASE WHEN (sub.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1 ELSE 0 END) as correct_count,
      COUNT(q.id) as attempted_count
    FROM submissions sub
    JOIN tests t ON sub.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN questions q ON q.section_id = sec.id
    WHERE sub.user_id=$1 AND sub.status='submitted'
    GROUP BY q.genre ORDER BY q.genre`, [id]);

  // Coding performance
  const { rows: codingBreakdown } = await query(`
    SELECT cp.id as problem_id, cp.title, cp.difficulty, cp.marks,
           (sub.code_results->>cp.id::text)::jsonb as result
    FROM submissions sub
    JOIN tests t ON sub.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN coding_problems cp ON cp.section_id = sec.id
    WHERE sub.user_id=$1 AND sub.status='submitted'
    ORDER BY cp.difficulty`, [id]);

  res.json({
    student,
    overall: {
      total_tests: parseInt(overall.total_tests) || 0,
      submitted: parseInt(overall.submitted_count) || 0,
      auto_submitted: parseInt(overall.auto_submitted_count) || 0,
      avg_percentage: Math.round(parseFloat(overall.avg_percentage) || 0),
      passed: parseInt(overall.passed_count) || 0,
      total_score: parseFloat(overall.total_score) || 0,
      total_max_score: parseFloat(overall.total_max_score) || 0,
    },
    tests: testBreakdown.map(({ settings, ...t }) => ({
      ...t,
      percentage: t.max_score > 0 ? Math.round((t.score / t.max_score) * 100) : 0,
      passed: t.max_score > 0 && (t.score / t.max_score) * 100 >= (settings?.passingScore ?? 40),
    })),
    genre_accuracy: genreAccuracy.map(g => ({
      genre: g.genre,
      total: parseInt(g.total_questions) || 0,
      correct: parseInt(g.correct_count) || 0,
      attempted: parseInt(g.attempted_count) || 0,
      accuracy: g.attempted_count > 0 ? Math.round((parseInt(g.correct_count) / parseInt(g.attempted_count)) * 100) : 0,
    })),
    coding_results: codingBreakdown.map(c => ({
      problem_id: c.problem_id,
      title: c.title,
      difficulty: c.difficulty,
      marks: c.marks,
      earned: c.result ? parseInt(c.result.earned) || 0 : 0,
      total: c.result ? parseInt(c.result.total) || 0 : 0,
      passed: c.result ? (c.result.earned || 0) > 0 : false,
    })),
  });
}

async function updateLanguage(req, res) {
  const { language } = req.body;
  if (!language) return res.status(400).json({ error: 'Language required' });

  await query('UPDATE users SET settings = COALESCE(settings, $1) || $2 WHERE id=$3',
    [JSON.stringify({}), JSON.stringify({ language }), req.user.id]
  );

  res.json({ message: 'Language updated', language });
}

module.exports = {
  listUsers,
  getStats,
  createAdmin,
  bulkImport,
  updateUser,
  deleteUser,
  listAdmins,
  notifyTestScheduled,
  sendResults,
  bulkUpdateClass,
  bulkUpdateAttribute,
  getStudentAnalytics,
  updateLanguage,
};
