const { request } = require('@playwright/test');

// NOTE: POST /api/auth/register always hard-codes role='student' server-side
// (see backend/src/controllers/auth.js) -- any `role` field in the request
// body is ignored. So admin@test.edu can NOT be created as an admin via
// register; it has to be created through POST /api/users/admin, which
// requires a super_admin bearer token. backend/src/db/seed.js (run by the
// backend-init service in docker-compose.yml) already creates that
// super_admin account (superadmin@college.edu / SuperAdmin@123), so we log
// in as it here and use it to provision the real admin test account.
async function globalSetup() {
  const apiURL = process.env.API_URL || 'http://localhost:5000';

  const ctx = await request.newContext({ baseURL: apiURL });

  // Create student user (register always creates role='student', which is
  // exactly what we want here)
  try {
    await ctx.post('/api/auth/register', {
      data: {
        name: 'Test Student',
        email: 'student@test.edu',
        password: 'testpass123',
        department: 'Computer Engineering',
        rollNumber: 'TEST001',
        className: 'Class 1',
      },
    });
  } catch {
    // user may already exist
  }

  // Create admin user properly via the super_admin-only endpoint
  try {
    const superLoginRes = await ctx.post('/api/auth/login', {
      data: { email: 'superadmin@college.edu', password: 'SuperAdmin@123' },
    });
    const { token: superToken } = await superLoginRes.json();

    if (superToken) {
      await ctx.post('/api/users/admin', {
        headers: { Authorization: `Bearer ${superToken}` },
        data: {
          name: 'Test Admin',
          email: 'admin@test.edu',
          password: 'testpass123',
        },
      });
    }
  } catch {
    // admin@test.edu may already exist from a previous run
  }

  await ctx.dispose();
}

module.exports = globalSetup;
