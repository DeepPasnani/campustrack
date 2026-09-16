import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { usersAPI } from '../../services/api';
import { Btn, Table, Badge, Modal, Input, Select, Alert, ConfirmModal, Spinner } from '../../components/shared/UI';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { ALLOWED_DEPARTMENTS as DEPT_ORDER } from '../../lib/departments';
import { useClassOptions } from '../../hooks/useClassOptions';
import { useStore } from '../../store';

// Students page has no pagination UI — it clusters every result client-side,
// so it needs the whole scoped roster back in one page rather than the
// API's normal 50-row default.
const STUDENTS_PAGE_LIMIT = 5000;

const BULK_ATTRIBUTES = [
  { value: 'class_name',    label: 'Class',         superAdminOnly: false },
  { value: 'year_of_study', label: 'Year of Study', superAdminOnly: false },
  { value: 'branch',        label: 'Branch',        superAdminOnly: false },
  { value: 'is_active',     label: 'Status',        superAdminOnly: false },
  { value: 'department',    label: 'Department',    superAdminOnly: true },
];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

const yearLabel = (y) => {
  if (y === null || y === undefined || y === '' || y === 'Any') return 'Any year';
  const num = Number(y);
  return Number.isFinite(num) ? `${num}${ordinal(num)} Year` : String(y);
};

/* ═══════════════════════════════════════════════════════════
 * Admin Users — Student management (clustered by
 * department → year of study → class)
 * ═══════════════════════════════════════════════════════════ */

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user: me } = useStore();
  const isSuperAdmin = me?.role === 'super_admin';
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [showClassUpdate, setShowClassUpdate] = useState(false);
  const [classCsvText, setClassCsvText] = useState('');
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [editingUser, setEditingUser] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'student', search],
    queryFn: () => usersAPI.list({ role: 'student', search, limit: STUDENTS_PAGE_LIMIT }),
  });
  const deleteMut = useMutation({
    mutationFn: usersAPI.delete,
    onSuccess: () => { toast.success('User removed'); qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => usersAPI.update(id, { isActive }),
    onSuccess: () => { toast.success('Updated'); qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  const importMut = useMutation({
    mutationFn: () => {
      const lines = csvText.trim().split('\n').slice(1);
      const students = lines
        .map(l => {
          const [name, email, branch, rollNumber] = l
            .split(',')
            .map(s => s.trim().replace(/"/g, ''));
          return { name, email, branch, rollNumber };
        })
        .filter(s => s.email);
      return usersAPI.bulkImport({ students });
    },
    onSuccess: (r) => {
      toast.success(`Created ${r.created} students`);
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowImport(false);
      setCsvText('');
    },
  });

  const classUpdateMut = useMutation({
    mutationFn: () => {
      const lines = classCsvText.trim().split('\n').slice(1);
      const students = lines
        .map(l => {
          const [email, className, yearOfStudy] = l
            .split(',')
            .map(s => s.trim().replace(/"/g, ''));
          return { email, class_name: className, year_of_study: yearOfStudy ? parseInt(yearOfStudy) : undefined };
        })
        .filter(s => s.email);
      return usersAPI.bulkUpdateClass({ students });
    },
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} students`);
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowClassUpdate(false);
      setClassCsvText('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Class update failed'),
  });

  const bulkEditMut = useMutation({
    mutationFn: (payload) => usersAPI.bulkUpdateAttribute(payload),
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} student${r.updated === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowBulkEdit(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Bulk update failed'),
  });

  const users = data?.users || [];

  const clusters = useMemo(() => {
    const deptMap = new Map();
    users.forEach(u => {
      const dept = u.department || 'Unassigned';
      const year = u.year_of_study ?? 'Any';
      const className = u.class_name || 'Unassigned';

      if (!deptMap.has(dept)) deptMap.set(dept, { department: dept, years: new Map(), total: 0 });
      const deptGroup = deptMap.get(dept);
      deptGroup.total++;

      if (!deptGroup.years.has(year)) deptGroup.years.set(year, { year, classes: new Map() });
      const yearGroup = deptGroup.years.get(year);

      if (!yearGroup.classes.has(className)) yearGroup.classes.set(className, { className, students: [] });
      yearGroup.classes.get(className).students.push(u);
    });

    return [...deptMap.values()]
      .sort((a, b) => {
        const da = DEPT_ORDER.indexOf(a.department);
        const db = DEPT_ORDER.indexOf(b.department);
        if (da !== -1 && db !== -1) return da - db;
        if (da !== -1) return -1;
        if (db !== -1) return 1;
        return a.department.localeCompare(b.department);
      })
      .map(dept => ({
        ...dept,
        years: [...dept.years.values()]
          .sort((a, b) => {
            const ay = a.year === 'Any' ? 0 : Number(a.year) || 99;
            const by = b.year === 'Any' ? 0 : Number(b.year) || 99;
            return ay - by;
          })
          .map(year => ({
            ...year,
            classes: [...year.classes.values()]
              .sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })),
          })),
      }));
  }, [users]);

  const columns = [
    {
      key: 'name',
      label: 'Student',
      render: (u) => (
        <div>
          <div className="font-medium text-sm text-ink">{u.name || '—'}</div>
          <div className="text-xs text-annotation/60">{u.email}</div>
        </div>
      ),
    },
    {
      key: 'roll_number',
      label: 'Roll / Branch',
      render: (u) => (
        <span className="text-xs text-annotation/70">
          {u.roll_number || '—'} {u.branch ? `· ${u.branch}` : ''}
        </span>
      ),
    },
    {
      key: 'cluster',
      label: 'Department / Year / Class',
      render: (u) => (
        <div className="flex flex-wrap gap-1 items-center">
          <Badge color="verify">{u.department || 'Unassigned'}</Badge>
          <Badge color="annotation">{yearLabel(u.year_of_study)}</Badge>
          <Badge color="clarify">{u.class_name || 'Unassigned'}</Badge>
        </div>
      ),
    },
    {
      key: 'login',
      label: 'Login',
      render: (u) => (
        <Badge color={u.google_id ? 'clarify' : 'annotation'}>
          {u.google_id ? 'Google' : 'Email'}
        </Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <Badge color={u.is_active ? 'verify' : 'alert'}>
          {u.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'last_login',
      label: 'Last Login',
      render: (u) =>
        u.last_login ? (
          <span className="text-xs text-annotation/60 font-mono">
            {format(new Date(u.last_login), 'dd MMM yyyy')}
          </span>
        ) : (
          <span className="text-xs text-annotation/40">Never</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      render: (u) => (
        <div className="flex gap-1 justify-end">
          <Link to={`/admin/analytics/students/${u.id}`}
            className="btn-ghost-icon text-clarify hover:text-accent"
            title="View analytics" aria-label="View student analytics">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </Link>
          <button
            onClick={() => setEditingUser(u)}
            className="btn-ghost-icon"
            title="Edit student"
            aria-label="Edit student"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() =>
              toggleMut.mutate({ id: u.id, isActive: !u.is_active })
            }
            className="btn-ghost-icon"
            title={u.is_active ? 'Deactivate' : 'Activate'}
            aria-label={u.is_active ? 'Deactivate user' : 'Activate user'}
          >
            {u.is_active ? (
              <svg className="w-4 h-4 text-verify" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-annotation" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setDeleteId(u.id)}
            className="btn-ghost-icon text-annotation hover:text-alert"
            aria-label="Delete user"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="section-header">
        <div>
          <h1 className="section-title">Students</h1>
          <p className="section-subtitle">
            {data?.total || 0} registered{!isSuperAdmin && me?.department ? ` · ${me.department}` : ''}
          </p>
        </div>
        <Btn variant="ghost" size="sm" onClick={() => setShowBulkEdit(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Bulk Edit
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setShowClassUpdate(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Update Class
        </Btn>
        <Btn variant="primary" onClick={() => setShowImport(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Bulk Import
        </Btn>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search by name or email"
          className="input-field max-w-xs"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} className="text-accent" />
        </div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-16 text-annotation text-sm">
          No students found.
        </div>
      ) : (
        <div className="space-y-5">
          {clusters.map(dept => (
            <div key={dept.department} className="panel overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-deck/40 border-b border-rim">
                <h3 className="font-display font-semibold text-sm text-ink">
                  {dept.department}
                </h3>
                <span className="text-2xs font-mono text-annotation/70">
                  {dept.total} student{dept.total === 1 ? '' : 's'}
                </span>
              </div>
              <div className="divide-y divide-rim">
                {dept.years.map(yr => (
                  <div key={`${dept.department}-${yr.year}`}>
                    <div className="px-4 py-1.5 bg-deck/20 flex items-center gap-2">
                      <svg className="w-3 h-3 text-annotation/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs font-medium text-annotation">
                        {yearLabel(yr.year)}
                      </span>
                    </div>
                    {yr.classes.map(b => (
                      <div key={`${dept.department}-${yr.year}-${b.className}`} className="border-t border-rim/40">
                        <div className="px-4 py-1.5 flex items-center gap-2 bg-deck/10">
                          <svg className="w-3 h-3 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="text-xs font-semibold text-ink">{b.className}</span>
                          <span className="text-2xs font-mono text-annotation/60">
                            {b.students.length} student{b.students.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <Table
                          columns={columns}
                          data={b.students}
                          emptyMessage="No students in this cluster."
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk Import Modal */}
      <Modal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        title="Bulk Import Students"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowImport(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              onClick={() => importMut.mutate()}
              disabled={!csvText.trim() || importMut.isLoading}
            >
              {importMut.isLoading ? 'Importing…' : 'Import Students'}
            </Btn>
          </>
        }
      >
        <Alert type="info" className="mb-4">
          Paste CSV with header row. Students receive a temporary password and
          must reset it.
        </Alert>
        <p className="text-xs text-annotation/70 mb-3 font-mono bg-deck p-2 rounded border border-rim">
          name,email,branch,rollNumber
          <br />
          Alice Smith,alice@college.edu,Computer Engineering,CS001
          <br />
          Bob Jones,bob@college.edu,Computer Science and Design,CSD042
        </p>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          rows={10}
          placeholder="Paste CSV data here…"
          aria-label="Paste CSV data here"
          className="textarea-field"
        />
        {importMut.data && (
          <Alert type="success" className="mt-3">
            Created: {importMut.data.created} · Skipped:{' '}
            {importMut.data.skipped}
          </Alert>
        )}
      </Modal>

      {/* Bulk Update Class Modal */}
      <Modal
        isOpen={showClassUpdate}
        onClose={() => setShowClassUpdate(false)}
        title="Bulk Update Class / Year"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowClassUpdate(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={() => classUpdateMut.mutate()} disabled={!classCsvText.trim() || classUpdateMut.isLoading}>
              {classUpdateMut.isLoading ? 'Updating…' : 'Update Classes'}
            </Btn>
          </>
        }
      >
        <Alert type="info" className="mb-4">
          Update student class assignments and year of study for semester re-shuffling.
        </Alert>
        <p className="text-xs text-annotation/70 mb-3 font-mono bg-deck p-2 rounded border border-rim">
          email,class,year_of_study
          <br />
          alice@college.edu,Class 1,3
          <br />
          bob@college.edu,Class 2,2
        </p>
        <textarea
          value={classCsvText}
          onChange={e => setClassCsvText(e.target.value)}
          rows={10}
          placeholder="Paste CSV data here (email,class,year_of_study)..."
          aria-label="Paste CSV data here (email,class,year_of_study)"
          className="textarea-field"
        />
        {classUpdateMut.data && (
          <Alert type="success" className="mt-3">
            Updated: {classUpdateMut.data.updated} · Skipped: {classUpdateMut.data.skipped}
          </Alert>
        )}
      </Modal>

      {showBulkEdit && (
        <BulkEditAttributeModal
          isSuperAdmin={isSuperAdmin}
          scopeCount={data?.total || 0}
          scopeLabel={isSuperAdmin ? 'all students' : `all students in ${me?.department || 'your department'}`}
          search={search}
          isLoading={bulkEditMut.isLoading}
          onClose={() => setShowBulkEdit(false)}
          onSubmit={(payload) => bulkEditMut.mutate(payload)}
        />
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Remove Student"
        message="This will permanently delete the student and all their submissions."
        confirmLabel="Remove"
      />

      {editingUser && (
        <EditStudentModal
          student={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); qc.invalidateQueries({ queryKey: ['users'] }); }}
        />
      )}
    </div>
  );
}

/* ── Edit Student ─────────────────────────────────────────────── */
function EditStudentModal({ student, onClose, onSaved }) {
  const { years, classes } = useClassOptions();
  const [form, setForm] = useState({
    name: student.name || '',
    email: student.email || '',
    rollNumber: student.roll_number || '',
    branch: student.branch || '',
    department: student.department || '',
    className: student.class_name || '',
    yearOfStudy: student.year_of_study != null ? String(student.year_of_study) : '',
  });
  const upd = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const mut = useMutation({
    mutationFn: () => usersAPI.update(student.id, form),
    onSuccess: () => { toast.success('Student updated'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update student'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit Student"
      width="max-w-md"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => mut.mutate()} disabled={!form.name.trim() || !form.email.trim() || mut.isLoading}>
            {mut.isLoading ? 'Saving…' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Full Name *" value={form.name} onChange={e => upd('name', e.target.value)} />
        <Input label="Email Address *" type="email" value={form.email} onChange={e => upd('email', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Roll Number" value={form.rollNumber} onChange={e => upd('rollNumber', e.target.value)} />
          <Input label="Branch" value={form.branch} onChange={e => upd('branch', e.target.value)} />
        </div>
        <Select label="Department" value={form.department} onChange={e => upd('department', e.target.value)}>
          <option value="">— Not set —</option>
          {DEPT_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Class" value={form.className} onChange={e => upd('className', e.target.value)}>
            <option value="">— Not set —</option>
            {classes.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Year of Study" value={form.yearOfStudy} onChange={e => upd('yearOfStudy', e.target.value)}>
            <option value="">— Not set —</option>
            {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </Select>
        </div>
      </div>
    </Modal>
  );
}

/* ── Bulk Edit Attribute ───────────────────────────────────────
 * Sets one field on every student the caller can see (their own
 * department for an admin, everyone for a super admin), optionally
 * narrowed by whatever search text is active on the Students page. */
function BulkEditAttributeModal({ isSuperAdmin, scopeCount, scopeLabel, search, isLoading, onClose, onSubmit }) {
  const { years, classes } = useClassOptions();
  const attributes = BULK_ATTRIBUTES.filter(a => !a.superAdminOnly || isSuperAdmin);
  const [attribute, setAttribute] = useState(attributes[0].value);
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);

  const target = search ? `students matching "${search}"` : scopeLabel;

  const valueField = () => {
    switch (attribute) {
      case 'department':
        return (
          <Select label="New Department" value={value} onChange={e => setValue(e.target.value)}>
            <option value="">— Select —</option>
            {DEPT_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
        );
      case 'class_name':
        return (
          <Select label="New Class" value={value} onChange={e => setValue(e.target.value)}>
            <option value="">— Select —</option>
            {classes.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        );
      case 'year_of_study':
        return (
          <Select label="New Year of Study" value={value} onChange={e => setValue(e.target.value)}>
            <option value="">— Select —</option>
            {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </Select>
        );
      case 'is_active':
        return (
          <Select label="New Status" value={value} onChange={e => setValue(e.target.value)}>
            <option value="">— Select —</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        );
      default:
        return <Input label="New Branch" value={value} onChange={e => setValue(e.target.value)} />;
    }
  };

  const canSubmit = value !== '';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Bulk Edit Students"
      width="max-w-md"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!canSubmit || isLoading} onClick={() => setConfirming(true)}>
            Apply to {scopeCount} student{scopeCount === 1 ? '' : 's'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Alert type="info">
          Changes apply to <strong>{target}</strong> — not just the ones currently on screen.
        </Alert>
        <Select label="Attribute" value={attribute} onChange={e => { setAttribute(e.target.value); setValue(''); }}>
          {attributes.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </Select>
        {valueField()}
      </div>

      <ConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); onSubmit({ attribute, value, search: search || undefined }); }}
        title="Confirm Bulk Update"
        message={`This will set ${attributes.find(a => a.value === attribute)?.label} for ${scopeCount} student${scopeCount === 1 ? '' : 's'} (${target}). This can't be undone in bulk.`}
        confirmLabel="Apply"
      />
    </Modal>
  );
}
