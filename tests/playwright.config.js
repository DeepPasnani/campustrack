const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // Without this, e2e/global-setup.js (which creates the admin@test.edu /
  // student@test.edu accounts every spec logs in as) never runs, and every
  // spec fails at the login step.
  globalSetup: require.resolve('./e2e/global-setup.js'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:2828',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'docker compose -f ../docker-compose.yml up -d && sleep 10',
        url: 'http://localhost:5000/health',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
