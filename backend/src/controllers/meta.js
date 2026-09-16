const { query } = require('../db');
const { ALLOWED_DEPARTMENTS } = require('../config/departments');
const { ALLOWED_YEARS } = require('../config/classes');

// ── GET /api/meta/options ────────────────────────────────────
// Single source of truth for every class/year picker on the site
// (Test Creator targeting, Login/CompleteProfile registration, etc.).
// Years come from the canonical config (the DB has no dedicated year
// master table — the backend already validates against 1–4); classes
// are derived from the classes table so the options always mirror what
// is actually in the database.
async function getOptions(req, res) {
  const { rows } = await query(
    `SELECT DISTINCT name FROM classes
     WHERE name IS NOT NULL AND name <> ''
     ORDER BY name`
  );

  res.json({
    years: ALLOWED_YEARS,
    classes: rows.map(r => r.name),
    departments: ALLOWED_DEPARTMENTS,
  });
}

module.exports = { getOptions };
