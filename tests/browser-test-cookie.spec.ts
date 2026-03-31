import { test, expect } from '@playwright/test';

test('AutoAds Cookie Debug Test', async ({ page, context }) => {
  // Enable console logging
  page.on('console', msg => {
    console.log(`Browser [${msg.type()}]: ${msg.text()}`);
  });

  // Log network responses
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/auth/')) {
      console.log(`API: ${response.request().method()} ${url} -> ${response.status()}`);

      // Log Set-Cookie headers
      const headers = response.headers();
      if (headers['set-cookie']) {
        console.log(`Set-Cookie: ${headers['set-cookie']}`);
      }
    }
  });

  console.log('='.repeat(60));
  console.log('AUTOADS COOKIE DEBUG TEST');
  console.log('='.repeat(60));

  // Navigate to login page
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  console.log('1. Navigated to login page');

  // Fill and submit
  await page.locator('#username').fill('autoads');
  await page.locator('#password').fill('***REMOVED***');
  console.log('2. Filled credentials');

  // Click submit button
  await page.locator('button[type="submit"]').click();
  console.log('3. Clicked submit');

  // Wait for navigation or timeout
  await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 }).catch(async () => {
    console.log('4. URL did not change');

    // Check cookies
    const cookies = await context.cookies();
    console.log(`\nCookies after login attempt (${cookies.length}):`);
    cookies.forEach(c => {
      console.log(`  - ${c.name}: ${c.value.substring(0, 20)}... (httpOnly: ${c.httpOnly}, path: ${c.path})`);
    });
  });

  // Final URL check
  const finalUrl = page.url();
  console.log(`\n5. Final URL: ${finalUrl}`);

  // Check cookies
  const finalCookies = await context.cookies();
  console.log(`\nFinal cookies (${finalCookies.length}):`);
  finalCookies.forEach(c => {
    console.log(`  - ${c.name}: ${c.value.substring(0, 30)}...`);
  });

  // If we have auth token, try manual navigation
  const hasAuthToken = finalCookies.some(c => c.name === 'auth_token');
  console.log(`\nHas auth_token cookie: ${hasAuthToken}`);

  if (hasAuthToken) {
    console.log('\n6. Manually navigating to dashboard...');
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-screenshots/cookie-01-dashboard.png', fullPage: true });
    console.log(`Dashboard URL: ${page.url()}`);

    if (!page.url().includes('/login')) {
      console.log('SUCCESS: Accessed dashboard!');

      // Now test offers
      await page.goto('http://localhost:3000/offers');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-screenshots/cookie-02-offers.png', fullPage: true });
      console.log(`Offers URL: ${page.url()}`);

      // Check for table
      const tableCount = await page.locator('table').count();
      console.log(`Tables on offers page: ${tableCount}`);

      // Check for import buttons
      const buttonTexts = await page.locator('button').allTextContents();
      console.log(`Buttons: ${buttonTexts.slice(0, 10).join(', ')}`);
    } else {
      console.log('FAILED: Redirected back to login');
    }
  } else {
    console.log('ERROR: No auth_token cookie found');
  }

  await page.screenshot({ path: 'test-screenshots/cookie-03-final.png', fullPage: true });
  console.log('='.repeat(60));
});
