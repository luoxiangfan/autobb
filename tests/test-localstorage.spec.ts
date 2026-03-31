import { test, expect } from '@playwright/test'

test.describe('LocalStorage Persistence', () => {
  test('Check if auth_token persists across navigation', async ({ page }) => {
    console.log('\n========== Step 1: Login ==========')
    await page.goto('http://localhost:3000/login')

    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')

    await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 })
    console.log('✅ Login successful')

    // Check token immediately after login
    const token1 = await page.evaluate(() => localStorage.getItem('auth_token'))
    console.log('Token after login exists:', token1 ? 'YES' : 'NO')
    console.log('Token value:', token1 ? token1.substring(0, 50) + '...' : 'NULL')

    console.log('\n========== Step 2: Navigate to Offers ==========')
    // Navigate using page.goto
    await page.goto('http://localhost:3000/offers')
    await page.waitForTimeout(1000)

    // Check token after navigation
    const token2 = await page.evaluate(() => localStorage.getItem('auth_token'))
    console.log('Token after navigation exists:', token2 ? 'YES' : 'NO')
    console.log('Token value:', token2 ? token2.substring(0, 50) + '...' : 'NULL')

    // Check current URL
    const currentUrl = page.url()
    console.log('Current URL:', currentUrl)

    console.log('\n========== Step 3: Try API call from browser ==========')
    const apiResult = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        return { error: 'No token in localStorage' }
      }

      try {
        const response = await fetch('/api/offers', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        return {
          status: response.status,
          ok: response.ok,
          hasToken: true
        }
      } catch (error) {
        return { error: error.message, hasToken: true }
      }
    })

    console.log('API call result:', JSON.stringify(apiResult, null, 2))
  })
})
