import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// If the API is served from its own domain (e.g. frontend on Vercel,
// backend on Render/Railway), a path like "/api/images/<id>" would resolve
// against the *frontend's* origin in an <img src="..."> tag and 404. When
// VITE_API_URL is a relative path ("/api"), the frontend and API share an
// origin (nginx/dev-server proxy) and no prefix is needed.
function apiOrigin() {
  if (/^https?:\/\//i.test(API_BASE)) {
    try { return new URL(API_BASE).origin; } catch { return ''; }
  }
  return '';
}

// Attach JWT on every request. Kept in sessionStorage (not localStorage) so
// a logged-in identity never survives past the browser tab — see store.js.
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('pp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Error message mapper ─────────────────────────────────────
// Translates backend error text into user-friendly messages
// so T&P coordinators never see raw server jargon.
const friendlyErrors = {
  'duplicate key value violates unique constraint': 'This record already exists (duplicate entry).',
  'violates foreign key constraint': 'Referenced record not found. Please check your selection.',
  'violates not-null constraint': 'A required field is missing. Please fill in all fields.',
  'value too long': 'Input is too long. Please shorten it.',
  'invalid input syntax': 'Invalid value format. Please check your input.',
  'password': 'Password verification failed.',
  'email': 'Email address is invalid.',
};

function humanizeError(msg) {
  if (!msg) return 'Something went wrong. Please try again.';
  const lower = msg.toLowerCase();
  for (const [pattern, friendly] of Object.entries(friendlyErrors)) {
    if (lower.includes(pattern)) return friendly;
  }
  return msg;
}

// Global error handling
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = humanizeError(err.response?.data?.error);
    // A 401 with no Authorization header on the request (login, register,
    // Google sign-in, forgot/reset-password, 2FA validate — all called
    // while logged out) just means "wrong credentials", not "your session
    // expired". Only an authenticated request getting rejected should wipe
    // the token and hard-redirect; otherwise this fired on every failed
    // login attempt and reloaded the page out from under whatever the user
    // had typed. Let the caller's own .catch() show the real error instead.
    const wasAuthenticated = !!err.config?.headers?.Authorization;
    if (err.response?.status === 401 && wasAuthenticated) {
      sessionStorage.removeItem('pp_token');
      window.location.href = '/login';
    } else if (err.response?.status !== 400 && err.response?.status !== 401) {
      toast.error(msg);
    }
    return Promise.reject(err);
  }
);

// ── Class metadata (years / classes / departments) ─────────────
export const metaAPI = {
  options: () => api.get('/meta/options').then(r => r.data),
};

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  login:           (data)       => api.post('/auth/login', data).then(r => r.data),
  register:        (data)       => api.post('/auth/register', data).then(r => r.data),
  googleLogin:     (credential) => api.post('/auth/google', { credential }).then(r => r.data),
  completeProfile: (data)       => api.post('/auth/complete-profile', data).then(r => r.data),
  logout:          ()           => api.post('/auth/logout').then(r => r.data),
  getMe:           ()           => api.get('/auth/me').then(r => r.data),
  changePassword:  (data)       => api.post('/auth/change-password', data).then(r => r.data),
  forgotPassword:  (data)       => api.post('/auth/forgot-password', data).then(r => r.data),
  resetPassword:   (data)       => api.post('/auth/reset-password', data).then(r => r.data),
  deleteAccount:   (data)       => api.delete('/auth/me', { data }).then(r => r.data),
};

// ── Tests ─────────────────────────────────────────────────────
export const testsAPI = {
  list:       ()         => api.get('/tests').then(r => r.data),
  get:        (id)       => api.get(`/tests/${id}`).then(r => r.data),
  create:     (data)     => api.post('/tests', data).then(r => r.data),
  update:     (id, data) => api.put(`/tests/${id}`, data).then(r => r.data),
  delete:     (id)       => api.delete(`/tests/${id}`).then(r => r.data),
  duplicate:  (id)       => api.post(`/tests/${id}/duplicate`).then(r => r.data),
};

// ── Submissions ───────────────────────────────────────────────
export const submissionsAPI = {
  start:      (testId) => api.post('/submissions/start', { testId }).then(r => r.data),
  save:       (data)   => api.post('/submissions/save', data).then(r => r.data),
  submit:     (data)   => api.post('/submissions/submit', data).then(r => r.data),
  runCode:    (data)   => api.post('/submissions/run-code', data).then(r => r.data),
  getMy:      ()       => api.get('/submissions/my').then(r => r.data),
  getForTest: (testId) => api.get(`/submissions/test/${testId}`).then(r => r.data),
  publishResults:   (testId) => api.put(`/submissions/test/${testId}/publish-results`).then(r => r.data),
  unpublishResults: (testId) => api.put(`/submissions/test/${testId}/unpublish-results`).then(r => r.data),
  exportPdf:  (testId) => api.get(`/submissions/test/${testId}/export-pdf`, { responseType: 'blob' }).then(r => r.data),
  exportCsv:  (testId, params) => api.get(`/submissions/test/${testId}/export-csv`, { params, responseType: 'blob' }).then(r => r.data instanceof Blob ? r.data : new Blob([r.data], { type: 'text/csv' })),
  get:        (id)     => api.get(`/submissions/${id}`).then(r => r.data),
  delete:     (id)     => api.delete(`/submissions/${id}`).then(r => r.data),
  resume:     (id)     => api.post(`/submissions/resume/${id}`).then(r => r.data),
  forceStop:  (id)     => api.post(`/submissions/${id}/force-stop`).then(r => r.data),
  updateMarks: (id, data) => api.patch(`/submissions/${id}/marks`, data).then(r => r.data),
  adjustAllMarks: (testId, data) => api.patch(`/submissions/test/${testId}/adjust-marks`, data).then(r => r.data),
  bulkMarksCsv:  (data) => api.post('/submissions/bulk-marks/csv', data).then(r => r.data),
  bulkMarksJson: (data) => api.post('/submissions/bulk-marks/json', data).then(r => r.data),
};

// ── Users ─────────────────────────────────────────────────────
export const usersAPI = {
  list:        (params) => api.get('/users', { params }).then(r => r.data),
  stats:       ()       => api.get('/users/stats').then(r => r.data),
  createAdmin: (data)   => api.post('/users/admin', data).then(r => r.data),
  bulkImport:  (data)   => api.post('/users/bulk-import', data).then(r => r.data),
  bulkUpdateClass: (data) => api.post('/users/bulk-update-class', data).then(r => r.data),
  bulkUpdateAttribute: (data) => api.post('/users/bulk-update-attribute', data).then(r => r.data),
  update:      (id, data) => api.patch(`/users/${id}`, data).then(r => r.data),
  delete:      (id)     => api.delete(`/users/${id}`).then(r => r.data),
  listAdmins:  ()       => api.get('/admins').then(r => r.data),
  notifyTest:  (data)   => api.post('/users/notify-test', data).then(r => r.data),   // NEW
  sendResults: (data)   => api.post('/users/send-results', data).then(r => r.data),  // NEW
  getAnalytics: (id)    => api.get(`/users/${id}/analytics`).then(r => r.data),      // NEW
};

// ── Classes ───────────────────────────────────────────────────
export const classesAPI = {
  list:       ()       => api.get('/classes').then(r => r.data),
  create:     (data)   => api.post('/classes', data).then(r => r.data),
  delete:     (id)     => api.delete(`/classes/${id}`).then(r => r.data),
  assign:     (data)   => api.post('/classes/assign', data).then(r => r.data),
  listForTest: (id)    => api.get(`/tests/${id}/classes`).then(r => r.data),
  mapToTest:  (id, data) => api.post(`/tests/${id}/classes`, data).then(r => r.data),
};

// ── Question Bank ─────────────────────────────────────────────
export const questionBankAPI = {
  list:    (params) => api.get('/question-bank', { params }).then(r => r.data),
  create:  (data)   => api.post('/question-bank', data).then(r => r.data),
  import:  (data)   => api.post('/question-bank/import', data).then(r => r.data),
  importCsv: (data) => api.post('/question-bank/import-csv', data).then(r => r.data),
  importJson: (data) => api.post('/question-bank/import-json', data).then(r => r.data),
  importImages: (formData) => api.post('/question-bank/import-images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data),
  importFromTest: (testId, data) => api.post(`/question-bank/from-test/${testId}`, data).then(r => r.data),
  delete:  (id)     => api.delete(`/question-bank/${id}`).then(r => r.data),
  bulkDelete: (ids) => api.post('/question-bank/bulk-delete', { ids }).then(r => r.data),
  bulkUpdateMarks: (ids, marks) => api.post('/question-bank/bulk-marks', { ids, marks }).then(r => r.data),
};

// ── Upload ────────────────────────────────────────────────────
export const uploadAPI = {
  image: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/upload/image', fd).then(r => {
      const data = r.data;
      if (data?.url) data.url = apiOrigin() + data.url;
      return data;
    });
  },
  deleteImage: (idOrFilename) => api.delete(`/upload/image/${encodeURIComponent(idOrFilename)}`).then(r => r.data),
};

// ── Resources (study material: Aptitude/Coding/GD/PI) ──────────
export const resourcesAPI = {
  list: (category) => api.get('/resources', { params: category ? { category } : undefined }).then(r => r.data),
  create: ({ title, description, category, departments, years, classes, file }) => {
    const fd = new FormData();
    fd.append('title', title);
    if (description) fd.append('description', description);
    fd.append('category', category);
    fd.append('departments', JSON.stringify(departments || []));
    fd.append('years', JSON.stringify(years || []));
    fd.append('classes', JSON.stringify(classes || []));
    fd.append('file', file);
    return api.post('/resources', fd).then(r => r.data);
  },
  update: (id, data) => api.patch(`/resources/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/resources/${id}`).then(r => r.data),
  // responseType 'blob' so this works for both an in-app <iframe> preview
  // (URL.createObjectURL) and a client-side "Download" save, the same
  // pattern already used for CSV/PDF exports elsewhere in this file.
  getFileBlob: (id) => api.get(`/resources/${id}/file`, { responseType: 'blob' }).then(r => r.data),
};

// ── Email ────────────────────────────────────────────────────
// ── Drives ────────────────────────────────────────────────────
export const drivesAPI = {
  list:       ()      => api.get('/drives').then(r => r.data),
  get:        (id)    => api.get(`/drives/${id}`).then(r => r.data),
  create:     (data)  => api.post('/drives', data).then(r => r.data),
  update:     (id, data) => api.put(`/drives/${id}`, data).then(r => r.data),
  delete:     (id)    => api.delete(`/drives/${id}`).then(r => r.data),
  addTest:    (id, data) => api.post(`/drives/${id}/tests`, data).then(r => r.data),
  removeTest: (id, testId) => api.delete(`/drives/${id}/tests/${testId}`).then(r => r.data),
  stats:      (id)    => api.get(`/drives/${id}/stats`).then(r => r.data),
};

export const emailAPI = {
  send: (data) => api.post('/email/send', data).then(r => r.data),
};

export const emailPreferencesAPI = {
  list:   ()     => api.get('/email-preferences').then(r => r.data),
  create: (data) => api.post('/email-preferences', data).then(r => r.data),
  delete: (id)   => api.delete(`/email-preferences/${id}`).then(r => r.data),
};

// ── Leaderboard ────────────────────────────────────────────
export const gamificationAPI = {
  getLeaderboard: (params) => api.get('/gamification/leaderboard', { params }).then(r => r.data),
  listLeaderboardTests: () => api.get('/gamification/leaderboard-tests').then(r => r.data),
};

// ── Proctoring ─────────────────────────────────────────────────
export const proctoringAPI = {
  snapshot:     (data) => api.post('/proctoring/snapshot', data).then(r => r.data),
  heartbeat:    (data) => api.post('/proctoring/heartbeat', data).then(r => r.data),
  getFlags:     (submissionId) => api.get(`/proctoring/flags/${submissionId}`).then(r => r.data),
  getSessions:  (testId) => api.get(`/proctoring/sessions/${testId}`).then(r => r.data),
};

// ── Shuffle ────────────────────────────────────────────────────
export const shuffleAPI = {
  assign:  (testId) => api.post(`/tests/${testId}/assign-shuffle`).then(r => r.data),
  get:     (testId) => api.get(`/tests/${testId}/shuffle`).then(r => r.data),
};

// ── Security ───────────────────────────────────────────────────
export const securityAPI = {
  getAlerts:           (params) => api.get('/admin/security/alerts', { params }).then(r => r.data),
  getAlertStats:       ()       => api.get('/admin/security/alerts/stats').then(r => r.data),
  reviewAlert:         (id, action) => api.post(`/admin/security/alerts/${id}/review`, { action }).then(r => r.data),
  disqualifySubmission: (submissionId) => api.post(`/admin/security/disqualify/${submissionId}`).then(r => r.data),
  getSessionDetails:   (submissionId) => api.get(`/admin/security/sessions/${submissionId}`).then(r => r.data),
};

// ── Plagiarism ─────────────────────────────────────────────────
export const plagiarismAPI = {
  bulkAction: (testId, pairs, action) =>
    api.post(`/submissions/plagiarism-check/${testId}/bulk-action`, { pairs, action }).then(r => r.data),
};

// ── Submissions extended ──────────────────────────────────────
export const submissionsAPIExtended = {
  fingerprint:          (data) => api.post('/submissions/fingerprint', data).then(r => r.data),
  verifyFingerprint:    (data) => api.post('/submissions/fingerprint/verify', data).then(r => r.data),
  fullscreenViolation:  (data) => api.post('/submissions/fullscreen-violation', data).then(r => r.data),
  getTimeBombStatus:    (testId) => api.get('/submissions/time-bomb-status', { params: { testId } }).then(r => r.data),
};

// ── Analytics ──────────────────────────────────────────────────
export const analyticsAPI = {
  studentGrowth:      (userId) => api.get(`/analytics/student-growth/${userId}`).then(r => r.data),
  reportBuilder:      (data)   => api.post('/analytics/report-builder', data).then(r => r.data),
  thresholdAlerts: {
    list:   ()     => api.get('/analytics/threshold-alerts').then(r => r.data),
    create: (data) => api.post('/analytics/threshold-alert', data).then(r => r.data),
    update: (id, data) => api.put(`/analytics/threshold-alert/${id}`, data).then(r => r.data),
    delete: (id)   => api.delete(`/analytics/threshold-alert/${id}`).then(r => r.data),
  },
  nlSummary: (testId) => api.get(`/analytics/nl-summary/${testId}`).then(r => r.data),
};

// ── Code Operations (Coding Platform Enhancements) ─────────
export const codeOpsAPI = {
  lint:             (data) => api.post('/code/lint', data).then(r => r.data),
  format:           (data) => api.post('/code/format', data).then(r => r.data),
  saveSnapshot:     (data) => api.post('/submissions/code-snapshot', data).then(r => r.data),
  getPlayback:      (id)   => api.get(`/submissions/${id}/playback`).then(r => r.data),
  qualityReport:    (id)   => api.post(`/submissions/${id}/quality-report`).then(r => r.data),
  runCustomTest:    (data) => api.post('/submissions/run-custom-test', data).then(r => r.data),
  saveCustomTest:   (data) => api.post('/submissions/save-custom-test', data).then(r => r.data),
  getCustomTests:   (problemId) => api.get(`/saved-custom-tests/${problemId}`).then(r => r.data),
  deleteCustomTest: (id) => api.delete(`/saved-custom-tests/${id}`).then(r => r.data),
  getWorkspace:     (id)   => api.get(`/coding-problems/${id}/workspace`).then(r => r.data),
  saveWorkspace:    (data) => api.post('/submissions/save-workspace', data).then(r => r.data),
};

// ── Email Extended ────────────────────────────────────────────
export const emailAPIExt = {
  send: (data) => api.post('/email/send', data).then(r => r.data),
  sendTestReminder: (testId) => api.post(`/email/test-reminder/${testId}`).then(r => r.data),
};

// ── Notifications ─────────────────────────────────────────────
export const notificationsAPI = {
  list: (params) => api.get('/notifications', { params }).then(r => r.data),
  markRead: (id) => api.put(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.put('/notifications/read-all').then(r => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then(r => r.data),
  send: (data) => api.post('/notifications/send', data).then(r => r.data),
};

// ── Test Messages (student-to-admin chat) ─────────────────────
export const testMessagesAPI = {
  send: (data) => api.post('/test-messages', data).then(r => r.data),
  getForTest: (testId) => api.get(`/test-messages/${testId}`).then(r => r.data),
  getMy: (testId) => api.get(`/test-messages/my/${testId}`).then(r => r.data),
  resolve: (id) => api.put(`/test-messages/${id}/resolve`).then(r => r.data),
};

// ── Announcements ─────────────────────────────────────────────
export const announcementsAPI = {
  list: () => api.get('/announcements').then(r => r.data),
  create: (data) => api.post('/announcements', data).then(r => r.data),
  update: (id, data) => api.put(`/announcements/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/announcements/${id}`).then(r => r.data),
};

// ── Forum ─────────────────────────────────────────────────────
export const forumAPI = {
  listThreads: (problemId) => api.get(`/forum/problems/${problemId}/threads`).then(r => r.data),
  createThread: (data) => api.post('/forum/threads', data).then(r => r.data),
  getThread: (id) => api.get(`/forum/threads/${id}`).then(r => r.data),
  replyToThread: (id, data) => api.post(`/forum/threads/${id}/reply`, data).then(r => r.data),
  upvoteReply: (id) => api.post(`/forum/replies/${id}/upvote`).then(r => r.data),
  updateReply: (id, data) => api.put(`/forum/replies/${id}`, data).then(r => r.data),
  deleteReply: (id) => api.delete(`/forum/replies/${id}`).then(r => r.data),
};


export default api;
