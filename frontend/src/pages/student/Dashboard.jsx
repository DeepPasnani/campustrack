import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '../../store';
import { testsAPI, submissionsAPI, gamificationAPI } from '../../services/api';
import { Btn, Modal, StatCard } from '../../components/shared/UI';
import { Link, useNavigate } from 'react-router-dom';
import OnboardingTutorial from '../../components/shared/OnboardingTutorial';

export default function StudentDashboard() {
  const { user } = useStore();
  const [launchTest, setLaunchTest] = useState(null);
  const navigate = useNavigate();
  const testsQ = useQuery({ queryKey: ['student-tests'], queryFn: testsAPI.list });
  const subsQ = useQuery({ queryKey: ['my-subs'], queryFn: submissionsAPI.getMy });
  const lbQ = useQuery({ queryKey: ['leaderboard'], queryFn: () => gamificationAPI.getLeaderboard({ limit: 100 }) });

  const testsData = testsQ.data;
  const subsData = subsQ.data;
  const lbData = lbQ.data;
  const loadingTests = testsQ.isLoading;
  const boardsLoading = testsQ.isLoading || subsQ.isLoading || lbQ.isLoading;
  const testsError = testsQ.isError;
  const testsRetry = testsQ.refetch;

  const tests = testsData?.tests || [];
  const submissions = subsData?.submissions || [];

  const now = Date.now();
  const statusOf = (t) => {
    const started = t.start_time ? new Date(t.start_time).getTime() <= now : true;
    const ended = t.end_time ? new Date(t.end_time).getTime() <= now : false;
    const sub = submissions.find(s => s.test_id === t.id);
    const submitted = sub && (sub.status === 'submitted' || sub.status === 'auto_submitted');
    return { started, ended, submitted, inProgress: started && !ended && !submitted };
  };

  // Primary action: the single most relevant test right now.
  const actionable = tests.filter(t => { const s = statusOf(t); return s.started && !s.ended && !s.submitted; });
  const upcomingTests = tests
    .filter(t => !statusOf(t).started)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const heroTest = actionable[0] || upcomingTests[0] || null;
  const heroInProgress = heroTest ? statusOf(heroTest).inProgress : false;
  const heroQuestionCount = (heroTest?.sections || []).reduce((n, s) => n + (s.questions?.length || 0), 0);

  // Single signed-in stats rail: Leaderboard rank.
  const statRank = (lbData?.leaderboard || []).findIndex(e => e.id === user?.id) + 1;
  const statCount = (lbData?.leaderboard || []).length;

  const sectionCount = (heroTest?.sections || []).length;

  return (
    <div className="space-y-5">
      <OnboardingTutorial />

      <div className="section-header">
        <div>
          <h1 className="text-display">Welcome, {user?.name?.split(' ')[0] || 'Student'}</h1>
          <p className="section-subtitle">Your placement dashboard</p>
        </div>
        <div className="flex gap-2">
          <Link to="/student/tests" className="btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M5 12h14m-6 6l6-6-6-6" />
            </svg>
            All Tests
          </Link>
        </div>
      </div>

      {/* ── Next action hero ─────────────────────────────────── */}
      {loadingTests ? (
        <div className="panel p-5 animate-pulse">
          <div className="h-4 w-40 bg-sunken rounded-md mb-3" />
          <div className="h-3 w-72 bg-sunken rounded-md mb-5" />
          <div className="h-9 w-32 bg-sunken rounded-md" />
        </div>
      ) : testsError ? (
        <div className="panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-alert shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 9v3m0 4h.01M5.07 19H19a2 2 0 001.7-3L13.7 4.4a2 2 0 00-3.4 0L3.3 16a2 2 0 001.7 3zM12 9v3m0 4h.01" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-ink">Couldn’t load your tests</p>
              <p className="text-xs text-annotation mt-0.5">Your next test isn’t available right now — check your connection and try again.</p>
            </div>
          </div>
          <button onClick={() => testsRetry()} className="btn-ghost shrink-0">
            Retry
          </button>
        </div>
      ) : heroTest ? (
        <div className="panel p-5 md:p-6 relative overflow-hidden">
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${heroInProgress ? 'bg-accent' : 'bg-annotation/60'}`} aria-hidden="true" />
                {heroInProgress ? 'In progress' : 'Next up'}
              </span>
              <span className="eyebrow">· {heroTest.sections?.length || 0} sections · {heroQuestionCount} questions · {heroTest.duration_minutes} min</span>
            </div>
            <h2 className="text-headline mb-1">{heroTest.title}</h2>
            <p className="text-sm text-annotation mb-5 max-w-2xl">
              {heroInProgress
                ? 'You started this test and it hasn’t been submitted yet.'
                : upcomingTests.includes(heroTest)
                  ? `Opens ${new Date(heroTest.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
                  : 'Available now — ready when you are.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" size="md" onClick={() => setLaunchTest(heroTest)}>
                {heroInProgress ? 'Resume Test' : 'Start Test'}
              </Btn>
              <Link to="/student/tests" className="btn-ghost">
                View all tests
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">No test ready right now</p>
            <p className="text-xs text-annotation mt-0.5">Keep preparing — new tests will appear here as soon as they’re published.</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link to="/student/tests" className="btn-ghost">
              View all tests
            </Link>
          </div>
        </div>
      )}

      {/* ── Stats rail (the one signed-in data summary) ─────── */}
      {boardsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0].map(i => (
            <div key={i} className="panel p-4 animate-pulse">
              <div className="h-3 w-24 bg-sunken rounded-md mb-3" />
              <div className="h-8 w-16 bg-sunken rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Leaderboard Rank" value={`#${statRank || '-'}`} sub={`of ${statCount} students`} color="purple" />
        </div>
      )}

      <Modal isOpen={!!launchTest} onClose={() => setLaunchTest(null)} title={launchTest ? `${heroInProgress ? 'Resume' : 'Start'} test` : ''} width="max-w-md"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setLaunchTest(null)}>Not now</Btn>
            <Btn variant="primary" onClick={() => navigate(`/test/${launchTest.id}`)}>
              {heroInProgress ? 'Resume with countdown' : `I’m ready — ${heroInProgress ? 'Resume' : 'Start'}`}
            </Btn>
          </>
        }>
        {launchTest && (
          <div>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-display font-bold text-sm text-ink">{launchTest.title}</p>
                <p className="text-xs text-annotation mt-0.5">
                  {sectionCount} sections · {heroQuestionCount} questions · {launchTest.duration_minutes} minutes
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-sunken border border-rim p-4 text-xs text-annotation space-y-2">
              <p className="flex gap-2"><span className="text-ink font-medium">Single attempt</span> — once the timer starts you can’t retake unless reopened.</p>
              <p className="flex gap-2"><span className="text-ink font-medium">Auto submit</span> — when time runs out, answers are submitted automatically.</p>
              <p className="flex gap-2"><span className="text-ink font-medium">No going back</span> — leaving the test (or losing full-screen focus) will be recorded.</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}