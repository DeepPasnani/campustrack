import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import api, { submissionsAPI } from '../../services/api';
import { Btn, Spinner, Badge, Modal } from '../../components/shared/UI';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';

export default function StudentAnalytics() {
  const { studentId } = useParams();
  const qc = useQueryClient();
  const [showAllTests, setShowAllTests] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'start'|'stop', submissionId, testTitle }

  const { data, isLoading } = useQuery({
    queryKey: ['student-analytics', studentId],
    queryFn: () => api.get(`/users/${studentId}/analytics`).then(r => r.data),
    enabled: !!studentId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['student-analytics', studentId] });

  const startStopMut = useMutation({
    mutationFn: ({ type, submissionId }) =>
      type === 'start' ? submissionsAPI.resume(submissionId) : submissionsAPI.forceStop(submissionId),
    onSuccess: (data, vars) => {
      toast.success(data.message || (vars.type === 'start' ? 'Test started' : 'Test stopped and graded'));
      setConfirmAction(null);
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Action failed'),
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>;
  }

  if (!data) {
    return <div className="empty-state"><p>Student not found</p></div>;
  }

  const { student, overall, tests, genre_accuracy, coding_results } = data;

  const genreChartData = genre_accuracy.map(g => ({
    name: g.genre.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    accuracy: g.accuracy,
    attempted: g.attempted,
  }));

  const codingChartData = coding_results.map(c => ({
    name: c.title?.length > 20 ? c.title.substring(0, 20) + '…' : c.title || 'Problem',
    score: c.marks > 0 ? Math.round((c.earned / c.marks) * 100) : 0,
    difficulty: c.difficulty,
  }));

  const passRate = overall.submitted > 0 ? Math.round((overall.passed / overall.submitted) * 100) : 0;

  const displayedTests = showAllTests ? tests : tests.slice(0, 5);

  return (
    <div className="animate-fade-up space-y-5">
      {/* Header */}
      <div className="section-header">
        <div>
          <h1 className="text-display">{student.name}</h1>
          <p className="section-subtitle">{student.email} · {student.branch || 'No branch'} · {student.roll_number || 'No roll no'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="panel px-2 py-1">Class: {student.class_name || '—'}</span>
          <span className="panel px-2 py-1">Year: {student.year_of_study || '—'}</span>
          <Link to={`/admin/analytics/growth/${studentId}`} className="btn-ghost text-xs">
            Growth Trajectory
          </Link>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="panel p-3 text-center">
          <div className="text-lg font-bold text-accent">{overall.total_tests}</div>
          <div className="text-2xs text-annotation/60">Total Tests</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="text-lg font-bold text-clarify">{overall.submitted}</div>
          <div className="text-2xs text-annotation/60">Submitted</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="text-lg font-bold text-verify">{overall.avg_percentage}%</div>
          <div className="text-2xs text-annotation/60">Avg Score</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="text-lg font-bold text-verify">{overall.passed}/{overall.submitted}</div>
          <div className="text-2xs text-annotation/60">Passed</div>
        </div>
        <div className="panel p-3 text-center">
          <div className={`text-lg font-bold ${passRate >= 50 ? 'text-verify' : 'text-alert'}`}>{passRate}%</div>
          <div className="text-2xs text-annotation/60">Pass Rate</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Genre-wise accuracy */}
        <div className="panel p-4">
          <h3 className="text-xs font-bold text-ink mb-3">Genre-wise Accuracy</h3>
          {genreChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={genreChartData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v) => [`${v}%`, 'Accuracy']} contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="accuracy" radius={[3, 3, 0, 0]} fill="var(--ct-accent)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-annotation/50 py-8 text-center">No MCQ data yet.</p>
          )}
        </div>

        {/* Coding Performance */}
        <div className="panel p-4">
          <h3 className="text-xs font-bold text-ink mb-3">Coding Problem Scores</h3>
          {codingChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={codingChartData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v) => [`${v}%`, 'Score']} contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="score" radius={[3, 3, 0, 0]} fill="var(--ct-clarify)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-annotation/50 py-8 text-center">No coding submissions yet.</p>
          )}
        </div>
      </div>

      {/* Test History */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-ink">Test History ({tests.length})</h3>
          {tests.length > 5 && (
            <Btn variant="ghost" size="sm" onClick={() => setShowAllTests(!showAllTests)}>
              {showAllTests ? 'Show Less' : 'Show All'}
            </Btn>
          )}
        </div>
        {displayedTests.length === 0 ? (
          <p className="text-xs text-annotation/50 py-4 text-center">No test submissions yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Score</th>
                  <th>%</th>
                  <th>Result</th>
                  <th>Time</th>
                  <th>Tab Switches</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayedTests.map(t => (
                  <tr key={t.submission_id}>
                    <td className="font-medium text-sm text-ink">{t.test_title}</td>
                    <td className="font-mono">{t.score}/{t.max_score}</td>
                    <td>
                      <span className={`font-mono font-bold ${t.passed ? 'text-verify' : 'text-alert'}`}>
                        {t.percentage}%
                      </span>
                    </td>
                    <td>
                      <Badge color={t.status === 'submitted' ? (t.passed ? 'verify' : 'alert') : 'accent'}>
                        {t.status === 'submitted' ? (t.passed ? 'Passed' : 'Failed') : t.status}
                      </Badge>
                    </td>
                    <td className="font-mono text-xs">{t.time_taken_seconds ? `${Math.floor(t.time_taken_seconds / 60)}m ${t.time_taken_seconds % 60}s` : '—'}</td>
                    <td className="font-mono text-xs text-center">{t.tab_switch_count || 0}</td>
                    <td className="font-mono text-xs">{t.submitted_at ? format(new Date(t.submitted_at), 'dd MMM, HH:mm') : '—'}</td>
                    <td className="text-right">
                      {t.status === 'in_progress' ? (
                        <button
                          onClick={() => setConfirmAction({ type: 'stop', submissionId: t.submission_id, testTitle: t.test_title })}
                          className="btn-ghost-icon text-alert hover:text-alert"
                          title="Stop test now"
                          aria-label="Stop test now"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <rect x="6" y="6" width="12" height="12" rx="1.5" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmAction({ type: 'start', submissionId: t.submission_id, testTitle: t.test_title })}
                          className="btn-ghost-icon text-accent hover:text-clarify"
                          title="Start / resume test for this student"
                          aria-label="Start / resume test for this student"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Modal
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          title={confirmAction?.type === 'start' ? 'Start / Resume Test' : 'Stop Test Now'}
          width="max-w-sm"
        >
          <p className="text-sm text-annotation mb-5">
            {confirmAction?.type === 'start'
              ? <>Reopen <strong className="text-ink">{confirmAction?.testTitle}</strong> for {student.name}, with their remaining time and saved answers preserved.</>
              : <>End <strong className="text-ink">{confirmAction?.testTitle}</strong> for {student.name} right now and grade it from their last saved answers.</>}
          </p>
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Btn>
            <Btn
              variant={confirmAction?.type === 'start' ? 'primary' : 'danger'}
              disabled={startStopMut.isLoading}
              onClick={() => startStopMut.mutate(confirmAction)}
            >
              {startStopMut.isLoading ? 'Working…' : confirmAction?.type === 'start' ? 'Start Test' : 'Stop Test'}
            </Btn>
          </div>
        </Modal>
      </div>
    </div>
  );
}
