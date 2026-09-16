const { query } = require('../db');
const logger = require('../services/logger');
const { resultsVisibleToStudent } = require('../services/resultsVisibility');

const ADMIN_ROLES = ['admin', 'super_admin'];

function isAdmin(user) {
  return ADMIN_ROLES.includes(user?.role);
}

// Students are always locked to their own department (branch) + year of study
// so the board never leaks peers from other departments/years. Admins keep the
// full board. Adds hard WHERE filters (and matching params) for students.
function addScopeFilters(params, filters, user) {
  if (isAdmin(user)) return filters;
  if (user?.branch) { params.push(user.branch); filters.push(`u.branch = $${params.length}`); }
  if (user?.year_of_study) { params.push(user.year_of_study); filters.push(`u.year_of_study = $${params.length}`); }
  return filters;
}

// ── GET /api/gamification/leaderboard
// Ranks students by the total marks they scored in ONE test (submissions.score),
// so every student sees the exact same board for a given test. The previous
// implementation ranked by cumulative XP and allowed ties to reorder between
// page loads, which made the board look different for every student.
async function getLeaderboard(req, res) {
  try {
    const { testId, class: studentClass, branch } = req.query;
    const params = [];
    const filters = [];

    // Students: own department + year only.
    addScopeFilters(params, filters, req.user);

    // No explicit test → fall back to the most recently ended published test
    // that has submissions within the requester's scope (keeps the dashboard
    // rank card working without leaking other departments/years).
    let activeTestId = testId;
    if (!activeTestId) {
      const fbParams = ['submitted', 'auto_submitted'];
      const fbFilters = [`s.status IN ($1, $2)`];
      addScopeFilters(fbParams, fbFilters, req.user);
      const { rows } = await query(`
        SELECT s.test_id
        FROM submissions s
        JOIN users u ON u.id = s.user_id
        JOIN tests t ON t.id = s.test_id
        WHERE ${fbFilters.join(' AND ')}
        ORDER BY t.end_time DESC NULLS LAST, t.created_at DESC
        LIMIT 1
      `, fbParams);
      activeTestId = rows[0]?.test_id;
    }
    if (!activeTestId) {
      return res.json({ leaderboard: [], myRank: null, test: null, maxScore: null });
    }

    // Scores are only ready to show once the test's own release setting
    // clears them — same rule submissions.js applies to a single result, so
    // the leaderboard can't be used as a side door to see scores early.
    const { rows: [releaseInfo] } = await query(
      'SELECT settings, end_time, results_published_at FROM tests WHERE id=$1',
      [activeTestId]
    );
    if (!isAdmin(req.user) && (!releaseInfo || !resultsVisibleToStudent(releaseInfo))) {
      const { rows: [testMeta] } = await query('SELECT id, title, end_time FROM tests WHERE id = $1', [activeTestId]);
      return res.json({ leaderboard: [], myRank: null, test: testMeta || null, maxScore: null, resultsAvailable: false });
    }

    params.push(activeTestId, 'submitted', 'auto_submitted');
    filters.push(
      `s.test_id = $${params.length - 2}`,
      `s.status IN ($${params.length - 1}, $${params.length})`
    );

    // Students may narrow to a class within their own department + year. The
    // branch/year filters above are always enforced, so this can never leak
    // peers from other departments or years.
    if (studentClass) { params.push(studentClass); filters.push(`u.class_name = $${params.length}`); }
    // Only admins may additionally switch branch.
    if (isAdmin(req.user) && branch) { params.push(branch); filters.push(`u.branch = $${params.length}`); }

    // Deterministic ordering (score, then earlier submission, then name) so
    // ties are broken identically for every viewer.
    const { rows: leaderboard } = await query(`
      SELECT
        u.id,
        u.id as user_id,
        u.name, u.avatar_url, u.branch, u.class_name, u.roll_number,
        s.score as score,
        s.max_score as max_score,
        ROW_NUMBER() OVER (
          ORDER BY s.score DESC, s.submitted_at ASC, u.name ASC, u.id ASC
        ) as rank
      FROM submissions s
      JOIN users u ON u.id = s.user_id
      WHERE ${filters.join(' AND ')}
      ORDER BY s.score DESC, s.submitted_at ASC, u.name ASC, u.id ASC
    `, params);

    const myRank = leaderboard.findIndex(r => r.id === req.user.id) + 1;

    const { rows: [testInfo] } = await query(
      `SELECT id, title, end_time FROM tests WHERE id = $1`,
      [activeTestId]
    );

    res.json({
      leaderboard,
      myRank: myRank || null,
      test: testInfo || null,
      maxScore: leaderboard.length ? leaderboard[0].max_score : null,
    });
  } catch (err) {
    logger.error({ err }, 'getLeaderboard error');
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
}

// ── GET /api/gamification/leaderboard-tests
// Lists the tests (with at least one submitted paper) that a leaderboard can
// be shown for, most recent first, so students can switch between tests.
// Students only see tests where their own department + year has results.
async function listLeaderboardTests(req, res) {
  try {
    const { class: studentClass } = req.query;
    const params = ['submitted', 'auto_submitted'];
    const filters = [`s.status IN ($1, $2)`];

    addScopeFilters(params, filters, req.user);

    if (studentClass) { params.push(studentClass); filters.push(`u.class_name = $${params.length}`); }

    const { rows } = await query(`
      SELECT DISTINCT t.id, t.title, t.end_time
      FROM submissions s
      JOIN tests t ON t.id = s.test_id
      JOIN users u ON u.id = s.user_id
      WHERE ${filters.join(' AND ')}
      ORDER BY t.end_time DESC NULLS LAST, t.title ASC
    `, params);

    res.json({ tests: rows });
  } catch (err) {
    logger.error({ err }, 'listLeaderboardTests error');
    res.status(500).json({ error: 'Failed to list leaderboard tests' });
  }
}

module.exports = {
  getLeaderboard,
  listLeaderboardTests,
};
