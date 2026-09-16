import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { useStore } from './store';

const LoginPage = lazy(() => import('./pages/Login'));
const CompleteProfilePage = lazy(() => import('./pages/CompleteProfile'));
const AdminLayout = lazy(() => import('./pages/admin/Layout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminTests = lazy(() => import('./pages/admin/Tests'));
const TestCreator = lazy(() => import('./pages/admin/TestCreator'));
const AdminResults = lazy(() => import('./pages/admin/Results'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminAdmins = lazy(() => import('./pages/admin/Admins'));
const AdminQuestionBank = lazy(() => import('./pages/admin/QuestionBank'));
const AdminResources = lazy(() => import('./pages/admin/Resources'));
const AdminDrives = lazy(() => import('./pages/admin/Drives'));
const StudentAnalytics = lazy(() => import('./pages/admin/StudentAnalytics'));
const QuestionAnalytics = lazy(() => import('./pages/admin/QuestionAnalytics'));
const PlagiarismCheck = lazy(() => import('./pages/admin/PlagiarismCheck'));
const SendEmail = lazy(() => import('./pages/admin/SendEmail'));
const SecurityAlerts = lazy(() => import('./pages/admin/SecurityAlerts'));
const AiQuestionGenerator = lazy(() => import('./pages/admin/AiQuestionGenerator'));
const AiNlQuery = lazy(() => import('./pages/admin/AiNlQuery'));
const Landing = lazy(() => import('./pages/Landing'));
const StudentGrowth = lazy(() => import('./pages/admin/analytics/StudentGrowth'));
const ReportBuilder = lazy(() => import('./pages/admin/analytics/ReportBuilder'));

const StudentLayout = lazy(() => import('./pages/student/Layout'));
const StudentTests = lazy(() => import('./pages/student/Tests'));
const StudentResults = lazy(() => import('./pages/student/Results'));
const StudentResources = lazy(() => import('./pages/student/Resources'));
const TestInterface = lazy(() => import('./pages/student/TestInterface'));
const ResultDetail = lazy(() => import('./pages/student/ResultDetail'));
const StudentDashboard = lazy(() => import('./pages/student/Dashboard'));

const Profile = lazy(() => import('./pages/Profile'));

const Leaderboard = lazy(() => import('./pages/student/Leaderboard'));

function SuspenseFallback() {
  return (
    <div className="min-h-screen bg-deck flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg className="spinner text-accent" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.15" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="text-sm text-annotation">Loading...</p>
      </div>
    </div>
  );
}

function needsProfile(user) {
  if (!user || user.role !== 'student') return false;
  if (user.profileComplete === true) return false;
  if (user.profileComplete === false) return true;
  // Persisted sessions from before this flag existed
  return !(user.roll_number && user.class_name && user.year_of_study);
}

function homeFor(user) {
  if (!user) return '/login';
  if (needsProfile(user)) return '/complete-profile';
  if (user.role === 'admin' || user.role === 'super_admin') return '/admin';
  return '/student';
}

function RequireAuth({ children, role }) {
  const { user } = useStore();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (needsProfile(user) && location.pathname !== '/complete-profile') {
    return <Navigate to="/complete-profile" replace />;
  }
  if (role) {
    const allowedRoles = role === 'admin' ? ['admin', 'super_admin'] : [role];
    if (!allowedRoles.includes(user.role)) {
      return <Navigate to={homeFor(user)} replace />;
    }
  }
  return children;
}

export default function App() {
  const { user, authReady, refreshUser } = useStore();

  useEffect(() => {
    // Always call this (even with no token) so authReady flips regardless —
    // see store.js's refreshUser. `user` is intentionally never persisted
    // across tabs/restarts, so until this resolves we don't yet know
    // whether the tab is logged in.
    refreshUser();
  }, []);

  if (!authReady) return <SuspenseFallback />;

  return (
    <Suspense fallback={<SuspenseFallback />}>
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={homeFor(user)} replace /> : <ErrorBoundary><LoginPage /></ErrorBoundary>}
      />
      <Route
        path="/complete-profile"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : needsProfile(user) ? (
            <ErrorBoundary><CompleteProfilePage /></ErrorBoundary>
          ) : (
            <Navigate to={homeFor(user)} replace />
          )
        }
      />

      {/* Admin routes */}
      <Route path="/admin" element={<RequireAuth role="admin"><AdminLayout /></RequireAuth>}>
        <Route index element={<ErrorBoundary><AdminDashboard /></ErrorBoundary>} />
        <Route path="tests" element={<ErrorBoundary><AdminTests /></ErrorBoundary>} />
        <Route path="tests/new" element={<ErrorBoundary><TestCreator /></ErrorBoundary>} />
        <Route path="tests/:id/edit" element={<ErrorBoundary><TestCreator /></ErrorBoundary>} />
        <Route path="results" element={<ErrorBoundary><AdminResults /></ErrorBoundary>} />
        <Route path="results/:testId" element={<ErrorBoundary><AdminResults /></ErrorBoundary>} />
        <Route path="analytics/students/:studentId" element={<ErrorBoundary><StudentAnalytics /></ErrorBoundary>} />
        <Route path="analytics/questions" element={<ErrorBoundary><QuestionAnalytics /></ErrorBoundary>} />
        <Route path="analytics/plagiarism" element={<ErrorBoundary><PlagiarismCheck /></ErrorBoundary>} />
        <Route path="security/alerts" element={<ErrorBoundary><SecurityAlerts /></ErrorBoundary>} />
        <Route path="users" element={<ErrorBoundary><AdminUsers /></ErrorBoundary>} />
        <Route path="admins" element={<ErrorBoundary><AdminAdmins /></ErrorBoundary>} />
        <Route path="question-bank" element={<ErrorBoundary><AdminQuestionBank /></ErrorBoundary>} />
        <Route path="resources" element={<ErrorBoundary><AdminResources /></ErrorBoundary>} />
        <Route path="drives" element={<ErrorBoundary><AdminDrives /></ErrorBoundary>} />
        <Route path="email" element={<ErrorBoundary><SendEmail /></ErrorBoundary>} />
        <Route path="analytics/growth/:studentId" element={<ErrorBoundary><StudentGrowth /></ErrorBoundary>} />
        <Route path="analytics/report-builder" element={<ErrorBoundary><ReportBuilder /></ErrorBoundary>} />
        <Route path="ai/question-generator" element={<ErrorBoundary><AiQuestionGenerator /></ErrorBoundary>} />
        <Route path="ai/nl-query" element={<ErrorBoundary><AiNlQuery /></ErrorBoundary>} />
        <Route path="profile" element={<ErrorBoundary><Profile /></ErrorBoundary>} />
      </Route>

      {/* Student routes */}
      <Route path="/student" element={<RequireAuth role="student"><StudentLayout /></RequireAuth>}>
        <Route index element={<ErrorBoundary><StudentDashboard /></ErrorBoundary>} />
        <Route path="tests" element={<ErrorBoundary><StudentTests /></ErrorBoundary>} />
        <Route path="results" element={<ErrorBoundary><StudentResults /></ErrorBoundary>} />
        <Route path="results/:submissionId" element={<ErrorBoundary><ResultDetail /></ErrorBoundary>} />
        <Route path="resources" element={<ErrorBoundary><StudentResources /></ErrorBoundary>} />
        <Route path="leaderboard" element={<ErrorBoundary><Leaderboard /></ErrorBoundary>} />
        <Route path="profile" element={<ErrorBoundary><Profile /></ErrorBoundary>} />
      </Route>

      {/* Test taking - full screen, no layout */}
      <Route path="/test/:testId" element={<RequireAuth role="student"><ErrorBoundary><TestInterface /></ErrorBoundary></RequireAuth>} />

      {/* Public landing page (redirects straight to dashboard if already signed in) */}
      <Route path="/" element={user ? <Navigate to={homeFor(user)} replace /> : <ErrorBoundary><Landing /></ErrorBoundary>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
