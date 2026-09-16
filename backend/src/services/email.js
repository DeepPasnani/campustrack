const nodemailer = require('nodemailer');
const logger = require('./logger');
const { query } = require('../db');

// ── Transporter ───────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('SMTP not configured — emails will be skipped.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  return transporter;
}

// ── Core send function ────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) return; // silently skip if SMTP not configured

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || `CampusTrack <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info({ to, subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to, subject }, 'Email failed');
  }
}

// ── Shared HTML wrapper ───────────────────────────────────────
function wrap(title, body) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body { margin:0; padding:0; background:#f1f5f9; font-family:'Segoe UI',Arial,sans-serif; }
    .wrapper { max-width:600px; margin:32px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#1a6cf5,#0d9488); padding:28px 32px; }
    .header h1 { color:white; margin:0; font-size:22px; font-weight:700; }
    .header p  { color:rgba(255,255,255,0.75); margin:4px 0 0; font-size:13px; }
    .body  { padding:32px; color:#334155; line-height:1.7; font-size:15px; }
    .body h2 { color:#0f172a; font-size:18px; margin:0 0 16px; }
    .btn { display:inline-block; background:#1a6cf5; color:white; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px; margin:20px 0; }
    .info-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px 20px; margin:16px 0; }
    .info-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e2e8f0; font-size:14px; }
    .info-row:last-child { border-bottom:none; }
    .info-label { color:#64748b; }
    .info-value { color:#0f172a; font-weight:600; }
    .badge { display:inline-block; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; }
    .badge-green  { background:#d1fae5; color:#065f46; }
    .badge-blue   { background:#dbeafe; color:#1e40af; }
    .badge-orange { background:#fef3c7; color:#92400e; }
    .footer { background:#f8fafc; padding:20px 32px; text-align:center; color:#94a3b8; font-size:12px; border-top:1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🎓 CampusTrack</h1>
      <p>Campus Placement Assessment Platform — SVIT Vasad</p>
    </div>
    <div class="body">
      <h2>${title}</h2>
      ${body}
    </div>
    <div class="footer">
      <p>© 2025 CampusTrack · SVIT Vasad · GTU</p>
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── 1. Welcome email after registration ───────────────────────
async function sendWelcomeEmail({ to, name }) {
  await sendEmail({
    to,
    subject: '🎓 Welcome to CampusTrack!',
    html: wrap('Welcome aboard!', `
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your account has been successfully created on <strong>CampusTrack</strong> — your campus placement assessment platform.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Email</span><span class="info-value">${to}</span></div>
        <div class="info-row"><span class="info-label">Role</span><span class="info-value">Student</span></div>
        <div class="info-row"><span class="info-label">Platform</span><span class="info-value">CampusTrack · SVIT Vasad</span></div>
      </div>
      <p>You can now log in and access aptitude tests, coding challenges, and placement preparation resources.</p>
      <p>Best of luck with your placement journey! 🚀</p>
    `),
  });
}

// ── 2. Test scheduled notification ───────────────────────────
async function sendTestScheduledEmail({ to, name, test }) {
  const start = new Date(test.start_time).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short'
  });
  const end = new Date(test.end_time).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', timeStyle: 'short'
  });

  await sendEmail({
    to,
    subject: `📋 New Test Scheduled: ${test.title}`,
    html: wrap(`New Test: ${test.title}`, `
      <p>Hi <strong>${name}</strong>,</p>
      <p>A new placement test has been scheduled for your department. Please make sure you're prepared and available at the scheduled time.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Test</span><span class="info-value">${test.title}</span></div>
        <div class="info-row"><span class="info-label">Department</span><span class="info-value">${test.department}</span></div>
        <div class="info-row"><span class="info-label">Date &amp; Time</span><span class="info-value">${start}</span></div>
        <div class="info-row"><span class="info-label">End Time</span><span class="info-value">${end}</span></div>
        <div class="info-row"><span class="info-label">Duration</span><span class="info-value">${test.duration_minutes} minutes</span></div>
      </div>
      ${test.description ? `<p><strong>About this test:</strong> ${test.description}</p>` : ''}
      <p><strong>⚠️ Important:</strong> Ensure a stable internet connection. Once started, the timer cannot be paused.</p>
    `),
  });
}

// ── 3. Test results email ─────────────────────────────────────
async function sendTestResultEmail({ to, name, result }) {
  const percentage = result.total_marks > 0
    ? Math.round((result.score / result.total_marks) * 100)
    : 0;
  const badgeClass = percentage >= 70 ? 'badge-green' : percentage >= 40 ? 'badge-orange' : 'badge-blue';
  const remark = percentage >= 70 ? '🎉 Excellent performance!' : percentage >= 40 ? '👍 Good effort — keep practising!' : '📚 Keep working hard!';

  await sendEmail({
    to,
    subject: `📊 Your Results: ${result.test_title}`,
    html: wrap(`Your Test Results`, `
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your results for <strong>${result.test_title}</strong> are now available.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Test</span><span class="info-value">${result.test_title}</span></div>
        <div class="info-row"><span class="info-label">Score</span><span class="info-value">${result.score} / ${result.total_marks}</span></div>
        <div class="info-row"><span class="info-label">Percentage</span><span class="info-value"><span class="badge ${badgeClass}">${percentage}%</span></span></div>
        <div class="info-row"><span class="info-label">Submitted At</span><span class="info-value">${new Date(result.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span></div>
      </div>
      <p>${remark}</p>
      <p>Log in to CampusTrack to view your detailed answer breakdown and explanations.</p>
    `),
  });
}

// ── 4. Password reset OTP ─────────────────────────────────────
async function sendPasswordResetEmail({ to, name, otp }) {
  await sendEmail({
    to,
    subject: '🔐 Password Reset OTP — CampusTrack',
    html: wrap('Reset Your Password', `
      <p>Hi <strong>${name}</strong>,</p>
      <p>We received a request to reset your CampusTrack password. Use the OTP below:</p>
      <div style="text-align:center;margin:24px 0;">
        <div style="display:inline-block;background:#f1f5f9;border:2px dashed #1a6cf5;border-radius:12px;padding:20px 40px;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748b;letter-spacing:0.1em;text-transform:uppercase;">Your OTP</p>
          <p style="margin:0;font-size:40px;font-weight:800;color:#1a6cf5;letter-spacing:0.2em;font-family:monospace;">${otp}</p>
        </div>
      </div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Valid for</span><span class="info-value">15 minutes</span></div>
        <div class="info-row"><span class="info-label">One-time use</span><span class="info-value">Cannot be reused</span></div>
      </div>
      <p>If you did not request a password reset, ignore this email. Your password will remain unchanged.</p>
    `),
  });
}

// ── 5. Admin account created ──────────────────────────────────
async function sendAdminCreatedEmail({ to, name, tempPassword }) {
  await sendEmail({
    to,
    subject: '🔑 Your Admin Account — CampusTrack',
    html: wrap('Admin Account Created', `
      <p>Hi <strong>${name}</strong>,</p>
      <p>An admin account has been created for you on CampusTrack. Please log in and change your password immediately.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Email</span><span class="info-value">${to}</span></div>
        <div class="info-row"><span class="info-label">Temporary Password</span><span class="info-value" style="font-family:monospace;">${tempPassword}</span></div>
        <div class="info-row"><span class="info-label">Role</span><span class="info-value"><span class="badge badge-blue">Admin</span></span></div>
      </div>
      <p style="color:#ef4444;font-weight:600;">⚠️ Change your password immediately after your first login.</p>
    `),
  });
}

// ── 6. Test reminder (1h before) ──────────────────────────────
async function sendTestReminderEmail({ to, name, test }) {
  const start = new Date(test.start_time).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short'
  });

  await sendEmail({
    to,
    subject: `⏰ Reminder: ${test.title} starts soon!`,
    html: wrap(`Test Reminder: ${test.title}`, `
      <p>Hi <strong>${name}</strong>,</p>
      <p>This is a reminder that the following test is scheduled to start <strong>soon</strong>.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Test</span><span class="info-value">${test.title}</span></div>
        <div class="info-row"><span class="info-label">Date &amp; Time</span><span class="info-value">${start}</span></div>
        <div class="info-row"><span class="info-label">Duration</span><span class="info-value">${test.duration_minutes} minutes</span></div>
        ${test.department ? `<div class="info-row"><span class="info-label">Department</span><span class="info-value">${test.department}</span></div>` : ''}
      </div>
      ${test.description ? `<p>${test.description}</p>` : ''}
      <p>Make sure you have a stable internet connection and a quiet environment. Good luck! 🚀</p>
    `),
  });
}

// ── 7. Weekly digest ─────────────────────────────────────────
async function sendWeeklyDigestEmail({ to, name, submissions, upcomingTests, unreadCount }) {
  let submissionsHtml = '';
  if (submissions && submissions.length > 0) {
    submissionsHtml = submissions.map(s => {
      const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0;
      return `<div class="info-row"><span class="info-label">${s.test_title}</span><span class="info-value">${s.score}/${s.max_score} (${pct}%)</span></div>`;
    }).join('');
  }

  let upcomingHtml = '';
  if (upcomingTests && upcomingTests.length > 0) {
    upcomingHtml = upcomingTests.map(t => {
      const date = new Date(t.start_time).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short'
      });
      return `<div class="info-row"><span class="info-label">${t.title}</span><span class="info-value">${date}</span></div>`;
    }).join('');
  }

  await sendEmail({
    to,
    subject: '📬 Your Weekly Digest — CampusTrack',
    html: wrap('Weekly Performance Digest', `
      <p>Hi <strong>${name}</strong>,</p>
      <p>Here's your weekly summary from CampusTrack.</p>

      ${submissionsHtml ? `
      <h3 style="font-size:15px;margin:20px 0 10px;">📊 Tests Completed This Week</h3>
      <div class="info-box">${submissionsHtml}</div>` : '<p>You didn\'t complete any tests this week. Keep practising! 📚</p>'}

      ${upcomingHtml ? `
      <h3 style="font-size:15px;margin:20px 0 10px;">📋 Upcoming Tests</h3>
      <div class="info-box">${upcomingHtml}</div>` : ''}

      <div class="info-box">
        <div class="info-row"><span class="info-label">Unread Notifications</span><span class="info-value">${unreadCount}</span></div>
      </div>

      <p style="margin-top:24px;font-size:12px;color:#94a3b8;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/student/notifications/preferences" style="color:#1a6cf5;">Unsubscribe from weekly digests</a>
      </p>
    `),
  });
}

// ── 8. Bulk import — student credentials ─────────────────────
async function sendBulkImportEmail({ to, name, tempPassword }) {
  await sendEmail({
    to,
    subject: '🎓 Your CampusTrack Account Details',
    html: wrap('Your Account is Ready', `
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your student account on CampusTrack has been created by your T&P Cell. Use the credentials below to log in.</p>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Email</span><span class="info-value">${to}</span></div>
        <div class="info-row"><span class="info-label">Temporary Password</span><span class="info-value" style="font-family:monospace;">${tempPassword}</span></div>
      </div>
      <p style="color:#ef4444;font-weight:600;">⚠️ Change your password after your first login.</p>
      <p>Good luck with your placement preparation! 🚀</p>
    `),
  });
}

// ── Template library for admin email composer ─────────────
const TEMPLATES = {
  blank: {
    label: 'Blank',
    subject: '',
    body: '',
  },
  welcome: {
    label: 'Welcome',
    subject: '🎓 Welcome to CampusTrack!',
    body: '<p>Hi {name},</p><p>Your account has been successfully created on <strong>CampusTrack</strong> — your campus placement assessment platform.</p><p>You can now log in and access aptitude tests, coding challenges, and placement preparation resources.</p><p>Best of luck with your placement journey! 🚀</p>',
  },
  testScheduled: {
    label: 'Test Scheduled',
    subject: '📋 New Test Scheduled: {test_title}',
    body: '<p>Hi {name},</p><p>A new placement test has been scheduled for your department. Please make sure you\'re prepared and available at the scheduled time.</p><p>Log in to CampusTrack to view the details.</p>',
  },
  testResults: {
    label: 'Test Results Available',
    subject: '📊 Your Results: {test_title}',
    body: '<p>Hi {name},</p><p>Your results for <strong>{test_title}</strong> are now available. Log in to CampusTrack to view your detailed score breakdown.</p>',
  },
  passwordReset: {
    label: 'Password Reset',
    subject: '🔐 Password Reset OTP — CampusTrack',
    body: '<p>Hi {name},</p><p>We received a request to reset your CampusTrack password. Use the OTP shown on screen to complete the process.</p><p>If you did not request a password reset, ignore this email.</p>',
  },
};

module.exports = {
  sendWelcomeEmail,
  sendTestScheduledEmail,
  sendTestResultEmail,
  sendPasswordResetEmail,
  sendAdminCreatedEmail,
  sendBulkImportEmail,
  sendTestReminderEmail,
  sendWeeklyDigestEmail,
  sendEmail,
  wrap,
  TEMPLATES,
};
