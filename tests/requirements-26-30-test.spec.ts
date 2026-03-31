import { test, expect } from '@playwright/test'

test.describe('Requirements 26-30 Verification', () => {
  test('Requirement 26: Marketing homepage displays correctly', async ({ page }) => {
    await page.goto('http://localhost:3000/')

    // Check hero section
    await expect(page.locator('h1')).toContainText('AutoAds')
    await expect(page.locator('text=Google Ads 快速测试和一键优化营销平台')).toBeVisible()

    // Check CTA button
    const ctaButton = page.locator('a[href="/login"]').first()
    await expect(ctaButton).toContainText('立即开始')

    // Check core features section (4 cards)
    await expect(page.locator('text=核心功能')).toBeVisible()
    await expect(page.locator('text=Offer集中管理')).toBeVisible()
    await expect(page.locator('text=广告快速上线')).toBeVisible()
    await expect(page.locator('text=数据汇总展现')).toBeVisible()
    await expect(page.locator('text=ROI持续优化')).toBeVisible()

    // Check product features section (4 numbered items)
    await expect(page.locator('text=产品特点')).toBeVisible()
    await expect(page.locator('h3:has-text("自动化全链路")')).toBeVisible()
    await expect(page.locator('h3:has-text("AI广告文案生成")')).toBeVisible()
    await expect(page.locator('h3:has-text("真实关键词数据")')).toBeVisible()
    await expect(page.locator('h3:has-text("增长飞轮")')).toBeVisible()

    // Check pricing section (3 tiers)
    await expect(page.locator('text=套餐定价')).toBeVisible()
    await expect(page.locator('text=年卡')).toBeVisible()
    await expect(page.locator('text=¥5,999')).toBeVisible()
    await expect(page.locator('text=终身买断')).toBeVisible()
    await expect(page.locator('text=¥10,999')).toBeVisible()
    await expect(page.locator('text=私有化部署')).toBeVisible()
    await expect(page.locator('text=¥29,999')).toBeVisible()

    // Verify NO registration button (Requirement 20)
    await expect(page.locator('a[href="/register"]')).toHaveCount(0)

    // Check footer
    await expect(page.locator('text=© 2025 AutoAds. All rights reserved.')).toBeVisible()

    console.log('✅ Requirement 26: Marketing homepage - PASSED')
  })

  test('Requirement 27: Login redirect logic works', async ({ page }) => {
    // Test 1: Homepage is publicly accessible (no redirect)
    await page.goto('http://localhost:3000/')
    await expect(page).toHaveURL('http://localhost:3000/')
    console.log('✅ Homepage is public - PASSED')

    // Test 2: Login page is publicly accessible
    await page.goto('http://localhost:3000/login')
    await expect(page).toHaveURL('http://localhost:3000/login')
    await expect(page.locator('h2')).toContainText('登录 AutoAds')
    console.log('✅ Login page is public - PASSED')

    // Test 3: Protected pages redirect to login
    const protectedPages = [
      '/dashboard',
      '/offers',
      '/campaigns',
      '/settings',
      '/admin/users',
    ]

    for (const pagePath of protectedPages) {
      await page.goto(`http://localhost:3000${pagePath}`)

      // Should redirect to login with redirect parameter
      await expect(page).toHaveURL(new RegExp('/login\\?redirect='))
      console.log(`✅ Protected page ${pagePath} redirects to login - PASSED`)
    }

    console.log('✅ Requirement 27: Login redirect logic - PASSED')
  })

  test('Requirement 29: SEO optimization is present', async ({ page }) => {
    await page.goto('http://localhost:3000/')

    // Check title
    await expect(page).toHaveTitle(/AutoAds.*Google Ads.*AI.*自动化投放系统.*ROI/)

    // Check meta description
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content')
    expect(metaDescription).toContain('自动化Offer管理')
    expect(metaDescription).toContain('广告投放')
    expect(metaDescription).toContain('AI')

    // Check Open Graph tags
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(ogTitle).toContain('AutoAds')

    const ogDescription = await page.locator('meta[property="og:description"]').getAttribute('content')
    expect(ogDescription).toContain('自动化Offer管理')

    // Check robots.txt exists
    const robotsResponse = await page.goto('http://localhost:3000/robots.txt')
    expect(robotsResponse?.status()).toBe(200)
    const robotsText = await robotsResponse?.text()
    expect(robotsText).toContain('User-agent: *')
    expect(robotsText).toContain('Sitemap:')

    // Check sitemap.xml exists
    const sitemapResponse = await page.goto('http://localhost:3000/sitemap.xml')
    expect(sitemapResponse?.status()).toBe(200)
    const sitemapText = await sitemapResponse?.text()
    expect(sitemapText).toContain('<urlset')
    expect(sitemapText).toContain('http://localhost:3000/')
    expect(sitemapText).toContain('http://localhost:3000/login')

    console.log('✅ Requirement 29: SEO optimization - PASSED')
  })

  test('Requirement 30: UI components are accessible', async ({ page }) => {
    await page.goto('http://localhost:3000/login')

    // Check form elements are accessible
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

    // Check button has proper styling
    const loginButton = page.locator('button[type="submit"]')
    await expect(loginButton).toHaveClass(/bg-indigo-600/)
    await expect(loginButton).toHaveClass(/hover:bg-indigo-700/)

    // Check responsive design
    await page.setViewportSize({ width: 375, height: 667 }) // Mobile
    await expect(loginButton).toBeVisible()

    await page.setViewportSize({ width: 1920, height: 1080 }) // Desktop
    await expect(loginButton).toBeVisible()

    console.log('✅ Requirement 30: UI/UX components - PASSED')
  })

  test('Full integration: Homepage to Login flow', async ({ page }) => {
    // Start at homepage
    await page.goto('http://localhost:3000/')

    // Click "立即开始" button
    await page.click('text=立即开始')

    // Should navigate to login page
    await expect(page).toHaveURL('http://localhost:3000/login')
    await expect(page.locator('h2')).toContainText('登录 AutoAds')

    console.log('✅ Full integration: Homepage → Login - PASSED')
  })
})
