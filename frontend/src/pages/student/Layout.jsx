import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import toast from 'react-hot-toast';
import { Menu, X, BarChart3, Trophy, LayoutDashboard, FileText, User, BookOpen } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
 * Student Layout — Top nav bar + content
 * ──────────────────────────────────────────────────────────
 * One source of truth for navigation: PRIMARY_LINKS render inline
 * on desktop, and ALL links render in the mobile menu. Same
 * array drives both, so desktop and mobile can never drift.
 * ═══════════════════════════════════════════════════════════ */

const PRIMARY_LINKS = [
  { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/student/tests', label: 'My Tests', icon: FileText },
  { to: '/student/results', label: 'Results', icon: BarChart3 },
  { to: '/student/resources', label: 'Resources', icon: BookOpen },
  { to: '/student/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/student/profile', label: 'Profile', icon: User },
];

const desktopLinkClass = ({ isActive }) =>
  `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
    isActive
      ? 'bg-accent/10 text-accent'
      : 'text-annotation hover:bg-sunken hover:text-ink'
  }`;

function DesktopLink({ link }) {
  const Icon = link.icon;
  return (
    <NavLink to={link.to} end={link.end} className={desktopLinkClass}>
      <Icon size={14} />
      {link.label}
    </NavLink>
  );
}

export default function StudentLayout() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    toast.success('Signed out');
    navigate('/login');
  };

  return (
    <>
      {/* Skip-to-content link for keyboard users */}
      <a
        href="#student-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-panel focus:text-sm focus:font-bold focus:outline-none"
      >
        Skip to main content
      </a>

    <div className="min-h-screen bg-deck">
      {/* Top bar */}
      <header className="bg-panel border-b border-rim sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-12">
          <div className="flex items-center gap-4">
            {/* Brand */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-display font-bold text-sm text-ink hidden sm:block">
                CampusTrack
              </span>
            </div>

            {/* Nav */}
            <nav className="hidden lg:flex gap-1 items-center" aria-label="Primary">
              {PRIMARY_LINKS.map(link => <DesktopLink key={link.to} link={link} />)}
            </nav>
          </div>

          {/* User + Sign out */}
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium text-ink">{user?.name || 'Student'}</div>
              <div className="text-2xs text-annotation/60">{user?.email}</div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="sm:hidden flex items-center justify-center w-8 h-8 rounded-md text-annotation hover:bg-panel hover:text-ink"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-annotation hover:bg-panel hover:text-ink transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {mobileMenuOpen && (
        <div className="sm:hidden">
          <div className="max-w-5xl mx-auto px-4 pb-4 pt-1">
            <nav className="bg-panel border border-rim rounded-xl shadow-lg shadow-black/5 overflow-hidden page-enter">
              <div className="px-4 py-3 border-b border-rim flex items-center justify-between bg-sunken/30">
                <span className="text-xs font-semibold uppercase tracking-wider text-annotation">
                  Menu
                </span>
                <span className="text-2xs text-annotation/50">{user?.name || 'Student'}</span>
              </div>
              <div className="p-2 flex flex-col gap-0.5">
                {PRIMARY_LINKS.map(link => (
                  <DropdownLink key={link.to} link={link} onClose={() => setMobileMenuOpen(false)} />
                ))}
              </div>
            </nav>
          </div>
        </div>
      )}

      {/* Content */}
      <main id="student-content" className="max-w-5xl mx-auto px-4 sm:px-6 py-6 page-enter">
        <Outlet />
      </main>
    </div>
    </>
  );
}

function DropdownLink({ link, onClose }) {
  const Icon = link.icon;
  return (
    <NavLink
      to={link.to}
      end={link.end}
      onClick={onClose}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-accent/10 text-accent'
            : 'text-annotation hover:bg-sunken hover:text-ink'
        }`
      }
    >
      <span
        className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 ${
          link.end ? 'bg-accent/10 text-accent' : 'bg-sunken text-annotation'
        }`}
      >
        <Icon size={15} />
      </span>
      {link.label}
    </NavLink>
  );
}
