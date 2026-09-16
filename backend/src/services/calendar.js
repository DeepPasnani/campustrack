const { query } = require('../db');
const logger = require('./logger');
const ical = require('ical-generator');
const { google } = require('googleapis');
const axios = require('axios');

async function getEvents(req, res) {
  try {
    const now = new Date();
    const monthEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { rows: tests } = await query(
      `SELECT id, title, description, start_time, end_time, duration_minutes
       FROM tests WHERE status = 'published' AND start_time BETWEEN $1 AND $2
       ORDER BY start_time ASC`,
      [now, monthEnd]
    );
    const events = tests.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      start: t.start_time,
      end: t.end_time,
      allDay: false,
    }));
    res.json({ events });
  } catch (err) {
    logger.error({ err }, 'Get calendar events failed');
    res.status(500).json({ error: 'Failed to get events' });
  }
}

async function generateICS(req, res) {
  try {
    const { testId } = req.params;
    const { rows } = await query('SELECT id, title, description, start_time, end_time FROM tests WHERE id = $1', [testId]);
    if (!rows.length) return res.status(404).json({ error: 'Test not found' });
    const test = rows[0];
    const cal = ical({ name: 'CampusTrack - ' + test.title });
    cal.createEvent({
      start: test.start_time,
      end: test.end_time || new Date(new Date(test.start_time).getTime() + 90 * 60000),
      summary: test.title,
      description: test.description || '',
      organizer: { name: 'CampusTrack', email: process.env.EMAIL_FROM || 'noreply@campustrack.com' },
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${test.title}.ics"`);
    res.send(cal.toString());
  } catch (err) {
    logger.error({ err }, 'ICS generation failed');
    res.status(500).json({ error: 'Failed to generate ICS' });
  }
}

async function googleAuth(req, res) {
  try {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    if (!CLIENT_ID || !CLIENT_SECRET) return res.status(400).json({ error: 'Google Calendar not configured' });
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/google-calendar/callback`);
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      prompt: 'consent',
    });
    res.json({ url });
  } catch (err) {
    logger.error({ err }, 'Google auth URL generation failed');
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function googleCallback(req, res) {
  try {
    const { code } = req.body;
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/google-calendar/callback`);
    const { tokens } = await oauth2Client.getToken(code);
    await query(
      `UPDATE users SET google_calendar_token = $1, google_calendar_refresh_token = $2 WHERE id = $3`,
      [tokens.access_token, tokens.refresh_token || '', req.user.id]
    );
    res.json({ message: 'Google Calendar connected' });
  } catch (err) {
    logger.error({ err }, 'Google Calendar callback failed');
    res.status(500).json({ error: 'Failed to connect Google Calendar' });
  }
}

async function createGoogleEvent(req, res) {
  try {
    const { rows } = await query('SELECT google_calendar_token, google_calendar_refresh_token FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!user?.google_calendar_token) return res.status(400).json({ error: 'Google Calendar not connected' });
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({
      access_token: user.google_calendar_token,
      refresh_token: user.google_calendar_refresh_token,
    });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const { testId } = req.body;
    const { rows: tests } = await query('SELECT title, description, start_time, end_time FROM tests WHERE id = $1', [testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    const test = tests[0];
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: test.title,
        description: test.description || 'CampusTrack Test',
        start: { dateTime: test.start_time, timeZone: 'Asia/Kolkata' },
        end: { dateTime: test.end_time || new Date(new Date(test.start_time).getTime() + 90 * 60000).toISOString(), timeZone: 'Asia/Kolkata' },
      },
    });
    res.json({ event: event.data });
  } catch (err) {
    logger.error({ err }, 'Google Calendar event creation failed');
    res.status(500).json({ error: 'Failed to create event: ' + err.message });
  }
}

async function outlookAuth(req, res) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  if (!clientId) return res.status(400).json({ error: 'Outlook not configured' });
  const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/outlook/callback`;
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.ReadWrite User.Read')}&response_mode=query`;
  res.json({ url });
}

async function outlookCallback(req, res) {
  try {
    const { code } = req.body;
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(400).json({ error: 'Outlook not configured' });
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/outlook/callback`;
    const resp = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code',
    }));
    const tokens = resp.data;
    await query(
      `UPDATE users SET outlook_calendar_token = $1, outlook_calendar_refresh_token = $2 WHERE id = $3`,
      [tokens.access_token, tokens.refresh_token || '', req.user.id]
    );
    res.json({ message: 'Outlook Calendar connected' });
  } catch (err) {
    logger.error({ err }, 'Outlook callback failed');
    res.status(500).json({ error: 'Failed to connect Outlook' });
  }
}

async function createOutlookEvent(req, res) {
  try {
    const { rows } = await query('SELECT outlook_calendar_token FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]?.outlook_calendar_token) return res.status(400).json({ error: 'Outlook not connected' });
    const { testId } = req.body;
    const { rows: tests } = await query('SELECT title, description, start_time, end_time FROM tests WHERE id = $1', [testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    const test = tests[0];
    await axios.post('https://graph.microsoft.com/v1.0/me/events', {
      subject: test.title,
      body: { contentType: 'text', content: test.description || 'CampusTrack Test' },
      start: { dateTime: test.start_time, timeZone: 'Asia/Kolkata' },
      end: { dateTime: test.end_time || new Date(new Date(test.start_time).getTime() + 90 * 60000).toISOString(), timeZone: 'Asia/Kolkata' },
    }, { headers: { Authorization: `Bearer ${rows[0].outlook_calendar_token}` } });
    res.json({ message: 'Event created in Outlook' });
  } catch (err) {
    logger.error({ err }, 'Outlook event creation failed');
    res.status(500).json({ error: 'Failed to create Outlook event' });
  }
}

module.exports = { getEvents, generateICS, googleAuth, googleCallback, createGoogleEvent, outlookAuth, outlookCallback, createOutlookEvent };
