import { test, expect } from '@playwright/test'

test('Debug middleware redirect', async ({ page, context }) => {
  // Clear all cookies first
  await context.clearCookies()

  // Try to access dashboard
  console.log('Accessing /dashboard without auth...')
  const response = await page.goto('http://localhost:3000/dashboard')

  console.log('Response status:', response?.status())
  console.log('Final URL:', page.url())

  // Check cookies
  const cookies = await context.cookies()
  console.log('Cookies:', cookies)

  // Wait a bit
  await page.waitForTimeout(2000)
  console.log('URL after wait:', page.url())

  // Take screenshot
  await page.screenshot({ path: 'test-results/middleware-debug.png' })
})
