const { query } = require('../db');

async function getPerformanceHistory(req, res) {
  const userId = req.user.id;

  const { rows: scoreHistory } = await query(
    `SELECT s.id, s.score, s.max_score, s.submitted_at, t.title as test_title
     FROM submissions s JOIN tests t ON s.test_id = t.id
     WHERE s.user_id=$1 AND s.status IN ('submitted','auto_submitted')
     ORDER BY s.submitted_at ASC`,
    [userId]
  );

  const history = scoreHistory.map(s => ({
    date: s.submitted_at,
    score: parseFloat(s.score) || 0,
    maxScore: parseFloat(s.max_score) || 0,
    percentage: s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0,
    testTitle: s.test_title,
  }));

  const { rows: genreAccuracy } = await query(
    `SELECT q.genre,
       COUNT(q.id) as total,
       SUM(CASE WHEN (sub.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1 ELSE 0 END) as correct
     FROM submissions sub
     JOIN sections sec ON sub.test_id IN (SELECT test_id FROM sections WHERE id IN (SELECT section_id FROM questions WHERE id IN (SELECT UNNEST(ARRAY(SELECT jsonb_object_keys(sub.answers)::uuid)))))
     JOIN questions q ON q.section_id = sec.id
     WHERE sub.user_id=$1 AND sub.status='submitted'
     GROUP BY q.genre`,
    [userId]
  );

  const genres = genreAccuracy.map(g => ({
    genre: g.genre,
    total: parseInt(g.total) || 0,
    correct: parseInt(g.correct) || 0,
    accuracy: g.total > 0 ? Math.round((parseInt(g.correct) / parseInt(g.total)) * 100) : 0,
  }));

  const { rows: [last5] } = await query(
    `SELECT AVG(score) as avg_score, AVG(max_score) as avg_max, AVG(score::float/NULLIF(max_score,0)*100) as avg_pct
     FROM submissions WHERE user_id=$1 AND status IN ('submitted','auto_submitted')
     ORDER BY submitted_at DESC NULLS LAST LIMIT 5`,
    [userId]
  );

  const { rows: [prev5] } = await query(
    `SELECT AVG(score) as avg_score, AVG(max_score) as avg_max, AVG(score::float/NULLIF(max_score,0)*100) as avg_pct
     FROM submissions WHERE user_id=$1 AND status IN ('submitted','auto_submitted')
     ORDER BY submitted_at DESC NULLS LAST OFFSET 5 LIMIT 5`,
    [userId]
  );

  const improvement = {
    last5: last5?.avg_pct ? Math.round(parseFloat(last5.avg_pct)) : 0,
    previous5: prev5?.avg_pct ? Math.round(parseFloat(prev5.avg_pct)) : 0,
    change: last5?.avg_pct && prev5?.avg_pct ? Math.round(parseFloat(last5.avg_pct) - parseFloat(prev5.avg_pct)) : 0,
  };

  const { rows: monthOverMonth } = await query(
    `SELECT
       DATE_TRUNC('month', submitted_at) as month,
       COUNT(*) as test_count,
       AVG(score::float/NULLIF(max_score,0)*100) as avg_pct
     FROM submissions
     WHERE user_id=$1 AND status IN ('submitted','auto_submitted')
     GROUP BY DATE_TRUNC('month', submitted_at)
     ORDER BY month`,
    [userId]
  );

  res.json({
    history,
    genreAccuracy: genres,
    improvement,
    monthOverMonth: monthOverMonth.map(m => ({
      month: m.month,
      testCount: parseInt(m.test_count) || 0,
      avgPercentage: m.avg_pct ? Math.round(parseFloat(m.avg_pct)) : 0,
    })),
  });
}

module.exports = { getPerformanceHistory };