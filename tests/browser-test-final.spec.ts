import { test, expect } from '@playwright/test';

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
  await page.screenshot({ path: 'test-screenshots/final-01-login-page.png', fullPage: true });
  console.log('Screenshot saved: final-01-login-page.png');

  // Use the specific input IDs from the form
  const usernameInput = page.locator('#username');
  const passwordInput = page.locator('#password');

  // Clear and fill username
  await usernameInput.click();
  await usernameInput.fill('autoads');
  console.log('Filled username: autoads');

  // Clear and fill password - the password contains special characters
  await passwordInput.click();
  await passwordInput.fill('***REMOVED***');
  console.log('Filled password: [hidden]');

  // Take screenshot with filled form
  await page.screenshot({ path: 'test-screenshots/final-02-login-filled.png', fullPage: true });
  console.log('Screenshot saved: final-02-login-filled.png');

  // Click the submit button
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();
  console.log('Clicked login button');

  // Wait for either redirect or error message
  await Promise.race([
    page.waitForURL(/\/(dashboard|offers|change-password)/, { timeout: 10000 }),
    page.waitForSelector('.bg-red-50', { timeout: 10000 }), // Error message container
  ]).catch(() => {
    console.log('Neither redirect nor error message detected within timeout');
  });

  // Additional wait for page to stabilize
  await page.waitForTimeout(2000);

  // Take screenshot after login attempt
  await page.screenshot({ path: 'test-screenshots/final-03-after-login.png', fullPage: true });
  console.log('Screenshot saved: final-03-after-login.png');

  // Check current URL
  const urlAfterLogin = page.url();
  console.log(`Current URL: ${urlAfterLogin}`);

  // Check for error message
  const errorMessage = await page.locator('.bg-red-50').textContent().catch(() => null);
  if (errorMessage) {
    console.log(`ERROR: Login failed with message: ${errorMessage.trim()}`);
  }

  // Verify login result
  if (urlAfterLogin.includes('/login')) {
    console.log('RESULT: Login FAILED - still on login page');

    // Check what values are in the form
    const currentUsername = await usernameInput.inputValue();
    const currentPassword = await passwordInput.inputValue();
    console.log(`Form state - Username: "${currentUsername}", Password length: ${currentPassword.length}`);
  } else if (urlAfterLogin.includes('/change-password')) {
    console.log('RESULT: Login SUCCESS - redirected to change password');
  } else if (urlAfterLogin.includes('/dashboard')) {
    console.log('RESULT: Login SUCCESS - redirected to dashboard');
  } else if (urlAfterLogin.includes('/offers')) {
    console.log('RESULT: Login SUCCESS - redirected to offers');
  }

  // Only continue if login succeeded
  if (urlAfterLogin.includes('/login')) {
    console.log('\nStopping tests - login failed');
    return;
  }

  // ============================================================
  // TEST 2: OFFERS PAGE
  // ============================================================
  console.log('\n--- TEST 2: OFFERS PAGE ---\n');

  // Navigate to offers page
  await page.goto('http://localhost:3000/offers');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log('Navigated to offers page');

  // Take screenshot
  await page.screenshot({ path: 'test-screenshots/final-04-offers-page.png', fullPage: true });
  console.log('Screenshot saved: final-04-offers-page.png');

  const offersUrl = page.url();
  if (offersUrl.includes('/login')) {
    console.log('ERROR: Session expired - redirected to login');
  } else {
    console.log('On offers page');

    // Check for table
    const tableCount = await page.locator('table').count();
    console.log(`Tables found: ${tableCount}`);

    if (tableCount > 0) {
      const rowCount = await page.locator('table tbody tr').count();
      console.log(`Table rows (offers): ${rowCount}`);
    }

    // Check for import/upload functionality
    const buttons = await page.locator('button').allTextContents();
    const importButtons = buttons.filter(b => /import|upload|csv|batch/i.test(b));
    console.log(`Import/Upload buttons: ${importButtons.length > 0 ? importButtons.join(', ') : 'None found'}`);

    // Check for file input
    const fileInputCount = await page.locator('input[type="file"]').count();
    console.log(`File inputs: ${fileInputCount}`);

    // Get page title/headings
    const h1Text = await page.locator('h1').first().textContent().catch(() => 'N/A');
    console.log(`Page title: ${h1Text}`);
  }

  // ============================================================
  // TEST 3: DASHBOARD
  // ============================================================
  console.log('\n--- TEST 3: DASHBOARD ---\n');

  // Navigate to dashboard
  await page.goto('http://localhost:3000/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log('Navigated to dashboard');

  // Take screenshot
  await page.screenshot({ path: 'test-screenshots/final-05-dashboard.png', fullPage: true });
  console.log('Screenshot saved: final-05-dashboard.png');

  const dashboardUrl = page.url();
  if (dashboardUrl.includes('/login')) {
    console.log('ERROR: Session expired - redirected to login');
  } else {
    console.log('On dashboard');

    // Get page content for analysis
    const pageText = await page.locator('body').textContent() || '';

    // Check for Risk Alerts
    const hasRiskAlerts = /risk|风险/i.test(pageText);
    console.log(`Risk Alerts section: ${hasRiskAlerts ? 'FOUND' : 'NOT FOUND'}`);

    // Check for Optimization Tasks
    const hasOptimization = /optim|优化/i.test(pageText);
    console.log(`Optimization Tasks section: ${hasOptimization ? 'FOUND' : 'NOT FOUND'}`);

    // Get all headings
    const allHeadings = await page.locator('h1, h2, h3, h4').allTextContents();
    const headings = allHeadings.filter(h => h.trim());
    console.log(`Dashboard sections: ${headings.length > 0 ? headings.slice(0, 5).join(', ') : 'None found'}`);

    // Count widgets/cards
    const cardCount = await page.locator('[class*="card"], [class*="widget"]').count();
    console.log(`Cards/Widgets: ${cardCount}`);

    // Check for charts
    const chartCount = await page.locator('canvas, svg[class*="chart"], [class*="chart"]').count();
    console.log(`Charts: ${chartCount}`);

    // Scroll and take full page screenshot
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-screenshots/final-06-dashboard-full.png', fullPage: true });
    console.log('Screenshot saved: final-06-dashboard-full.png');
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const loginPassed = !urlAfterLogin.includes('/login');
  const offersPassed = !offersUrl.includes('/login');
  const dashboardPassed = !dashboardUrl.includes('/login');

  console.log(`1. Login Test: ${loginPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`2. Offers Page Test: ${offersPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`3. Dashboard Test: ${dashboardPassed ? 'PASSED' : 'FAILED'}`);
  console.log('\nScreenshots saved to: test-screenshots/');
  console.log('='.repeat(60));
});
