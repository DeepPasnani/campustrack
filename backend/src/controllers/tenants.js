const { query } = require('../db');
const { cacheDel } = require('../db/redis');

async function createTenant(req, res) {
  const { name, slug, domain, logo_url, primary_color, secondary_color, favicon_url, settings } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' });

  const { rows } = await query(
    `INSERT INTO tenants (name, slug, domain, logo_url, primary_color, secondary_color, favicon_url, settings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [name, slug.toLowerCase(), domain || null, logo_url || null, primary_color || '#2F5D56', secondary_color || '#565C86', favicon_url || null, JSON.stringify(settings || {})]
  );

  res.status(201).json({ tenant: rows[0] });
}

async function listTenants(req, res) {
  const { rows } = await query('SELECT * FROM tenants ORDER BY created_at DESC');
  res.json({ tenants: rows });
}

// Only this tenant's own admins (or a super admin, who oversees every
// tenant) may read its config — the route only requires `authenticate`, so
// this check is what actually stops a student (or an admin belonging to a
// different tenant) from reading another institution's branding/SSO setup.
function canAccessTenant(req) {
  if (req.user.role === 'super_admin') return true;
  return req.user.role === 'admin' && req.user.tenant_id === req.params.id;
}

async function getTenant(req, res) {
  if (!canAccessTenant(req)) return res.status(403).json({ error: 'Admin access required' });
  const { rows } = await query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });
  res.json({ tenant: rows[0] });
}

async function updateTenant(req, res) {
  const { name, slug, domain, logo_url, primary_color, secondary_color, favicon_url, is_active, settings } = req.body;
  const fields = [];
  const params = [];

  if (name !== undefined) { params.push(name); fields.push(`name=$${params.length}`); }
  if (slug !== undefined) { params.push(slug); fields.push(`slug=$${params.length}`); }
  if (domain !== undefined) { params.push(domain); fields.push(`domain=$${params.length}`); }
  if (logo_url !== undefined) { params.push(logo_url); fields.push(`logo_url=$${params.length}`); }
  if (primary_color !== undefined) { params.push(primary_color); fields.push(`primary_color=$${params.length}`); }
  if (secondary_color !== undefined) { params.push(secondary_color); fields.push(`secondary_color=$${params.length}`); }
  if (favicon_url !== undefined) { params.push(favicon_url); fields.push(`favicon_url=$${params.length}`); }
  if (is_active !== undefined) { params.push(is_active); fields.push(`is_active=$${params.length}`); }
  if (settings !== undefined) { params.push(JSON.stringify(settings)); fields.push(`settings=$${params.length}`); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });

  await cacheDel(`tenant:${rows[0].slug}`);
  if (rows[0].domain) await cacheDel(`tenant:${rows[0].domain}`);

  res.json({ tenant: rows[0] });
}

async function deleteTenant(req, res) {
  const { rows } = await query('UPDATE tenants SET is_active=false WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tenant not found' });

  await cacheDel(`tenant:${req.params.id}`);
  res.json({ message: 'Tenant deactivated' });
}

async function verifyDomain(req, res) {
  const { domain } = req.body;
  const { id } = req.params;
  if (!domain) return res.status(400).json({ error: 'Domain required' });

  const cnameValue = `${process.env.PLATFORM_DOMAIN || 'platform.com'}`;
  const txtValue = `pp-verify=${id}`;

  await query('UPDATE tenants SET domain=$1, settings=settings || $2 WHERE id=$3', [
    domain, JSON.stringify({ domain_verified: false, cname_value: cnameValue, txt_value: txtValue }), id
  ]);

  res.json({ cname: { host: domain, value: cnameValue }, txt: { value: txtValue }, status: 'pending' });
}

async function getTenantUsage(req, res) {
  if (!canAccessTenant(req)) return res.status(403).json({ error: 'Admin access required' });
  const { id } = req.params;

  const { rows: [students] } = await query('SELECT COUNT(*) as count FROM users WHERE tenant_id=$1 AND role=$2', [id, 'student']);
  const { rows: [tests] } = await query('SELECT COUNT(*) as count FROM tests WHERE tenant_id=$1', [id]);
  const { rows: [storage] } = await query("SELECT COALESCE(SUM(COALESCE((metadata->>'size')::bigint,0)),0) as total FROM audit_log WHERE tenant_id=$1", [id]);

  const { rows: [quotas] } = await query(
    'SELECT * FROM usage_quotas WHERE tenant_id=$1 AND period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE ORDER BY created_at DESC LIMIT 1',
    [id]
  );

  res.json({
    usage: {
      students: parseInt(students.count),
      tests: parseInt(tests.count),
      storage_mb: Math.round(parseInt(storage.total) / (1024 * 1024)),
    },
    quotas: quotas || null,
  });
}

async function getTenantQuotas(req, res) {
  const { rows } = await query(
    'SELECT * FROM usage_quotas WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );
  res.json({ quotas: rows[0] || null });
}

async function setTenantQuotas(req, res) {
  const { max_students, max_tests, max_storage_mb, max_api_calls } = req.body;
  if (!max_students && !max_tests && !max_storage_mb && !max_api_calls) {
    return res.status(400).json({ error: 'At least one quota value required' });
  }

  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { rows } = await query(
    `INSERT INTO usage_quotas (tenant_id, max_students, max_tests, max_storage_mb, max_api_calls, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [req.params.id, max_students || 100, max_tests || 50, max_storage_mb || 1000, max_api_calls || 10000, periodStart, periodEnd]
  );

  res.json({ quotas: rows[0] });
}

async function recordUsage(req, res) {
  const { tenant_id, metric_type, value } = req.body;
  if (!tenant_id || !metric_type) return res.status(400).json({ error: 'tenant_id and metric_type required' });

  await query(
    'INSERT INTO usage_records (tenant_id, metric_type, value) VALUES ($1,$2,$3)',
    [tenant_id, metric_type, value || 1]
  );

  res.json({ recorded: true });
}

module.exports = {
  createTenant, listTenants, getTenant, updateTenant, deleteTenant,
  verifyDomain, getTenantUsage, getTenantQuotas, setTenantQuotas, recordUsage,
};
