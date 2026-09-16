import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { testsAPI, classesAPI, questionBankAPI } from '../../services/api';
import { Btn, Badge, Table, ConfirmModal, Spinner, Modal, Select } from '../../components/shared/UI';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS, CLASSES } from '../../lib/departments';

/* ═══════════════════════════════════════════════════════════
 * Admin Tests — Test management list
 * ═══════════════════════════════════════════════════════════ */

export default function AdminTests() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [deleteId, setDeleteId] = useState(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [classModalTest, setClassModalTest] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });

  const deleteMut = useMutation({
    mutationFn: testsAPI.delete,
    onSuccess: () => { toast.success('Test deleted'); qc.invalidateQueries({ queryKey: ['tests'] }); },
  });
  const dupMut = useMutation({
    mutationFn: testsAPI.duplicate,
    onSuccess: () => { toast.success('Test duplicated'); qc.invalidateQueries({ queryKey: ['tests'] }); },
  });

  const bankImportMut = useMutation({
    mutationFn: (testId) => questionBankAPI.importFromTest(testId),
    onSuccess: (data) => { toast.success(data.message || `Added ${data.count} question(s) to bank`); qc.invalidateQueries({ queryKey: ['question-bank'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add to bank'),
  });

  const tests = data?.tests || [];

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === tests.length ? new Set() : new Set(tests.map(t => t.id))
    );
  }, [tests]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Batch delete ─────────────────────────────────────────
  const batchDeleteMut = useMutation({
    mutationFn: (ids) => Promise.all(ids.map(id => testsAPI.delete(id))),
    onSuccess: (_data, ids) => {
      toast.success(`${ids.length} test(s) deleted`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['tests'] });
    },
  });

  const columns = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={tests.length > 0 && selectedIds.size === tests.length}
          onChange={toggleSelectAll}
          className="accent-accent w-4 h-4 rounded border-rim cursor-pointer"
          aria-label={selectedIds.size === tests.length ? 'Deselect all' : 'Select all'}
        />
      ),
      render: (t) => (
        <input
          type="checkbox"
          checked={selectedIds.has(t.id)}
          onChange={() => toggleSelect(t.id)}
          className="accent-accent w-4 h-4 rounded border-rim cursor-pointer"
          aria-label={`Select ${t.title}`}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      align: 'w-10',
    },
    {
      key: 'title',
      label: 'Test',
      render: (t) => (
        <div>
          <div className="font-medium text-sm text-ink">{t.title}</div>
          <div className="text-xs text-annotation/60 mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1 font-mono">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t.duration_minutes} min
            </span>
            <span>{t.section_count || 0} sections</span>
            <span>{t.submission_count || 0} submissions</span>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (t) => (
        <Badge
          color={
            t.status === 'published'
              ? 'verify'
              : t.status === 'archived'
              ? 'annotation'
              : 'accent'
          }
        >
          {t.status}
        </Badge>
      ),
    },
    {
      key: 'start_time',
      label: 'Schedule',
      render: (t) =>
        t.start_time ? (
          <div className="text-xs text-annotation/70">
            <div>
              {format(
                new Date(t.start_time),
                'dd MMM yyyy, HH:mm',
              )}
            </div>
            <div className="text-annotation/50">
              to{' '}
              {t.end_time
                ? format(new Date(t.end_time), 'dd MMM HH:mm')
                : '—'}
            </div>
          </div>
        ) : (
          <span className="text-xs text-annotation/40">No schedule</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      render: (t) => (
        <div className="flex gap-1 justify-end">
          <Btn variant="ghost" size="sm" onClick={() => setClassModalTest(t)} aria-label="Manage classes & sets">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="hidden sm:inline">Classes</span>
          </Btn>
          <Link to={`/admin/results/${t.id}`}>
            <Btn variant="ghost" size="sm" aria-label="View results">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden sm:inline">Results</span>
            </Btn>
          </Link>
          <Btn variant="ghost" size="sm" onClick={() => bankImportMut.mutate(t.id)} aria-label="Add to question bank" disabled={bankImportMut.isLoading}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="hidden sm:inline">Bank</span>
          </Btn>
          <Link to={`/admin/tests/${t.id}/edit`}>
            <Btn variant="ghost" size="sm" aria-label="Edit test">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="hidden sm:inline">Edit</span>
            </Btn>
          </Link>
          <Btn variant="ghost" size="sm" onClick={() => dupMut.mutate(t.id)} aria-label="Duplicate test">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </Btn>
          <Btn variant="danger" size="sm" onClick={() => setDeleteId(t.id)} aria-label="Delete test">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Btn>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} className="text-accent" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="section-header">
        <div>
          <h1 className="section-title">Tests</h1>
          <p className="section-subtitle">{tests.length} total</p>
        </div>
        <Link to="/admin/tests/new">
          <Btn variant="primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Test
          </Btn>
        </Link>
      </div>

      {tests.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <h3 className="empty-state-title">No tests yet</h3>
          <p className="empty-state-desc">Create your first placement test to get started.</p>
          <Link to="/admin/tests/new">
            <Btn variant="primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Test
            </Btn>
          </Link>
        </div>
      ) : (
        <>
          {/* ── Batch action bar ─────────────────────────────── */}
          {selectedIds.size > 0 && (
            <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-panel border border-rim/60">
              <span className="text-sm text-annotation font-medium">
                {selectedIds.size} selected
              </span>
              <span className="text-annotation/30">|</span>
              <Btn variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection
              </Btn>
              <div className="ml-auto flex gap-2">
                <Btn
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmBatchDelete(true)}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Selected
                </Btn>
              </div>
            </div>
          )}

          <Table columns={columns} data={tests} emptyMessage="No tests found." />
        </>
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Delete Test"
        confirmLabel="Delete"
        message="This will permanently delete the test and all its submissions. Cannot be undone."
      />

      <ConfirmModal
        isOpen={confirmBatchDelete}
        onClose={() => setConfirmBatchDelete(false)}
        onConfirm={() => batchDeleteMut.mutate([...selectedIds])}
        title={`Delete ${selectedIds.size} Test${selectedIds.size > 1 ? 's' : ''}`}
        confirmLabel="Delete"
        message={`This will permanently delete ${selectedIds.size} selected test(s) and all their submissions. Cannot be undone.`}
      />

      <ClassMappingModal test={classModalTest} onClose={() => setClassModalTest(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Class → MCQ Set mapping
//
// Lets an admin tag which classes sit this drive and which MCQ
// "set" (A–D, tagged per-question in the Test Creator) each
// class receives — the "map classes to test sets, reconfigurable
// each time" anti-answer-sharing feature from the masterplan.
// ═══════════════════════════════════════════════════════════
function ClassMappingModal({ test, onClose }) {
  const qc = useQueryClient();
  const [newClassName, setNewClassName] = useState('');
  const [newClassDept, setNewClassDept] = useState('');
  const [selected, setSelected] = useState({}); // classId -> { checked, set }

  const { data: classData } = useQuery({ queryKey: ['classes'], queryFn: classesAPI.list, enabled: !!test });
  const { data: mappedData } = useQuery({
    queryKey: ['test-classes', test?.id],
    queryFn: () => classesAPI.listForTest(test.id),
    enabled: !!test,
  });

  const classes = classData?.classes || [];

  // Seed local selection state from the test's existing mapping once it loads
  useEffect(() => {
    if (!test) { setSelected({}); return; }
    if (mappedData?.classes?.length) {
      const seeded = {};
      mappedData.classes.forEach(c => { seeded[c.class_id] = { checked: true, set: c.section_mapping?.set || 'A' }; });
      setSelected(seeded);
    }
  }, [test?.id, mappedData]);

  const createClassMut = useMutation({
    mutationFn: classesAPI.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); setNewClassName(''); setNewClassDept(''); toast.success('Class added'); },
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const classIds = Object.entries(selected).filter(([, v]) => v.checked).map(([id]) => id);
      const sectionMapping = {};
      classIds.forEach(id => { sectionMapping[id] = { set: selected[id].set || 'A' }; });
      return classesAPI.mapToTest(test.id, { classIds, sectionMapping });
    },
    onSuccess: () => { toast.success('Class mapping saved'); qc.invalidateQueries({ queryKey: ['test-classes', test.id] }); onClose(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to save mapping'),
  });

  const toggle = (id) => setSelected(p => ({ ...p, [id]: { checked: !p[id]?.checked, set: p[id]?.set || 'A' } }));
  const setSet = (id, set) => setSelected(p => ({ ...p, [id]: { ...p[id], set } }));

  return (
    <Modal isOpen={!!test} onClose={() => { setSelected({}); onClose(); }} title={`Classes & Sets — ${test?.title || ''}`} width="max-w-2xl"
      footer={<><Btn variant="ghost" onClick={() => { setSelected({}); onClose(); }}>Cancel</Btn><Btn onClick={() => saveMut.mutate()} disabled={saveMut.isLoading}>{saveMut.isLoading ? <Spinner size={14} /> : 'Save Mapping'}</Btn></>}>
      <div className="space-y-4">
        <p className="text-xs text-annotation">
          Choose which classes can sit this drive, and which MCQ set (tagged per-question in the Test Creator)
          each one receives. Leave a class unchecked to keep it off this drive; leave everything unmapped to give
          every class Set A (the default, unchanged behaviour).
        </p>

        {classes.length === 0 ? (
          <p className="text-xs text-annotation/60">No classes yet — add one below.</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {classes.map(c => (
              <div key={c.id} className="flex items-center gap-3 panel p-2.5">
                <input type="checkbox" className="accent-accent w-4 h-4" checked={!!selected[c.id]?.checked} onChange={() => toggle(c.id)} aria-label={`Select class ${c.name}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink font-medium truncate">{c.name}</div>
                  <div className="text-2xs text-annotation/60">{c.department} · Year {c.year_of_study}</div>
                </div>
                <Select value={selected[c.id]?.set || 'A'} onChange={e => setSet(c.id, e.target.value)} className="w-24 text-xs py-1" disabled={!selected[c.id]?.checked}>
                  <option value="A">Set A</option>
                  <option value="B">Set B</option>
                  <option value="C">Set C</option>
                  <option value="D">Set D</option>
                </Select>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-rim pt-3">
          <label className="input-label">Add a new class</label>
          <div className="flex gap-2">
            <Select value={newClassName} onChange={e => setNewClassName(e.target.value)} className="flex-1 text-xs">
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={newClassDept} onChange={e => setNewClassDept(e.target.value)} className="flex-1 text-xs">
              <option value="">Select department</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
            <Btn variant="ghost" onClick={() => newClassName && newClassDept && createClassMut.mutate({ name: newClassName, department: newClassDept })} disabled={createClassMut.isLoading}>
              Add
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
