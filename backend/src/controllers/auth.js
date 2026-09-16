const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { query }        = require('../db');
const { cacheSet, cacheDel, cacheGet, incrementRateLimit } = require('../db/redis');
const { normalizeDepartment, ALLOWED_DEPARTMENTS } = require('../config/departments');
const { ALLOWED_YEARS, isAllowedYear } = require('../config/classes');
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require('../services/email');

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

function signToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_url: user.avatar_url,
    department: user.department || null,
    branch: user.branch || null,
    roll_number: user.roll_number || null,
    class_name: user.class_name || null,
    year_of_study: user.year_of_study || null,
    profileComplete: isStudentProfileComplete(user),
  };
}

function isStudentProfileComplete(user) {
  if (!user) return false;
  if (user.role && user.role !== 'student') return true;
  return Boolean(
    user.roll_number &&
    String(user.roll_number).trim() &&
    user.class_name &&
    String(user.class_name).trim() &&
    user.year_of_study
  );
}

async function assignUserToCluster({ userId, rollNumber, studentClass, department, yearOfStudy }) {
  const year = parseInt(yearOfStudy, 10) || 1;
  const dept = department || null;
  const className = studentClass.trim();
  const roll = rollNumber.trim();

  await query(
    `UPDATE users SET
       roll_number = $1,
       class_name = $2,
       year_of_study = $3,
       department = COALESCE($4, department),
       branch = COALESCE(branch, $4)
     WHERE id = $5`,
    [roll, className, year, dept, userId]
  );

  // Ensure a classes row exists so the student lands in the same cluster
  // admins use for test/drive mapping.
  if (dept) {
    const { rows: [classRow] } = await query(
      `INSERT INTO classes (name, department, year_of_study)
       VALUES ($1, $2, $3)
       ON CONFLICT (name, department) DO UPDATE SET
         year_of_study = COALESCE(EXCLUDED.year_of_study, classes.year_of_study)
       RETURNING id`,
      [className, dept, year]
    );

    if (classRow?.id) {
      const semester = process.env.CURRENT_SEMESTER || `${new Date().getFullYear()}-Spring`;
      await query(
        `INSERT INTO student_classes (user_id, class_id, year_of_study, semester)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, semester) DO UPDATE SET
           class_id = EXCLUDED.class_id,
           year_of_study = EXCLUDED.year_of_study`,
        [userId, classRow.id, year, semester]
      );
    }
  }

  await cacheDel(`user:${userId}`);

  const { rows: [user] } = await query(
    `SELECT id, name, email, role, avatar_url, department, branch, roll_number, class_name, year_of_study, is_active
     FROM users WHERE id = $1`,
    [userId]
  );
  return user;
}

// ── POST /api/auth/login ──────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { rows } = await query(
    `SELECT id, name, email, role, password_hash, is_active, avatar_url,
            department, branch, roll_number, class_name, year_of_study
     FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const token = signToken(user.id, user.role);
  res.json({ token, user: publicUser(user) });
}

// ── POST /api/auth/register ───────────────────────────────────
async function register(req, res) {
  const { name, email, password, department, rollNumber, branch, className, yearOfStudy } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const emailLower = email.toLowerCase().trim();
  const existing   = await query('SELECT id FROM users WHERE email = $1', [emailLower]);
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const allowedDept = normalizeDepartment(department);
  if (department && !allowedDept) {
    return res.status(400).json({
      error: `This platform is only for ${ALLOWED_DEPARTMENTS.join(' and ')} students.`,
    });
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows: [created] } = await query(
    `INSERT INTO users (name, email, password_hash, role, department, roll_number, branch, class_name, year_of_study, is_active)
     VALUES ($1,$2,$3,'student',$4,$5,$6,$7,$8,$9)
     RETURNING id, name, email, role, department, avatar_url, roll_number, branch, class_name, year_of_study`,
    [name.trim(), emailLower, hash, allowedDept || null, rollNumber || null, branch || allowedDept || null, className || null, yearOfStudy || 1, true]
  );

  let user = created;
  if (rollNumber && className && allowedDept) {
    user = await assignUserToCluster({
      userId: created.id,
      rollNumber,
      studentClass: className,
      department: allowedDept,
      yearOfStudy: yearOfStudy || 1,
    });
  }

  const token = signToken(user.id, user.role);

  // Send welcome email (non-blocking)
  sendWelcomeEmail({ to: emailLower, name: name.trim() }).catch(() => {});

  res.status(201).json({
    token,
    user: publicUser(user),
  });
}

// ── POST /api/auth/google ─────────────────────────────────────
async function googleLogin(req, res) {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Google credential required' });
  if (!googleClient) return res.status(400).json({ error: 'Google OAuth is not configured' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  const { sub: googleId, email, name, picture } = payload;
  const emailLower = email.toLowerCase();

  // Existing account? Match by google_id first, then by the verified Google
  // email — so a student who already registered with a password can link
  // their Google account instead of tripping the UNIQUE email constraint.
  const { rows: existingRows } = await query(
    `SELECT id, name, email, role, avatar_url, is_active, google_id,
            department, branch, roll_number, class_name, year_of_study
     FROM users
     WHERE google_id = $1 OR email = $2
     ORDER BY (google_id = $1) DESC
     LIMIT 1`,
    [googleId, emailLower]
  );

  let isNew = false;
  let user = existingRows[0];

  if (user) {
    if (user.google_id === googleId) {
      // Returning Google user — refresh their profile info
      ({ rows: [user] } = await query(
        `UPDATE users SET email = $1, name = $2, avatar_url = $3, last_login = NOW()
         WHERE id = $4
         RETURNING id, name, email, role, avatar_url, is_active, google_id,
                   department, branch, roll_number, class_name, year_of_study`,
        [emailLower, name, picture, user.id]
      ));
    } else {
      // Email already registered with a password — link this Google account
      ({ rows: [user] } = await query(
        `UPDATE users SET google_id = $1, avatar_url = $2, last_login = NOW()
         WHERE id = $3
         RETURNING id, name, email, role, avatar_url, is_active, google_id,
                   department, branch, roll_number, class_name, year_of_study`,
        [googleId, picture, user.id]
      ));
    }
  } else {
    isNew = true;
    ({ rows: [user] } = await query(
      `INSERT INTO users (google_id, email, name, avatar_url, role)
       VALUES ($1,$2,$3,$4,'student')
       RETURNING id, name, email, role, avatar_url, is_active, google_id,
                 department, branch, roll_number, class_name, year_of_study`,
      [googleId, emailLower, name, picture]
    ));
  }

  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

  // Send welcome email only on first login
  if (isNew) sendWelcomeEmail({ to: emailLower, name }).catch(() => {});

  const token = signToken(user.id, user.role);
  res.json({
    token,
    user: publicUser(user),
    needsProfileCompletion: !isStudentProfileComplete(user),
  });
}

// ── POST /api/auth/complete-profile ───────────────────────────
// Required after Google sign-in (and for any student missing cluster fields).
async function completeProfile(req, res) {
  const { rollNumber, className, yearOfStudy, department } = req.body;
  if (!rollNumber || !className || !yearOfStudy) {
    return res.status(400).json({
      error: 'Enrollment number, class, and year of study are required',
    });
  }
  if (req.user.role !== 'student') {
    return res.status(400).json({ error: 'Only students complete this profile step' });
  }

  const year = parseInt(yearOfStudy, 10);
  if (!isAllowedYear(year)) {
    return res.status(400).json({ error: `Year of study must be ${ALLOWED_YEARS.join('–')}` });
  }

  const requestedDept = department ? String(department).trim() : (req.user.department || null);
  const allowedDept = requestedDept ? normalizeDepartment(requestedDept) : req.user.department || null;
  if (requestedDept && !allowedDept) {
    return res.status(400).json({
      error: `This platform is only for ${ALLOWED_DEPARTMENTS.join(' and ')} students.`,
    });
  }

  const user = await assignUserToCluster({
    userId: req.user.id,
    rollNumber: String(rollNumber),
    studentClass: String(className),
    department: allowedDept,
    yearOfStudy: year,
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ user: publicUser(user), message: 'Profile completed' });
}

// ── POST /api/auth/logout ─────────────────────────────────────
async function logout(req, res) {
  await cacheDel(`user:${req.user.id}`);
  res.json({ message: 'Logged out successfully' });
}

// ── GET /api/auth/me ──────────────────────────────────────────
async function getMe(req, res) {
  res.json({
    user: publicUser(req.user),
    needsProfileCompletion: req.user.role === 'student' && !isStudentProfileComplete(req.user),
  });
}

// ── POST /api/auth/change-password ────────────────────────────
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]?.password_hash) return res.status(400).json({ error: 'Cannot change password for Google accounts' });

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  await cacheDel(`user:${req.user.id}`);

  res.json({ message: 'Password changed successfully' });
}

// ── POST /api/auth/forgot-password ───────────────────────────
// Generates a 6-digit OTP, caches it in Redis for 15 min, sends email
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const { rows } = await query(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  // Always return success to prevent email enumeration
  if (!rows.length || !rows[0].password_hash) {
    return res.json({ message: 'If that email exists, an OTP has been sent.' });
  }

  const user = rows[0];
  const otp  = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP

  // Store OTP in Redis for 15 minutes
  await cacheSet(`otp:${user.id}`, otp, 900);

  await sendPasswordResetEmail({ to: user.email, name: user.name, otp });

  res.json({ message: 'If that email exists, an OTP has been sent.' });
}

// ── POST /api/auth/reset-password ────────────────────────────
// Verifies OTP and sets new password
async function resetPassword(req, res) {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const { rows } = await query(
    'SELECT id, name FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  if (!rows.length) return res.status(400).json({ error: 'Invalid OTP or email' });

  const user       = rows[0];
  const cachedOtp  = await cacheGet(`otp:${user.id}`);

  // A 6-digit OTP is only 900k possibilities — without a cap, someone could
  // just try all of them inside the 15-minute window. This counts wrong
  // guesses against *this one* reset request only (keyed by user id, same
  // lifetime as the OTP itself), so it can't false-positive against normal
  // login traffic the way the old blanket per-IP login limiter did.
  const attemptsKey = `otp-attempts:${user.id}`;
  const attempts = await incrementRateLimit(attemptsKey, 900);
  if (attempts > 5) {
    await cacheDel(`otp:${user.id}`);
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new OTP.' });
  }

  if (!cachedOtp || cachedOtp !== otp) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);

  // Delete OTP (and its attempt counter) so neither can be reused
  await cacheDel(`otp:${user.id}`);
  await cacheDel(attemptsKey);
  await cacheDel(`user:${user.id}`);

  res.json({ message: 'Password reset successfully. Please log in.' });
}

// ── DELETE /api/auth/me (student self-service only) ───────────
// Permanently deletes the student's own account. Everything keyed to
// user_id (submissions, saved custom tests, bookmarks, drive applications,
// etc.) cascades via the same ON DELETE CASCADE foreign keys the admin
// bulk-delete-users path already relies on — this isn't a soft delete.
async function deleteMyAccount(req, res) {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Self-service account deletion is only available for student accounts.' });
  }

  const { password, confirm } = req.body;
  if (confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm.' });
  }

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (rows[0]?.password_hash) {
    if (!password) return res.status(400).json({ error: 'Password is required to delete your account.' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password.' });
  }

  // A test still in progress holds Redis session state (timer, tab-switch
  // count) that nothing would clean up if the row disappears mid-exam —
  // same reasoning as the edit-test guard for in-progress submissions.
  const { rows: activeRows } = await query(
    "SELECT COUNT(*)::int AS n FROM submissions WHERE user_id=$1 AND status='in_progress'",
    [req.user.id]
  );
  if (activeRows[0]?.n > 0) {
    return res.status(400).json({ error: 'You have a test in progress. Finish it (or wait for it to auto-submit) before deleting your account.' });
  }

  await query('DELETE FROM users WHERE id = $1', [req.user.id]);
  await cacheDel(`user:${req.user.id}`);

  res.json({ message: 'Your account and all associated data have been permanently deleted.' });
}

module.exports = {
  login,
  register,
  googleLogin,
  completeProfile,
  logout,
  getMe,
  changePassword,
  forgotPassword,
  resetPassword,
  deleteMyAccount,
  isStudentProfileComplete,
};
