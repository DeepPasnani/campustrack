const { query } = require('../db');

const EMAIL_TYPES = ['test_reminder', 'result_announcement', 'weekly_digest'];

// Fetch every suppression rule for one automated email type, bucketed by
// scope so the scheduler can filter a whole recipient list in memory
// instead of a DB round trip per student.
async function getSuppressionSet(emailType) {
  const { rows } = await query(
    'SELECT scope_type, scope_value FROM email_suppression_rules WHERE email_type=$1',
    [emailType]
  );

  const set = { global: false, departments: new Set(), classes: new Set(), years: new Set(), students: new Set() };
  for (const r of rows) {
    if (r.scope_type === 'global') set.global = true;
    else if (r.scope_type === 'department') set.departments.add(r.scope_value);
    else if (r.scope_type === 'class') set.classes.add(r.scope_value);
    else if (r.scope_type === 'year_of_study') set.years.add(r.scope_value);
    else if (r.scope_type === 'student') set.students.add(r.scope_value);
  }
  return set;
}

// student needs at least { id, department, class_name, year_of_study }.
function isSuppressed(set, student) {
  if (set.global) return true;
  if (student.department && set.departments.has(student.department)) return true;
  if (student.class_name && set.classes.has(student.class_name)) return true;
  if (student.year_of_study != null && set.years.has(String(student.year_of_study))) return true;
  if (student.id && set.students.has(student.id)) return true;
  return false;
}

module.exports = { EMAIL_TYPES, getSuppressionSet, isSuppressed };
