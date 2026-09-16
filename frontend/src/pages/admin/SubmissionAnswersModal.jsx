import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { submissionsAPI } from '../../services/api';
import { Modal, Badge, Spinner } from '../../components/shared/UI';

/* ═══════════════════════════════════════════════════════════
 * Admin — Submission Answers Modal
 *
 * Lets a T&P admin inspect what a student actually wrote for
 * each coding problem (code + per-test-case pass/fail), since
 * the Results page otherwise only surfaces the aptitude/overall
 * score. Aptitude answers are shown too, using the same test
 * definition (question text/correct answer) the admin already
 * has full access to.
 * ═══════════════════════════════════════════════════════════ */

const LANG_MAP = {
  python: 'python', javascript: 'javascript', java: 'java', cpp: 'cpp',
  c: 'c', sql: 'sql',
};

// JSONB columns come back already-parsed from the API in the normal case,
// but tolerate a stringified value too (e.g. legacy rows) without crashing.
function asObject(val) {
  if (!val) return {};
  if (typeof val === 'string') {
    try { return JSON.parse(val) || {}; } catch { return {}; }
  }
  return val;
}

export default function SubmissionAnswersModal({ submissionId, test, onClose }) {
  const [activeProblemId, setActiveProblemId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['submission-detail', submissionId],
    queryFn: () => submissionsAPI.get(submissionId),
    enabled: !!submissionId,
  });

  const sub = data?.submission;
  const codeSolutions = useMemo(() => asObject(sub?.code_solutions), [sub]);
  const codeResults = useMemo(() => asObject(sub?.code_results), [sub]);
  const answers = useMemo(() => asObject(sub?.answers), [sub]);

  const codingProblems = useMemo(() => {
    const list = [];
    (test?.sections || []).forEach(s => {
      if (s.type === 'coding') (s.questions || []).forEach(q => list.push(q));
    });
    return list;
  }, [test]);

  const aptitudeQuestions = useMemo(() => {
    const list = [];
    (test?.sections || []).forEach(s => {
      if (s.type === 'aptitude') (s.questions || []).forEach(q => list.push(q));
    });
    return list;
  }, [test]);

  const currentProblemId = activeProblemId || codingProblems[0]?.id || null;
  const currentProblem = codingProblems.find(p => p.id === currentProblemId);
  const currentSolution = currentProblemId ? codeSolutions[currentProblemId] : null;
  const currentResult = currentProblemId ? codeResults[currentProblemId] : null;
  const currentLang = currentSolution
    ? Object.keys(currentSolution).find(l => currentSolution[l]?.trim())
    : null;
  const currentCode = currentLang ? currentSolution[currentLang] : '';

  return (
    <Modal
      isOpen={!!submissionId}
      onClose={onClose}
      title={sub ? `${sub.user_name || 'Student'} — Answers` : 'Answers'}
      width="max-w-4xl"
    >
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner size={24} className="text-accent" />
        </div>
      )}

      {!isLoading && sub && (
        <div className="space-y-4">
          {codingProblems.length === 0 && (
            <p className="text-sm text-annotation/70 py-6 text-center">
              This test has no coding section.
            </p>
          )}

          {codingProblems.length > 0 && (
            <>
              {/* Problem tabs */}
              <div className="flex gap-1.5 flex-wrap">
                {codingProblems.map((p, i) => {
                  const r = codeResults[p.id];
                  const attempted = !!codeSolutions[p.id];
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveProblemId(p.id)}
                      className={`text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                        currentProblemId === p.id
                          ? 'bg-ink text-deck'
                          : 'bg-panel text-annotation hover:text-ink border border-rim'
                      }`}
                    >
                      Q{i + 1}
                      {r ? (
                        <span className={`ml-1.5 font-mono ${r.earned > 0 ? 'text-verify' : 'text-alert'}`}>
                          {r.earned}/{p.marks}
                        </span>
                      ) : attempted ? (
                        <span className="ml-1.5 text-annotation/50">·</span>
                      ) : (
                        <span className="ml-1.5 text-annotation/40">unattempted</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {currentProblem && (
                <div className="panel-muted p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-display font-bold text-ink">{currentProblem.title}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentLang && <Badge color="annotation">{currentLang}</Badge>}
                      {currentResult ? (
                        <span className="text-xs font-mono font-bold text-ink">
                          {currentResult.earned}/{currentProblem.marks} marks
                          {currentResult.total ? ` · ${currentResult.passed}/${currentResult.total} tests` : ''}
                          {currentResult.passed != null && currentResult.total ? (
                            <span className="text-annotation/60">
                              {' '}({currentResult.visiblePassed || 0} visible · {currentResult.hiddenPassed || 0} hidden)
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-xs text-annotation/50">Not attempted</span>
                      )}
                    </div>
                  </div>

                  {!currentCode ? (
                    <p className="text-sm text-annotation/60 py-6 text-center">
                      No code was submitted for this problem.
                    </p>
                  ) : (
                    <div className="border border-rim rounded-lg overflow-hidden mb-3" style={{ height: 320 }}>
                      <Editor
                        height="320px"
                        language={LANG_MAP[currentLang] || 'text'}
                        theme="light"
                        value={currentCode}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineNumbers: 'on',
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  )}

                  {currentResult?.error && (
                    <p className="text-xs text-alert font-mono mb-2">{currentResult.error}</p>
                  )}

                  {currentResult?.results?.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="text-annotation/60 border-b border-rim">
                            <th className="text-left py-1 pr-2">#</th>
                            <th className="text-left py-1 pr-2">Input</th>
                            <th className="text-left py-1 pr-2">Expected</th>
                            <th className="text-left py-1 pr-2">Got</th>
                            <th className="text-right py-1">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentResult.results.map((tr, i) => (
                            <tr key={i} className="border-b border-rim/50">
                              <td className="py-1.5 pr-2 text-annotation">
                                {i + 1}
                                {tr.hidden && <span className="badge-accent text-2xs ml-1">Hidden</span>}
                              </td>
                              <td className="py-1.5 pr-2 text-ink max-w-32 align-top">
                                <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.hidden ? '—' : tr.input}</pre>
                              </td>
                              <td className="py-1.5 pr-2 text-ink max-w-32 align-top">
                                <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.hidden ? '—' : tr.expected}</pre>
                              </td>
                              <td className="py-1.5 pr-2 text-ink max-w-32 align-top">
                                <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.actual}</pre>
                                {!tr.passed && (tr.stderr || tr.compileOutput) && (
                                  <span className="block mt-0.5 text-alert" title={(tr.compileOutput || tr.stderr)}>
                                    {(tr.compileOutput || tr.stderr).trim().split('\n')[0]}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 text-right">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase ${
                                  tr.passed ? 'bg-verify/12 text-verify' : 'bg-alert/12 text-alert'
                                }`}>
                                  {tr.passed ? 'Pass' : 'Fail'}
                                </span>
                                {tr.marks != null && (
                                  <span className="ml-1 text-2xs text-annotation/60 font-mono">
                                    {tr.earned || 0}/{tr.marks}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {currentResult.perCaseMarks && (
                        <p className="text-2xs text-annotation/50 mt-2">
                          Custom marks configured per test case (visible/hidden inputs are shown as — where confidential).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {aptitudeQuestions.length > 0 && (
            <details className="panel-muted p-4">
              <summary className="text-sm font-display font-bold text-ink cursor-pointer select-none">
                Aptitude Answers ({aptitudeQuestions.length})
              </summary>
              <div className="divide-y divide-rim/30 mt-3">
                {aptitudeQuestions.map((q, i) => {
                  const given = answers[q.id];
                  const correct = q.correct_answer;
                  const isCorrect = given !== undefined && given !== null && given !== '' &&
                    JSON.stringify((Array.isArray(given) ? given : [given]).map(String).sort()) ===
                    JSON.stringify((Array.isArray(correct) ? correct : [correct]).map(String).sort());
                  return (
                    <div key={q.id} className="py-2.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-ink font-medium">Q{i + 1}. {q.text}</span>
                        <span className={`shrink-0 font-mono font-bold ${
                          given === undefined || given === null || given === ''
                            ? 'text-annotation/50'
                            : isCorrect ? 'text-verify' : 'text-alert'
                        }`}>
                          {given === undefined || given === null || given === ''
                            ? 'Unanswered'
                            : isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                      </div>
                      {q.options && (given !== undefined && given !== null && given !== '') && (
                        <p className="text-annotation/70 mt-1">
                          Answered: {(Array.isArray(given) ? given : [given]).map(idx => q.options[idx]).filter(Boolean).join(', ') || String(given)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
