const { query } = require('../db');
const { cacheGet, cacheSet } = require('../db/redis');

const PERMISSION_MAP = {
  super_admin: ['*'],
  dept_admin: [
    'tests:create', 'tests:edit', 'tests:delete', 'tests:publish',
    'results:view', 'results:export',
    'users:view', 'users:create', 'users:edit',
    'question-bank:manage', 'classes:manage',
  ],
  proctor: ['proctor:view-sessions', 'proctor:terminate', 'proctor:attendance', 'results:view'],
  auditor: ['audit:view', 'audit:export', 'results:view'],
  student: [],
};

async function getUserEffectiveRole(userId) {
  const cacheKey = `user:roles:${userId}`;
  let cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const { rows } = await query(
    `SELECT r.name, r.permissions FROM user_roles ur
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [userId]
  );

  const result = rows.map(r => ({
    name: r.name,
    permissions: r.permissions || PERMISSION_MAP[r.name] || [],
  }));

  await cacheSet(cacheKey, result, 120);
  return result;
}

function checkPermission(...requiredPerms) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    if (req.user.role === 'super_admin') return next();

    const roles = await getUserEffectiveRole(req.user.id);
    const userPerms = new Set();
    for (const r of roles) {
      if (r.permissions.includes('*')) return next();
      r.permissions.forEach(p => userPerms.add(p));
    }

    if (req.user.role === 'admin') {
      const adminPerms = PERMISSION_MAP.dept_admin || [];
      adminPerms.forEach(p => userPerms.add(p));
    }

    const hasAll = requiredPerms.every(p => userPerms.has(p));
    if (!hasAll) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

async function getUserPermissions(userId) {
  const roles = await getUserEffectiveRole(userId);
  const perms = new Set();
  for (const r of roles) {
    if (r.permissions.includes('*')) return ['*'];
    r.permissions.forEach(p => perms.add(p));
  }
  return Array.from(perms);
}

module.exports = { checkPermission, getUserEffectiveRole, getUserPermissions, PERMISSION_MAP };
