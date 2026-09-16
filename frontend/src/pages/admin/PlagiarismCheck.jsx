import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { testsAPI, plagiarismAPI } from '../../services/api';
import api from '../../services/api';
import { Btn, Spinner, Badge, Modal } from '../../components/shared/UI';
import toast from 'react-hot-toast';

// Pairs have no id of their own (recomputed fresh every check) — the two
// submission ids together are the stable identity for selection.
const pairKey = (p) => `${p.student_a.submissionId}|${p.student_b.submissionId}`;

const ACTION_LABEL = { ignore: 'Ignore', warn: 'Warn', disqualify: 'Disqualify' };
const ACTION_MESSAGE = {
  ignore: 'These pairs will be dismissed and won’t reappear in future checks. No action is taken against either student.',
  warn: 'Both students in each selected pair will get an in-app notification that their submission was flagged for code similarity.',
  disqualify: 'Both submissions in each selected pair will be marked disqualified for this test — this can’t be undone from here.',
};

export default function PlagiarismCheck() {
  const qc = useQueryClient();
  const [selectedTest, setSelectedTest] = useState('all');
  const [filterTestId, setFilterTestId] = useState('all');
  const [threshold, setThreshold] = useState(0.7);
  const [minTabSwitches, setMinTabSwitches] = useState(0);
  const [showCode, setShowCode] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [selected, setSelected] = useState(() => new Set());
  const [pendingAction, setPendingAction] = useState(null);

  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data, isLoading } = useQuery({
    queryKey: ['plagiarism', selectedTest, threshold, minTabSwitches],
    queryFn: () => api.get(`/submissions/plagiarism-check/${selectedTest || 'all'}`, {
      params: { threshold, minTabSwitches }
    }).then(r => r.data),
    enabled: !!selectedTest,
  });

  const tests = testsData?.tests || [];
  const rawPairs = data?.pairs || [];

  // Filter pairs locally by secondary test filter if 'all' tests is selected
  const pairs = useMemo(() => {
    if (selectedTest === 'all' && filterTestId !== 'all') {
      return rawPairs.filter(p => p.test_id === filterTestId);
    }
    return rawPairs;
  }, [rawPairs, selectedTest, filterTestId]);

  const bulkActionMut = useMutation({
    mutationFn: (action) => {
      const targeted = pairs.filter(p => selected.has(pairKey(p))).map(p => ({
        submissionIdA: p.student_a.submissionId,
        submissionIdB: p.student_b.submissionId,
        similarity: p.similarity,
        problemId: p.problem_id,
        testId: p.test_id || selectedTest,
      }));
      return plagiarismAPI.bulkAction(selectedTest, targeted, action);
    },
    onSuccess: (res) => {
      const extra = res.action === 'disqualify' ? `, ${res.disqualified} submission(s) disqualified`
        : res.action === 'warn' ? `, ${res.warned} student(s) notified` : '';
      toast.success(`${ACTION_LABEL[res.action]} applied to ${res.pairsProcessed} pair${res.pairsProcessed === 1 ? '' : 's'}${extra}`);
      setSelected(new Set());
      setPendingAction(null);
      qc.invalidateQueries({ queryKey: ['plagiarism', selectedTest] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to apply action'),
  });

  const toggleOne = (key) => setSelected(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const allSelected = pairs.length > 0 && pairs.every(p => selected.has(pairKey(p)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pairs.map(pairKey)));

  const students = useMemo(() => {
    const set = new Set();
    pairs.forEach(p => {
      set.add(p.student_a.name);
      set.add(p.student_b.name);
    });
    return Array.from(set).sort();
  }, [pairs]);

  const similarityMatrix = useMemo(() => {
    const matrix = {};
    pairs.forEach(p => {
      const key = [p.student_a.name, p.student_b.name].sort().join('||');
      if (!matrix[key] || matrix[key].similarity < p.similarity) {
        matrix[key] = p;
      }
    });
    return matrix;
  }, [pairs]);

  const getHeatColor = (pct) => {
    if (pct >= 85) return 'bg-alert/30';
    if (pct >= 70) return 'bg-accent/30';
    if (pct >= 50) return 'bg-clarify/30';
    return 'bg-annotation/10';
  };

  const tabSwitchesCount = useMemo(() => {
    return pairs.filter(p => (p.student_a.tabSwitches > 0 || p.student_b.tabSwitches > 0)).length;
  }, [pairs]);

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Plagiarism & Integrity Detection</h1>
          <p className="section-subtitle">Code similarity analysis & tab-switch proctoring flags</p>
        </div>
      </div>

      {/* Control Panel / Filters */}
      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Test Selector */}
          <div>
            <label className="text-2xs text-annotation/60 mb-1.5 block font-medium">Select Test</label>
            <select
              className="select-field max-w-xs"
              value={selectedTest}
              onChange={e => {
                setSelectedTest(e.target.value);
                setFilterTestId('all');
                setSelected(new Set());
              }}
            >
              <option value="all">All Tests (Aggregate View)</option>
              {tests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>

          {/* Secondary Test Filter when viewing 'All Tests' */}
          {selectedTest === 'all' && tests.length > 0 && (
            <div>
              <label className="text-2xs text-annotation/60 mb-1.5 block font-medium">Filter by Specific Test</label>
              <select
                className="select-field max-w-xs"
                value={filterTestId}
                onChange={e => setFilterTestId(e.target.value)}
              >
                <option value="all">All Tests ({tests.length})</option>
                {tests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          )}

          {/* Similarity Threshold */}
          <div>
            <label className="text-2xs text-annotation/60 mb-1.5 block font-medium">Similarity Threshold</label>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.3" max="1.0" step="0.05" value={threshold}
                onChange={e => { setThreshold(parseFloat(e.target.value)); setSelected(new Set()); }}
                className="w-28 accent-accent"
              />
              <span className="text-xs text-annotation font-mono font-semibold">{Math.round(threshold * 100)}%</span>
            </div>
          </div>

          {/* Tab Switch Filter */}
          <div>
            <label className="text-2xs text-annotation/60 mb-1.5 block font-medium">Tab Switches Filter</label>
            <select
              className="select-field text-xs"
              value={minTabSwitches}
              onChange={e => { setMinTabSwitches(parseInt(e.target.value, 10)); setSelected(new Set()); }}
            >
              <option value={0}>All Submissions (0+ switches)</option>
              <option value={1}>⚡ 1+ Tab Switch</option>
              <option value={3}>⚠️ 3+ Tab Switches</option>
              <option value={5}>🚨 5+ Tab Switches (High Risk)</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          {pairs.length > 0 && (
            <div className="flex gap-1 shrink-0 self-end">
              <Btn variant={viewMode === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('list')}>List</Btn>
              <Btn variant={viewMode === 'heatmap' ? 'primary' : 'ghost'} size="sm" onClick={() => setViewMode('heatmap')}>Heatmap</Btn>
            </div>
          )}
        </div>

        {/* Stats bar summary */}
        {data && (
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-rim/40 text-xs text-annotation/70">
            <div className="flex items-center gap-4">
              <span><strong>{pairs.length}</strong> flagged pairs</span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${tabSwitchesCount > 0 ? 'bg-alert' : 'bg-annotation/40'}`} />
                <strong className={tabSwitchesCount > 0 ? 'text-alert font-bold' : ''}>{tabSwitchesCount}</strong> with tab switches
              </span>
              <span>•</span>
              <span><strong>{data.total_code_entries || 0}</strong> code entries analyzed</span>
            </div>
            {minTabSwitches > 0 && (
              <span className="text-2xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-mono">
                Filtering by ≥ {minTabSwitches} tab switch{minTabSwitches !== 1 ? 'es' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {!selectedTest && (
        <div className="empty-state">
          <p className="empty-state-title">Select a test</p>
          <p className="empty-state-desc">Choose a test with coding submissions to check for plagiarism.</p>
        </div>
      )}

      {selectedTest && isLoading && (
        <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>
      )}

      {selectedTest && !isLoading && pairs.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-title">No matching pairs found</p>
          <p className="empty-state-desc">
            No submissions matched above {Math.round(threshold * 100)}% similarity
            {minTabSwitches > 0 ? ` with at least ${minTabSwitches} tab switches` : ''}.
          </p>
        </div>
      )}

      {/* Heatmap View */}
      {viewMode === 'heatmap' && students.length > 0 && (
        <div className="panel p-4 overflow-x-auto">
          <div className="text-xs font-bold text-ink mb-3">Similarity Heatmap</div>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left p-1 text-annotation/60 font-medium"></th>
                {students.map(s => (
                  <th key={s} className="p-1 text-annotation/60 font-medium truncate max-w-[80px]" title={s}>{s.split(' ')[0]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s1, i) => (
                <tr key={s1}>
                  <td className="p-1 text-annotation/60 font-medium truncate max-w-[80px]" title={s1}>{s1.split(' ')[0]}</td>
                  {students.map((s2, j) => {
                    const key = [s1, s2].sort().join('||');
                    const pair = similarityMatrix[key];
                    const isSelf = i === j;
                    return (
                      <td
                        key={s2}
                        className={`p-1 text-center rounded cursor-pointer transition-opacity hover:opacity-80 ${isSelf ? 'bg-ink/5' : pair ? getHeatColor(pair.similarity) : ''}`}
                        onClick={() => {
                          if (pair) {
                            if (pair.student_a.name === s1 || pair.student_a.name === s2) {
                              setShowCode(pair);
                            }
                          }
                        }}
                        title={pair ? `${s1} ↔ ${s2}: ${pair.similarity}% (${pair.test_title || 'Test'})` : isSelf ? '' : 'No match'}
                      >
                        {isSelf ? '—' : pair ? `${pair.similarity}%` : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && pairs.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-annotation cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-accent w-3.5 h-3.5 cursor-pointer" />
              Select all ({pairs.length})
            </label>
            {selected.size > 0 && (
              <div className="flex gap-2 ml-auto">
                <Btn variant="ghost" size="sm" onClick={() => setPendingAction('ignore')}>
                  Ignore ({selected.size})
                </Btn>
                <Btn variant="warning" size="sm" onClick={() => setPendingAction('warn')}>
                  Warn ({selected.size})
                </Btn>
                <Btn variant="danger" size="sm" onClick={() => setPendingAction('disqualify')}>
                  Disqualify ({selected.size})
                </Btn>
              </div>
            )}
          </div>

          {pairs.map((pair, idx) => {
            const key = pairKey(pair);
            const sa = pair.student_a;
            const sb = pair.student_b;
            return (
              <div key={idx} className={`panel p-4 hover:ring-1 hover:ring-accent/20 transition-all ${selected.has(key) ? 'ring-1 ring-accent/40 bg-accent/5' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleOne(key)}
                      className="accent-accent w-3.5 h-3.5 cursor-pointer mt-1.5 shrink-0"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pair.similarity >= 85 ? 'var(--ct-alert)' : pair.similarity >= 70 ? 'var(--ct-accent)' : 'var(--ct-clarify)' }} />
                          <span className={`text-xl font-bold font-mono ${
                            pair.similarity >= 85 ? 'text-alert' : pair.similarity >= 70 ? 'text-accent' : 'text-clarify'
                          }`}>{pair.similarity}%</span>
                        </div>
                        <Badge color={pair.similarity >= 85 ? 'alert' : pair.similarity >= 70 ? 'accent' : 'clarify'}>
                          {pair.similarity >= 85 ? 'High Similarity' : pair.similarity >= 70 ? 'Medium Similarity' : 'Low Similarity'}
                        </Badge>

                        {pair.test_title && (
                          <span className="text-2xs bg-deck border border-rim px-2 py-0.5 rounded text-annotation font-medium">
                            Test: {pair.test_title}
                          </span>
                        )}
                      </div>

                      {/* Student comparison grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-2.5 bg-deck/50 rounded-lg border border-rim/40">
                        {/* Student A */}
                        <div className="text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink">{sa.name}</span>
                            <span className={`px-2 py-0.5 rounded text-2xs font-mono font-medium ${
                              sa.tabSwitches > 0
                                ? (sa.tabSwitches >= 3 ? 'bg-alert/20 text-alert border border-alert/30 font-bold' : 'bg-warning/20 text-warning border border-warning/30')
                                : 'bg-sunken text-annotation/60'
                            }`}>
                              ⚡ {sa.tabSwitches || 0} tab switch{sa.tabSwitches !== 1 ? 'es' : ''}
                            </span>
                          </div>
                          <div className="text-annotation/60 text-2xs flex gap-2">
                            <span>{sa.email}</span>
                            {sa.roll && <span>({sa.roll})</span>}
                          </div>
                        </div>

                        {/* Student B */}
                        <div className="text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink">{sb.name}</span>
                            <span className={`px-2 py-0.5 rounded text-2xs font-mono font-medium ${
                              sb.tabSwitches > 0
                                ? (sb.tabSwitches >= 3 ? 'bg-alert/20 text-alert border border-alert/30 font-bold' : 'bg-warning/20 text-warning border border-warning/30')
                                : 'bg-sunken text-annotation/60'
                            }`}>
                              ⚡ {sb.tabSwitches || 0} tab switch{sb.tabSwitches !== 1 ? 'es' : ''}
                            </span>
                          </div>
                          <div className="text-annotation/60 text-2xs flex gap-2">
                            <span>{sb.email}</span>
                            {sb.roll && <span>({sb.roll})</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 text-2xs text-annotation/60 font-mono pt-1">
                        <span>Jaccard: {pair.jaccard}%</span>
                        <span>Levenshtein: {pair.levenshtein}%</span>
                        {pair.ast_similarity !== undefined && <span>AST: {pair.ast_similarity}%</span>}
                        <span>Language: {pair.language}</span>
                      </div>
                    </div>
                  </div>
                  <Btn variant="ghost" size="sm" onClick={() => setShowCode(pair)}>
                    View Code
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk action confirm modal */}
      <Modal
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        title={pendingAction ? `${ACTION_LABEL[pendingAction]} ${selected.size} pair${selected.size === 1 ? '' : 's'}` : ''}
        width="max-w-sm"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setPendingAction(null)}>Cancel</Btn>
            <Btn
              variant={pendingAction === 'disqualify' ? 'danger' : pendingAction === 'warn' ? 'warning' : 'primary'}
              onClick={() => bulkActionMut.mutate(pendingAction)}
              disabled={bulkActionMut.isLoading}
            >
              {bulkActionMut.isLoading ? 'Applying…' : `Confirm ${pendingAction ? ACTION_LABEL[pendingAction] : ''}`}
            </Btn>
          </>
        }
      >
        <p className="text-sm text-annotation">{pendingAction ? ACTION_MESSAGE[pendingAction] : ''}</p>
      </Modal>

      {/* Code comparison modal */}
      <Modal isOpen={!!showCode} onClose={() => setShowCode(null)} title="Code & Security Comparison" width="max-w-5xl">
        {showCode && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-sunken rounded-lg border border-rim">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: showCode.similarity >= 85 ? 'var(--ct-alert)' : 'var(--ct-accent)' }} />
                  <span className="text-sm font-bold text-ink">{showCode.similarity}% code similarity</span>
                </div>
                <Badge color={showCode.similarity >= 85 ? 'alert' : 'accent'}>{showCode.language}</Badge>
                {showCode.test_title && <span className="text-xs text-annotation font-medium">• {showCode.test_title}</span>}
              </div>
              {showCode.matched_passages?.length > 0 && (
                <span className="text-2xs text-annotation/60">{showCode.matched_passages.length} matching passages</span>
              )}
            </div>

            {/* Security Banner */}
            {(showCode.student_a.tabSwitches > 0 || showCode.student_b.tabSwitches > 0) && (
              <div className="p-3 bg-alert/10 border border-alert/30 rounded-lg text-xs text-alert space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-alert shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  Proctoring Violation Flagged
                </div>
                <div className="flex flex-wrap gap-4 text-annotation text-2xs">
                  <span><strong>{showCode.student_a.name}:</strong> {showCode.student_a.tabSwitches || 0} tab switches, {showCode.student_a.fullscreenExits || 0} fullscreen exits</span>
                  <span><strong>{showCode.student_b.name}:</strong> {showCode.student_b.tabSwitches || 0} tab switches, {showCode.student_b.fullscreenExits || 0} fullscreen exits</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="text-xs font-bold text-ink">{showCode.student_a.name}</p>
                    <p className="text-2xs text-annotation/60">{showCode.student_a.email}</p>
                  </div>
                  <span className={`text-2xs px-2 py-0.5 rounded font-mono font-medium ${
                    showCode.student_a.tabSwitches > 0 ? 'bg-alert/20 text-alert' : 'bg-sunken text-annotation/60'
                  }`}>
                    ⚡ {showCode.student_a.tabSwitches || 0} tab switches
                  </span>
                </div>
                <pre className="text-xs bg-deck p-3 rounded border border-rim overflow-auto max-h-80 whitespace-pre font-mono leading-relaxed">
                  {showCode.code_a.split('\n').map((line, i) => {
                    const isMatched = showCode.matched_passages?.some(m => m.lineA === i);
                    return (
                      <div key={i} className={isMatched ? 'bg-alert/10 -mx-1 px-1 rounded' : ''}>
                        <span className="text-annotation/30 mr-2 select-none">{i + 1}</span>
                        {line || ' '}
                      </div>
                    );
                  })}
                </pre>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="text-xs font-bold text-ink">{showCode.student_b.name}</p>
                    <p className="text-2xs text-annotation/60">{showCode.student_b.email}</p>
                  </div>
                  <span className={`text-2xs px-2 py-0.5 rounded font-mono font-medium ${
                    showCode.student_b.tabSwitches > 0 ? 'bg-alert/20 text-alert' : 'bg-sunken text-annotation/60'
                  }`}>
                    ⚡ {showCode.student_b.tabSwitches || 0} tab switches
                  </span>
                </div>
                <pre className="text-xs bg-deck p-3 rounded border border-rim overflow-auto max-h-80 whitespace-pre font-mono leading-relaxed">
                  {showCode.code_b.split('\n').map((line, i) => {
                    const isMatched = showCode.matched_passages?.some(m => m.lineB === i);
                    return (
                      <div key={i} className={isMatched ? 'bg-alert/10 -mx-1 px-1 rounded' : ''}>
                        <span className="text-annotation/30 mr-2 select-none">{i + 1}</span>
                        {line || ' '}
                      </div>
                    );
                  })}
                </pre>
              </div>
            </div>
            {showCode.matched_passages?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-ink mb-1">Highlighted Matches</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {showCode.matched_passages.slice(0, 10).map((m, i) => (
                    <div key={i} className="text-2xs p-1.5 bg-deck rounded border border-rim flex gap-2">
                      <span className="text-annotation/50 shrink-0">L{m.lineA + 1} ↔ L{m.lineB + 1}</span>
                      <code className="text-ink font-mono truncate">{m.text}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
