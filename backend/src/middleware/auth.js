const jwt = require('jsonwebtoken');
const logger = require('../services/logger');
const { query } = require('../db');
const { cacheGet, cacheSet } = require('../db/redis');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Try cache first
    const cacheKey = `user:${decoded.userId}`;
    let user = await cacheGet(cacheKey);

    if (!user) {
      const { rows } = await query(
        'SELECT id, name, email, role, is_active, avatar_url, branch, roll_number, department, class_name, year_of_study, tenant_id FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (!rows.length) return res.status(401).json({ error: 'User not found' });
      user = rows[0];
      await cacheSet(cacheKey, user, 300); // cache 5 min
    }

    if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

    req.user = user;
    next();
  } catch (err) {
    logger.error({ err }, 'Auth middleware error');
    res.status(500).json({ error: 'Authentication error' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
};

const requireStudent = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
};

module.exports = { authenticate, requireAdmin, requireSuperAdmin, requireStudent };
