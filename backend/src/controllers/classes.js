const { query } = require('../db');
const { cacheDelPattern } = require('../db/redis');
const { ALLOWED_CLASSES, ALLOWED_YEARS, isAllowedClass, isAllowedYear } = require('../config/classes');

// ── GET /api/classes ─────────────────────────────────────────
async function listClasses(req, res) {
  const { rows } = await query(
    'SELECT * FROM classes ORDER BY department, name'
  );
  res.json({ classes: rows });
}

// ── POST /api/classes ────────────────────────────────────────
async function createClass(req, res) {
  const { name, department, yearOfStudy } = req.body;
  if (!name || !department) {
    return res.status(400).json({ error: 'Name and department required' });
  }
  if (!isAllowedClass(name)) {
    return res.status(400).json({
      error: `Only these class clusters are allowed: ${ALLOWED_CLASSES.join(', ')}`,
    });
  }
  if (yearOfStudy !== undefined && yearOfStudy !== null && !isAllowedYear(yearOfStudy)) {
    return res.status(400).json({
      error: `Year of study must be ${ALLOWED_YEARS.join('–')}`,
    });
  }

  const { rows: [cls] } = await query(
    `INSERT INTO classes (name, department, year_of_study)
     VALUES ($1,$2,$3) ON CONFLICT (name, department) DO UPDATE SET
       year_of_study = EXCLUDED.year_of_study
     RETURNING *`,
    [name.trim(), department, yearOfStudy || 1]
  );

  res.status(201).json({ class: cls });
}

// ── DELETE /api/classes/:id ──────────────────────────────────
async function deleteClass(req, res) {
  const { id } = req.params;
  await query('DELETE FROM classes WHERE id = $1', [id]);
  res.json({ message: 'Class deleted' });
}

// ── POST /api/classes/assign ─────────────────────────────────
async function assignClass(req, res) {
  const { userId, classId, yearOfStudy, semester } = req.body;
  if (!userId || !classId) {
    return res.status(400).json({ error: 'userId and classId required' });
  }

  // Also update user's class/year for simpler queries
  await query(
    `UPDATE users SET class_name = (SELECT name FROM classes WHERE id = $2), year_of_study = $3 WHERE id = $1`,
    [userId, classId, yearOfStudy || 1]
  );

  const { rows: [assignment] } = await query(
    `INSERT INTO student_classes (user_id, class_id, year_of_study, semester)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, semester) DO UPDATE SET
       class_id = EXCLUDED.class_id, year_of_study = EXCLUDED.year_of_study
     RETURNING *`,
    [userId, classId, yearOfStudy || 1, semester || '2026-Spring']
  );

  res.json({ assignment });
}

// ── POST /api/tests/:id/classes ──────────────────────────────
async function mapTestClasses(req, res) {
  const { id: testId } = req.params;
  const { classIds, sectionMapping } = req.body;

  if (!Array.isArray(classIds)) {
    return res.status(400).json({ error: 'classIds array required' });
  }

  // Remove existing mappings
  await query('DELETE FROM test_classes WHERE test_id = $1', [testId]);

  // Insert new mappings
  for (const classId of classIds) {
    const mapping = sectionMapping?.[classId] || {};
    await query(
      'INSERT INTO test_classes (test_id, class_id, section_mapping) VALUES ($1,$2,$3)',
      [testId, classId, JSON.stringify(mapping)]
    );
  }

  await cacheDelPattern(`test:${testId}:full:`);
  res.json({ message: `Mapped ${classIds.length} class(es) to test` });
}


// ── GET /api/tests/:id/classes ───────────────────────────────
async function getTestClasses(req, res) {
  const { id: testId } = req.params;

  const { rows } = await query(
    `SELECT tc.*, c.name as class_name, c.department
     FROM test_classes tc
     JOIN classes c ON tc.class_id = c.id
     WHERE tc.test_id = $1
     ORDER BY c.name`,
    [testId]
  );

  res.json({ classes: rows });
}

module.exports = { listClasses, createClass, deleteClass, assignClass, mapTestClasses, getTestClasses };
