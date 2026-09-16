import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { submissionsAPI } from '../../services/api';
import { Badge, ProgressBar, Spinner } from '../../components/shared/UI';
import { format } from 'date-fns';

/* ═══════════════════════════════════════════════════════════
 * Student Results — Score history
 * ═══════════════════════════════════════════════════════════ */

export default function StudentResults() {
  const { data, isLoading } = useQuery({ queryKey: ['my-submissions'], queryFn: submissionsAPI.getMy });
  const subs = (data?.submissions || []).filter(
    s => s.status === 'submitted' || s.status === 'auto_submitted',
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-display font-bold text-ink">My Results</h1>
        <p className="text-sm text-annotation mt-0.5">
          {subs.length} test{subs.length !== 1 ? 's' : ''} completed
        </p>
      </div>

      {/* Empty state */}
      {subs.length === 0 && (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <h3 className="empty-state-title">No results yet</h3>
          <p className="empty-state-desc">Complete a test to see your results here.</p>
          <Link to="/student" className="text-sm text-clarify hover:underline font-medium">
            Browse available tests →
          </Link>
        </div>
      )}

      {/* Results list */}
      <div className="space-y-3">
        {subs.map(sub => {
          const resultsAvailable = sub.max_score != null;
          const pct =
            resultsAvailable && sub.max_score > 0
              ? Math.round((sub.score / sub.max_score) * 100)
              : 0;
          const passed = pct >= (sub.test_settings?.passingScore ?? 40);
          const timeTaken = sub.time_taken_seconds;
          const m = timeTaken ? Math.floor(timeTaken / 60) : null;
          const sec = timeTaken ? timeTaken % 60 : null;

          return (
            <Link
              key={sub.id}
              to={`/student/results/${sub.id}`}
              className="panel p-4 block hover:border-accent/30 transition-all group"
            >
              <div className="flex items-center gap-4">
                {/* Score (left) */}
                <div className="shrink-0 text-center w-16">
                  {resultsAvailable ? (
                    <>
                      <div
                        className={`text-2xl font-display font-bold score-digit ${
                          passed ? 'text-verify' : 'text-alert'
                        }`}
                      >
                        {pct}
                        <span className="text-xs opacity-60">%</span>
                      </div>
                      <div className="text-2xs text-annotation/60 font-mono">
                        {sub.score}/{sub.max_score}
                      </div>
                    </>
                  ) : (
                    <div className="text-2xs text-annotation/60 font-medium">Pending</div>
                  )}
                </div>

                {/* Details (middle) */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-display font-semibold text-sm text-ink truncate">
                      {sub.test_title}
                    </h3>
                    {resultsAvailable ? (
                      <Badge color={passed ? 'verify' : 'alert'}>
                        {passed ? 'Passed' : 'Failed'}
                      </Badge>
                    ) : (
                      <Badge color="accent">Results Pending</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-annotation/60">
                    <span>
                      {m !== null ? `${m}m ${sec}s` : '—'}
                    </span>
                    <span>
                      {sub.submitted_at
                        ? format(new Date(sub.submitted_at), 'MMM d, HH:mm')
                        : ''}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar
                      value={resultsAvailable ? sub.score : 0}
                      max={resultsAvailable ? sub.max_score : 1}
                      color={passed ? 'bg-verify' : 'bg-alert'}
                    />
                  </div>
                </div>

                {/* Arrow (right) */}
                <svg
                  className="w-4 h-4 text-annotation/30 group-hover:text-annotation transition-colors shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
