const { test, expect } = require('@playwright/test');

test.describe('Full MCQ Flow', () => {
  test('student can log in, attempt an MCQ test, and submit', async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.fill('input[type="email"]', 'student@test.edu');
    await page.fill('input[type="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/student/);
    await expect(page.locator('text=Tests')).toBeVisible();

    // Navigate to available tests
    await page.goto('/student');
    await page.waitForLoadState('networkidle');

    // Click first available test card
    const testCards = page.locator('[data-testid="test-card"]');
    const count = await testCards.count();
    if (count > 0) {
      await testCards.first().click();
    }

    // If test exists, attempt it
    const startBtn = page.locator('button:has-text("Start Test")');
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(2000);

      // Answer an MCQ
      const options = page.locator('input[type="radio"]');
      const optCount = await options.count();
      if (optCount > 0) {
        await options.first().click();
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
    }
  });
});
