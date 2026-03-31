import { test, expect } from '@playwright/test';

test('AutoAds Debug Browser Test', async ({ page }) => {
  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`Browser ERROR: ${msg.text()}`);
    }
  });

  // Log all network requests to login API
  page.on('response', async response => {
    if (response.url().includes('/api/auth/login')) {
      console.log(`API Response: ${response.status()} ${response.statusText()}`);
      try {
        const body = await response.json();
        console.log(`API Body: ${JSON.stringify(body)}`);
      } catch (e) {
        console.log(`API Body: Could not parse`);
      }
    }
  });

  console.log('='.repeat(60));
  console.log('AUTOADS DEBUG BROWSER TEST');
  console.log('='.repeat(60));

  // Navigate to login page
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  console.log('Navigated to login page');

  // Screenshot
  await page.screenshot({ path: 'test-screenshots/debug-01-login.png', fullPage: true });

  // Fill the form using keyboard input (more reliable)
  const usernameInput = page.locator('#username');
  const passwordInput = page.locator('#password');

  await usernameInput.click();
  await page.keyboard.type('autoads');
  console.log('Typed username');

  await passwordInput.click();
  // Type the password character by character
  await page.keyboard.type('***REMOVED***');
  console.log('Typed password');

  // Screenshot with filled form
  await page.screenshot({ path: 'test-screenshots/debug-02-filled.png', fullPage: true });

  // Submit using keyboard (Enter key)
  console.log('Pressing Enter to submit...');
  await page.keyboard.press('Enter');

  // Wait for response
  await page.waitForTimeout(5000);

  // Screenshot after submit
  await page.screenshot({ path: 'test-screenshots/debug-03-after-submit.png', fullPage: true });

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  // Check for error message
  const errorElement = page.locator('.bg-red-50');
  const hasError = await errorElement.isVisible().catch(() => false);
  if (hasError) {
    const errorText = await errorElement.textContent();
    console.log(`Error message: ${errorText}`);
  }

  // If still on login page, check form values
  if (currentUrl.includes('/login')) {
    const usernameValue = await usernameInput.inputValue();
    const passwordValue = await passwordInput.inputValue();
    console.log(`Username value: "${usernameValue}"`);
    console.log(`Password length: ${passwordValue.length}`);
    console.log('LOGIN FAILED');
  } else {
    console.log('LOGIN SUCCEEDED - Redirected to: ' + currentUrl);

    // Continue to offers page
    await page.goto('http://localhost:3000/offers');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-screenshots/debug-04-offers.png', fullPage: true });
    console.log(`Offers page URL: ${page.url()}`);

    // Check offers content
    const tableCount = await page.locator('table').count();
    console.log(`Tables found: ${tableCount}`);

    // Dashboard
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-screenshots/debug-05-dashboard.png', fullPage: true });
    console.log(`Dashboard URL: ${page.url()}`);

    // Get dashboard content
    const bodyText = await page.locator('body').textContent() || '';
    console.log(`Has Risk content: ${/risk|风险/i.test(bodyText)}`);
    console.log(`Has Optimization content: ${/optim|优化/i.test(bodyText)}`);
  }

  console.log('='.repeat(60));
});
