/* ═══════════════════════════════════════════════════════════
 * Admin Dashboard — Operational overview with performance analytics
 *
 * Genre-wise MCQ accuracy, difficulty breakdown, coding performance.
 * Designed as a decision-making tool for T&P faculty.
 * ═══════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { usersAPI, testsAPI, submissionsAPI } from '../../services/api';
import { Badge, Spinner } from '../../components/shared/UI';
import { ALLOWED_DEPARTMENTS as DEPT_ORDER } from '../../lib/departments';
import { formatDistanceToNow } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const GENRE_ORDER = [
  'quantitative',
  'aptitude',
  'technical',
  'verbal',
  'logical',
  'data_interpretation',
  'general',
];

export default function AdminDashboard() {
  const [selectedTest, setSelectedTest] = useState('all');
  const [dateRange, setDateRange] = useState('30');

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats', dateRange],
    queryFn: () => usersAPI.stats(),
    refetchInterval: 60000,
  });
  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data: testSubsData } = useQuery({
    queryKey: ['dashboard-submissions', selectedTest],
    queryFn: () => submissionsAPI.getForTest(selectedTest),
    enabled: selectedTest !== 'all' && !!selectedTest,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  const s = stats || {};
  const tests = testsData?.tests || [];
  const recentTests = tests.slice(0, 5) || [];

  // ── Compute score distribution ──────────────────────────
  // When one specific test is selected, judge pass/fail against that
  // test's own passing score; the generic 40% only stands in for the
  // "all tests" aggregate, where submissions span many different tests
  // that may each have a different threshold.
  const selectedTestObj = selectedTest !== 'all' ? tests.find(t => t.id === selectedTest) : null;
  const passingScore = selectedTestObj ? (selectedTestObj.settings?.passingScore ?? 40) : 40;
  const allSubs = testSubsData?.submissions || s.recentSubmissions || [];
  const scoredSubs = (selectedTest !== 'all' ? allSubs : (s.recentSubmissions || [])).filter(
    sb => sb.status === 'submitted' && sb.max_score > 0
  );
  const distBuckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const distData = distBuckets.slice(0, -1).map((b, i) => ({
    range: `${b}-${distBuckets[i + 1]}`,
    count: scoredSubs.filter(sb => {
      const p = sb.max_score > 0 ? (sb.score / sb.max_score) * 100 : 0;
      return p >= b && p < distBuckets[i + 1];
    }).length,
    passing: b >= passingScore,
  }));

  // ── Cluster breakdown: department → year → class ──────────
  const deptOrder = DEPT_ORDER;
  const clusterMap = {};
  scoredSubs.forEach(sb => {
    const dept  = sb.user_department || sb.department || 'Unknown';
    const year  = sb.year_display ?? sb.user_year ?? 'Any';
    const className = sb.class_display || sb.user_class || 'Unknown';
    if (!clusterMap[dept]) clusterMap[dept] = {};
    if (!clusterMap[dept][year]) clusterMap[dept][year] = {};
    if (!clusterMap[dept][year][className]) clusterMap[dept][year][className] = { count: 0, totalPct: 0, passCount: 0 };
    const d = clusterMap[dept][year][className];
    d.count++;
    const pct = sb.max_score > 0 ? (sb.score / sb.max_score) * 100 : 0;
    d.totalPct += pct;
    if (pct >= passingScore) d.passCount++;
  });
  const clusterData = Object.entries(clusterMap)
    .sort((a, b) => {
      const ai = deptOrder.indexOf(a[0]);
      const bi = deptOrder.indexOf(b[0]);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([department, years]) => ({
      department,
      years: Object.entries(years)
        .sort((a, b) => (Number(a[0]) || 0) - (Number(b[0]) || 0))
        .map(([year, classes]) => ({
          year,
          classes: Object.entries(classes)
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
            .map(([className, d]) => ({
              className,
              count: d.count,
              avg: Math.round(d.totalPct / d.count),
              passRate: Math.round((d.passCount / d.count) * 100),
            })),
        })),
    }));

  const GENRE_SHORT_NAMES = {
    quantitative: 'Quant',
    aptitude: 'Aptitude',
    technical: 'Technical',
    verbal: 'Verbal',
    logical: 'Logical',
    data_interpretation: 'Data Interp',
    general: 'General',
  };

  const genreData = (s.genreStats || []).map(g => {
    const fullName = g.genre.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return {
      fullName,
      name: GENRE_SHORT_NAMES[g.genre] || (fullName.length > 12 ? fullName.substring(0, 10) + '…' : fullName),
      accuracy: Math.round((g.accuracy || 0) * 100),
      total: parseInt(g.total_questions) || 0,
      genre: g.genre,
    };
  });

  const diffData = (s.diffStats || []).map(d => ({
    name: d.difficulty.charAt(0).toUpperCase() + d.difficulty.slice(1),
    accuracy: Math.round((d.accuracy || 0) * 100),
    total: parseInt(d.total_questions) || 0,
    difficulty: d.difficulty,
  }));

  const codingData = (s.codingStats || []).map(c => ({
    name: c.difficulty.charAt(0).toUpperCase() + c.difficulty.slice(1),
    score: Math.round((c.avg_score_rate || 0) * 100),
    difficulty: c.difficulty,
  }));

  const testsBreakdown = {
    total: tests.length,
    published: tests.filter(t => t.status === 'published').length,
  };

  return (
    <div className="animate-fade-up space-y-5">
      {/* Header */}
      <div className="section-header">
        <div>
          <h1 className="text-display">Dashboard</h1>
          <p className="section-subtitle">Placement platform overview</p>
        </div>
        <Link to="/admin/tests/new" className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Test
        </Link>
      </div>

      {/* Filters */}
      <div className="panel p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Test</label>
          <select value={selectedTest} onChange={e => setSelectedTest(e.target.value)} className="select-field max-w-xs">
            <option value="all">All tests (aggregate)</option>
            {tests.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Period</label>
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="select-field max-w-xxs">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">All time</option>
          </select>
        </div>
      </div>

      {/* Stat cards (neutral, one accent max) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Tests" value={testsBreakdown.total} sub={`${testsBreakdown.published} published`} highlight />
        <StatBox label="Students" value={s.students || 0} sub="registered" />
        <StatBox label="Active (7d)" value={s.active_this_week || 0} sub="recent logins" />
        <StatBox label="Avg Score" value={`${scoredSubs.length ? Math.round(scoredSubs.reduce((a, sb) => a + (sb.max_score > 0 ? (sb.score/sb.max_score)*100 : 0), 0) / scoredSubs.length) : 0}%`} sub="selected test(s)" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Genre-wise MCQ Accuracy */}
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Genre-wise MCQ Accuracy</h3>
          {genreData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={genreData} margin={{ top: 10, right: 10, bottom: 25, left: -16 }}>
                <XAxis
                  dataKey="name"
                  interval={0}
                  tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }}
                  angle={-25}
                  textAnchor="end"
                  height={45}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Accuracy']}
                  labelFormatter={(label, items) => items?.[0]?.payload?.fullName || label}
                  contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', color: 'var(--ct-ink)', fontSize: '12px' }}
                />
                <Bar dataKey="accuracy" radius={[3, 3, 0, 0]} fill="var(--ct-accent)" >
                  {genreData.map((g, i) => (
                    <Cell key={i} fill="var(--ct-accent)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-annotation text-xs">
              No MCQ submissions yet. Genre insights appear once students complete tests.
            </div>
          )}
        </div>

        {/* Difficulty-wise Performance */}
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Difficulty-wise Performance</h3>
          {diffData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={diffData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Accuracy']}
                  contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', color: 'var(--ct-ink)', fontSize: '12px' }}
                />
                <Bar dataKey="accuracy" radius={[3, 3, 0, 0]} fill="var(--ct-verify)" >
                  {diffData.map((d, i) => (
                    <Cell key={i} fill="var(--ct-verify)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-annotation text-xs">
              No data yet. Performance breakdown appears after submissions.
            </div>
          )}
        </div>
      </div>

      {/* Coding Performance */}
      {codingData.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Coding Problem Performance (avg score rate)</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={codingData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
              <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
              <Tooltip
                formatter={(v) => [`${v}%`, 'Avg Score Rate']}
                contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', color: 'var(--ct-ink)', fontSize: '12px' }}
              />
              <Bar dataKey="score" radius={[3, 3, 0, 0]} fill="var(--ct-clarify)" >
                {codingData.map((c, i) => (
                  <Cell key={i} fill="var(--ct-clarify)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Score Distribution */}
      {scoredSubs.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Score Distribution {selectedTest !== 'all' ? '(selected test)' : '(recent)'}</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={distData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
              <XAxis dataKey="range" interval={0} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} allowDecimals={false} />
              <Tooltip formatter={v => [`${v} students`]} contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', color: 'var(--ct-ink)', fontSize: '12px' }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {distData.map((d, i) => (
                  <Cell key={i} fill={d.passing ? 'var(--ct-verify)' : 'var(--ct-alert)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center mt-2 text-2xs text-annotation/60">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-verify rounded-sm inline-block" /> Pass (≥40%)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-alert rounded-sm inline-block" /> Fail (&lt;40%)</span>
          </div>
        </div>
      )}

      {/* Class-wise Breakdown (department → year → class) */}
      {clusterData.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Cluster-wise Breakdown (Dept / Year / Class)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-rim">
                  <th className="text-left py-2 font-medium text-annotation">Cluster</th>
                  <th className="text-right py-2 font-medium text-annotation">Submitted</th>
                  <th className="text-right py-2 font-medium text-annotation">Average</th>
                  <th className="text-right py-2 font-medium text-annotation">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {clusterData.map(d => (
                  <ClusterRows key={d.department} cluster={d} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Two-column layout: recent tests + submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Tests */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-title text-ink">Recent Tests</h3>
            <Link to="/admin/tests" className="text-xs text-clarify hover:underline font-medium">View all</Link>
          </div>
          {recentTests.length === 0 ? (
            <div className="text-center py-8 text-annotation text-xs">
              <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="mb-2">No tests yet.</p>
              <Link to="/admin/tests/new" className="text-clarify hover:underline">Create one →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTests.map(t => (
                <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-rim/30 last:border-0">
                  <div className="min-w-0 mr-2">
                    <Link to={`/admin/tests/${t.id}/edit`} className="text-sm font-medium text-ink hover:text-accent truncate block transition-colors">
                      {t.title}
                    </Link>
                    <span className="text-2xs text-annotation/60 font-mono">{t.duration_minutes} min · {t.section_count || 0} sections</span>
                  </div>
                  <Badge color={t.status === 'published' ? 'verify' : t.status === 'archived' ? 'annotation' : 'accent'}>
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Submissions */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-title text-ink">Recent Submissions</h3>
            <Link to="/admin/results" className="text-xs text-clarify hover:underline font-medium">View all</Link>
          </div>
          {!s.recentSubmissions?.length ? (
            <div className="text-center py-8 text-annotation text-xs">
              <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <p>No submissions yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {s.recentSubmissions.slice(0, 6).map(sub => {
                const pct = sub.max_score > 0 ? Math.round((sub.score / sub.max_score) * 100) : 0;
                return (
                  <div key={sub.id} className="flex items-center justify-between py-1.5 border-b border-rim/30 last:border-0">
                    <div className="min-w-0 mr-2">
                      <div className="text-sm font-medium text-ink truncate">{sub.user_name}</div>
                      <div className="text-2xs text-annotation/60 truncate">{sub.test_title}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold font-mono score-digit ${pct >= (sub.passing_score ?? 40) ? 'text-verify' : 'text-alert'}`}>{pct}%</div>
                      <div className="text-2xs text-annotation/50 font-mono">
                        {formatDistanceToNow(new Date(sub.submitted_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Renders a cluster (department → year → class) as table rows ── */
const yearOrdinal = (y) => {
  const n = Number(y);
  if (!Number.isFinite(n) || y === '' || y === null) return `Year ${y}`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${(s[(v - 20) % 10] || s[v] || s[0])} Year`;
};

function ClusterRows({ cluster }) {
  return (
    <>
      <tr className="bg-deck/40 border-b border-rim/40">
        <td className="py-1.5 pl-2 font-semibold text-ink">{cluster.department}</td>
        <td className="text-right py-1.5 font-mono text-annotation" colSpan={3}>
          {cluster.years.reduce((sum, y) => sum + y.classes.reduce((a, b) => a + b.count, 0), 0)} submitted
        </td>
      </tr>
      {cluster.years.map(y => (
        <tr key={`${cluster.department}-${y.year}`} className="border-b border-rim/20">
          <td className="py-1 pl-6 text-clarify font-medium">
            {yearOrdinal(y.year)}
            <span className="text-annotation/50 font-normal"> (Year)</span>
          </td>
          <td className="text-right py-1 font-mono text-annotation/80">
            {y.classes.reduce((a, b) => a + b.count, 0)}
          </td>
          <td />
          <td />
        </tr>
        ))}
      {cluster.years.flatMap(y =>
        y.classes.map(b => (
          <tr key={`${cluster.department}-${y.year}-${b.className}`} className="border-b border-rim/30">
            <td className="py-1.5 pl-10 font-medium text-ink">{b.className}</td>
            <td className="text-right py-1.5 font-mono">{b.count}</td>
            <td className="text-right py-1.5 font-mono">{b.avg}%</td>
            <td className="text-right py-1.5 font-mono">{b.passRate}%</td>
          </tr>
        ))
      )}
    </>
  );
}

/* ── Compact stat box ─────────────────────────────────────── */
function StatBox({ label, value, sub, highlight }) {
  return (
    <div className="panel p-4">
      <p className="text-label text-annotation font-medium">{label}</p>
      <p className={`text-headline font-display font-bold text-ink mt-1 score-digit ${highlight ? 'text-accent' : ''}`}>
        {value}
      </p>
      {sub && <p className="text-caption text-annotation/60 mt-0.5 font-mono">{sub}</p>}
    </div>
  );
}