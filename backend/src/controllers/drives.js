const { query } = require('../db');

// A Drive is a plain grouping of existing Tests for combined analytics and
// viewing — it has no schedule, duration, passing score or status of its
// own; all of that lives on each linked Test.

async function listDrives(req, res) {
  const { rows } = await query(`
    SELECT d.*, u.name as created_by_name,
      COALESCE(dt.test_count, 0) as test_count
    FROM drives d
    LEFT JOIN users u ON d.created_by = u.id
    LEFT JOIN (
      SELECT drive_id, COUNT(*) as test_count FROM drive_tests GROUP BY drive_id
    ) dt ON dt.drive_id = d.id
    ORDER BY d.created_at DESC
  `);
  res.json({ drives: rows });
}

async function getDrive(req, res) {
  const { id } = req.params;
  const { rows: [drive] } = await query('SELECT * FROM drives WHERE id = $1', [id]);
  if (!drive) return res.status(404).json({ error: 'Drive not found' });

  const { rows: tests } = await query(
    `SELECT dt.*, t.title as test_title, t.status as test_status, t.duration_minutes,
            t.department, t.settings, t.start_time as test_start, t.end_time as test_end
     FROM drive_tests dt JOIN tests t ON dt.test_id = t.id
     WHERE dt.drive_id = $1 ORDER BY dt.round_number, dt.order_index`,
    [id]
  );
  res.json({ drive, tests });
}

// ── POST /api/drives ────────────────────────────────────────
// Create the drive and (optionally) attach a starting set of tests in one
// call — testIds: [{ testId, roundNumber?, roundType?, orderIndex? }] or
// just an array of test id strings.
async function createDrive(req, res) {
  const { title, description, testIds } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const { rows: [drive] } = await query(
    `INSERT INTO drives (title, description, created_by) VALUES ($1,$2,$3) RETURNING *`,
    [title, description || '', req.user.id]
  );

  if (Array.isArray(testIds) && testIds.length) {
    let idx = 0;
    for (const entry of testIds) {
      const testId = typeof entry === 'string' ? entry : entry.testId;
      if (!testId) continue;
      const roundNumber = typeof entry === 'object' ? (entry.roundNumber || 1) : 1;
      const roundType = typeof entry === 'object' ? (entry.roundType || 'aptitude') : 'aptitude';
      await query(
        `INSERT INTO drive_tests (drive_id, test_id, round_number, round_type, order_index)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (drive_id, test_id) DO NOTHING`,
        [drive.id, testId, roundNumber, roundType, idx++]
      );
    }
  }

  res.status(201).json({ drive });
}

// ── PUT /api/drives/:id ──────────────────────────────────────
async function updateDrive(req, res) {
  const { id } = req.params;
  const { title, description } = req.body;

  const fields = []; const params = [];
  if (title !== undefined) { params.push(title); fields.push(`title=$${params.length}`); }
  if (description !== undefined) { params.push(description); fields.push(`description=$${params.length}`); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push('updated_at=NOW()');
  params.push(id);
  const { rows: [drive] } = await query(
    `UPDATE drives SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  if (!drive) return res.status(404).json({ error: 'Drive not found' });
  res.json({ drive });
}

async function deleteDrive(req, res) {
  const { id } = req.params;
  const { rowCount } = await query('DELETE FROM drives WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Drive not found' });
  res.json({ message: 'Drive deleted' });
}

async function addTestToDrive(req, res) {
  const { id } = req.params;
  const { test_id, round_number, round_type, order_index } = req.body;
  if (!test_id) return res.status(400).json({ error: 'test_id required' });

  const { rows: [mapping] } = await query(
    `INSERT INTO drive_tests (drive_id, test_id, round_number, round_type, order_index)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (drive_id, test_id) DO NOTHING RETURNING *`,
    [id, test_id, round_number || 1, round_type || 'aptitude', order_index || 0]
  );
  if (!mapping) return res.status(400).json({ error: 'Test already added to this drive' });
  res.status(201).json({ mapping });
}

async function removeTestFromDrive(req, res) {
  const { id, testId } = req.params;
  await query('DELETE FROM drive_tests WHERE drive_id = $1 AND test_id = $2', [id, testId]);
  res.json({ message: 'Test removed from drive' });
}

// ── GET /api/drives/:id/stats ────────────────────────────────
// Combined analytics across every test in the drive — pass/fail is judged
// per submission against that submission's own test's passing score
// (tests.settings.passingScore, default 40), not a single drive-wide one.
async function getDriveStats(req, res) {
  const { id } = req.params;
  const { rows: [drive] } = await query('SELECT * FROM drives WHERE id = $1', [id]);
  if (!drive) return res.status(404).json({ error: 'Drive not found' });

  const { rows: testRows } = await query(
    'SELECT t.id, t.title, t.settings FROM drive_tests dt JOIN tests t ON dt.test_id = t.id WHERE dt.drive_id = $1',
    [id]
  );
  const passingScoreByTest = Object.fromEntries(
    testRows.map(t => [t.id, Number(t.settings?.passingScore ?? 40)])
  );
  const testIds = testRows.map(t => t.id);
  let stats = { total_submissions: 0, total_students: 0, passed: 0, avg_score: 0, test_breakdown: [] };

  if (testIds.length > 0) {
    const { rows: submissions } = await query(
      `SELECT s.score, s.max_score, s.status, s.test_id, u.name as user_name, u.email
       FROM submissions s JOIN users u ON s.user_id = u.id
       WHERE s.test_id = ANY($1::uuid[]) AND s.status = 'submitted'`,
      [testIds]
    );
    stats.total_submissions = submissions.length;
    const uniqueStudents = new Set(submissions.map(s => s.email));
    stats.total_students = uniqueStudents.size;
    const scored = submissions.filter(s => s.max_score > 0);
    stats.avg_score = scored.length ? Math.round(scored.reduce((a, s) => a + (s.score / s.max_score) * 100, 0) / scored.length) : 0;
    stats.passed = scored.filter(s => (s.score / s.max_score) * 100 >= (passingScoreByTest[s.test_id] ?? 40)).length;

    stats.test_breakdown = testRows.map(t => {
      const tSubs = submissions.filter(s => s.test_id === t.id);
      const tScored = tSubs.filter(s => s.max_score > 0);
      return {
        test_id: t.id,
        test_title: t.title,
        submissions: tSubs.length,
        avg_score: tScored.length ? Math.round(tScored.reduce((a, s) => a + (s.score / s.max_score) * 100, 0) / tScored.length) : 0,
        passed: tScored.filter(s => (s.score / s.max_score) * 100 >= passingScoreByTest[t.id]).length,
      };
    });
  }
  res.json({ stats });
}

module.exports = { listDrives, getDrive, createDrive, updateDrive, deleteDrive, addTestToDrive, removeTestFromDrive, getDriveStats };
