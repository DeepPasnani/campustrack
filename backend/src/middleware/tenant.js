const { query } = require('../db');
const { cacheGet, cacheSet } = require('../db/redis');

async function detectTenant(req, res, next) {
  try {
    let tenantSlug = null;

    const host = req.headers.host;
    if (host) {
      const parts = host.split('.');
      if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'app') {
        tenantSlug = parts[0];
      }
    }

    const headerTenant = req.headers['x-tenant-id'];
    if (headerTenant) tenantSlug = headerTenant;

    if (!tenantSlug) {
      req.tenant = null;
      return next();
    }

    const cacheKey = `tenant:${tenantSlug}`;
    let tenant = await cacheGet(cacheKey);

    if (!tenant) {
      const { rows } = await query(
        'SELECT * FROM tenants WHERE (slug = $1 OR domain = $1) AND is_active = true',
        [tenantSlug]
      );
      if (rows.length) {
        tenant = rows[0];
        await cacheSet(cacheKey, tenant, 300);
      }
    }

    req.tenant = tenant || null;
    next();
  } catch (err) {
    req.tenant = null;
    next();
  }
}

function requireTenant(req, res, next) {
  if (!req.tenant) return res.status(400).json({ error: 'Tenant context required' });
  next();
}

module.exports = { detectTenant, requireTenant };
