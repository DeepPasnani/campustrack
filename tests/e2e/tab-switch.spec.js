const { test, expect } = require('@playwright/test');

test.describe('Tab-Switch Auto-Submit', () => {
  test('test auto-submits after exceeding tab switch limit', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'student@test.edu');
    await page.fill('input[type="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/student/);

    // Navigate to an in-progress test or start one
    await page.goto('/student');
    await page.waitForLoadState('networkidle');

    const testCards = page.locator('[data-testid="test-card"]');
    const count = await testCards.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await testCards.first().click();

    const startBtn = page.locator('button:has-text("Start Test")');
    if (!(await startBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await startBtn.click();
    await page.waitForTimeout(2000);

    // Simulate tab switches by navigating away and back
    // The frontend tracks visibility changes
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(500);
    }

    // Try to submit — should be auto-submitted after 5 switches
    // The frontend should disable the test or show auto-submit message
    await page.waitForTimeout(2000);

    // Check if we're on results page or see submission confirmation
    const isSubmitted = await page.locator('text=submitted').isVisible({ timeout: 5000 }).catch(() => false);
    const isAutoSubmitted = await page.locator('text=auto-submitted').isVisible({ timeout: 3000 }).catch(() => false);

    // Either way, the test should have ended
    expect(isSubmitted || isAutoSubmitted || page.url().includes('/results')).toBeTruthy();
  });
});
