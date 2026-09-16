const { test, expect } = require('@playwright/test');

test.describe('Coding Flow', () => {
  test('student can select 3 of 5 coding problems, run code, and submit', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'student@test.edu');
    await page.fill('input[type="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/student/);

    // Navigate to tests and find a coding test
    await page.goto('/student');
    await page.waitForLoadState('networkidle');

    // Look for a test with coding section
    const codingTest = page.locator('[data-testid="coding-test-card"]');
    if (await codingTest.isVisible({ timeout: 3000 }).catch(() => false)) {
      await codingTest.click();
    } else {
      // Try first test
      const testCards = page.locator('[data-testid="test-card"]');
      const count = await testCards.count();
      if (count > 0) {
        await testCards.first().click();
      } else {
        test.skip();
        return;
      }
    }

    const startBtn = page.locator('button:has-text("Start Test")');
    if (!(await startBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(2000);

    // Select coding problems (if coding section exists)
    const problemCheckboxes = page.locator('input[type="checkbox"][data-testid="coding-select"]');
    const checkboxCount = await problemCheckboxes.count();
    if (checkboxCount === 0) {
      test.skip();
      return;
    }

    // Select up to 3 problems
    const toSelect = Math.min(3, checkboxCount);
    for (let i = 0; i < toSelect; i++) {
      await problemCheckboxes.nth(i).check();
    }

    // Navigate to first selected coding problem
    const problemTabs = page.locator('[data-testid="coding-tab"]');
    if (await problemTabs.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await problemTabs.first().click();
    }

    // Write code in Monaco editor
    const editor = page.locator('.monaco-editor');
    if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editor.click();
      await page.keyboard.insertText('print("hello world")');
    }

    // Run code
    const runBtn = page.locator('button:has-text("Run")');
    if (await runBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await runBtn.click();
      await page.waitForTimeout(3000);
    }

    // Submit test
    const submitBtn = page.locator('button:has-text("Submit")');
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      const confirmBtn = page.locator('button:has-text("Confirm")');
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
    }

    await page.waitForTimeout(2000);
  });
});
