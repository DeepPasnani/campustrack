import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersAPI } from '../../services/api';
import { useStore } from '../../store';
import { Btn, Table, Badge, Modal, Input, Alert, ConfirmModal, Spinner } from '../../components/shared/UI';
import { ALLOWED_DEPARTMENTS } from '../../lib/departments';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Admin Admins — department admins see admins in their own
 * department; only super admins can add new admins (or promote
 * a new super admin) and see every department.
 * ═══════════════════════════════════════════════════════════ */

const emptyForm = { name: '', email: '', password: '', department: '', role: 'admin' };

export default function AdminAdmins() {
  const qc = useQueryClient();
  const { user: me } = useStore();
  const isSuperAdmin = me?.role === 'super_admin';
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErr, setFormErr] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admins'],
    queryFn: () => usersAPI.listAdmins(),
  });
  const createMut = useMutation({
    mutationFn: usersAPI.createAdmin,
    onSuccess: () => {
      toast.success('Admin account created');
      qc.invalidateQueries({ queryKey: ['admins'] });
      setShowAdd(false);
      setForm(emptyForm);
    },
    onError: (e) => setFormErr(e.response?.data?.error || 'Failed to create admin'),
  });
  const deleteMut = useMutation({
    mutationFn: usersAPI.delete,
    onSuccess: () => { toast.success('Admin removed'); qc.invalidateQueries({ queryKey: ['admins'] }); },
  });

  const admins = data?.admins || [];

  const handleCreate = () => {
    setFormErr('');
    if (!form.name || !form.email || !form.password) {
      setFormErr('All fields are required.');
      return;
    }
    if (form.password.length < 8) {
      setFormErr('Password must be at least 8 characters.');
      return;
    }
    if (form.role !== 'super_admin' && !form.department) {
      setFormErr('Department is required for an admin account.');
      return;
    }
    createMut.mutate(form);
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-sm shrink-0">
            {(u.name || u.email)[0].toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-sm text-ink">{u.name}</div>
            <div className="text-xs text-annotation/60">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (u) => (
        <Badge color={u.role === 'super_admin' ? 'alert' : 'accent'}>
          {u.role === 'super_admin' ? 'Super Admin' : 'Admin'}
        </Badge>
      ),
    },
    {
      key: 'department',
      label: 'Department',
      render: (u) => (
        <span className="text-xs text-annotation/70">
          {u.role === 'super_admin' ? 'All departments' : (u.department || '—')}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <div className="flex items-center gap-2">
          <Badge color="verify">Active</Badge>
          {u.id === me?.id && <Badge color="clarify">You</Badge>}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Added',
      render: (u) => (
        <span className="text-xs text-annotation/60 font-mono">
          {u.created_at ? format(new Date(u.created_at), 'dd MMM yyyy') : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (u) =>
        !isSuperAdmin ? null : (
          <div className="flex gap-1 justify-end">
            <button
              onClick={() => setEditingAdmin(u)}
              className="btn-ghost-icon"
              title="Edit admin"
              aria-label="Edit admin"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            {u.id !== me?.id && (
              <button
                onClick={() => setDeleteId(u.id)}
                className="btn-ghost-icon text-annotation hover:text-alert"
                aria-label="Remove admin"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="section-header">
        <div>
          <h1 className="section-title">Admin Accounts</h1>
          <p className="section-subtitle">
            {admins.length} admin{admins.length !== 1 ? 's' : ''}
            {isSuperAdmin ? ' across all departments' : ` in ${me?.department || 'your department'}`}
          </p>
        </div>
        {isSuperAdmin && (
          <Btn variant="primary" onClick={() => setShowAdd(true)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Add Admin
          </Btn>
        )}
      </div>

      <Alert type="warning" className="mb-5">
        {isSuperAdmin
          ? 'Admin accounts can create/edit tests, view results, and manage students within their department. Only grant access to trusted staff.'
          : 'You can see admins from your own department, plus every super admin. Ask a super admin to add or remove accounts.'}
      </Alert>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} className="text-accent" />
        </div>
      ) : (
        <Table
          columns={columns}
          data={admins}
          emptyMessage="No admin accounts found."
        />
      )}

      <Modal
        isOpen={showAdd}
        onClose={() => { setShowAdd(false); setFormErr(''); }}
        title="Create Admin Account"
        width="max-w-md"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleCreate} disabled={createMut.isLoading}>
              {createMut.isLoading ? 'Creating…' : 'Create Admin'}
            </Btn>
          </>
        }
      >
        {formErr && <Alert type="error" className="mb-4">{formErr}</Alert>}
        <div className="space-y-4">
          <Input
            label="Full Name *"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Dr. Jane Smith"
          />
          <Input
            label="Email Address *"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="placement@college.edu"
          />
          <Input
            label="Password *"
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Min. 8 characters"
            hint="Admin must change this after first login."
          />
          <div>
            <label className="text-xs font-medium text-annotation mb-1.5 block">Role *</label>
            <select
              className="select-field w-full"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value, department: e.target.value === 'super_admin' ? '' : f.department }))}
            >
              <option value="admin">Admin (department-scoped)</option>
              <option value="super_admin">Super Admin (all departments)</option>
            </select>
          </div>
          {form.role !== 'super_admin' && (
            <div>
              <label className="text-xs font-medium text-annotation mb-1.5 block">Department *</label>
              <select
                className="select-field w-full"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
              >
                <option value="">— Select department —</option>
                {ALLOWED_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="text-2xs text-annotation/60 mt-1">
                This admin will only see admins, tests and results from this department.
              </p>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Remove Admin"
        message="This admin will lose all access. Their created tests will remain."
        confirmLabel="Remove Admin"
      />

      {editingAdmin && (
        <EditAdminModal
          admin={editingAdmin}
          isSelf={editingAdmin.id === me?.id}
          onClose={() => setEditingAdmin(null)}
          onSaved={() => { setEditingAdmin(null); qc.invalidateQueries({ queryKey: ['admins'] }); }}
        />
      )}
    </div>
  );
}

/* ── Edit Admin (super admin only) ────────────────────────────── */
function EditAdminModal({ admin, isSelf, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: admin.name || '',
    email: admin.email || '',
    role: admin.role,
    department: admin.role === 'super_admin' ? '' : (admin.department || ''),
  });
  const qc = useQueryClient();
  const upd = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const mut = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, email: form.email };
      // Role can't be changed on your own account (server-enforced too) —
      // omit it entirely so editing your own name/email doesn't get
      // rejected by that guard.
      if (!isSelf) {
        payload.role = form.role;
        payload.department = form.role === 'super_admin' ? null : form.department;
      }
      return usersAPI.update(admin.id, payload);
    },
    onSuccess: () => { toast.success('Admin updated'); qc.invalidateQueries({ queryKey: ['users'] }); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update admin'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit Admin"
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
        {isSelf && (
          <Alert type="info">You're editing your own account — role and department can't be changed here.</Alert>
        )}
        <Input label="Full Name *" value={form.name} onChange={e => upd('name', e.target.value)} />
        <Input label="Email Address *" type="email" value={form.email} onChange={e => upd('email', e.target.value)} />
        {!isSelf && (
          <>
            <div>
              <label className="text-xs font-medium text-annotation mb-1.5 block">Role</label>
              <select
                className="select-field w-full"
                value={form.role}
                onChange={e => upd('role', e.target.value)}
              >
                <option value="admin">Admin (department-scoped)</option>
                <option value="super_admin">Super Admin (all departments)</option>
              </select>
            </div>
            {form.role !== 'super_admin' && (
              <div>
                <label className="text-xs font-medium text-annotation mb-1.5 block">Department</label>
                <select
                  className="select-field w-full"
                  value={form.department}
                  onChange={e => upd('department', e.target.value)}
                >
                  <option value="">— Select department —</option>
                  {ALLOWED_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
