const { query } = require('../db');

async function getAuditLogs(req, res) {
  const { user_id, action, entity_type, date_from, date_to, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';

  if (user_id) { params.push(user_id); where += ` AND al.user_id=$${params.length}`; }
  if (action) { params.push(action); where += ` AND al.action=$${params.length}`; }
  if (entity_type) { params.push(entity_type); where += ` AND al.entity_type=$${params.length}`; }
  if (date_from) { params.push(date_from); where += ` AND al.created_at>=$${params.length}`; }
  if (date_to) { params.push(date_to); where += ` AND al.created_at<=$${params.length}`; }

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_log al
     LEFT JOIN users u ON al.user_id = u.id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM audit_log al ${where}`,
    params.slice(0, -2)
  );

  res.json({ logs: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
}

async function exportAuditLogs(req, res) {
  const { user_id, action, entity_type, date_from, date_to } = req.query;
  const params = [];
  let where = 'WHERE 1=1';

  if (user_id) { params.push(user_id); where += ` AND user_id=$${params.length}`; }
  if (action) { params.push(action); where += ` AND action=$${params.length}`; }
  if (entity_type) { params.push(entity_type); where += ` AND entity_type=$${params.length}`; }
  if (date_from) { params.push(date_from); where += ` AND created_at>=$${params.length}`; }
  if (date_to) { params.push(date_to); where += ` AND created_at<=$${params.length}`; }

  const { rows } = await query(
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_log al LEFT JOIN users u ON al.user_id = u.id ${where}
     ORDER BY al.created_at DESC`,
    params
  );

  const header = 'ID,User,Email,Action,Entity Type,Entity ID,IP Address,Created At\n';
  const csv = rows.map(r =>
    `"${r.id}","${r.user_name || ''}","${r.user_email || ''}","${r.action}","${r.entity_type || ''}","${r.entity_id || ''}","${r.ip_address || ''}","${r.created_at}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
  res.send(header + csv);
}

async function logAudit(userId, action, entityType, entityId, metadata, ipAddress, tenantId) {
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, ipAddress || null]
  );
}

module.exports = { getAuditLogs, exportAuditLogs, logAudit };
