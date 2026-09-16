import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gamificationAPI, classesAPI } from '../../services/api';
import { Badge, Spinner } from '../../components/shared/UI';
import { useStore } from '../../store';
import { Trophy, Medal, Award, User, Users } from 'lucide-react';

const rankIcons = {
  1: { icon: Trophy, color: 'text-trophy-gold', tint: 'bg-trophy-gold/10', label: 'Gold' },
  2: { icon: Medal, color: 'text-trophy-silver', tint: 'bg-trophy-silver/10', label: 'Silver' },
  3: { icon: Award, color: 'text-trophy-bronze', tint: 'bg-trophy-bronze/10', label: 'Bronze' },
};

export default function Leaderboard() {
  const { user } = useStore();
  const [testId, setTestId] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const { data: testsData, isLoading: testsLoading } = useQuery({
    queryKey: ['leaderboard-tests'],
    queryFn: gamificationAPI.listLeaderboardTests,
  });
  const tests = testsData?.tests || [];
  const activeTestId = testId || tests[0]?.id || '';
  const activeTest = tests.find(t => t.id === activeTestId);

  const { data: lbData, isLoading: lbLoading } = useQuery({
    queryKey: ['leaderboard', activeTestId, classFilter],
    queryFn: () => gamificationAPI.getLeaderboard({ testId: activeTestId || undefined, class: classFilter || undefined }),
    enabled: !!activeTestId,
  });

  // Only the classes inside the student's own department + year are shown,
  // so they can drill into their class without ever seeing other scopes.
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: classesAPI.list,
  });
  const myDept = user?.branch || user?.department;
  const myYear = user?.year_of_study;
  const myClasses = (classesData?.classes || []).filter(c =>
    (!myDept || c.department === myDept) &&
    (!myYear || String(c.year_of_study) === String(myYear))
  );

  const leaderboard = lbData?.leaderboard || [];
  const myRank = lbData?.myRank;
  const maxScore = lbData?.maxScore;
  const resultsAvailable = lbData?.resultsAvailable !== false;

  const scoreLabel = (entry) => {
    const label = `${Number(entry.score ?? 0).toLocaleString()} / ${Number(entry.max_score ?? 0).toLocaleString()}`;
    const pct = entry.max_score > 0 ? Math.round((entry.score / entry.max_score) * 100) : 0;
    return { label, pct };
  };

  if (testsLoading || lbLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Leaderboard</h1>
          <p className="section-subtitle">
            {activeTest ? `Ranked by marks scored in ${activeTest.title}` : 'Top performers by marks scored'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={activeTestId}
          onChange={e => setTestId(e.target.value)}
          className="select-field text-xs"
          aria-label="Choose test"
        >
          {tests.map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 ml-auto">
          {myClasses.length > 0 && (
            <select
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              className="select-field text-xs"
              aria-label="Filter by class"
            >
              <option value="">All Classes</option>
              {myClasses.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2 rounded-lg bg-sunken/60 border border-rim/50 px-3 py-1.5 text-2xs text-annotation/70">
            <Users size={14} className="text-accent" />
            <span>
              {user?.branch || 'Your department'}{user?.year_of_study ? ` • Year ${user.year_of_study}` : ''}
              <span className="ml-1 font-medium text-ink">only</span>
            </span>
          </div>
        </div>
      </div>

      {myRank && (
        <div className="panel bg-accent/5 border-accent/20 p-3 flex items-center gap-3">
          <User size={16} className="text-accent" />
          <span className="text-xs text-ink font-medium">Your Rank: #{myRank}</span>
        </div>
      )}

      {!activeTestId || leaderboard.length === 0 ? (
        <div className="empty-state py-16">
          <Trophy size={40} className="empty-state-icon" />
          <h3 className="empty-state-title">{resultsAvailable ? 'No rankings yet' : 'Rankings not available yet'}</h3>
          <p className="empty-state-desc">
            {resultsAvailable
              ? 'This test has no submitted papers yet — results will appear here once students finish.'
              : 'Your placement coordinator hasn’t published results for this test yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {leaderboard.slice(0, 3).map((entry, idx) => {
            const rank = idx + 1;
            const RankIcon = rankIcons[rank]?.icon;
            const rankInfo = rankIcons[rank];
            const { label, pct } = scoreLabel(entry);
            return (
              <div
                key={entry.id}
                className={`panel p-4 flex items-center gap-4 ${user?.id === entry.id ? 'ring-2 ring-accent/40' : ''}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${rankInfo?.tint || 'bg-sunken'}`}>
                  {RankIcon ? <RankIcon size={20} className={rankInfo?.color ?? 'text-annotation'} /> : <span className="text-lg font-bold text-ink">{rank}</span>}
                </div>
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent uppercase shrink-0">
                  {entry.name?.charAt(0) || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-semibold text-ink truncate">
                      {entry.name} {user?.id === entry.id && <Badge color="clarify">You</Badge>}
                    </span>
                  </div>
                  <div className="text-xs text-annotation/60">
                    {entry.branch || ''} {entry.class_name ? `• ${entry.class_name}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-ink">{label} <span className="text-2xs text-annotation/60 font-normal">marks</span></div>
                  {maxScore > 0 && <div className="text-2xs text-annotation/60">{pct}%</div>}
                </div>
              </div>
            );
          })}

          {leaderboard.length > 3 && (
            <div className="border-t border-rim/50 pt-2 mt-4">
              {leaderboard.slice(3).map((entry, idx) => {
                const rank = idx + 4;
                const { label } = scoreLabel(entry);
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-sunken/50 transition-colors ${user?.id === entry.id ? 'bg-accent/5 ring-1 ring-accent/20' : ''}`}
                  >
                    <span className="w-6 text-center text-xs font-mono text-annotation/60">#{rank}</span>
                    <div className="w-8 h-8 rounded-full bg-sunken flex items-center justify-center text-xs font-bold text-annotation uppercase shrink-0">
                      {entry.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-ink">
                        {entry.name} {user?.id === entry.id && <Badge color="clarify">You</Badge>}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-ink">{label}</span>
                      <span className="text-2xs text-annotation/60 ml-1">marks</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
