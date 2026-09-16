import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { submissionsAPI, testsAPI, usersAPI } from '../../services/api';
import { Badge, Spinner, Btn, Modal, Input, Textarea, Tabs } from '../../components/shared/UI';
import SubmissionAnswersModal from './SubmissionAnswersModal';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Admin Results — Live monitoring & leaderboard
 *
 * Designed for the T&P admin watching submissions come in
 * during a live test window. Shows real-time state.
 * ═══════════════════════════════════════════════════════════ */

export default function AdminResults() {
  const { testId } = useParams();
  const qc = useQueryClient();
  const [selectedTest, setSelectedTest] = useState(testId || '');
  const [deleteId, setDeleteId] = useState(null);
  const [emailModal, setEmailModal] = useState(false);
  const [notifyModal, setNotifyModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState('desc');
  const [showDetails, setShowDetails] = useState(true);

  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data: subData, isLoading } = useQuery({
    queryKey: ['submissions', selectedTest],
    queryFn: () => submissionsAPI.getForTest(selectedTest),
    enabled: !!selectedTest,
  });

  // Full question text/descriptions (incl. hidden test cases, since we're
  // admin) for the "View Answers" modal below — the lightweight `tests`
  // list above only has counts, not question content.
  const { data: testDetail } = useQuery({
    queryKey: ['test-detail', selectedTest],
    queryFn: () => testsAPI.get(selectedTest),
    enabled: !!selectedTest,
  });
  const [viewingSubmissionId, setViewingSubmissionId] = useState(null);

  const tests = testsData?.tests || [];
  const allSubs = subData?.submissions || [];
  const test = tests.find(t => t.id === selectedTest);
  const passingScore = test?.settings?.passingScore ?? 40;

  // ── Class-wise filter ───────────────────────────────────
  // Uses class_snapshot (falls back to the student's live class for
  // pre-existing rows) so filtering stays accurate even after a
  // semester reshuffle moves students between classes.
  const [classFilter, setClassFilter] = useState('all');
  const classOptions = [...new Set(allSubs.map(s => s.class_display).filter(Boolean))].sort();
  const subs = classFilter === 'all' ? allSubs : allSubs.filter(s => s.class_display === classFilter);

  // Class-wise breakdown (always computed off the full, unfiltered set)
  const classBreakdown = classOptions.map(c => {
    const rows = allSubs.filter(s => s.class_display === c && (s.status === 'submitted' || s.status === 'auto_submitted') && s.max_score > 0);
    const avg = rows.length ? Math.round(rows.reduce((a, s) => a + (s.score / s.max_score) * 100, 0) / rows.length) : 0;
    const passed = rows.filter(s => (s.score / s.max_score) * 100 >= passingScore).length;
    return { className: c, count: rows.length, avg, passRate: rows.length ? Math.round((passed / rows.length) * 100) : 0 };
  });

  const scored = subs.filter(
    s => (s.status === 'submitted' || s.status === 'auto_submitted') && s.max_score > 0,
  );
  const inProgress = subs.filter(s => s.status === 'in_progress');
  const pendingCount = inProgress.length;

  const avgPct = scored.length
    ? Math.round(
        scored.reduce(
          (a, s) => a + (s.score / s.max_score) * 100,
          0,
        ) / scored.length,
      )
    : 0;
  const passCount = scored.filter(
    s => (s.score / s.max_score) * 100 >= passingScore,
  ).length;

  // Score distribution buckets
  const buckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const dist = buckets.slice(0, -1).map((b, i) => ({
    range: `${b}-${buckets[i + 1]}`,
    count: scored.filter(s => {
      const p = (s.score / s.max_score) * 100;
      return p >= b && p < buckets[i + 1];
    }).length,
    passing: b >= passingScore,
  }));

  // ── Export CSV ─────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  const exportCSV = async () => {
    setExporting(true);
    try {
      const blob = await submissionsAPI.exportCsv(selectedTest, {
        class_name: classFilter !== 'all' ? classFilter : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campus-track_results_${selectedTest}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  // ── Export PDF ─────────────────────────────────────────
  const [exportingPdf, setExportingPdf] = useState(false);

  const exportPDF = async () => {
    setExportingPdf(true);
    try {
      const blob = await submissionsAPI.exportPdf(selectedTest);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campus-track_results_${selectedTest}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Failed to generate PDF report.');
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Publish / unpublish results (manual / after_end modes) ─
  const [publishing, setPublishing] = useState(false);
  const resultsMode = test?.settings?.showResults || 'after_submit';
  const resultsPublished = !!test?.results_published_at;

  const togglePublishResults = async () => {
    if (!selectedTest) return;
    setPublishing(true);
    try {
      if (resultsPublished) {
        await submissionsAPI.unpublishResults(selectedTest);
        toast.success('Results hidden from students again.');
      } else {
        await submissionsAPI.publishResults(selectedTest);
        toast.success('Results published to students.');
      }
      qc.invalidateQueries({ queryKey: ['tests'] });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update results visibility.');
    } finally {
      setPublishing(false);
    }
  };

  // ── Send results email ─────────────────────────────────
  const handleSendResults = async () => {
    if (!selectedTest) return;
    setSending(true);
    try {
      const data = await usersAPI.sendResults({ test_id: selectedTest });
      toast.success(`Results emailed to ${data.sent} student${data.sent !== 1 ? 's' : ''}!`);
      setEmailModal(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send results.');
    } finally {
      setSending(false);
    }
  };

  // ── Notify test scheduled ──────────────────────────────
  const handleNotifyTest = async () => {
    if (!selectedTest) return;
    setSending(true);
    try {
      const data = await usersAPI.notifyTest({ test_id: selectedTest });
      toast.success(`Notifications sent to ${data.sent} student${data.sent !== 1 ? 's' : ''}!`);
      setNotifyModal(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send notifications.');
    } finally {
      setSending(false);
    }
  };

  const deleteMut = useMutation({
    mutationFn: submissionsAPI.delete,
    onSuccess: () => {
      toast.success('Submission deleted');
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
    },
    onError: () => toast.error('Failed to delete'),
  });

  // ── Resume / stop test (admin) ─────────────────────────
  const [resumingId, setResumingId] = useState(null);
  const resumeMut = useMutation({
    mutationFn: (id) => api.post(`/submissions/resume/${id}`).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data.message || 'Test resumed successfully');
      setResumingId(null);
      qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to resume test'),
  });

  const [stoppingId, setStoppingId] = useState(null);
  const stopMut = useMutation({
    mutationFn: submissionsAPI.forceStop,
    onSuccess: (data) => {
      toast.success(data.message || 'Test stopped and graded');
      setStoppingId(null);
      qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to stop test'),
  });

  // ── Manual / bulk marks (admin) ────────────────────────
  const [editingMarksSub, setEditingMarksSub] = useState(null);
  const [bulkMarksOpen, setBulkMarksOpen] = useState(false);
  const [adjustAllOpen, setAdjustAllOpen] = useState(false);

  const adjustAllMut = useMutation({
    mutationFn: (data) => submissionsAPI.adjustAllMarks(selectedTest, data),
    onSuccess: (res) => {
      toast.success(`${res.delta > 0 ? '+' : ''}${res.delta} marks applied to ${res.updated} submission${res.updated === 1 ? '' : 's'}`);
      setAdjustAllOpen(false);
      qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to adjust marks'),
  });

  // ── Search filter ──────────────────────────────────────
  const searchedSubs = useMemo(() => {
    if (!searchQuery.trim()) return subs;
    const q = searchQuery.toLowerCase();
    return subs.filter(s =>
      (s.user_name || '').toLowerCase().includes(q) ||
      (s.user_email || '').toLowerCase().includes(q) ||
      (s.roll_number || '').toLowerCase().includes(q)
    );
  }, [subs, searchQuery]);

  // ── Ranked + sorted submissions ────────────────────────
  // Sort: submitted first (by score descending), then in-progress
  // Or apply custom column sort if specified
  const rankedSubs = useMemo(() => {
    const list = [...searchedSubs];
    if (sortField) {
      list.sort((a, b) => {
        let aVal, bVal;
        switch (sortField) {
          case 'name': aVal = (a.user_name || '').toLowerCase(); bVal = (b.user_name || '').toLowerCase(); break;
          case 'email': aVal = (a.user_email || '').toLowerCase(); bVal = (b.user_email || '').toLowerCase(); break;
          case 'roll': aVal = (a.roll_number || '').toLowerCase(); bVal = (b.roll_number || '').toLowerCase(); break;
          case 'score':
            aVal = a.max_score > 0 ? (a.score || 0) / a.max_score : -1;
            bVal = b.max_score > 0 ? (b.score || 0) / b.max_score : -1;
            break;
          case 'time': aVal = a.time_taken_seconds || 0; bVal = b.time_taken_seconds || 0; break;
          case 'percentage': aVal = a.max_score > 0 ? (a.score || 0) / a.max_score * 100 : 0; bVal = b.max_score > 0 ? (b.score || 0) / b.max_score * 100 : 0; break;
          default: aVal = a[sortField]; bVal = b[sortField];
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      const isDone = (s) => s.status === 'submitted' || s.status === 'auto_submitted';
      list.sort(
        (a, b) =>
          (isDone(b) ? 1 : 0) - (isDone(a) ? 1 : 0) ||
          (b.max_score > 0 ? b.score / b.max_score : 0) -
            (a.max_score > 0 ? a.score / a.max_score : 0),
      );
    }
    return list;
  }, [searchedSubs, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'email' || field === 'roll' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="opacity-20 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="section-header flex-wrap gap-3">
        <div>
          <h1 className="section-title">Results</h1>
          <p className="section-subtitle">
            {selectedTest
              ? `${subs.length} submissions · ${pendingCount} still submitting`
              : 'Select a test to view results'}
          </p>
        </div>
        {selectedTest && subs.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {(resultsMode === 'manual' || resultsMode === 'after_end') && (
              <Btn
                variant={resultsPublished ? 'ghost' : 'primary'}
                size="sm"
                onClick={togglePublishResults}
                disabled={publishing}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="ml-1.5">
                  {publishing ? 'Updating…' : resultsPublished ? 'Results Published' : 'Publish Results'}
                </span>
              </Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={() => setBulkMarksOpen(true)}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M9 17v-2a4 4 0 014-4h4M9 17H5a2 2 0 01-2-2V7a2 2 0 012-2h9l5 5v5a2 2 0 01-2 2h-1" />
                <path strokeLinecap="round" d="M13 17l3 3 3-3" />
              </svg>
              Bulk Marks
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => setAdjustAllOpen(true)}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M12 4v16m8-8H4" />
              </svg>
              Adjust All Marks
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => setNotifyModal(true)}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Notify
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => setEmailModal(true)}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email Results
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={exportCSV}
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <Spinner size={13} className="text-deck" />
                  <span className="ml-1.5">Exporting…</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  <span className="ml-1.5">Export CSV</span>
                </>
              )}
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={exportPDF}
              disabled={exportingPdf}
            >
              {exportingPdf ? (
                <>
                  <Spinner size={13} className="text-deck" />
                  <span className="ml-1.5">Generating…</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="ml-1.5">Export PDF</span>
                </>
              )}
            </Btn>
          </div>
        )}
      </div>

      {/* Test selector */}
      <div className="panel p-3 mb-5 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="results-test" className="text-2xs text-annotation/60 mb-1.5">
            Select Test
          </label>
          <select
            id="results-test"
            value={selectedTest}
            onChange={e => { setSelectedTest(e.target.value); setClassFilter('all'); setSearchQuery(''); }}
            className="select-field max-w-sm"
          >
            <option value="">— Select a test —</option>
            {tests.map(t => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.submission_count || 0} submissions)
              </option>
            ))}
          </select>
        </div>
        {selectedTest && classOptions.length > 0 && (
          <div>
            <label htmlFor="results-class" className="text-2xs text-annotation/60 mb-1.5">
              Class
            </label>
            <select
              id="results-class"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              className="select-field max-w-xs"
            >
              <option value="all">All classes (consolidated)</option>
              {classOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        {selectedTest && (
          <div className="ml-auto">
            <label htmlFor="results-search" className="text-2xs text-annotation/60 mb-1.5">
              Search student
            </label>
            <input
              id="results-search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Name, email, or roll…"
              className="input-field max-w-56"
            />
          </div>
        )}
      </div>

      {/* Empty / unselected */}
      {!selectedTest && (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="empty-state-title">Select a test</p>
          <p className="empty-state-desc">Choose a test from the dropdown above to view results, score distribution, and student leaderboard.</p>
        </div>
      )}

      {selectedTest && isLoading && (
        <div className="flex justify-center py-16">
          <Spinner size={28} className="text-accent" />
        </div>
      )}

      {selectedTest && !isLoading && (
        <>
          {/* ── Summary cards ──────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <SummaryCard label="Total" value={subs.length} accent="clarify" />
            <SummaryCard label="Average" value={`${avgPct}%`} accent="accent" />
            <SummaryCard label="Passed" value={passCount} accent="verify" />
            <SummaryCard
              label="Pass Rate"
              value={
                scored.length
                  ? `${Math.round((passCount / scored.length) * 100)}%`
                  : '—'
              }
              accent="alert"
            />
          </div>

          {/* ── Live indicator + pending count ─────────────── */}
          {pendingCount > 0 && (
            <div className="panel-muted p-3 mb-5 flex items-center gap-3 border-accent/30">
              <span className="live-dot" />
              <span className="text-sm font-semibold text-accent">
                {pendingCount} candidate{pendingCount !== 1 ? 's' : ''} still submitting
              </span>
              <span className="text-xs text-annotation/60">
                — results update automatically
              </span>
            </div>
          )}

          {/* ── Score Distribution ─────────────────────────── */}
          {scored.length > 0 && (
            <div className="panel p-4 mb-5">
              <h3 className="text-xs font-display font-bold text-ink mb-3">
                Score Distribution
              </h3>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={dist} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#6E6444' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6E6444' }} allowDecimals={false} />
                  <Tooltip
                    formatter={v => [`${v} students`]}
                    contentStyle={{
                      background: '#FBF9F2',
                      border: '1px solid #DFD4B8',
                      borderRadius: '8px',
                      color: '#2A2419',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {dist.map((d, i) => (
                      <Cell key={i} fill={d.passing ? '#4B7B3F' : '#AE4331'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center mt-2 text-2xs text-annotation/60">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-verify rounded-sm inline-block" />
                  Pass (≥40%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-alert rounded-sm inline-block" />
                  Fail ({ "<" }40%)
                </span>
              </div>
            </div>
          )}

          {/* ── Class-wise Breakdown ───────────────────────── */}
          {classFilter === 'all' && classBreakdown.length > 1 && (
            <div className="panel p-4 mb-5">
              <h3 className="text-xs font-display font-bold text-ink mb-3">
                Class-wise Breakdown
              </h3>
              <div className="table-wrap">
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Submitted</th>
                        <th>Average</th>
                        <th>Pass Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classBreakdown.map(c => (
                        <tr key={c.className} className="cursor-pointer hover:bg-panel/60" onClick={() => setClassFilter(c.className)}>
                          <td className="font-medium text-sm text-ink">{c.className}</td>
                          <td>{c.count}</td>
                          <td className="font-mono">{c.avg}%</td>
                          <td className="font-mono">{c.passRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-2xs text-annotation/50 mt-2">Click a row to filter the leaderboard below to that class.</p>
            </div>
          )}

          {/* ── Leaderboard Table ──────────────────────────── */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-base text-ink">Leaderboard</h3>
            <button
              onClick={() => setShowDetails(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-annotation hover:text-ink transition-colors"
              aria-pressed={showDetails}
            >
              {showDetails ? 'Compact view' : 'Full view'}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
          <div className="table-wrap">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th className="cursor-pointer hover:text-accent select-none" onClick={() => handleSort('name')}>
                      Student <SortIcon field="name" />
                    </th>
                    {showDetails && (
                      <th className="hidden sm:table-cell cursor-pointer hover:text-accent select-none" onClick={() => handleSort('roll')}>
                        Roll / Branch <SortIcon field="roll" />
                      </th>
                    )}
                    <th className="cursor-pointer hover:text-accent select-none" onClick={() => handleSort('score')}>
                      Score <SortIcon field="score" />
                    </th>
                    <th className="cursor-pointer hover:text-accent select-none" onClick={() => handleSort('percentage')}>
                      % <SortIcon field="percentage" />
                    </th>
                    <th>Status</th>
                    {showDetails && (
                      <th className="hidden md:table-cell cursor-pointer hover:text-accent select-none" onClick={() => handleSort('time')}>
                        Time <SortIcon field="time" />
                      </th>
                    )}
                    {showDetails && <th className="hidden lg:table-cell">Submitted</th>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rankedSubs.length === 0 ? (
                    <tr>
                      <td colSpan={showDetails ? 9 : 5} className="text-center py-10">
                        <div className="flex flex-col items-center gap-2">
                          <svg className="w-8 h-8 text-annotation/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          <p className="text-sm text-annotation font-medium">No submissions yet</p>
                          <p className="text-xs text-annotation/60 max-w-xs">
                            Make sure the test is published and students are enrolled. You can notify students from this page once submissions start coming in.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rankedSubs.map((s, i) => {
                      const pct =
                        s.max_score > 0
                          ? Math.round((s.score / s.max_score) * 100)
                          : 0;
                      const isPending = s.status === 'in_progress';
                      const isPassed = pct >= passingScore;

                      return (
                        <tr key={s.id} className={isPending ? 'opacity-60' : ''}>
                          <td>
                            <span className="rank-num text-annotation/60">
                              {isPending ? '—' : i + 1}
                            </span>
                          </td>
                          <td>
                            <Link to={`/admin/analytics/students/${s.user_id}`}
                              className="font-medium text-sm text-ink hover:text-accent transition-colors">
                              {s.user_name}
                            </Link>
                            <div className="text-xs text-annotation/60">
                              {s.user_email}
                            </div>
                          </td>
                          {showDetails && (
                          <td className="hidden sm:table-cell">
                            <span className="text-xs text-annotation/70">
                              {s.roll_number || '—'}
                              {s.branch ? ` · ${s.branch}` : ''}
                            </span>
                          </td>
                          )}
                          <td>
                            <span className="font-mono font-bold text-sm text-ink score-digit">
                              {isPending ? '—' : `${s.score}/${s.max_score}`}
                            </span>
                          </td>
                          <td>
                            {isPending ? (
                              <span className="text-xs text-annotation/50 font-mono">—</span>
                            ) : (
                              <span
                                className={`font-mono font-bold text-sm score-digit ${
                                  isPassed ? 'text-verify' : 'text-alert'
                                }`}
                              >
                                {pct}%
                              </span>
                            )}
                          </td>
                          <td>
                            {isPending ? (
                              <span className="badge-accent text-2xs">In Progress</span>
                            ) : (
                              <Badge color={isPassed ? 'verify' : 'alert'}>
                                {isPassed ? 'Passed' : 'Failed'}
                              </Badge>
                            )}
                          </td>
                          {showDetails && (
                          <td className="hidden md:table-cell">
                            <span className="text-xs text-annotation/60 font-mono">
                              {s.time_taken_seconds
                                ? `${Math.floor(s.time_taken_seconds / 60)}m ${
                                    s.time_taken_seconds % 60
                                  }s`
                                : '—'}
                            </span>
                          </td>
                          )}
                          {showDetails && (
                          <td className="hidden lg:table-cell">
                            <span className="text-xs text-annotation/60 font-mono">
                              {s.submitted_at
                                ? format(
                                    new Date(s.submitted_at),
                                    'dd MMM, HH:mm',
                                  )
                                : '—'}
                            </span>
                          </td>
                          )}
                          <td>
                            <div className="flex gap-0.5 justify-end">
                              {!isPending && (
                                <button
                                  onClick={() => setViewingSubmissionId(s.id)}
                                  className="btn-ghost-icon text-annotation hover:text-clarify"
                                  title="View coding & aptitude answers"
                                  aria-label="View answers"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </button>
                              )}
                              {isPending && (
                                <button
                                  onClick={() => setStoppingId(s.id)}
                                  disabled={stopMut.isLoading && stoppingId === s.id}
                                  className="btn-ghost-icon text-alert hover:text-alert"
                                  title="Stop test now for this student"
                                  aria-label="Stop test now for this student"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                                  </svg>
                                </button>
                              )}
                              {(s.status === 'auto_submitted' || s.status === 'submitted') && (
                                <button
                                  onClick={() => setResumingId(s.id)}
                                  disabled={resumeMut.isLoading && resumingId === s.id}
                                  className="btn-ghost-icon text-accent hover:text-clarify"
                                  title="Start / resume test for student"
                                  aria-label="Start / resume test for student"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                              )}
                              {!isPending && (
                                <button
                                  onClick={() => setEditingMarksSub(s)}
                                  className="btn-ghost-icon text-annotation hover:text-accent"
                                  title="Edit marks manually"
                                  aria-label="Edit marks manually"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              )}
                              {!isPending && (
                                <button
                                  onClick={() => setDeleteId(s.id)}
                                  className="btn-ghost-icon text-annotation hover:text-alert"
                                  title="Delete submission"
                                  aria-label="Delete submission"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── View Answers Modal ────────────────────────────── */}
      <SubmissionAnswersModal
        submissionId={viewingSubmissionId}
        test={testDetail}
        onClose={() => setViewingSubmissionId(null)}
      />

      {/* ── Email Results Modal ───────────────────────────── */}
      <Modal
        isOpen={emailModal}
        onClose={() => setEmailModal(false)}
        title="Email Results"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-3">
          Send each student who submitted <strong className="text-ink">{test?.title}</strong> an email with
          their score and result.
        </p>
        <p className="text-xs text-annotation/60 mb-5">
          {scored.length} student{scored.length !== 1 ? 's' : ''} will receive this email.
        </p>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={() => setEmailModal(false)} disabled={sending}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSendResults} disabled={sending}>
            {sending ? (
              <><Spinner size={14} className="text-deck" /> Sending…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send Results
              </>
            )}
          </Btn>
        </div>
      </Modal>

      {/* ── Notify Modal ──────────────────────────────────── */}
      <Modal
        isOpen={notifyModal}
        onClose={() => setNotifyModal(false)}
        title="Notify Students"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-2">
          Email all eligible students about <strong className="text-ink">{test?.title}</strong>.
        </p>
        <AlertBox type="warning" className="mb-5">
          Students will receive the email immediately. Use once.
        </AlertBox>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={() => setNotifyModal(false)} disabled={sending}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleNotifyTest} disabled={sending}>
            {sending ? (
              <><Spinner size={14} className="text-deck" /> Sending…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Notify Now
              </>
            )}
          </Btn>
        </div>
      </Modal>

      {/* ── Resume/Start Test Modal ────────────────────────── */}
      <Modal
        isOpen={!!resumingId}
        onClose={() => setResumingId(null)}
        title="Start / Resume Test"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-2">
          Reopen this student's test so they can continue.
        </p>
        <p className="text-xs text-annotation/60 mb-5">
          The student will regain access with their remaining time preserved. All saved answers will be retained.
        </p>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={() => setResumingId(null)}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={() => {
              resumeMut.mutate(resumingId);
              setResumingId(null);
            }}
            disabled={resumeMut.isLoading}
          >
            {resumeMut.isLoading ? 'Starting…' : 'Start Test'}
          </Btn>
        </div>
      </Modal>

      {/* ── Stop Test Modal ────────────────────────────────── */}
      <Modal
        isOpen={!!stoppingId}
        onClose={() => setStoppingId(null)}
        title="Stop Test Now"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-2">
          End this student's test immediately and grade it from their last saved answers.
        </p>
        <p className="text-xs text-annotation/60 mb-5">
          This cannot be undone directly, but you can Start/Resume the test again afterwards if needed.
        </p>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={() => setStoppingId(null)}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            onClick={() => stopMut.mutate(stoppingId)}
            disabled={stopMut.isLoading}
          >
            {stopMut.isLoading ? 'Stopping…' : 'Stop Test'}
          </Btn>
        </div>
      </Modal>

      {/* ── Edit Marks Modal ───────────────────────────────── */}
      <EditMarksModal
        submission={editingMarksSub}
        onClose={() => setEditingMarksSub(null)}
        onSaved={() => {
          setEditingMarksSub(null);
          qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
        }}
      />

      {/* ── Adjust All Marks Modal ───────────────────────────── */}
      {adjustAllOpen && (
        <AdjustAllMarksModal
          count={subs.filter(s => s.status === 'submitted' || s.status === 'auto_submitted').length}
          onClose={() => setAdjustAllOpen(false)}
          onConfirm={(data) => adjustAllMut.mutate(data)}
          isLoading={adjustAllMut.isLoading}
        />
      )}

      {/* ── Bulk Marks Modal ───────────────────────────────── */}
      <BulkMarksModal
        isOpen={bulkMarksOpen}
        testId={selectedTest}
        onClose={() => setBulkMarksOpen(false)}
        onDone={() => {
          setBulkMarksOpen(false);
          qc.invalidateQueries({ queryKey: ['submissions', selectedTest] });
        }}
      />

      {/* ── Delete Modal ──────────────────────────────────── */}
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Submission?"
        width="max-w-sm"
      >
        <p className="text-sm text-annotation mb-4">
          This will permanently remove this test attempt. Cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={() => setDeleteId(null)}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            onClick={() => deleteMut.mutate(deleteId)}
            disabled={deleteMut.isLoading}
          >
            {deleteMut.isLoading ? 'Deleting…' : 'Delete'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

/* ── Summary Card ─────────────────────────────────────────── */
function SummaryCard({ label, value, accent = 'clarify' }) {
  const accentColors = {
    clarify: 'text-clarify',
    accent: 'text-accent',
    verify: 'text-verify',
    alert: 'text-alert',
  };
  return (
    <div className="panel p-3 text-center">
      <div className="text-2xs text-annotation/60 mb-0.5">
        {label}
      </div>
      <div
        className={`text-lg font-display font-bold score-digit ${
          accentColors[accent] || 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Local Alert (not importing Alert to avoid circular UI issue with the new design) ── */
function AlertBox({ type = 'info', children, className = '' }) {
  const map = {
    info:    'bg-clarify/10 border-clarify/20 text-clarify',
    accent:  'bg-accent/10 border-accent/20 text-accent',
    success: 'bg-verify/10 border-verify/20 text-verify',
    error:   'bg-alert/10 border-alert/20 text-alert',
  };
  return (
    <div
      className={`flex items-start gap-2 text-sm px-3.5 py-2.5 rounded-lg border ${map[type] || map.info} ${className}`}
    >
      <span>{children}</span>
    </div>
  );
}

/* ── Edit Marks (single submission, manual override) ────────── */
function EditMarksModal({ submission, onClose, onSaved }) {
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [note, setNote] = useState('');

  // This modal is one long-lived component instance reused for every
  // student (only its `submission` prop changes), so its state was never
  // reset between them. Re-seed it with THIS submission's actual current
  // values every time a different student is opened: without this,
  // (a) the score/max-score fields either stayed blank on a fresh open —
  // Save is disabled while score is blank, so clicking it silently did
  // nothing, which is exactly "marks did not update at all" — or
  // (b) kept whatever the *previous* student's edit had left in them,
  // which is the "previously entered marks stay there" bug, and could
  // silently re-save the wrong student's number.
  useEffect(() => {
    if (submission) {
      setScore(String(submission.score ?? 0));
      setMaxScore(String(submission.max_score ?? 0));
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.id]);

  const mut = useMutation({
    mutationFn: (data) => submissionsAPI.updateMarks(submission.id, data),
    onSuccess: () => { toast.success('Marks updated'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update marks'),
  });

  const open = !!submission;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Edit Marks"
      width="max-w-sm"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={score === '' || mut.isLoading}
            onClick={() => mut.mutate({
              score: Number(score),
              maxScore: maxScore === '' ? undefined : Number(maxScore),
              note: note || undefined,
            })}
          >
            {mut.isLoading ? 'Saving…' : 'Save Marks'}
          </Btn>
        </>
      }
    >
      {submission && (
        <div className="space-y-4">
          <p className="text-sm text-annotation">
            Manually set the score for <strong className="text-ink">{submission.user_name}</strong>.
            Use this for partial credit, disputes, or answers the auto-grader can't evaluate.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Score *"
              type="number"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
            <Input
              label="Max score"
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </div>
          <Textarea
            label="Note (optional)"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for the manual override…"
          />
        </div>
      )}
    </Modal>
  );
}

/* ── Adjust All Marks (flat curve/penalty across the whole test) ── */
function AdjustAllMarksModal({ count, onClose, onConfirm, isLoading }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const parsed = Number(amount);
  const canSave = amount !== '' && !Number.isNaN(parsed) && parsed !== 0;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Adjust All Marks"
      width="max-w-sm"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!canSave || isLoading}
            onClick={() => onConfirm({ amount: parsed, note: note || undefined })}
          >
            {isLoading ? 'Applying…' : `Apply to ${count} student${count === 1 ? '' : 's'}`}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-annotation">
          Adds (or subtracts) the same amount to every graded submission for this test — e.g. to credit a
          question that turned out to be ambiguous for everyone. Each student's score is clamped between
          0 and their own max score.
        </p>
        <Input
          label="Amount *"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 2 or -1"
          hint="Positive adds marks, negative subtracts."
        />
        <Textarea
          label="Note (optional)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for this adjustment…"
        />
      </div>
    </Modal>
  );
}

/* ── Bulk Marks (CSV/JSON import) ─────────────────────────────── */
const BULK_MARKS_SAMPLE_CSV = `rollNumber,score,maxScore
21CE001,42,50
21CE002,38,50`;
const BULK_MARKS_SAMPLE_JSON = `[
  { "rollNumber": "21CE001", "score": 42, "maxScore": 50 },
  { "email": "student@college.edu", "score": 38 }
]`;

function BulkMarksModal({ isOpen, testId, onClose, onDone }) {
  const [mode, setMode] = useState('csv');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const csvMut = useMutation({
    mutationFn: submissionsAPI.bulkMarksCsv,
    onSuccess: (data) => { setResult(data); if (!data.errors?.length) onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Import failed'),
  });
  const jsonMut = useMutation({
    mutationFn: submissionsAPI.bulkMarksJson,
    onSuccess: (data) => { setResult(data); if (!data.errors?.length) onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Import failed'),
  });

  const isJson = mode === 'json';
  const loading = csvMut.isLoading || jsonMut.isLoading;

  const submit = () => {
    setError(null);
    setResult(null);
    if (!testId) { setError('Select a test first.'); return; }
    if (isJson) {
      try {
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries) || !entries.length) throw new Error('JSON must be a non-empty array');
        jsonMut.mutate({ testId, entries });
      } catch (e) {
        setError(e.message);
      }
    } else {
      csvMut.mutate({ testId, csv: raw });
    }
  };

  const reset = () => { setRaw(''); setError(null); setResult(null); onClose(); };

  return (
    <Modal
      isOpen={isOpen}
      onClose={reset}
      title="Bulk Marks Import"
      width="max-w-2xl"
      footer={
        <>
          <Btn variant="ghost" onClick={reset}>Close</Btn>
          <Btn variant="primary" onClick={submit} disabled={!raw.trim() || loading}>
            {loading ? <Spinner size={14} /> : 'Import Marks'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-annotation">
          Match students by roll number or email, then set their score for the currently selected test.
          Rows that don't match an existing submission are skipped and reported below.
        </p>
        <Tabs
          tabs={[{ id: 'csv', label: 'CSV' }, { id: 'json', label: 'JSON' }]}
          active={mode}
          onChange={(m) => { setMode(m); setResult(null); setError(null); }}
        />
        {isJson ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="input-label">JSON — array of {`{ rollNumber | email, score, maxScore? }`}</label>
              <button className="text-xs text-accent hover:underline" onClick={() => setRaw(BULK_MARKS_SAMPLE_JSON)}>Load sample</button>
            </div>
            <Textarea rows={8} value={raw} onChange={e => setRaw(e.target.value)} placeholder={BULK_MARKS_SAMPLE_JSON} className="font-mono text-xs" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="input-label">CSV — columns: rollNumber (or email), score, maxScore (optional)</label>
              <button className="text-xs text-accent hover:underline" onClick={() => setRaw(BULK_MARKS_SAMPLE_CSV)}>Load sample</button>
            </div>
            <Textarea rows={6} value={raw} onChange={e => setRaw(e.target.value)} placeholder={BULK_MARKS_SAMPLE_CSV} className="font-mono text-xs" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-annotation">Or upload a .csv file:</span>
              <input
                type="file"
                accept=".csv"
                aria-label="Upload CSV file"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setRaw(ev.target.result);
                  reader.readAsText(file);
                }}
                className="text-xs text-annotation file:mr-2 file:py-0.5 file:px-2 file:rounded file:border file:border-rim file:text-xs file:bg-panel file:text-ink hover:file:bg-sunken transition-colors"
              />
            </div>
          </div>
        )}
        {error && <AlertBox type="error">{error}</AlertBox>}
        {result && (
          <AlertBox type={result.errors?.length ? 'error' : 'success'}>
            <div>
              {result.updated || 0} updated
              {result.skipped ? `, ${result.skipped} skipped` : ''}.
              {result.errors?.length ? (
                <ul className="mt-1.5 list-disc pl-4 text-xs space-y-0.5">
                  {result.errors.slice(0, 8).map((er, i) => (
                    <li key={i}>{typeof er === 'string' ? er : (er.message || JSON.stringify(er))}</li>
                  ))}
                  {result.errors.length > 8 && <li>…and {result.errors.length - 8} more</li>}
                </ul>
              ) : null}
            </div>
          </AlertBox>
        )}
      </div>
    </Modal>
  );
}