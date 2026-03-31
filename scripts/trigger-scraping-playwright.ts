#!/usr/bin/env ts-node
/**
 * Automated scraping trigger using Playwright
 * Logs in and triggers scraping for test offers
 */

import { chromium, Browser, Page } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'autoads'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

if (!ADMIN_PASSWORD) {
  console.error('❌ Error: ADMIN_PASSWORD environment variable is required')
  console.log('Usage: ADMIN_PASSWORD=your_password tsx scripts/trigger-scraping-playwright.ts')
  process.exit(1)
}

// Offers to trigger scraping
const OFFER_IDS = [24, 25]

async function loginAndTriggerScraping() {
  console.log('🚀 Starting automated scraping trigger...\n')

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    })
    const page = await context.newPage()

    // Step 1: Login
    console.log('📝 Step 1: Logging in...')
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')

    await page.fill('input[name="username"], input[type="text"]', ADMIN_USERNAME)
    await page.fill('input[name="password"], input[type="password"]', ADMIN_PASSWORD)

    console.log('   Username:', ADMIN_USERNAME)
    console.log('   Clicking login button...')

    await page.click('button[type="submit"]')
    await page.waitForLoadState('networkidle')

    // Wait for navigation after login
    await page.waitForTimeout(2000)

    const currentUrl = page.url()
    console.log('   Current URL after login:', currentUrl)

    if (currentUrl.includes('/login')) {
      console.error('❌ Login failed - still on login page')
      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/login-failed.png' })
      console.log('   Screenshot saved to /tmp/login-failed.png')
      throw new Error('Login failed')
    }

    console.log('✅ Login successful\n')

    // Step 2: Navigate to Offers page
    console.log('📋 Step 2: Navigating to Offers page...')
    await page.goto(`${BASE_URL}/offers`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    console.log('✅ On Offers page\n')

    // Step 3: Trigger scraping for each offer
    for (const offerId of OFFER_IDS) {
      console.log(`🔄 Step 3.${OFFER_IDS.indexOf(offerId) + 1}: Triggering scraping for Offer #${offerId}...`)

      try {
        // Navigate to offer detail page
        await page.goto(`${BASE_URL}/offers/${offerId}`)
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1000)

        console.log(`   Navigated to Offer #${offerId} detail page`)

        // Look for scraping button - try multiple selectors
        const scrapingSelectors = [
          'button:has-text("数据抓取")',
          'button:has-text("抓取")',
          'button:has-text("Scrape")',
          '[data-action="scrape"]',
          'button[type="button"]:has-text("抓取")'
        ]

        let buttonClicked = false
        for (const selector of scrapingSelectors) {
          const button = await page.locator(selector).first()
          if (await button.isVisible().catch(() => false)) {
            console.log(`   Found scraping button: ${selector}`)
            await button.click()
            buttonClicked = true
            console.log(`   Clicked scraping button`)
            break
          }
        }

        if (!buttonClicked) {
          console.log(`   ⚠️  Could not find scraping button, trying API call...`)

          // Fallback: Try API call with authenticated session
          const response = await page.evaluate(async (offerId) => {
            try {
              const res = await fetch(`/api/offers/${offerId}/scrape`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              })
              return {
                status: res.status,
                statusText: res.statusText,
                body: await res.text()
              }
            } catch (error: any) {
              return {
                status: 0,
                statusText: 'Error',
                body: error.message
              }
            }
          }, offerId)

          console.log(`   API Response: ${response.status} ${response.statusText}`)

          if (response.status === 200 || response.status === 202) {
            console.log(`   ✅ Scraping triggered via API`)
          } else {
            console.log(`   Response body:`, response.body.substring(0, 200))
          }
        }

        // Wait for scraping to start
        await page.waitForTimeout(2000)

        // Check for success message or status update
        const successIndicators = [
          'text=抓取中',
          'text=抓取完成',
          'text=Scraping',
          'text=Success'
        ]

        let foundSuccess = false
        for (const indicator of successIndicators) {
          const element = await page.locator(indicator).first()
          if (await element.isVisible().catch(() => false)) {
            console.log(`   ✅ Status update found: ${indicator}`)
            foundSuccess = true
            break
          }
        }

        if (!foundSuccess) {
          console.log(`   ⚠️  No immediate success indicator found`)
        }

        // Wait longer for scraping to process
        console.log(`   Waiting 15 seconds for scraping to process...`)
        await page.waitForTimeout(15000)

        console.log(`✅ Scraping triggered for Offer #${offerId}\n`)

      } catch (error: any) {
        console.error(`   ❌ Error triggering scraping for Offer #${offerId}:`, error.message)
        // Take screenshot for debugging
        await page.screenshot({ path: `/tmp/offer-${offerId}-error.png` })
        console.log(`   Screenshot saved to /tmp/offer-${offerId}-error.png`)
      }
    }

    console.log('═'.repeat(80))
    console.log('✅ Automated scraping trigger completed!')
    console.log('═'.repeat(80))
    console.log('\n💡 Next steps:')
    console.log('   1. Wait 30-60 seconds for scraping to complete')
    console.log('   2. Run: npx tsx scripts/test-scraping-optimization.ts')
    console.log('   3. Check the test results for Phase 2 validation\n')

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message)
    throw error
  } finally {
    await browser.close()
  }
}

// Run the automation
loginAndTriggerScraping()
  .then(() => {
    console.log('✅ Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  })
