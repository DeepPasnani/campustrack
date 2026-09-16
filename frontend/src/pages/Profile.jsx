import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { authAPI } from '../services/api';
import { Spinner, Btn, Alert, Modal, Input } from '../components/shared/UI';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS } from '../lib/departments';
import { useClassOptions } from '../hooks/useClassOptions';
import toast from 'react-hot-toast';

const ORDINALS = ['th', 'st', 'nd', 'rd'];

function yearLabel(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return String(y);
  const s = ORDINALS[(n % 100 >= 11 && n % 100 <= 13) ? 0 : (n % 10) < 4 ? n % 10 : 0];
  return `${n}${s} Year`;
}

function roleLabel(role) {
  const map = {
    student: 'Student',
    admin: 'Admin',
    super_admin: 'Super Admin',
    staff: 'Staff',
  };
  return map[role] || role || 'User';
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-rim last:border-0">
      <dt className="text-xs text-annotation/70 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-ink text-right min-w-0">
        {value || <span className="text-annotation/40">—</span>}
      </dd>
    </div>
  );
}

export default function ProfilePage() {
  const { user, completeProfile, deleteAccount } = useStore();
  const navigate = useNavigate();
  const { years, classes } = useClassOptions();
  const isStudent = user?.role === 'student';

  const [details, setDetails] = useState({
    rollNumber: user?.roll_number || '',
    department: user?.department || '',
    className: user?.class_name || '',
    yearOfStudy: user?.year_of_study ? String(user.year_of_study) : '',
  });
  const [detailsError, setDetailsError] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const handleDetailsChange = (e) => {
    setDetails((p) => ({ ...p, [e.target.name]: e.target.value }));
    setDetailsError('');
  };

  const handleSaveDetails = async (e) => {
    e.preventDefault();
    setDetailsError('');
    if (!details.rollNumber.trim() || !details.department || !details.className || !details.yearOfStudy) {
      setDetailsError('Please fill in enrollment number, department, class, and year.');
      return;
    }
    setSavingDetails(true);
    try {
      await completeProfile({
        rollNumber: details.rollNumber.trim(),
        department: details.department,
        className: details.className,
        yearOfStudy: Number(details.yearOfStudy),
      });
      toast.success('Profile details updated.');
    } catch (err) {
      setDetailsError(err.response?.data?.error || 'Could not save details. Please try again.');
    } finally {
      setSavingDetails(false);
    }
  };

  const handlePwChange = (e) => {
    setPw((p) => ({ ...p, [e.target.name]: e.target.value }));
    setPwError('');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (!pw.currentPassword || !pw.newPassword) {
      setPwError('Both current and new password are required.');
      return;
    }
    if (pw.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (pw.newPassword !== pw.confirm) {
      setPwError('New password and confirmation do not match.');
      return;
    }
    setSavingPw(true);
    try {
      await authAPI.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast.success('Password changed successfully.');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not change password. Please try again.';
      if (msg.toLowerCase().includes('google')) {
        setPwError('This account uses Google sign-in and has no password to change.');
      } else {
        setPwError(msg);
      }
    } finally {
      setSavingPw(false);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const closeDeleteModal = () => {
    setDeleteOpen(false);
    setDeleteConfirm('');
    setDeletePassword('');
    setDeleteError('');
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError('');
    if (deleteConfirm !== 'DELETE') {
      setDeleteError('Type DELETE (in capitals) to confirm.');
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount({ confirm: deleteConfirm, password: deletePassword || undefined });
      toast.success('Your account has been deleted.');
      navigate('/login', { replace: true });
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete your account. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const initial = (user?.name || user?.email || 'U')[0].toUpperCase();

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-accent flex items-center justify-center text-panel font-display font-bold text-xl shrink-0">
          {initial}
        </div>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-xl text-ink truncate">
            {user?.name || 'My Profile'}
          </h1>
          <p className="text-sm text-annotation/70 truncate">{user?.email}</p>
        </div>
        <span className="ml-auto badge-accent">{roleLabel(user?.role)}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Account details */}
        <section className="panel p-5">
          <h2 className="font-display font-bold text-sm text-ink mb-3">Account Details</h2>
          <dl>
            <DetailRow label="Name" value={user?.name} />
            <DetailRow label="Email" value={user?.email} />
            <DetailRow label="Role" value={roleLabel(user?.role)} />
            {!isStudent && <DetailRow label="Department" value={user?.department || user?.branch} />}
            {isStudent && (
              <>
                <DetailRow label="Enrollment No." value={user?.roll_number} />
                <DetailRow label="Department" value={user?.department || user?.branch} />
                <DetailRow label="Class" value={user?.class_name} />
                <DetailRow label="Year of Study" value={user?.year_of_study ? yearLabel(user?.year_of_study) : ''} />
              </>
            )}
          </dl>
        </section>

        {/* Student-editable class/enrollment fields */}
        {isStudent && (
          <section className="panel p-5">
            <h2 className="font-display font-bold text-sm text-ink mb-1">Class &amp; Enrollment</h2>
            <p className="text-xs text-annotation/70 mb-4">
              Update your enrollment details so you stay in the right class cluster.
            </p>

            {detailsError && <Alert type="error" className="mb-4">{detailsError}</Alert>}

            <form onSubmit={handleSaveDetails} className="space-y-3.5">
              <div>
                <label htmlFor="profile-roll" className="input-label">Enrollment No.</label>
                <input
                  id="profile-roll"
                  type="text"
                  name="rollNumber"
                  value={details.rollNumber}
                  onChange={handleDetailsChange}
                  placeholder="e.g. 220410107114"
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="profile-dept" className="input-label">Department</label>
                <select
                  id="profile-dept"
                  name="department"
                  value={details.department}
                  onChange={handleDetailsChange}
                  className="select-field"
                >
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="profile-class" className="input-label">Class</label>
                  <select
                    id="profile-class"
                    name="className"
                    value={details.className}
                    onChange={handleDetailsChange}
                    className="select-field"
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="profile-year" className="input-label">Year of Study</label>
                  <select
                    id="profile-year"
                    name="yearOfStudy"
                    value={details.yearOfStudy}
                    onChange={handleDetailsChange}
                    className="select-field"
                  >
                    <option value="">Select year</option>
                    {years.map((y) => (
                      <option key={y} value={String(y)}>{yearLabel(y)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <Btn type="submit" disabled={savingDetails}>
                {savingDetails && <Spinner size={14} />}
                Save Details
              </Btn>
            </form>
          </section>
        )}
      </div>

      {/* Change password */}
      <section className="panel p-5 max-w-2xl">
        <h2 className="font-display font-bold text-sm text-ink mb-1">Change Password</h2>
        <p className="text-xs text-annotation/70 mb-4">
          Use this to update the password you sign in with.
        </p>

        {pwError && <Alert type="error" className="mb-4">{pwError}</Alert>}

        <form onSubmit={handleChangePassword} className="space-y-3.5">
          <div>
            <label htmlFor="profile-current-pw" className="input-label">Current Password</label>
            <input
              id="profile-current-pw"
              type="password"
              name="currentPassword"
              value={pw.currentPassword}
              onChange={handlePwChange}
              autoComplete="current-password"
              className="input-field"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="profile-new-pw" className="input-label">New Password</label>
              <input
                id="profile-new-pw"
                type="password"
                name="newPassword"
                value={pw.newPassword}
                onChange={handlePwChange}
                autoComplete="new-password"
                placeholder="Min 8 characters"
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="profile-confirm-pw" className="input-label">Confirm New Password</label>
              <input
                id="profile-confirm-pw"
                type="password"
                name="confirm"
                value={pw.confirm}
                onChange={handlePwChange}
                autoComplete="new-password"
                placeholder="Repeat new password"
                className="input-field"
              />
            </div>
          </div>

          <Btn type="submit" disabled={savingPw}>
            {savingPw && <Spinner size={14} />}
            Change Password
          </Btn>
        </form>
      </section>

      {/* Danger zone */}
      {isStudent && (
        <section className="panel p-5 max-w-2xl border-alert/30">
          <h2 className="font-display font-bold text-sm text-alert mb-1">Danger Zone</h2>
          <p className="text-xs text-annotation/70 mb-4">
            Permanently delete your account and everything tied to it — submissions, scores,
            bookmarks, and saved custom tests. This cannot be undone.
          </p>
          <Btn variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete My Account
          </Btn>
        </section>
      )}

      <Modal isOpen={deleteOpen} onClose={closeDeleteModal} title="Delete your account">
        <form onSubmit={handleDeleteAccount} className="space-y-3.5">
          <Alert type="error">
            This permanently deletes your account, profile, test submissions and scores,
            bookmarks, and any saved custom tests. There is no way to undo this.
          </Alert>

          {deleteError && <Alert type="error">{deleteError}</Alert>}

          <div>
            <label htmlFor="delete-password" className="input-label">
              Current Password <span className="text-annotation/50 font-normal">(leave blank if you sign in with Google)</span>
            </label>
            <Input
              id="delete-password"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label htmlFor="delete-confirm" className="input-label">
              Type <span className="font-mono font-bold text-alert">DELETE</span> to confirm
            </label>
            <Input
              id="delete-confirm"
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Btn type="button" variant="ghost" onClick={closeDeleteModal}>Cancel</Btn>
            <Btn type="submit" variant="danger" disabled={deleting || deleteConfirm !== 'DELETE'}>
              {deleting && <Spinner size={14} />}
              Permanently Delete My Account
            </Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
