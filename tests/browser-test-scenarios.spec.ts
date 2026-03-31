import { test, expect } from '@playwright/test';

test.describe('AutoAds Browser Testing', () => {

  test('1. Login Test', async ({ page }) => {
    console.log('=== LOGIN TEST ===');

    // Navigate to login page
    await page.goto('http://localhost:3000/login');
    console.log('Navigated to login page');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Take screenshot of login page
    await page.screenshot({ path: 'test-screenshots/01-login-page.png', fullPage: true });
    console.log('Screenshot: login page');

    // Fill in credentials
    const usernameField = page.locator('input[name="username"], input[type="text"]').first();
    const passwordField = page.locator('input[name="password"], input[type="password"]');

    await usernameField.fill('autoads');
    await passwordField.fill('***REMOVED***');
    console.log('Filled in credentials');

    // Take screenshot before submitting
    await page.screenshot({ path: 'test-screenshots/02-login-filled.png', fullPage: true });

    // Click login button
    const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await loginButton.click();
    console.log('Clicked login button');

    // Wait for navigation
    await page.waitForURL(/\/(dashboard|offers|home)/, { timeout: 10000 }).catch(() => {
      console.log('Note: URL did not change to expected pattern');
    });

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Take screenshot after login
    await page.screenshot({ path: 'test-screenshots/03-after-login.png', fullPage: true });
    console.log('Screenshot: after login');

    // Verify we're logged in by checking URL or content
    const currentUrl = page.url();
    console.log(`Current URL after login: ${currentUrl}`);

    // Check if we're on dashboard, offers, or if there's an error
    const pageContent = await page.content();
    if (pageContent.includes('error') || pageContent.includes('Invalid')) {
      console.log('WARNING: Login may have failed - error message detected');
    } else {
      console.log('SUCCESS: Login appears successful');
    }

    // Verify login was successful
    expect(currentUrl).not.toContain('/login');
  });

  test('2. Offers Page Test', async ({ page }) => {
    console.log('\n=== OFFERS PAGE TEST ===');

    // First login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');

    const usernameField = page.locator('input[name="username"], input[type="text"]').first();
    const passwordField = page.locator('input[name="password"], input[type="password"]');

    await usernameField.fill('autoads');
    await passwordField.fill('***REMOVED***');

    const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await loginButton.click();

    await page.waitForLoadState('networkidle');
    console.log('Logged in');

    // Navigate to offers page
    await page.goto('http://localhost:3000/offers');
    await page.waitForLoadState('networkidle');
    console.log('Navigated to offers page');

    // Take screenshot
    await page.screenshot({ path: 'test-screenshots/04-offers-page.png', fullPage: true });
    console.log('Screenshot: offers page');

    // Check for offers list
    const offersList = page.locator('table, [class*="offer"], [class*="list"]');
    const offersCount = await offersList.count();
    console.log(`Found ${offersCount} potential offer list elements`);

    // Look for batch import / CSV upload functionality
    const importButton = page.locator('button:has-text("Import"), button:has-text("Upload"), button:has-text("CSV"), button:has-text("Batch")');
    const importButtonCount = await importButton.count();

    if (importButtonCount > 0) {
      console.log(`Found ${importButtonCount} import/upload button(s)`);
      await page.screenshot({ path: 'test-screenshots/05-offers-import-button.png', fullPage: true });
    } else {
      console.log('No batch import/CSV upload button found on offers page');
    }

    // Check for file input
    const fileInput = page.locator('input[type="file"]');
    const fileInputCount = await fileInput.count();
    if (fileInputCount > 0) {
      console.log(`Found ${fileInputCount} file input(s) for upload`);
    }

    // Look for any existing offers
    const tableRows = page.locator('table tbody tr');
    const rowCount = await tableRows.count();
    console.log(`Found ${rowCount} table rows (potential offers)`);

    // Get page content to analyze
    const headings = await page.locator('h1, h2, h3').allTextContents();
    console.log('Page headings:', headings.slice(0, 5));
  });

  test('3. Dashboard Test', async ({ page }) => {
    console.log('\n=== DASHBOARD TEST ===');

    // First login
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');

    const usernameField = page.locator('input[name="username"], input[type="text"]').first();
    const passwordField = page.locator('input[name="password"], input[type="password"]');

    await usernameField.fill('autoads');
    await passwordField.fill('***REMOVED***');

    const loginButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await loginButton.click();

    await page.waitForLoadState('networkidle');
    console.log('Logged in');

    // Navigate to dashboard
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForLoadState('networkidle');
    console.log('Navigated to dashboard');

    // Take screenshot
    await page.screenshot({ path: 'test-screenshots/06-dashboard.png', fullPage: true });
    console.log('Screenshot: dashboard');

    // Look for risk alerts section
    const riskAlerts = page.locator('[class*="risk"], [class*="alert"], :has-text("Risk"), :has-text("Alert")');
    const riskCount = await riskAlerts.count();
    console.log(`Found ${riskCount} potential risk/alert elements`);

    // Look for specific risk alerts section
    const riskSection = page.locator('section:has-text("Risk"), div:has-text("Risk Alert")').first();
    if (await riskSection.isVisible().catch(() => false)) {
      console.log('Risk alerts section is visible');
      // Highlight and screenshot
      await riskSection.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-screenshots/07-risk-alerts-section.png', fullPage: true });
    } else {
      console.log('Risk alerts section not found or not visible');
    }

    // Look for optimization tasks section
    const optimizationTasks = page.locator('[class*="optim"], [class*="task"], :has-text("Optimization"), :has-text("Task")');
    const optimCount = await optimizationTasks.count();
    console.log(`Found ${optimCount} potential optimization task elements`);

    // Look for specific optimization section
    const optimSection = page.locator('section:has-text("Optimization"), div:has-text("Optimization Task")').first();
    if (await optimSection.isVisible().catch(() => false)) {
      console.log('Optimization tasks section is visible');
      await optimSection.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-screenshots/08-optimization-section.png', fullPage: true });
    } else {
      console.log('Optimization tasks section not found or not visible');
    }

    // Get all section headings
    const sectionHeadings = await page.locator('h1, h2, h3, h4').allTextContents();
    console.log('Dashboard sections:', sectionHeadings.filter(h => h.trim()).slice(0, 10));

    // Check for any cards or widgets
    const cards = page.locator('[class*="card"], [class*="widget"], [class*="panel"]');
    const cardCount = await cards.count();
    console.log(`Found ${cardCount} card/widget/panel elements`);
  });

});
