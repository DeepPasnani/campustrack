const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { query } = require('../db');
const jwt = require('jsonwebtoken');

async function setup2FA(req, res) {
  const { rows: [user] } = await query('SELECT totp_secret, totp_enabled FROM users WHERE id=$1', [req.user.id]);
  if (user && user.totp_enabled) return res.status(400).json({ error: '2FA already enabled' });

  const secret = speakeasy.generateSecret({
    name: `MockPlacement:${req.user.email}`,
    issuer: 'Mock Placement',
  });

  await query('UPDATE users SET totp_secret=$1 WHERE id=$2', [secret.base32, req.user.id]);

  const dataUrl = await qrcode.toDataURL(secret.otpauth_url);

  res.json({ secret: secret.base32, qr_code: dataUrl });
}

async function verifyAndEnable2FA(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const { rows: [user] } = await query('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  if (!user || !user.totp_secret) return res.status(400).json({ error: '2FA not set up. Generate a secret first.' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token,
    window: 1,
  });

  if (!verified) return res.status(400).json({ error: 'Invalid token' });

  await query('UPDATE users SET totp_enabled=true WHERE id=$1', [req.user.id]);
  res.json({ message: '2FA enabled successfully' });
}

async function disable2FA(req, res) {
  await query('UPDATE users SET totp_secret=NULL, totp_enabled=false WHERE id=$1', [req.user.id]);
  res.json({ message: '2FA disabled' });
}

async function validate2FA(req, res) {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });

  const { rows: [user] } = await query('SELECT id, role, is_active, totp_secret, totp_enabled FROM users WHERE id=$1', [userId]);
  if (!user || !user.totp_enabled || !user.totp_secret) return res.status(400).json({ error: '2FA not configured' });
  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token,
    window: 1,
  });

  if (!verified) return res.status(401).json({ error: 'Invalid 2FA code' });

  // Always sign the account's real role — this used to hardcode 'admin'
  // regardless of who the account actually belonged to.
  const jwtToken = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  res.json({ token: jwtToken, verified: true });
}

async function get2FAStatus(req, res) {
  const { rows: [user] } = await query('SELECT totp_enabled FROM users WHERE id=$1', [req.user.id]);
  res.json({ enabled: !!user?.totp_enabled });
}

module.exports = { setup2FA, verifyAndEnable2FA, disable2FA, validate2FA, get2FAStatus };
