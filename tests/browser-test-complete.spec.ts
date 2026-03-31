import { test, expect } from '@playwright/test';

// Use a single test with all scenarios to maintain session
test('AutoAds Complete Browser Test', async ({ page }) => {
  console.log('='.repeat(60));
  console.log('AUTOADS BROWSER TESTING REPORT');
  console.log('='.repeat(60));

  // ============================================================
  // TEST 1: LOGIN
  // ============================================================
  console.log('\n--- TEST 1: LOGIN ---\n');

  // Navigate to login page
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('domcontentloaded');
  console.log('Navigated to login page');

  // Take screenshot of login page
  await page.screenshot({ path: 'test-screenshots/test-01-login-page.png', fullPage: true });
  console.log('Screenshot saved: test-01-login-page.png');

  // Find and fill credentials
  // The form has placeholders in Chinese: 用户名 (username), 密码 (password)
  const usernameField = page.locator('input').first();
  const passwordField = page.locator('input').nth(1);

  await usernameField.fill('autoads');
  await passwordField.fill('test123');
  console.log('Filled in credentials: autoads / [password hidden]');

  // Take screenshot with filled form
  await page.screenshot({ path: 'test-screenshots/test-02-login-filled.png', fullPage: true });
  console.log('Screenshot saved: test-02-login-filled.png');

  // Click login button (登录 means "Login" in Chinese)
  await page.locator('button').click();
  console.log('Clicked login button');

  // Wait for navigation and page load - wait longer for content to appear
  try {
    await page.waitForURL(/\/(dashboard|offers)/, { timeout: 15000 });
    console.log('URL changed after login');
  } catch (e) {
    console.log('URL did not change as expected');
  }

  // Wait for loading to complete - look for actual content, not spinner
  await page.waitForTimeout(3000); // Give time for data to load

  // Check current URL
  const urlAfterLogin = page.url();
  console.log(`Current URL: ${urlAfterLogin}`);

  // Take screenshot after login
  await page.screenshot({ path: 'test-screenshots/test-03-after-login.png', fullPage: true });
  console.log('Screenshot saved: test-03-after-login.png');

  // Verify login success
  if (urlAfterLogin.includes('/login')) {
    console.log('ERROR: Still on login page - login may have failed');
    // Check for error messages
    const errorText = await page.locator('[class*="error"], [class*="alert"]').textContent().catch(() => '');
    if (errorText) {
      console.log(`Error message: ${errorText}`);
    }
  } else {
    console.log('SUCCESS: Login successful, redirected to: ' + urlAfterLogin);
  }

  // ============================================================
  // TEST 2: OFFERS PAGE
  // ============================================================
  console.log('\n--- TEST 2: OFFERS PAGE ---\n');

  // Navigate to offers page
  await page.goto('http://localhost:3000/offers');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Wait for data to load
  console.log('Navigated to offers page');

  // Take screenshot
  await page.screenshot({ path: 'test-screenshots/test-04-offers-page.png', fullPage: true });
  console.log('Screenshot saved: test-04-offers-page.png');

  // Check if we're still logged in or redirected to login
  const offersUrl = page.url();
  if (offersUrl.includes('/login')) {
    console.log('ERROR: Redirected to login - session may have expired');
  } else {
    console.log('On offers page: ' + offersUrl);

    // Look for offers table
    const table = page.locator('table');
    const tableCount = await table.count();
    console.log(`Found ${tableCount} table(s)`);

    if (tableCount > 0) {
      const rows = await page.locator('table tbody tr').count();
      console.log(`Found ${rows} offer rows in table`);
    }

    // Look for batch import/CSV upload
    const importElements = await page.locator('button, a').filter({ hasText: /import|upload|csv|batch/i }).count();
    if (importElements > 0) {
      console.log(`Found ${importElements} import/upload button(s)`);
    } else {
      console.log('No batch import/CSV upload buttons found');
    }

    // Look for file inputs
    const fileInputs = await page.locator('input[type="file"]').count();
    if (fileInputs > 0) {
      console.log(`Found ${fileInputs} file input(s)`);
    }

    // Get page headings
    const headings = await page.locator('h1, h2, h3').allTextContents();
    console.log('Page headings: ' + headings.filter(h => h.trim()).join(', '));

    // Look for "Create Offer" or similar buttons
    const createButtons = await page.locator('button, a').filter({ hasText: /create|new|add/i }).count();
    console.log(`Found ${createButtons} create/new/add button(s)`);
  }

  // ============================================================
  // TEST 3: DASHBOARD
  // ============================================================
  console.log('\n--- TEST 3: DASHBOARD ---\n');

  // Navigate to dashboard
  await page.goto('http://localhost:3000/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Wait for data to load
  console.log('Navigated to dashboard');

  // Take screenshot
  await page.screenshot({ path: 'test-screenshots/test-05-dashboard.png', fullPage: true });
  console.log('Screenshot saved: test-05-dashboard.png');

  // Check if we're still logged in
  const dashboardUrl = page.url();
  if (dashboardUrl.includes('/login')) {
    console.log('ERROR: Redirected to login - session may have expired');
  } else {
    console.log('On dashboard: ' + dashboardUrl);

    // Get all visible text content to understand page structure
    const bodyText = await page.locator('body').textContent();

    // Look for risk alerts
    const hasRiskAlerts = bodyText?.toLowerCase().includes('risk') || bodyText?.includes('风险');
    console.log(`Risk alerts section: ${hasRiskAlerts ? 'FOUND' : 'NOT FOUND'}`);

    // Look for optimization tasks
    const hasOptimization = bodyText?.toLowerCase().includes('optim') || bodyText?.includes('优化');
    console.log(`Optimization tasks section: ${hasOptimization ? 'FOUND' : 'NOT FOUND'}`);

    // Get all headings
    const dashboardHeadings = await page.locator('h1, h2, h3, h4, h5').allTextContents();
    const cleanHeadings = dashboardHeadings.filter(h => h.trim());
    console.log('Dashboard sections: ' + (cleanHeadings.length > 0 ? cleanHeadings.join(', ') : 'None found'));

    // Count cards/widgets
    const cards = await page.locator('[class*="card"], [class*="widget"], [class*="panel"], [class*="box"]').count();
    console.log(`Found ${cards} card/widget/panel elements`);

    // Look for charts or data visualizations
    const charts = await page.locator('canvas, svg, [class*="chart"], [class*="graph"]').count();
    console.log(`Found ${charts} chart/graph elements`);

    // Take a longer page screenshot with scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-screenshots/test-06-dashboard-scrolled.png', fullPage: true });
    console.log('Screenshot saved: test-06-dashboard-scrolled.png');
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Login test: ${!urlAfterLogin.includes('/login') ? 'PASSED' : 'FAILED'}`);
  console.log(`Offers page test: ${!offersUrl.includes('/login') ? 'PASSED' : 'FAILED'}`);
  console.log(`Dashboard test: ${!dashboardUrl.includes('/login') ? 'PASSED' : 'FAILED'}`);
  console.log('\nScreenshots saved to: test-screenshots/');
  console.log('='.repeat(60));
});
