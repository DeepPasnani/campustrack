import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { testsAPI, submissionsAPI } from '../../services/api';
import { Btn, Badge, ProgressBar, Spinner } from '../../components/shared/UI';
import { format, formatDistanceToNow } from 'date-fns';

/* ═══════════════════════════════════════════════════════════
 * Student Tests — Browse & launch tests
 *
 * Three states: Upcoming / In Progress / Completed.
 * Each card shows metadata, section badges, and a CTA.
 * ═══════════════════════════════════════════════════════════ */

export default function StudentTests() {
  const { data, isLoading } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data: subsData } = useQuery({ queryKey: ['my-submissions'], queryFn: submissionsAPI.getMy });
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  const tests = data?.tests || [];
  const subs = (subsData?.submissions || []).reduce((acc, s) => {
    acc[s.test_id] = s;
    return acc;
  }, {});

  const now = Date.now();

  const getTestStatus = (test) => {
    const started = test.start_time ? new Date(test.start_time).getTime() <= now : true;
    const ended = test.end_time ? new Date(test.end_time).getTime() <= now : false;
    const sub = subs[test.id];
    const submitted = sub && (sub.status === 'submitted' || sub.status === 'auto_submitted');
    const inProgress = started && !ended && !submitted;

    return { started, ended, submitted, inProgress, notEnded: !ended };
  };

  if (tests.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <h3 className="empty-state-title">No tests available</h3>
        <p className="empty-state-desc">Check back later for upcoming placement drives.</p>
      </div>
    );
  }

  const handleStartTest = (test) => {
    navigate(`/test/${test.id}`);
  };

  const handleViewResult = (test) => {
    const sub = subs[test.id];
    if (sub) navigate(`/student/results/${sub.id}`);
  };

  const incompleteTests = tests.filter(t => !getTestStatus(t).submitted);
  const completedTests = tests.filter(t => getTestStatus(t).submitted);

  const renderTest = (test) => {
    const { started, ended, submitted, inProgress, notEnded } = getTestStatus(test);
    const sub = subs[test.id];
    const passed = sub?.max_score > 0 ? (sub.score / sub.max_score) * 100 >= (test.settings?.passingScore ?? 40) : false;
    const pct = sub?.max_score > 0 ? Math.round((sub.score / sub.max_score) * 100) : 0;

    const available = started && notEnded && !submitted;
    const upcoming = !started;

    return (
            <div
              key={test.id}
              onClick={submitted ? () => handleViewResult(test) : undefined}
              className={`panel p-4 hover:border-accent/30 transition-colors group ${submitted ? 'cursor-pointer' : ''}`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Left: title + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <h2 className="font-display font-bold text-sm text-ink">
                      {test.title}
                    </h2>
                    {submitted && (
                      <Badge color={passed ? 'verify' : 'alert'}>
                        {passed ? 'Passed' : 'Failed'}
                      </Badge>
                    )}
                    {inProgress && <Badge color="accent">In Progress</Badge>}
                    {!started && <Badge color="annotation">Upcoming</Badge>}
                    {started && !notEnded && !submitted && (
                      <Badge color="alert">Ended</Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-2xs text-annotation/60 flex-wrap mb-1">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {test.duration_minutes} min
                    </span>
                    {test.start_time && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {format(new Date(test.start_time), 'dd MMM yyyy, HH:mm')}
                      </span>
                    )}
                    {test.settings?.passingScore != null && (
                      <span className="font-mono">Pass: {test.settings.passingScore}%</span>
                    )}
                  </div>

                  {/* Section badges (neutral) */}
                  {(test.sections || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(test.sections || []).map(sec => (
                        <span
                          key={sec.id}
                          className="text-2xs font-semibold px-2 py-0.5 rounded-md font-mono uppercase tracking-wider bg-rim/30 text-annotation"
                        >
                          {sec.name} ({sec.questions?.length || sec.section_count || 0})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: score or CTA */}
                <div className="shrink-0 text-right">
                  {submitted ? (
                    <div>
                      <div
                        className={`text-xl font-display font-bold score-digit ${
                          passed ? 'text-verify' : 'text-alert'
                        }`}
                      >
                        {pct}%
                      </div>
                      <div className="text-2xs text-annotation/60 font-mono mb-1.5">
                        {sub.score}/{sub.max_score}
                      </div>
                      <ProgressBar
                        value={sub.score}
                        max={sub.max_score}
                        color={passed ? 'bg-verify' : 'bg-alert'}
                        className="w-20 ml-auto"
                      />
                    </div>
                  ) : inProgress ? (
                    <Btn
                      variant="warning"
                      size="sm"
                      onClick={() => handleStartTest(test)}
                    >
                      Resume
                    </Btn>
                  ) : available ? (
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={() => handleStartTest(test)}
                    >
                      Start Test
                    </Btn>
                  ) : !started ? (
                    <div className="flex items-center gap-1 text-xs text-annotation/50">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Not started
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-annotation/50">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
                      </svg>
                      Ended
                    </div>
                  )}
                </div>
              </div>
            </div>
    );
  };

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="section-header">
        <div>
          <h1 className="text-display">My Tests</h1>
          <p className="section-subtitle">{tests.length} test{tests.length !== 1 ? 's' : ''} available</p>
        </div>
      </div>

      {/* Incomplete: upcoming, available, in progress, or ended-without-submission */}
      <div className="mb-6">
        <h2 className="eyebrow mb-2">Incomplete</h2>
        {incompleteTests.length === 0 ? (
          <p className="text-xs text-annotation/60">Nothing here — every test has been submitted.</p>
        ) : (
          <div className="space-y-3">
            {incompleteTests.map(renderTest)}
          </div>
        )}
      </div>

      {/* Completed: click a card to view its result */}
      <div>
        <h2 className="eyebrow mb-2">Completed</h2>
        {completedTests.length === 0 ? (
          <p className="text-xs text-annotation/60">No submitted tests yet.</p>
        ) : (
          <div className="space-y-3">
            {completedTests.map(renderTest)}
          </div>
        )}
      </div>
    </div>
  );
}