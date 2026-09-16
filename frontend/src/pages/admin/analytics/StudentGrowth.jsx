import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { analyticsAPI } from '../../../services/api';
import { Btn, Spinner, Tabs } from '../../../components/shared/UI';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import { format } from 'date-fns';

export default function StudentGrowth() {
  const { studentId } = useParams();
  const [activeTab, setActiveTab] = useState('trend');

  const { data, isLoading } = useQuery({
    queryKey: ['student-growth', studentId],
    queryFn: () => analyticsAPI.studentGrowth(studentId),
    enabled: !!studentId,
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>;
  }

  if (!data) {
    return <div className="empty-state"><p>No growth data available</p></div>;
  }

  const trendChartData = data.trend.map(t => ({
    ...t,
    date: t.submitted_at ? format(new Date(t.submitted_at), 'dd MMM') : 'N/A',
  }));

  const tabs = [
    { id: 'trend', label: 'Score Trend' },
    { id: 'percentile', label: 'Percentile History' },
    { id: 'mastery', label: 'Genre Mastery' },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Growth Trajectory</h1>
          <p className="section-subtitle">Performance trends over time</p>
        </div>
        <Link to={`/admin/analytics/students/${studentId}`} className="btn-ghost text-sm">
          Back to Profile
        </Link>
      </div>

      {data.improvementRate !== undefined && (
        <div className="panel p-3 flex items-center gap-3">
          <span className="text-xs text-annotation/60">Improvement Rate:</span>
          <span className={`text-lg font-bold font-mono ${data.improvementRate >= 0 ? 'text-verify' : 'text-alert'}`}>
            {data.improvementRate >= 0 ? '+' : ''}{data.improvementRate}% per test
          </span>
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'trend' && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Score Trend Over Time</h3>
          {trendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendChartData} margin={{ top: 10, right: 10, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--ct-accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--ct-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ct-rim)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  formatter={(v, name) => [name === 'percentage' ? `${v}%` : v, name === 'percentage' ? 'Score' : name]}
                  contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="percentage" stroke="var(--ct-accent)" fill="url(#scoreGrad)" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-annotation/50 py-8 text-center">No trend data available</p>
          )}
        </div>
      )}

      {activeTab === 'percentile' && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Percentile Rank History</h3>
          {data.percentileHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.percentileHistory} margin={{ top: 10, right: 10, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ct-rim)" />
                <XAxis dataKey="rank" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} label={{ value: 'Test #', position: 'insideBottom', offset: -5 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  formatter={(v, name) => [name === 'percentile' ? `${v}%` : v, name]}
                  contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Line type="monotone" dataKey="percentile" stroke="var(--ct-clarify)" strokeWidth={2} dot={{ r: 3 }} name="Percentile" />
                <Line type="monotone" dataKey="score" stroke="var(--ct-verify)" strokeWidth={2} dot={{ r: 3 }} name="Score" />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-annotation/50 py-8 text-center">No percentile history available</p>
          )}
        </div>
      )}

      {activeTab === 'mastery' && (
        <div className="panel p-4">
          <h3 className="text-label text-annotation mb-3">Genre-wise Skill Mastery</h3>
          {data.genreMastery.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart margin={{ top: 10, right: 10, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ct-rim)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }} />
                <Legend />
                {data.genreMastery.map((genre, i) => (
                  <Line
                    key={genre.genre}
                    data={genre.data}
                    type="monotone"
                    dataKey="accuracy"
                    name={genre.genre.replace(/_/g, ' ')}
                    stroke={['var(--ct-accent)', 'var(--ct-clarify)', 'var(--ct-verify)', 'var(--ct-alert)', 'var(--ct-trophy-gold)', 'var(--ct-trophy-silver)'][i % 6]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-annotation/50 py-8 text-center">No genre mastery data available</p>
          )}
        </div>
      )}

      <div className="panel p-4">
        <h3 className="text-label text-annotation mb-3">Test History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-rim">
                <th className="text-left py-2 font-medium text-annotation">Test</th>
                <th className="text-right py-2 font-medium text-annotation">Score</th>
                <th className="text-right py-2 font-medium text-annotation">%</th>
                <th className="text-right py-2 font-medium text-annotation">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map(t => (
                <tr key={t.submission_id} className="border-b border-rim/30">
                  <td className="py-1.5 font-medium text-ink">{t.test_title}</td>
                  <td className="text-right py-1.5 font-mono">{t.score}/{t.max_score}</td>
                  <td className="text-right py-1.5 font-mono">{t.percentage}%</td>
                  <td className="text-right py-1.5 font-mono text-annotation/60">
                    {t.submitted_at ? format(new Date(t.submitted_at), 'dd MMM yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
