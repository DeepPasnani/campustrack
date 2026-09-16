import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { drivesAPI, testsAPI } from '../../services/api';
import { Btn, Spinner, Modal, Badge, ConfirmModal } from '../../components/shared/UI';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Admin Drives — a Drive is a plain grouping of existing Tests,
 * kept together purely for combined analytics/viewing. It has no
 * schedule, duration or passing score of its own; every one of
 * those lives on each linked Test.
 * ═══════════════════════════════════════════════════════════ */

export default function AdminDrives() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetailId, setShowDetailId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const { data: drivesData, isLoading } = useQuery({ queryKey: ['drives'], queryFn: drivesAPI.list });
  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });

  const drives = drivesData?.drives || [];
  const tests = testsData?.tests || [];

  const deleteMut = useMutation({
    mutationFn: drivesAPI.delete,
    onSuccess: () => {
      toast.success('Drive deleted');
      qc.invalidateQueries({ queryKey: ['drives'] });
      setDeleteId(null);
      setShowDetailId(prev => (prev === deleteId ? null : prev));
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => drivesAPI.update(id, data),
    onSuccess: () => { toast.success('Drive updated'); qc.invalidateQueries({ queryKey: ['drives'] }); setEditing(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Drives</h1>
          <p className="section-subtitle">Group tests together for combined analytics and viewing</p>
        </div>
        <Btn variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 4v16m8-8H4" />
          </svg>
          New Drive
        </Btn>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>
      ) : drives.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="empty-state-title">No drives yet</p>
          <p className="empty-state-desc">Create a drive to group tests together and view their combined results in one place.</p>
          <Btn variant="primary" size="sm" onClick={() => setShowCreate(true)}>Create First Drive</Btn>
        </div>
      ) : (
        <div className="grid gap-3">
          {drives.map(d => (
            <div key={d.id} className="panel p-4 hover:ring-1 hover:ring-accent/20 transition-all cursor-pointer"
              onClick={() => setShowDetailId(d.id)}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
                    <Badge color="accent">{d.test_count} test{d.test_count === 1 ? '' : 's'}</Badge>
                  </div>
                  <p className="text-xs text-annotation/70 truncate">{d.description || 'No description'}</p>
                  <div className="flex gap-4 mt-2 text-2xs text-annotation/60">
                    {d.created_by_name && <span>By {d.created_by_name}</span>}
                    <span>Created {format(new Date(d.created_at), 'dd MMM yyyy')}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); setEditing(d); }}
                    className="btn-ghost-icon text-annotation hover:text-accent" title="Edit" aria-label="Edit drive">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteId(d.id); }}
                    className="btn-ghost-icon text-annotation hover:text-alert" title="Delete" aria-label="Delete drive">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Drive Modal */}
      <DriveFormModal isOpen={showCreate} onClose={() => setShowCreate(false)} tests={tests}
        onSave={async (data) => {
          await drivesAPI.create(data);
          toast.success('Drive created');
          qc.invalidateQueries({ queryKey: ['drives'] });
          setShowCreate(false);
        }} />

      {/* Edit Drive Modal (title/description only — tests are managed in the detail view) */}
      <DriveFormModal isOpen={!!editing} onClose={() => setEditing(null)}
        initial={editing}
        onSave={(data) => updateMut.mutateAsync({ id: editing.id, data })} />

      {/* Drive Detail — linked tests + combined analytics */}
      <DriveDetailModal
        isOpen={!!showDetailId}
        driveId={showDetailId}
        allTests={tests}
        onClose={() => setShowDetailId(null)}
        onDelete={(id) => setDeleteId(id)}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Delete Drive"
        confirmLabel="Delete"
        message="This removes the drive and its test grouping. The tests themselves, and all their submissions, are not affected."
      />
    </div>
  );
}

function DriveFormModal({ isOpen, onClose, initial, tests = [], onSave }) {
  const [form, setForm] = useState({ title: initial?.title || '', description: initial?.description || '' });
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [testSearch, setTestSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset local state whenever the modal is (re)opened for a different target
  useEffect(() => {
    if (isOpen) {
      setForm({ title: initial?.title || '', description: initial?.description || '' });
      setSelectedTestIds([]);
      setTestSearch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial?.id]);

  const toggleTest = (id) => setSelectedTestIds(prev =>
    prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
  );

  const filteredTests = tests.filter(t => t.title.toLowerCase().includes(testSearch.toLowerCase()));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { title: form.title, description: form.description };
      if (!initial) payload.testIds = selectedTestIds;
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? 'Edit Drive' : 'Create Drive'} width="max-w-xl">
      <div className="space-y-3">
        <div>
          <label htmlFor="dr-title" className="input-label">Title *</label>
          <input className="input-field" id="dr-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="dr-description" className="input-label">Description</label>
          <textarea className="textarea-field" id="dr-description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        {!initial && (
          <div>
            <label className="input-label">Tests to include</label>
            <input
              value={testSearch}
              onChange={e => setTestSearch(e.target.value)}
              placeholder="Search tests…"
              aria-label="Search tests to add"
              className="input-field text-sm mb-2"
            />
            <div className="rounded-sm border border-rim max-h-48 overflow-y-auto">
              {filteredTests.length === 0 ? (
                <p className="text-2xs text-annotation px-2 py-3">No tests found</p>
              ) : filteredTests.map(t => {
                const checked = selectedTestIds.includes(t.id);
                return (
                  <label key={t.id} className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${checked ? 'bg-accent/[0.06]' : 'hover:bg-sunken'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTest(t.id)} className="accent-accent w-3.5 h-3.5 shrink-0" />
                    <span className="text-sm text-ink truncate">{t.title}</span>
                    <Badge color={t.status === 'published' ? 'verify' : 'accent'}>{t.status}</Badge>
                  </label>
                );
              })}
            </div>
            <p className="text-2xs text-annotation/60 mt-1">{selectedTestIds.length} selected — you can add or remove tests later from the drive's detail view.</p>
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end mt-5">
        <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !form.title.trim()} onClick={handleSave}>
          {saving ? 'Saving…' : initial ? 'Update' : 'Create'}
        </Btn>
      </div>
    </Modal>
  );
}

function DriveDetailModal({ isOpen, driveId, allTests, onClose, onDelete }) {
  const qc = useQueryClient();
  const [addTestId, setAddTestId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['drive', driveId],
    queryFn: () => drivesAPI.get(driveId),
    enabled: isOpen && !!driveId,
  });
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['drive-stats', driveId],
    queryFn: () => drivesAPI.stats(driveId),
    enabled: isOpen && !!driveId,
  });

  const addTestMut = useMutation({
    mutationFn: (testId) => drivesAPI.addTest(driveId, { test_id: testId }),
    onSuccess: () => {
      toast.success('Test added to drive');
      qc.invalidateQueries({ queryKey: ['drive', driveId] });
      qc.invalidateQueries({ queryKey: ['drive-stats', driveId] });
      qc.invalidateQueries({ queryKey: ['drives'] });
      setAddTestId('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add test'),
  });

  const removeTestMut = useMutation({
    mutationFn: (testId) => drivesAPI.removeTest(driveId, testId),
    onSuccess: () => {
      toast.success('Test removed');
      qc.invalidateQueries({ queryKey: ['drive', driveId] });
      qc.invalidateQueries({ queryKey: ['drive-stats', driveId] });
      qc.invalidateQueries({ queryKey: ['drives'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to remove test'),
  });

  if (!isOpen) return null;

  const drive = data?.drive;
  const driveTests = data?.tests || [];
  const stats = statsData?.stats;
  const addedTestIds = driveTests.map(t => t.test_id);
  const availableTests = (allTests || []).filter(t => !addedTestIds.includes(t.id));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={drive?.title || 'Drive'} width="max-w-2xl">
      {isLoading || !drive ? (
        <div className="flex justify-center py-10"><Spinner size={24} className="text-accent" /></div>
      ) : (
        <div className="space-y-5">
          {drive.description && <p className="text-sm text-annotation">{drive.description}</p>}

          {/* Combined analytics */}
          <div>
            <h4 className="text-xs font-bold text-ink mb-2">Combined Analytics</h4>
            {statsLoading ? (
              <div className="flex justify-center py-6"><Spinner size={20} className="text-accent" /></div>
            ) : !stats || driveTests.length === 0 ? (
              <p className="text-xs text-annotation/50 py-2">Add tests to this drive to see combined analytics.</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 text-center mb-3">
                  <div className="panel p-2.5"><div className="text-lg font-bold text-accent">{stats.total_students}</div><div className="text-2xs text-annotation/60">Students</div></div>
                  <div className="panel p-2.5"><div className="text-lg font-bold text-clarify">{stats.total_submissions}</div><div className="text-2xs text-annotation/60">Submissions</div></div>
                  <div className="panel p-2.5"><div className="text-lg font-bold text-verify">{stats.avg_score}%</div><div className="text-2xs text-annotation/60">Avg Score</div></div>
                  <div className="panel p-2.5"><div className="text-lg font-bold text-ink">{stats.passed}</div><div className="text-2xs text-annotation/60">Passed</div></div>
                </div>
                {stats.test_breakdown?.length > 0 && (
                  <div className="space-y-1">
                    {stats.test_breakdown.map(tb => (
                      <div key={tb.test_id} className="flex items-center justify-between py-1.5 px-2 rounded bg-deck/50 text-xs">
                        <span className="text-ink truncate">{tb.test_title}</span>
                        <span className="text-annotation/60 font-mono shrink-0 ml-2">{tb.submissions} subs · {tb.avg_score}% avg · {tb.passed} passed</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tests in Drive */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-ink">Tests ({driveTests.length})</h4>
              {availableTests.length > 0 && (
                <div className="flex gap-2 items-center">
                  <select className="select-field text-xs py-1 max-w-48" value={addTestId} onChange={e => setAddTestId(e.target.value)} aria-label="Test to add to drive">
                    <option value="">Select test…</option>
                    {availableTests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                  <Btn variant="primary" size="sm" disabled={!addTestId || addTestMut.isLoading} onClick={() => addTestMut.mutate(addTestId)}>Add</Btn>
                </div>
              )}
            </div>
            {driveTests.length === 0 ? (
              <p className="text-xs text-annotation/50 py-2">No tests added to this drive yet.</p>
            ) : (
              <div className="space-y-1">
                {driveTests.map(t => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-deck/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-ink truncate">{t.test_title}</span>
                      <Badge color={t.test_status === 'published' ? 'verify' : 'accent'}>{t.test_status}</Badge>
                      {t.department && <span className="text-2xs text-annotation/50">{t.department}</span>}
                    </div>
                    <button onClick={() => removeTestMut.mutate(t.test_id)} disabled={removeTestMut.isLoading}
                      className="btn-ghost-icon text-annotation hover:text-alert shrink-0" title="Remove" aria-label={`Remove ${t.test_title} from drive`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-3 border-t border-rim">
            <Btn variant="danger" size="sm" onClick={() => onDelete(drive.id)}>Delete Drive</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
