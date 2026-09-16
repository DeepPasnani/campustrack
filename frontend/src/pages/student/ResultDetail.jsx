import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { submissionsAPI } from '../../services/api';
import { Badge, ProgressBar, Spinner, Alert, Btn } from '../../components/shared/UI';
import { format } from 'date-fns';

/* ═══════════════════════════════════════════════════════════
 * Student Result Detail — Full score breakdown
 * ═══════════════════════════════════════════════════════════ */

export default function ResultDetail() {
  const { submissionId } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => submissionsAPI.get(submissionId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-annotation text-sm">
        Submission not found.
      </div>
    );
  }

  const sub = data.submission;
  const questionInfo = data.questionInfo || {};
  const resultsAvailable = sub.max_score != null;
  const pct =
    resultsAvailable && sub.max_score > 0
      ? Math.round((sub.score / sub.max_score) * 100)
      : 0;
  const passed = pct >= (sub.test_settings?.passingScore ?? 40);
  // The backend already withholds score/breakdown until settings.showResults
  // clears it (immediately, after the test ends, or once an admin manually
  // publishes) — resultsAvailable mirrors that, it isn't re-decided here.
  const showDetails = resultsAvailable;
  // code_results mixes both aptitude and coding entries together (backend
  // writes both section types into the same JSON column). Aptitude entries
  // are shaped { earned, correct } — no other key overlaps with coding
  // entries ({ results }/{ error }/{ total }), so `correct` in r reliably
  // tells them apart.
  const allResults = sub.code_results || {};
  const aptitudeResults = Object.fromEntries(
    Object.entries(allResults).filter(([, r]) => 'correct' in r)
  );
  const codeResults = Object.fromEntries(
    Object.entries(allResults).filter(([, r]) => !('correct' in r))
  );
  const m = sub.time_taken_seconds
    ? Math.floor(sub.time_taken_seconds / 60)
    : null;
  const s = sub.time_taken_seconds
    ? sub.time_taken_seconds % 60
    : null;
  const passingScore = sub.test_settings?.passingScore ?? 40;

  return (
    <div className="animate-fade-up">
      {/* Back link */}
      <Link
        to="/student/results"
        className="inline-flex items-center gap-1.5 text-sm text-annotation hover:text-clarify mb-5 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Results
      </Link>

      {/* ── Hero Score Card ──────────────────────────────── */}
      <div
        className={`panel overflow-hidden mb-5 ${
          resultsAvailable ? (passed ? 'border-verify/30' : 'border-alert/30') : ''
        }`}
      >
        {/* Top section: score + title */}
        <div className="p-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-display font-bold text-ink">
                {sub.test_title}
              </h1>
              <p className="text-xs text-annotation mt-0.5">
                {sub.submitted_at
                  ? format(new Date(sub.submitted_at), 'dd MMM yyyy, HH:mm')
                  : ''}
              </p>
            </div>
            {resultsAvailable && (
              <div className="text-right shrink-0">
                <div
                  className={`text-3xl font-display font-bold score-digit ${
                    passed ? 'text-verify' : 'text-alert'
                  }`}
                >
                  {pct}%
                </div>
                <div className="text-xs text-annotation font-mono">
                  {sub.score}/{sub.max_score} marks
                </div>
              </div>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-4">
            <div>
              <div className="eyebrow">Result</div>
              <div className="text-sm font-semibold mt-0.5 flex items-center gap-1.5">
                {resultsAvailable ? (
                  <Badge color={passed ? 'verify' : 'alert'}>
                    {passed ? 'Passed' : 'Failed'}
                  </Badge>
                ) : (
                  <Badge color="accent">Pending</Badge>
                )}
                {sub.status === 'auto_submitted' && (
                  <span className="badge-accent text-2xs">Auto-submitted</span>
                )}
              </div>
            </div>
            {m !== null && (
              <div>
                <div className="eyebrow">Time Taken</div>
                <div className="text-sm font-semibold mt-0.5 font-mono score-digit">
                  {m}m {s}s
                </div>
              </div>
            )}
            {resultsAvailable && (
              <div>
                <div className="eyebrow">Passing Score</div>
                <div className="text-sm font-semibold mt-0.5 font-mono score-digit">
                  {passingScore}%
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {resultsAvailable && (
          <div className="mt-4">
            <ProgressBar
              value={sub.score}
              max={sub.max_score}
              color={passed ? 'bg-verify' : 'bg-alert'}
            />
          </div>
          )}
        </div>
      </div>

      {/* ── Aptitude Results ─────────────────────────────── */}
      {Object.keys(aptitudeResults).length > 0 && showDetails && (
        <div className="panel p-5 mb-5">
          <h2 className="text-sm font-display font-bold text-ink mb-4">
            Aptitude Results
          </h2>
          <div className="divide-y divide-rim/30">
            {Object.entries(aptitudeResults).map(([qid, r]) => {
              const info = questionInfo[qid];
              const options = info?.options || [];
              // correct_answer / studentAnswer are option indices — a single
              // index for mcq, an array of indices for msq. Normalize both
              // to sets of strings so index membership checks are uniform.
              const correctSet = new Set(
                (Array.isArray(info?.correctAnswer) ? info.correctAnswer : [info?.correctAnswer])
                  .filter(v => v !== undefined && v !== null)
                  .map(String)
              );
              const studentSet = new Set(
                (Array.isArray(info?.studentAnswer) ? info.studentAnswer : [info?.studentAnswer])
                  .filter(v => v !== undefined && v !== null && v !== '')
                  .map(String)
              );
              return (
                <div key={qid} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {r.earned > 0 ? (
                        <svg className="w-4 h-4 text-verify shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-alert shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className="text-xs font-medium text-ink">
                        {info?.text || `Question ${qid.slice(0, 8)}…`}
                      </span>
                    </div>
                    <span className={`text-sm font-bold font-mono score-digit shrink-0 ${r.earned > 0 ? 'text-verify' : 'text-alert'}`}>
                      {r.earned} marks
                    </span>
                  </div>

                  {options.length > 0 && (
                    <div className="mt-2 ml-6 space-y-1">
                      {options.map((opt, i) => {
                        const isCorrect = correctSet.has(String(i));
                        const isPicked = studentSet.has(String(i));
                        return (
                          <div
                            key={i}
                            className={`text-2xs px-2.5 py-1.5 rounded-md border flex items-center gap-2 ${
                              isCorrect
                                ? 'border-verify/30 bg-verify/8 text-verify'
                                : isPicked
                                  ? 'border-alert/30 bg-alert/8 text-alert'
                                  : 'border-rim/30 text-annotation'
                            }`}
                          >
                            <span className="flex-1">{opt}</span>
                            {isPicked && <span className="font-semibold">Your answer</span>}
                            {isCorrect && <span className="font-semibold">Correct</span>}
                          </div>
                        );
                      })}
                      {studentSet.size === 0 && (
                        <p className="text-2xs text-annotation/50 italic">Not answered</p>
                      )}
                    </div>
                  )}

                  {info?.explanation && (
                    <div className="mt-2 ml-6 text-2xs text-annotation bg-sunken border border-rim/30 rounded-md px-2.5 py-2">
                      <span className="font-semibold text-ink">Explanation: </span>
                      {info.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Coding Results ───────────────────────────────── */}
      {Object.keys(codeResults).length > 0 && showDetails && (
        <div className="panel p-5 mb-5">
          <h2 className="text-sm font-display font-bold text-ink mb-4">
            Coding Results
          </h2>
          <div className="space-y-3">
            {Object.entries(codeResults).map(([pid, r]) => {
              const tcTotal = r.total ?? (r.results || []).length;
              const tcPassed = r.passed ?? (r.results || []).filter(t => t.passed).length;
              const visiblePassed = r.visiblePassed ?? 0;
              const hiddenPassed = r.hiddenPassed ?? 0;
              const allPassed = tcPassed === tcTotal;
              const info = questionInfo[pid];
              return (
                <div key={pid} className={`panel-muted overflow-hidden ${allPassed ? 'border-verify/20' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-panel">
                    <span className="text-sm font-medium text-ink truncate">
                      {info?.title || `Problem ${pid.slice(0, 8)}…`}
                    </span>
                    <span className="text-sm font-bold text-verify font-mono score-digit">
                      {r.earned || 0}
                      {r.problemMarks != null ? `/${r.problemMarks}` : ''} marks
                    </span>
                  </div>
                  {info?.description && (
                    <p className="px-4 py-2 text-xs text-annotation border-b border-rim/30 whitespace-pre-wrap">
                      {info.description}
                    </p>
                  )}

                  {(() => {
                    const sol = sub.code_solutions?.[pid];
                    const lang = sol && Object.keys(sol).find(l => sol[l]?.trim());
                    if (!lang) return null;
                    return (
                      <details className="border-b border-rim/30">
                        <summary className="px-4 py-2 text-xs font-medium text-ink cursor-pointer select-none">
                          Your submitted code ({lang})
                        </summary>
                        <pre className="mx-4 mb-3 text-xs font-mono bg-deck p-3 rounded overflow-x-auto whitespace-pre-wrap">
                          {sol[lang]}
                        </pre>
                      </details>
                    );
                  })()}

                  {r.results && r.results.length > 0 && (
                    <>
                      {/* Summary banner */}
                      <div className={`px-4 py-2.5 border-b flex flex-wrap items-center gap-x-4 gap-y-1 ${
                        allPassed ? 'bg-verify/8 border-verify/15' : 'bg-alert/5 border-alert/15'
                      }`}>
                        <span className="text-xs font-display font-bold">
                          {tcPassed}
                          <span className="text-annotation font-normal">/{tcTotal} test cases passed</span>
                        </span>
                        <span className="text-2xs font-mono text-annotation">
                          {visiblePassed} visible · {hiddenPassed} hidden
                        </span>
                        <span className={`text-xs font-bold font-mono ${allPassed ? 'text-verify' : 'text-alert'}`}>
                          {allPassed ? 'All passed' : 'Some failed'}
                        </span>
                      </div>

                      <div className="divide-y divide-rim/30">
                        {r.results.map((tc, i) => {
                          const isHidden = !!tc.hidden;
                          const showMarks = tc.marks !== undefined && tc.marks !== null;
                          return (
                            <div key={i} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {tc.passed ? (
                                    <svg className="w-4 h-4 text-verify shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4 text-alert shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  )}
                                  <span className="text-xs font-medium text-ink">
                                    Test Case {i + 1}
                                    {isHidden && <span className="badge-accent text-2xs ml-1.5">Hidden</span>}
                                    <span className="text-annotation font-normal"> — {tc.status}</span>
                                  </span>
                                </div>
                                <span className="text-2xs font-mono shrink-0 text-annotation">
                                  {showMarks ? `${tc.earned || 0}/${tc.marks}` : ''}
                                </span>
                              </div>

                              {/* Visible failed cases: show what was expected vs got */}
                              {!isHidden && !tc.passed && tc.actual !== undefined && (
                                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono">
                                  <div className="min-w-0">
                                    <span className="text-annotation">Expected: </span>
                                    <span className="text-verify whitespace-pre-wrap break-words">{tc.expected || '(empty)'}</span>
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-annotation">Got: </span>
                                    <span className="text-alert whitespace-pre-wrap break-words">{tc.actual || '(empty)'}</span>
                                  </div>
                                </div>
                              )}

                              {/* Error detail for any failed case (visible or hidden) */}
                              {!tc.passed && (tc.stderr || tc.compileOutput) && (
                                <pre className="mt-1.5 text-xs font-mono text-alert bg-deck p-2 rounded overflow-x-auto whitespace-pre-wrap">
                                  {(tc.compileOutput || tc.stderr).trim()}
                                </pre>
                              )}
                              {tc.time && (
                                <div className="text-xs text-annotation mt-1 font-mono">
                                  {tc.time}s
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {r.error && (
                    <div className="px-4 py-2 text-xs text-alert font-mono">{r.error}</div>
                  )}
                  {info?.explanation && (
                    <div className="px-4 py-2.5 text-xs text-annotation bg-sunken border-t border-rim/30 whitespace-pre-wrap">
                      <span className="font-semibold text-ink">Explanation: </span>
                      {info.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Results not available yet ─────────────────────── */}
      {!showDetails && (
        <Alert type="info">
          Your detailed answer breakdown will be available once your placement coordinator publishes the results.
        </Alert>
      )}
    </div>
  );
}
