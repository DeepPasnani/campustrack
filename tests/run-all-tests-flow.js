const { chromium } = require('playwright');

(async () => {
  const email = process.env.EMAIL;
  const password = process.env.PASSWORD;
  const testId = '350b1626-b760-4ab0-982c-9e2e906c9855';
  const baseURL = process.env.BASE_URL || 'http://localhost:2828';

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  try {
    // Login
    await page.goto(`${baseURL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/student/, { timeout: 20000 });
    console.log('LOGGED IN');

    // Navigate directly to test
    await page.goto(`${baseURL}/test/${testId}`);
    await page.waitForLoadState('networkidle');

    // Start test
    const startBtn = page.locator('button:has-text("Start Test")');
    await startBtn.waitFor({ state: 'visible', timeout: 15000 });
    await startBtn.click();
    await page.waitForTimeout(4000);

    // Handle fullscreen / lockdown prompts if any
    try {
      const okBtn = page.locator('text=Continue');
      if (await okBtn.count()) await okBtn.first().click();
    } catch {}

    // Look for Monaco editor
    const editor = page.locator('.monaco-editor');
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    console.log('EDITOR VISIBLE');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('def solve():\n    return "Hello World"\n\nif __name__ == "__main__":\n    print(solve())');

    // Click Run All Tests
    const runAll = page.locator('button:has-text("Run All Tests")');
    await runAll.waitFor({ state: 'visible', timeout: 10000 });
    await runAll.click();
    console.log('CLICKED RUN ALL TESTS');

    // Wait for results table or any visible change
    await page.waitForTimeout(8000);

    const bodyText = await page.locator('body').innerText();
    const hasSummary = bodyText.includes('test cases passed');
    const hasTable = await page.locator('table').count();
    const resultsPanel = page.locator('.panel.rounded-lg');

    console.log('HAS_SUMMARY_LABEL:', hasSummary);
    console.log('TABLE_COUNT:', hasTable);

    const toasts = await page.locator('[class*="toast"]').allInnerTexts().catch(() => []);
    console.log('TOASTS:', JSON.stringify(toasts));

    // Save screenshot + page HTML snapshot of results area
    await page.screenshot({ path: '/tmp/opencode/flow-screenshot.png', fullPage: false });
    const html = await page.content();
    require('fs').writeFileSync('/tmp/opencode/flow-page.html', html);

    const panelText = await resultsPanel.first().innerText().catch(() => 'NO PANEL');
    console.log('FIRST_PANEL_TEXT_START:', panelText.slice(0, 1200));

  } catch (err) {
    console.log('ERROR:', err.message);
    await page.screenshot({ path: '/tmp/opencode/flow-error.png' }).catch(() => {});
  }

  console.log('--- LOGS ---');
  logs.slice(-40).forEach((l) => console.log(l));

  await browser.close();
})();
