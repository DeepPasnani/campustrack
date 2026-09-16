const { query } = require('../db');
const logger = require('../services/logger');

// ── 2. Student Growth Trajectories ────────────────────────────

async function getStudentGrowth(req, res) {
  const { userId } = req.params;

  const { rows: tests } = await query(`
    SELECT s.id as submission_id, s.score, s.max_score, s.submitted_at, s.status,
           t.id as test_id, t.title as test_title
    FROM submissions s
    JOIN tests t ON s.test_id = t.id
    WHERE s.user_id=$1 AND s.status IN ('submitted', 'auto_submitted')
    ORDER BY s.submitted_at ASC
  `, [userId]);

  if (tests.length === 0) {
    return res.json({ trend: [], genreMastery: [], percentileHistory: [] });
  }

  const trendData = tests.map((t, i) => ({
    submission_id: t.submission_id,
    test_id: t.test_id,
    test_title: t.test_title,
    submitted_at: t.submitted_at,
    score: t.score,
    max_score: t.max_score,
    percentage: t.max_score > 0 ? Math.round((t.score / t.max_score) * 100) : 0,
    rank: null,
  }));

  const { rows: allSubsForPercentile } = await query(`
    SELECT s.user_id, s.test_id, s.score, s.max_score, s.submitted_at,
           ROW_NUMBER() OVER (PARTITION BY s.test_id ORDER BY (s.score / NULLIF(s.max_score, 0)) DESC) as student_rank,
           COUNT(*) OVER (PARTITION BY s.test_id) as total_students
    FROM submissions s
    WHERE s.test_id = ANY($1::uuid[]) AND s.status IN ('submitted', 'auto_submitted') AND s.max_score > 0
  `, [tests.map(t => t.test_id)]);

  const percentileHistory = allSubsForPercentile
    .filter(s => s.user_id === userId)
    .map(s => ({
      test_id: s.test_id,
      rank: parseInt(s.student_rank),
      total: parseInt(s.total_students),
      percentile: Math.round(((parseInt(s.total_students) - parseInt(s.student_rank)) / parseInt(s.total_students)) * 100),
      score: s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0,
    }));

  const improvementRate = trendData.length >= 2
    ? Math.round((trendData[trendData.length - 1].percentage - trendData[0].percentage) / trendData.length)
    : 0;

  const { rows: genreOverTime } = await query(`
    SELECT s.submitted_at::date as date, q.genre,
           AVG(CASE WHEN (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1.0 ELSE 0.0 END) as accuracy
    FROM submissions s
    JOIN tests t ON s.test_id = t.id
    JOIN sections sec ON sec.test_id = t.id
    JOIN questions q ON q.section_id = sec.id
    WHERE s.user_id=$1 AND s.status IN ('submitted', 'auto_submitted')
    GROUP BY date, q.genre
    ORDER BY date, q.genre
  `, [userId]);

  const genres = [...new Set(genreOverTime.map(g => g.genre))];
  const masteryCurves = genres.map(genre => ({
    genre,
    data: genreOverTime.filter(g => g.genre === genre).map(g => ({
      date: g.date,
      accuracy: Math.round(parseFloat(g.accuracy || 0) * 100),
    })),
  }));

  res.json({
    trend: trendData,
    percentileHistory,
    genreMastery: masteryCurves,
    improvementRate,
  });
}

// ── 6. Custom Report Builder ──────────────────────────────────

async function reportBuilder(req, res) {
  const { metrics, filters, dateRange, groupBy } = req.body;

  let conditions = ["s.status='submitted'"];
  const params = [];

  if (filters) {
    if (filters.class_id) { params.push(filters.class_id); conditions.push(`c.id=$${params.length}`); }
    if (filters.department) { params.push(filters.department); conditions.push(`u.department=$${params.length}`); }
    if (filters.year_of_study) { params.push(parseInt(filters.year_of_study)); conditions.push(`COALESCE(s.year_snapshot, u.year_of_study)=$${params.length}`); }
    if (filters.test_id) { params.push(filters.test_id); conditions.push(`s.test_id=$${params.length}`); }
    if (filters.min_score) { params.push(parseFloat(filters.min_score)); conditions.push(`s.score >= $${params.length}`); }
    if (filters.max_score) { params.push(parseFloat(filters.max_score)); conditions.push(`s.score <= $${params.length}`); }
  }

  if (dateRange) {
    if (dateRange.start) { params.push(dateRange.start); conditions.push(`s.submitted_at >= $${params.length}`); }
    if (dateRange.end) { params.push(dateRange.end); conditions.push(`s.submitted_at <= $${params.length}`); }
  }

  const where = conditions.join(' AND ');

  const groupColumn = groupBy === 'class' ? "COALESCE(s.class_snapshot, u.class_name)"
    : groupBy === 'department' ? "u.department"
    : groupBy === 'year' ? "COALESCE(s.year_snapshot::text, u.year_of_study::text)"
    : "'Overall'";

  const selects = [`${groupColumn} as group_label`];
  const having = [];

  if (!metrics || metrics.includes('avg_score')) selects.push("AVG(s.score) as avg_score");
  if (!metrics || metrics.includes('avg_percentage')) selects.push("AVG((s.score / NULLIF(s.max_score, 0)) * 100) as avg_percentage");
  if (!metrics || metrics.includes('completion_rate')) selects.push("COUNT(*) as total_submissions");
  if (!metrics || metrics.includes('coding_score')) selects.push("AVG((s.code_results->>'earned')::numeric) as avg_coding_score");
  if (!metrics || metrics.includes('genre_accuracy')) {
    const { rows: genreRows } = await query(`
      SELECT ${groupColumn} as group_label, q.genre,
        AVG(CASE WHEN (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1.0 ELSE 0.0 END) as accuracy
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      JOIN tests t ON s.test_id = t.id
      JOIN sections sec ON sec.test_id = t.id
      JOIN questions q ON q.section_id = sec.id
      LEFT JOIN student_classes sc ON sc.user_id = u.id
      LEFT JOIN classes c ON c.id = sc.class_id
      WHERE ${where}
      GROUP BY group_label, q.genre
      ORDER BY group_label, q.genre
    `, params);
    return res.json({ type: 'genre_accuracy', data: genreRows, groupBy });
  }

  const finalSelects = selects.join(', ');
  const groupClause = groupBy ? `GROUP BY group_label` : '';

  const { rows: data } = await query(`
    SELECT ${finalSelects}
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    JOIN tests t ON s.test_id = t.id
    LEFT JOIN student_classes sc ON sc.user_id = u.id
    LEFT JOIN classes c ON c.id = sc.class_id
    WHERE ${where}
    ${groupClause}
    ORDER BY group_label
  `, params);

  const resultData = data.map(d => ({
    ...d,
    avg_percentage: d.avg_percentage ? Math.round(parseFloat(d.avg_percentage)) : null,
    avg_score: d.avg_score ? Math.round(parseFloat(d.avg_score) * 100) / 100 : null,
  }));

  res.json({ type: 'tabular', data: resultData, metrics, groupBy });
}

// ── Threshold Alerts ──────────────────────────────────────────

async function createThresholdAlert(req, res) {
  const { name, student_id, threshold_pct, email_recipients, enabled } = req.body;
  if (!name || !student_id || threshold_pct === undefined) {
    return res.status(400).json({ error: 'name, student_id and threshold_pct required' });
  }

  const { rows: [alert] } = await query(`
    INSERT INTO threshold_alerts (name, student_id, threshold_pct, email_recipients, enabled, created_by)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [name, student_id, threshold_pct, JSON.stringify(email_recipients || []), enabled !== false, req.user.id]);

  res.status(201).json({ alert });
}

async function listThresholdAlerts(req, res) {
  const { rows } = await query(`
    SELECT ta.*, u.name as student_name, u.email as student_email, u.roll_number
    FROM threshold_alerts ta
    JOIN users u ON u.id = ta.student_id
    ORDER BY ta.created_at DESC
  `);
  res.json({ alerts: rows });
}

async function updateThresholdAlert(req, res) {
  const { id } = req.params;
  const { name, threshold_pct, email_recipients, enabled } = req.body;

  const fields = [];
  const params = [];
  if (name !== undefined) { params.push(name); fields.push(`name=$${params.length}`); }
  if (threshold_pct !== undefined) { params.push(threshold_pct); fields.push(`threshold_pct=$${params.length}`); }
  if (email_recipients !== undefined) { params.push(JSON.stringify(email_recipients)); fields.push(`email_recipients=$${params.length}`); }
  if (enabled !== undefined) { params.push(enabled); fields.push(`enabled=$${params.length}`); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  const { rows: [alert] } = await query(
    `UPDATE threshold_alerts SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
    params
  );

  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  res.json({ alert });
}

async function deleteThresholdAlert(req, res) {
  const { id } = req.params;
  const { rowCount } = await query('DELETE FROM threshold_alerts WHERE id=$1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Alert not found' });
  res.json({ message: 'Alert deleted' });
}

// ── 8. Natural Language Insight Summaries ─────────────────────

async function getNLSummary(req, res) {
  const { testId } = req.params;

  const { rows: [test] } = await query('SELECT * FROM tests WHERE id=$1', [testId]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const { rows: submissions } = await query(`
    SELECT s.*, u.name as user_name
    FROM submissions s JOIN users u ON s.user_id = u.id
    WHERE s.test_id=$1 AND s.status IN ('submitted', 'auto_submitted')
    ORDER BY s.score DESC
  `, [testId]);

  if (submissions.length === 0) {
    return res.json({
      summary_paragraph: `No submissions yet for "${test.title}".`,
      highlights: [],
      improvements: [],
      comparisons: {},
    });
  }

  const scored = submissions.filter(s => s.max_score > 0);
  const avgPct = scored.length
    ? Math.round(scored.reduce((a, s) => a + (s.score / s.max_score) * 100, 0) / scored.length)
    : 0;
  const passed = scored.filter(s => (s.score / s.max_score) * 100 >= (test.settings?.passingScore ?? 40)).length;
  const passRate = scored.length ? Math.round((passed / scored.length) * 100) : 0;

  const topPerformer = scored[0];
  const topPct = topPerformer ? Math.round((topPerformer.score / topPerformer.max_score) * 100) : 0;
  const bottomPerformer = scored[scored.length - 1];
  const bottomPct = bottomPerformer ? Math.round((bottomPerformer.score / bottomPerformer.max_score) * 100) : 0;

  const { rows: genreData } = await query(`
    SELECT q.genre,
      AVG(CASE WHEN (s.answers->>q.id::text)::text = (q.correct_answer#>>'{}') THEN 1.0 ELSE 0.0 END) as accuracy
    FROM submissions s
    JOIN sections sec ON sec.test_id = $1
    JOIN questions q ON q.section_id = sec.id
    WHERE s.test_id=$1 AND s.status='submitted'
    GROUP BY q.genre
    ORDER BY accuracy DESC
  `, [testId]);

  const bestGenre = genreData[0];
  const worstGenre = genreData[genreData.length - 1];

  const { rows: prevTest } = await query(`
    SELECT AVG((s.score / NULLIF(s.max_score, 0)) * 100) as prev_avg
    FROM submissions s
    WHERE s.test_id IN (SELECT id FROM tests WHERE department=$1 AND id != $2 AND status='published' LIMIT 1)
      AND s.status='submitted'
  `, [test.department, testId]);

  const comparisonData = {};
  if (prevTest[0]?.prev_avg) {
    const prevAvg = parseFloat(prevTest[0].prev_avg);
    comparisonData.previous_test_avg = Math.round(prevAvg);
    comparisonData.change = avgPct - Math.round(prevAvg);
    comparisonData.change_direction = comparisonData.change >= 0 ? 'higher' : 'lower';
  }

  let summary = `The average score for "${test.title}" was ${avgPct}%, with a pass rate of ${passRate}%. `;
  summary += `${scored.length} students submitted the test. `;
  summary += `${topPerformer.user_name} scored the highest at ${topPct}%. `;

  if (bestGenre) {
    summary += `Students performed best in ${bestGenre.genre} (${Math.round(parseFloat(bestGenre.accuracy) * 100)}% accuracy) `;
  }
  if (worstGenre && worstGenre.genre !== bestGenre.genre) {
    summary += `and struggled most with ${worstGenre.genre} (${Math.round(parseFloat(worstGenre.accuracy) * 100)}% accuracy).`;
  }

  if (comparisonData.change !== undefined) {
    summary += ` Compared to the previous test, this class scored ${comparisonData.change_direction} by ${Math.abs(comparisonData.change)} percentage points.`;
  }

  const highlights = [
    `${scored.length} students completed the test`,
    `Top score: ${topPct}% by ${topPerformer.user_name}`,
    `Pass rate: ${passRate}%`,
    comparisonData.change !== undefined
      ? comparisonData.change >= 0 ? `Score improved by ${comparisonData.change}% over previous test` : `Score dropped by ${Math.abs(comparisonData.change)}% from previous test`
      : null,
  ].filter(Boolean);

  const improvements = genreData
    .filter(g => parseFloat(g.accuracy || 0) < 0.5)
    .map(g => `${g.genre} (${Math.round(parseFloat(g.accuracy) * 100)}% accuracy)`);

  if (improvements.length === 0) {
    improvements.push('Maintain current performance across all genres');
  }

  res.json({
    summary_paragraph: summary,
    highlights,
    improvements: improvements.length > 0 ? improvements : ['No significant improvement areas identified'],
    comparisons: comparisonData,
    stats: { avg_percentage: avgPct, pass_rate: passRate, total_submissions: scored.length, top_score: topPct },
  });
}

module.exports = {
  getStudentGrowth,
  reportBuilder,
  createThresholdAlert, listThresholdAlerts, updateThresholdAlert, deleteThresholdAlert,
  getNLSummary,
};
