import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { testsAPI } from '../../services/api';
import { Btn, Spinner, Badge, Modal } from '../../components/shared/UI';

export default function QuestionAnalytics() {
  const [testFilter, setTestFilter] = useState('');
  const [threshold, setThreshold] = useState(0.6);

  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data, isLoading } = useQuery({
    queryKey: ['question-analytics', testFilter, threshold],
    queryFn: () => api.get('/submissions/question-analytics', {
      params: { test_id: testFilter || undefined, threshold }
    }).then(r => r.data),
  });

  const tests = testsData?.tests || [];
  const questions = data?.questions || [];
  const flagged = questions.filter(q => q.flagged);

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Question Analytics</h1>
          <p className="section-subtitle">Identify MCQs students consistently get wrong</p>
        </div>
      </div>

      <div className="panel p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Test</label>
          <select className="select-field max-w-sm" value={testFilter}
            onChange={e => setTestFilter(e.target.value)}>
            <option value="">All tests</option>
            {tests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Incorrect Rate Threshold</label>
          <input type="range" min="0.1" max="1.0" step="0.05" value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            className="w-32" />
          <span className="text-xs text-annotation ml-2 font-mono">{Math.round(threshold * 100)}%</span>
        </div>
        <div className="text-xs text-annotation/60 font-mono">
          {data ? `${data.flagged_count} of ${data.total_questions} questions flagged` : ''}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>
      ) : questions.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">Not enough data</p>
          <p className="empty-state-desc">At least 3 submissions per question are needed for analytics. Questions will appear here as students complete tests.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map(q => (
            <div key={q.id} className={`panel p-3 ${q.flagged ? 'ring-1 ring-alert/30' : ''}`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  q.flagged ? 'bg-alert/10 text-alert' : 'bg-verify/10 text-verify'
                }`}>
                  {q.incorrect_rate}%
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink mb-1">{q.text}</p>
                  <div className="flex flex-wrap gap-2 text-2xs">
                    <Badge color={q.flagged ? 'alert' : 'verify'}>{q.flagged ? 'Flagged' : 'OK'}</Badge>
                    <span className="px-1.5 py-0.5 rounded bg-panel text-annotation/70">{q.genre}</span>
                    <span className="px-1.5 py-0.5 rounded bg-panel text-annotation/70">{q.difficulty}</span>
                    <span className="text-annotation/50">{q.total_attempts} attempts · {q.correct_count} correct</span>
                  </div>
                  {q.explanation && (
                    <p className="text-xs text-annotation/60 mt-1 italic">Explanation: {q.explanation}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
