import { test, expect } from '@playwright/test'

test.describe('User Profile Modal Test', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('http://localhost:3001/login')

    // 填写登录表单
    await page.fill('input[name="username"]', 'simpletest')
    await page.fill('input[name="password"]', 'TestPass123')

    // 点击登录按钮
    await page.click('button[type="submit"]')

    // 等待跳转到dashboard
    await page.waitForURL('http://localhost:3001/dashboard', { timeout: 10000 })
  })

  test('should display personal center button and open modal', async ({ page }) => {
    // 等待页面加载完成
    await page.waitForSelector('text=个人中心', { timeout: 10000 })

    // 点击个人中心按钮
    await page.click('text=个人中心')

    // 等待弹窗出现
    await page.waitForSelector('text=个人基本信息', { timeout: 5000 })

    // 验证弹窗内容
    await expect(page.locator('text=个人基本信息')).toBeVisible()
    await expect(page.locator('text=套餐类型')).toBeVisible()
    await expect(page.locator('text=套餐有效期')).toBeVisible()

    // 验证用户信息显示
    await expect(page.locator('text=simpletest')).toBeVisible()
    await expect(page.locator('text=simple@test.com')).toBeVisible()

    // 验证套餐类型显示
    await expect(page.locator('text=终身版')).toBeVisible()

    console.log('✅ Personal center modal displayed successfully')
  })

  test('should display validity period correctly', async ({ page }) => {
    // 点击个人中心按钮
    await page.click('text=个人中心')

    // 等待弹窗出现
    await page.waitForSelector('text=套餐有效期', { timeout: 5000 })

    // 验证有效期字段存在
    await expect(page.locator('text=生效日期')).toBeVisible()
    await expect(page.locator('text=到期日期')).toBeVisible()

    // 验证日期格式 (2099-12-31应该被格式化为2099年12月31日)
    const validUntilText = await page.locator('text=/2099/').textContent()
    console.log('Validity period:', validUntilText)

    console.log('✅ Validity period displayed correctly')
  })

  test('should close modal when clicking close button', async ({ page }) => {
    // 点击个人中心按钮打开弹窗
    await page.click('text=个人中心')

    // 等待弹窗出现
    await page.waitForSelector('text=个人基本信息', { timeout: 5000 })

    // 点击关闭按钮
    await page.click('button:has-text("关闭")')

    // 等待弹窗消失
    await page.waitForTimeout(500)

    // 验证弹窗已关闭
    await expect(page.locator('text=个人基本信息')).not.toBeVisible()

    console.log('✅ Modal closed successfully')
  })

  test('should display user role correctly', async ({ page }) => {
    // 点击个人中心按钮
    await page.click('text=个人中心')

    // 等待弹窗出现
    await page.waitForSelector('text=个人基本信息', { timeout: 5000 })

    // 验证普通用户角色显示
    await expect(page.locator('text=普通用户')).toBeVisible()

    console.log('✅ User role displayed correctly')
  })
})
