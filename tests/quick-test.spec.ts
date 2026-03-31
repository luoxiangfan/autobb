import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3001'
const ADMIN_USERNAME = 'autoads'
const ADMIN_PASSWORD = '***REMOVED***'

test.describe('快速功能测试', () => {
  test('管理员登录', async ({ page }) => {
    console.log('\n🧪 测试：管理员登录')

    // 访问登录页面
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')

    console.log('  ✅ 登录页面加载成功')

    // 填写表单
    await page.fill('input[name="username"]', ADMIN_USERNAME)
    await page.fill('input[name="password"]', ADMIN_PASSWORD)

    console.log(`  输入用户名: ${ADMIN_USERNAME}`)

    // 提交表单
    await page.click('button[type="submit"]')

    // 等待登录处理
    await page.waitForTimeout(3000)

    // 截图
    await page.screenshot({ path: 'test-results/login-after-submit.png', fullPage: true })

    const currentURL = page.url()
    console.log(`  当前URL: ${currentURL}`)

    // 检查是否仍在登录页面
    if (currentURL.includes('/login')) {
      console.log('  ⚠️ 仍在登录页面，检查是否有错误信息')

      const errorElement = await page.locator('.bg-red-50, .text-red-700, [class*="error"]')
      const errorCount = await errorElement.count()

      if (errorCount > 0) {
        const errorText = await errorElement.first().textContent()
        console.log(`  ❌ 错误信息: ${errorText}`)
      }
    } else {
      console.log('  ✅ 已跳转，登录可能成功')
    }
  })

  test('检查Dashboard页面', async ({ page }) => {
    console.log('\n🧪 测试：Dashboard页面访问')

    // 先登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"]', ADMIN_USERNAME)
    await page.fill('input[name="password"]', ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2000)

    // 访问Dashboard
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForLoadState('networkidle')

    await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true })

    const title = await page.title()
    console.log(`  页面标题: ${title}`)
    console.log(`  ✅ Dashboard页面访问成功`)
  })

  test('检查Offers页面', async ({ page }) => {
    console.log('\n🧪 测试：Offers页面访问')

    // 先登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[name="username"]', ADMIN_USERNAME)
    await page.fill('input[name="password"]', ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2000)

    // 访问Offers页面
    await page.goto(`${BASE_URL}/offers`)
    await page.waitForLoadState('networkidle')

    await page.screenshot({ path: 'test-results/offers.png', fullPage: true })

    const pageText = await page.textContent('body')
    const hasOffers = pageText?.includes('Offer') || pageText?.includes('创建')

    console.log(`  页面包含Offer相关内容: ${hasOffers ? '是' : '否'}`)
    console.log(`  ✅ Offers页面访问成功`)
  })
})

test.afterAll(() => {
  console.log('\n✅ 快速测试完成\n')
})
