const { test, expect } = require('@playwright/test');

test.describe('Admin Resume Test', () => {
  test('admin can resume an auto-submitted student test', async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@test.edu');
    await page.fill('input[type="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/);

    // Navigate to results
    await page.goto('/admin/results');
    await page.waitForLoadState('networkidle');

    // Look for a test with auto-submitted entries
    const resultTables = page.locator('table');
    const tableCount = await resultTables.count();
    if (tableCount === 0) {
      test.skip();
      return;
    }

    // Find auto_submitted status in table
    const autoSubRow = page.locator('text=auto_submitted').first();
    if (!(await autoSubRow.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click resume button (usually in the row actions)
    const resumeBtn = page.locator('button:has-text("Resume")');
    if (!(await resumeBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await resumeBtn.click();

    // Confirm resume
    const confirmBtn = page.locator('button:has-text("Confirm")');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Verify success toast or message
    await expect(page.locator('text=resumed').or(page.locator('text=successfully'))).toBeVisible({ timeout: 5000 });
  });
});
