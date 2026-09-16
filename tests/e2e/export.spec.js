const { test, expect } = require('@playwright/test');
const { request } = require('@playwright/test');

test.describe('CSV/PDF Export', () => {
  let apiContext;
  let adminToken;
  let testId;

  test.beforeAll(async () => {
    const apiURL = process.env.API_URL || 'http://localhost:5000';
    apiContext = await request.newContext({ baseURL: apiURL });

    const loginRes = await apiContext.post('/api/auth/login', {
      data: { email: 'admin@test.edu', password: 'testpass123' },
    });
    const data = await loginRes.json();
    adminToken = data.token;

    // Get first test ID
    const testsRes = await apiContext.get('/api/tests', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const testsData = await testsRes.json();
    if (testsData.tests?.length > 0) {
      testId = testsData.tests[0].id;
    }
  });

  test('admin can export results as CSV', async () => {
    test.skip(!testId, 'No test available');
    const res = await apiContext.get(`/api/submissions/test/${testId}/export-csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/csv');
  });

  test('admin can export results as PDF', async () => {
    test.skip(!testId, 'No test available');
    const res = await apiContext.get(`/api/submissions/test/${testId}/export-pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('application/pdf');
  });

  test.afterAll(async () => {
    if (apiContext) await apiContext.dispose();
  });
});
