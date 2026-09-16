import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/shared/UI';

/* ═══════════════════════════════════════════════════════════
 * Admin Layout — Sidebar + content
 * ═══════════════════════════════════════════════════════════ */

const NAV_ICONS = {
  Dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  Tests: 'M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  Results: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  Students: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  Admins: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  'Question Bank': 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  Resources: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  'Send Email': 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  Drives: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  'Question Analytics': 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  Plagiarism: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z',
  Security: 'M12 15v2m-6 4h14a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  'AI Question Generator': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'AI NL Query': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  Profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  'Report Builder': 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
};

export default function AdminLayout() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set(['Overview', 'Engineering', 'Analytics']));

  // ── Scroll position memory ────────────────────────────────
  // The <Outlet> content unmounts/remounts on every navigation, which
  // resets the scrollable main pane to the top even when returning to a
  // page (e.g. Results) the admin had scrolled down on. Remember each
  // route's scroll offset and restore it instead of always snapping to 0.
  const mainRef = useRef(null);
  const scrollPositions = useRef(new Map());
  const prevPathRef = useRef(location.pathname);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const prevPath = prevPathRef.current;
    if (prevPath !== location.pathname) {
      scrollPositions.current.set(prevPath, el.scrollTop);
    }
    el.scrollTop = scrollPositions.current.get(location.pathname) || 0;
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  const handleMainScroll = () => {
    const el = mainRef.current;
    if (el) scrollPositions.current.set(location.pathname, el.scrollTop);
  };

  const toggleGroup = (id) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const NAV_GROUPS = useMemo(() => {
    const analytics = [
      { to: '/admin/analytics/questions', label: 'Question Analytics' },
      { to: '/admin/analytics/plagiarism', label: 'Plagiarism' },
      { to: '/admin/analytics/report-builder', label: 'Report Builder' },
    ];
    const groups = [
      { id: 'Overview', label: 'Overview', items: [{ to: '/admin', label: 'Dashboard', end: true }] },
      { id: 'Engineering', label: 'Engineering', items: [
        { to: '/admin/drives', label: 'Drives' },
        { to: '/admin/tests', label: 'Tests' },
        { to: '/admin/question-bank', label: 'Question Bank' },
        { to: '/admin/resources', label: 'Resources' },
        { to: '/admin/results', label: 'Results' },
        { to: '/admin/security/alerts', label: 'Security' },
        { to: '/admin/email', label: 'Send Email' },
      ]},
      { id: 'Analytics', label: 'Analytics', items: analytics },
      { id: 'AI Tools', label: 'AI Tools', items: [
        { to: '/admin/ai/question-generator', label: 'AI Question Generator' },
        { to: '/admin/ai/nl-query', label: 'AI NL Query' },
      ]},
      { id: 'Admin', label: 'People & System', items: [] },
    ];
    // keep existing analytics items in place and sort the users group
    const governance = [];
    if (user?.role === 'super_admin' || user?.role === 'admin') {
      governance.push({ to: '/admin/admins', label: 'Admins' });
    }
    groups.find(g => g.id === 'Admin').items = [
      { to: '/admin/users', label: 'Students' },
      ...governance,
      { to: '/admin/profile', label: 'Profile' },
    ];
    return groups;
  }, [user?.role]);

  const handleLogout = async () => {
    await logout();
    toast.success('Signed out');
    navigate('/login');
  };

  // A plain function called as `{renderSidebar()}` below, NOT a JSX
  // component (`<RenderSidebar />`). If this were re-declared as a
  // component on every render (as it used to be, under the name
  // SidebarContent), React would see a new component type each time and
  // unmount/remount its subtree on every navigation — resetting the nav
  // list's scroll position to the top even though the admin never touched
  // it. Calling it as a function keeps its JSX inline in AdminLayout's own
  // render output, so the underlying <nav> DOM node (and its scrollTop)
  // survives navigation instead of being torn down.
  const renderSidebar = () => {
    const q = navQuery.trim().toLowerCase();
    const filteredGroups = NAV_GROUPS
      .map(g => ({ ...g, items: g.items.filter(it => !q || it.label.toLowerCase().includes(q)) }))
      .filter(g => !q || g.items.length > 0);

    return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-rim">
        <div className="flex flex-col items-center text-center">
          <div className="font-display font-bold text-sm text-ink">CampusTrack</div>
          <div className="text-2xs text-annotation/60 font-mono">Admin Console</div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5 border-b border-rim">
        <div className="relative">
          <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-annotation/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
          </svg>
          <input
            value={navQuery}
            onChange={e => setNavQuery(e.target.value)}
            placeholder="Find page…"
            aria-label="Search navigation"
            className="input-field pl-8 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-3">
        {filteredGroups.map(group => {
          const isOpen = q ? true : openGroups.has(group.id);
          return (
            <div key={group.id}>
              <button
                onClick={() => !q && toggleGroup(group.id)}
                className="flex items-center justify-between w-full px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-annotation/70 hover:text-ink transition-colors"
                aria-expanded={isOpen}
              >
                {group.label}
                {!q && (
                  <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {group.items.map(({ to, label, end }) => {
                    const path = NAV_ICONS[label] || '';
                    return (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                           ${
                             isActive
                               ? 'bg-accent/10 text-accent'
                               : 'text-annotation hover:bg-panel hover:text-ink'
                           }`
                        }
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
                        </svg>
                        {label}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Help */}
      <div className="px-2 py-1">
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs font-medium text-annotation hover:bg-panel hover:text-ink transition-all"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          Help & Guide
          <span className="ml-auto text-2xs text-annotation/40">?</span>
        </button>
      </div>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-rim">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-xs shrink-0">
            {(user?.name || user?.email || 'A')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink truncate">
              {user?.name || 'Admin'}
            </div>
            <div className="text-2xs text-annotation/60 truncate">{user?.email}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-annotation hover:bg-panel hover:text-ink transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
    );
  };

  // ── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        navigate('/admin/tests/new');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

  return (
    <>
      {/* Help Modal */}
      <Modal isOpen={showHelp} onClose={() => setShowHelp(false)} title="Help & Guide" width="max-w-xl">
        <div className="space-y-4 text-sm text-ink/80">
          <section>
            <h4 className="font-display font-bold text-sm text-ink mb-2">Getting Started</h4>
            <ul className="space-y-2 list-disc pl-4 text-xs text-ink/70">
              <li><strong>Create a Test</strong> — Click "Create Test" in the Tests page. Set a title, department, and schedule, then add sections with questions.</li>
              <li><strong>Publish</strong> — Once you've added questions and configured settings, click "Publish" to make the test available to students.</li>
              <li><strong>Monitor Results</strong> — View submissions, scores, and the leaderboard from the Results page after students start taking the test.</li>
            </ul>
          </section>
          <section>
            <h4 className="font-display font-bold text-sm text-ink mb-2">Settings Explained</h4>
            <ul className="space-y-2 list-disc pl-4 text-xs text-ink/70">
              <li><strong>Passing Score</strong> — Minimum percentage required to pass the test. Students below this are marked as "fail".</li>
              <li><strong>Show Results</strong> — Controls when students can see their scores. Choose based on your test workflow.</li>
              <li><strong>Negative Marking</strong> — Deducts a fraction of marks for wrong MCQ answers. The fraction is multiplied by the question's marks.</li>
              <li><strong>Allowed Branches</strong> — Restrict the test to specific departments. Leave blank to allow all branches.</li>
            </ul>
          </section>
          <section>
            <h4 className="font-display font-bold text-sm text-ink mb-2">Keyboard Shortcuts</h4>
            <ul className="space-y-1.5 text-xs text-ink/70">
              <li><kbd className="px-1.5 py-0.5 rounded bg-panel border border-rim text-2xs font-mono">Ctrl+N</kbd> New Test</li>
              <li><kbd className="px-1.5 py-0.5 rounded bg-panel border border-rim text-2xs font-mono">Ctrl+S</kbd> Save Draft (in Test Creator)</li>
            </ul>
          </section>
          <section>
            <h4 className="font-display font-bold text-sm text-ink mb-2">Need More Help?</h4>
            <p className="text-xs text-ink/70">Contact your system administrator or refer to the CampusTrack documentation for advanced configuration.</p>
          </section>
        </div>
      </Modal>

    <div className="flex h-screen bg-deck overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-52 bg-panel border-r border-rim shrink-0 overflow-y-auto" role="navigation" aria-label="Admin navigation">
        {renderSidebar()}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-60 bg-panel border-r border-rim flex flex-col overflow-y-auto">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setMobileOpen(false)}
                className="btn-ghost-icon"
                aria-label="Close menu"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {renderSidebar()}
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <main id="main-content" ref={mainRef} onScroll={handleMainScroll} className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-40 bg-panel border-b border-rim px-4 py-2.5 flex items-center gap-3 relative">
          <button
            onClick={() => setMobileOpen(true)}
            className="btn-ghost-icon"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="absolute left-1/2 -translate-x-1/2 font-display font-bold text-sm text-ink">CampusTrack</span>
          <button
            onClick={handleLogout}
            className="ml-auto flex items-center justify-center w-8 h-8 rounded-md text-annotation hover:bg-sunken hover:text-ink transition-colors"
            aria-label="Sign out"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-6 max-w-6xl mx-auto page-enter">
          <Outlet />
        </div>
      </main>
    </div>
    </>
  );
}
