import api from './api';

export const aiAPI = {
  generateMCQs: (data) => {
    const fd = new FormData();
    if (data.pdf) {
      fd.append('pdf', data.pdf);
    } else {
      fd.append('topic', data.topic);
      fd.append('count', data.count);
      fd.append('difficulty', data.difficulty);
      fd.append('genre', data.genre);
    }
    return api.post('/ai/generate-mcqs', fd, {
      headers: data.pdf ? { 'Content-Type': 'multipart/form-data' } : {},
    }).then(r => r.data);
  },

  saveGeneratedMCQs: (questions) =>
    api.post('/ai/save-generated-mcqs', { questions }).then(r => r.data),

  getCodingHint: (problemId, studentCode, hintLevel) =>
    api.post('/ai/coding-hint', { problemId, studentCode, hintLevel }).then(r => r.data),

  getAdaptiveNext: (testId) =>
    api.post('/ai/adaptive-next', { testId }).then(r => r.data),

  autoTag: (questionId) =>
    api.post('/ai/auto-tag', { questionId }).then(r => r.data),

  autoTagBatch: () =>
    api.post('/ai/auto-tag-batch').then(r => r.data),

  getFeedback: (testId, userId) =>
    api.post('/ai/performance-feedback', { testId, userId }).then(r => r.data),

  nlQuery: (query) =>
    api.post('/ai/nl-query', { query }).then(r => r.data),

  logKeystroke: (data) =>
    api.post('/submissions/log-keystroke', data).then(r => r.data),

  getCheatingAnalysis: (testId) =>
    api.get(`/submissions/cheating-analysis/${testId}`).then(r => r.data),

  getCheatingFlags: (testId) =>
    api.get(`/submissions/cheating-flags/${testId}`).then(r => r.data),
};
