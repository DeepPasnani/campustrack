const { query } = require('../db');
const { cacheDel } = require('../db/redis');

async function listRoles(req, res) {
  const { rows } = await query('SELECT * FROM roles ORDER BY name');
  res.json({ roles: rows });
}

async function createRole(req, res) {
  const { name, description, permissions, tenant_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const { rows } = await query(
    'INSERT INTO roles (name, description, permissions, tenant_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, description || '', JSON.stringify(permissions || []), tenant_id || null]
  );
  res.status(201).json({ role: rows[0] });
}

async function updateRole(req, res) {
  const { description, permissions } = req.body;
  const fields = [];
  const params = [];

  if (description !== undefined) { params.push(description); fields.push(`description=$${params.length}`); }
  if (permissions !== undefined) { params.push(JSON.stringify(permissions)); fields.push(`permissions=$${params.length}`); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE roles SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Role not found' });

  await cacheDel(`user:roles:${req.params.id}`);
  res.json({ role: rows[0] });
}

async function deleteRole(req, res) {
  const { rows } = await query('DELETE FROM roles WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Role not found' });
  res.json({ message: 'Role deleted' });
}

async function assignUserRole(req, res) {
  const { user_id, role_id, department } = req.body;
  if (!user_id || !role_id) return res.status(400).json({ error: 'user_id and role_id required' });

  const { rows } = await query(
    'INSERT INTO user_roles (user_id, role_id, department) VALUES ($1,$2,$3) ON CONFLICT (user_id, role_id) DO UPDATE SET department=EXCLUDED.department RETURNING *',
    [user_id, role_id, department || null]
  );

  await cacheDel(`user:roles:${user_id}`);
  await cacheDel(`user:${user_id}`);
  res.json({ userRole: rows[0] });
}

async function removeUserRole(req, res) {
  const { userId, roleId } = req.params;
  const { rows } = await query(
    'DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2 RETURNING id',
    [userId, roleId]
  );
  if (!rows.length) return res.status(404).json({ error: 'User role not found' });

  await cacheDel(`user:roles:${userId}`);
  await cacheDel(`user:${userId}`);
  res.json({ message: 'Role removed from user' });
}

async function getUserRoles(req, res) {
  const { rows } = await query(
    `SELECT ur.*, r.name as role_name, r.permissions
     FROM user_roles ur JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [req.params.userId]
  );
  res.json({ roles: rows });
}

module.exports = { listRoles, createRole, updateRole, deleteRole, assignUserRole, removeUserRole, getUserRoles };
