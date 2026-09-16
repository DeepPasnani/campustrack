const { WebSocketServer } = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { trackActiveUser, getActiveUserCount, setActiveSession } = require('../db/redis');

let wss;

// Map<userId, Set<WebSocket>> — track multiple tabs per user
const userSockets = new Map();

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const query = url.parse(req.url, true).query;
    const token = query.token;
    if (!token) {
      ws.close(4001, 'Token required');
      return;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    // Re-derive identity/role from the database rather than trusting the
    // token's own claims — a JWT's `role` can be stale (changed since
    // issue) or, for the /auth/2fa/validate token specifically, was until
    // recently hardcoded to 'admin' regardless of the account's real role.
    // Same pattern middleware/auth.js already uses for REST requests.
    const { rows: [dbUser] } = await query(
      'SELECT id, name, email, role, is_active FROM users WHERE id=$1',
      [decoded.userId]
    );
    if (!dbUser || !dbUser.is_active) {
      ws.close(4001, 'Invalid token');
      return;
    }
    const user = dbUser;

    ws.userId = user.id;
    ws.userRole = user.role;

    // Register socket for user-based messaging
    if (!userSockets.has(user.id)) {
      userSockets.set(user.id, new Set());
    }
    userSockets.get(user.id).add(ws);

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HEARTBEAT' && msg.testId) {
          await trackActiveUser(msg.testId, user.id);
          ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK', testId: msg.testId }));
        }

        if (msg.type === 'TEST_MESSAGE' && msg.testId && msg.message) {
          const { query } = require('../db');
          // Store message and broadcast to admins
          const { rows } = await query(
            `INSERT INTO test_messages (test_id, submission_id, user_id, message, is_from_student)
             VALUES ($1, $2, $3, $4, true) RETURNING *`,
            [msg.testId, msg.submissionId || null, user.id, msg.message]
          );
          // Broadcast to all admin sockets watching this test
          broadcastToAdmins({
            type: 'TEST_MESSAGE',
            testId: msg.testId,
            message: rows[0],
            user: { id: user.id, name: user.name, email: user.email },
          });
          // Also send confirmation back to sender
          ws.send(JSON.stringify({
            type: 'TEST_MESSAGE_ACK',
            testId: msg.testId,
            message: rows[0],
          }));
        }

        if (msg.type === 'ADMIN_REPLY' && msg.testId && msg.message && msg.studentId) {
          const { query } = require('../db');
          const { rows } = await query(
            `INSERT INTO test_messages (test_id, user_id, message, is_from_student)
             VALUES ($1, $2, $3, false) RETURNING *`,
            [msg.testId, msg.studentId, msg.message]
          );
          // Send to the student
          sendToUser(msg.studentId, {
            type: 'TEST_MESSAGE',
            testId: msg.testId,
            message: rows[0],
            user: { id: user.id, name: user.name, role: 'admin' },
          });
          ws.send(JSON.stringify({
            type: 'TEST_MESSAGE_ACK',
            testId: msg.testId,
            message: rows[0],
          }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      const sockets = userSockets.get(user.id);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          userSockets.delete(user.id);
        }
      }
    });
  });

  return wss;
}

function getWss() {
  return wss;
}

function sendToUser(userId, data) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify(data);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function broadcastToAdmins(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && ws.userRole && ['admin', 'super_admin'].includes(ws.userRole)) {
      ws.send(msg);
    }
  });
}

function sendNotification(userId, notification) {
  sendToUser(userId, {
    type: 'NOTIFICATION',
    notification,
  });
}

module.exports = { setupWebSocket, getWss, sendToUser, broadcastToAdmins, sendNotification };
