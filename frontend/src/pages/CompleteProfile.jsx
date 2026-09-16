import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Spinner } from '../components/shared/UI';
import toast from 'react-hot-toast';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS } from '../lib/departments';
import { useClassOptions } from '../hooks/useClassOptions';

const ORDINALS = ['th', 'st', 'nd', 'rd'];

function yearLabel(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return String(y);
  const s = ORDINALS[(n % 100 >= 11 && n % 100 <= 13) ? 0 : (n % 10) < 4 ? n % 10 : 0];
  return `${n}${s} Year`;
}

/**
 * Forced after Google sign-in (and for any student missing cluster fields)
 * so enrollment / class / year are captured for class mapping.
 */
export default function CompleteProfilePage() {
  const { user, completeProfile, logout, isLoading } = useStore();
  const navigate = useNavigate();
  const { years, classes } = useClassOptions();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    rollNumber: user?.roll_number || '',
    department: user?.department || '',
    className: user?.class_name || '',
    yearOfStudy: user?.year_of_study ? String(user.year_of_study) : '',
  });

  const handleChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.rollNumber.trim() || !form.department || !form.className || !form.yearOfStudy) {
      setError('Please fill in enrollment number, department, class, and year.');
      return;
    }
    try {
      const { user: updated } = await completeProfile({
        rollNumber: form.rollNumber.trim(),
        department: form.department,
        className: form.className,
        yearOfStudy: Number(form.yearOfStudy),
      });
      toast.success('Profile saved — you are assigned to your class cluster.');
      navigate(updated.role === 'admin' || updated.role === 'super_admin' ? '/admin' : '/student', {
        replace: true,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save profile. Please try again.');
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-deck p-6">
      <div className="w-full max-w-md panel p-6 lg:p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <svg className="w-5 h-5 text-panel" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div>
            <h1 className="font-display font-bold text-base text-ink">Complete your profile</h1>
            <p className="text-xs text-annotation/70">
              {user?.name ? `Welcome, ${user.name}. ` : ''}
              Add your enrollment details so we can place you in the right class cluster.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-alert/10 border border-alert/20 rounded-lg p-3 mb-4">
            <p className="text-xs text-alert text-center">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="cp-roll" className="input-label">Enrollment No.</label>
            <input
              id="cp-roll"
              type="text"
              name="rollNumber"
              value={form.rollNumber}
              onChange={handleChange}
              placeholder="e.g. 220410107114"
              className="input-field"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="cp-dept" className="input-label">Department</label>
            <select
              id="cp-dept"
              name="department"
              value={form.department}
              onChange={handleChange}
              className="select-field"
              required
            >
              <option value="">Select department</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cp-class" className="input-label">Class</label>
              <select
                id="cp-class"
                name="className"
                value={form.className}
                onChange={handleChange}
                className="select-field"
                required
              >
                <option value="">Select class</option>
                {classes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cp-year" className="input-label">Year of Study</label>
              <select
                id="cp-year"
                name="yearOfStudy"
                value={form.yearOfStudy}
                onChange={handleChange}
                className="select-field"
                required
              >
                <option value="">Select year</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>{yearLabel(y)}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary w-full">
            {isLoading && <Spinner size={14} className="text-deck" />}
            Save &amp; Continue
          </button>
        </form>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full mt-4 text-xs text-annotation hover:text-ink transition-colors"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
