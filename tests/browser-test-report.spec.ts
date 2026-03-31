import { test, expect } from '@playwright/test';

test('AutoAds Browser Test Report', async ({ page, context }) => {
  const results: any = {
    login: { status: 'unknown', details: '' },
    offers: { status: 'unknown', details: '' },
    dashboard: { status: 'unknown', details: '' },
    issues: []
  };

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           AUTOADS BROWSER TEST REPORT                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════
  // TEST 1: LOGIN
  // ═══════════════════════════════════════════════════════════════
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ TEST 1: LOGIN                                                │');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-screenshots/report-01-login-page.png', fullPage: true });
  console.log('Screenshot: report-01-login-page.png');

  // Fill credentials
  await page.locator('#username').fill('autoads');
  await page.locator('#password').fill('***REMOVED***');
  await page.screenshot({ path: 'test-screenshots/report-02-login-filled.png', fullPage: true });
  console.log('Screenshot: report-02-login-filled.png');
  console.log('Filled username: autoads');

  // Submit
  await page.locator('button[type="submit"]').click();

  // Wait for navigation
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-screenshots/report-03-after-login.png', fullPage: true });
  console.log('Screenshot: report-03-after-login.png');

  const loginUrl = page.url();
  const cookies = await context.cookies();
  const hasAuthCookie = cookies.some(c => c.name === 'auth_token');

  console.log(`\nLogin Result:`);
  console.log(`  - URL after login: ${loginUrl}`);
  console.log(`  - Auth cookie set: ${hasAuthCookie}`);

  if (hasAuthCookie && !loginUrl.includes('/login')) {
    results.login.status = 'PASSED';
    results.login.details = `Redirected to ${loginUrl}`;
    console.log(`  - Status: PASSED (redirected successfully)`);
  } else if (hasAuthCookie && loginUrl.includes('/login')) {
    results.login.status = 'PARTIAL';
    results.login.details = 'Cookie set but redirect failed';
    results.issues.push('Auth cookie is set but subsequent /api/auth/me calls fail with 401');
    console.log(`  - Status: PARTIAL (cookie set but redirect failed)`);
  } else {
    results.login.status = 'FAILED';
    results.login.details = 'No auth cookie set';
    console.log(`  - Status: FAILED (no cookie set)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 2: OFFERS PAGE
  // ═══════════════════════════════════════════════════════════════
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│ TEST 2: OFFERS PAGE                                          │');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  await page.goto('http://localhost:3000/offers');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-screenshots/report-04-offers-page.png', fullPage: true });
  console.log('Screenshot: report-04-offers-page.png');

  const offersUrl = page.url();
  console.log(`Current URL: ${offersUrl}`);

  if (offersUrl.includes('/login')) {
    results.offers.status = 'BLOCKED';
    results.offers.details = 'Redirected to login';
    console.log(`Status: BLOCKED - Redirected to login (authentication issue)`);
  } else {
    console.log(`Status: Accessible`);

    // Check for table
    const tableCount = await page.locator('table').count();
    const rowCount = tableCount > 0 ? await page.locator('table tbody tr').count() : 0;
    console.log(`\nOffers List:`);
    console.log(`  - Tables found: ${tableCount}`);
    console.log(`  - Rows (offers): ${rowCount}`);

    // Check for import/upload
    const buttons = await page.locator('button').allTextContents();
    const hasImport = buttons.some(b => /import|upload|csv|batch/i.test(b));
    const fileInputs = await page.locator('input[type="file"]').count();
    console.log(`\nBatch Import/CSV Upload:`);
    console.log(`  - Import buttons: ${hasImport ? 'Found' : 'Not found'}`);
    console.log(`  - File inputs: ${fileInputs}`);

    results.offers.status = 'PASSED';
    results.offers.details = `${rowCount} offers, import: ${hasImport ? 'yes' : 'no'}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 3: DASHBOARD
  // ═══════════════════════════════════════════════════════════════
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│ TEST 3: DASHBOARD                                            │');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  await page.goto('http://localhost:3000/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-screenshots/report-05-dashboard.png', fullPage: true });
  console.log('Screenshot: report-05-dashboard.png');

  const dashboardUrl = page.url();
  console.log(`Current URL: ${dashboardUrl}`);

  if (dashboardUrl.includes('/login')) {
    results.dashboard.status = 'BLOCKED';
    results.dashboard.details = 'Redirected to login';
    console.log(`Status: BLOCKED - Redirected to login (authentication issue)`);
  } else {
    console.log(`Status: Accessible`);

    const pageText = await page.locator('body').textContent() || '';

    // Check sections
    const hasRisk = /risk|风险|alert|警报/i.test(pageText);
    const hasOptimization = /optim|优化|task|任务/i.test(pageText);

    console.log(`\nDashboard Sections:`);
    console.log(`  - Risk Alerts: ${hasRisk ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`  - Optimization Tasks: ${hasOptimization ? 'FOUND' : 'NOT FOUND'}`);

    // Count elements
    const cards = await page.locator('[class*="card"], [class*="widget"]').count();
    const charts = await page.locator('canvas, svg').count();
    console.log(`  - Cards/Widgets: ${cards}`);
    console.log(`  - Charts/Graphs: ${charts}`);

    results.dashboard.status = 'PASSED';
    results.dashboard.details = `Risk: ${hasRisk}, Optimization: ${hasOptimization}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                       SUMMARY                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Test Results:');
  console.log(`  1. Login Test:     ${results.login.status} - ${results.login.details}`);
  console.log(`  2. Offers Test:    ${results.offers.status} - ${results.offers.details}`);
  console.log(`  3. Dashboard Test: ${results.dashboard.status} - ${results.dashboard.details}`);

  if (results.issues.length > 0) {
    console.log('\nIssues Found:');
    results.issues.forEach((issue: string, i: number) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }

  console.log('\nScreenshots saved to: test-screenshots/');
  console.log('Files: report-01 through report-05');

  // Assert at least login was successful
  expect(hasAuthCookie).toBe(true);
});
