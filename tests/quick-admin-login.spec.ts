import { test, expect } from '@playwright/test'

test('管理员快速登录测试', async ({ page }) => {
  // 清除所有缓存和存储
  await page.context().clearCookies()

  // 访问登录页面
  console.log('1. 访问登录页面...')
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' })

  // 等待页面加载
  await page.waitForLoadState('domcontentloaded')

  // 填写凭证
  console.log('2. 填写管理员凭证...')
  await page.fill('input[type="text"]', 'autoads')
  await page.fill('input[type="password"]', '***REMOVED***')

  // 点击登录
  console.log('3. 点击登录按钮...')
  await page.click('button[type="submit"]')

  // 等待跳转
  console.log('4. 等待跳转到 dashboard...')
  await page.waitForURL('**/dashboard', { timeout: 15000 })

  // 验证登录成功
  const url = page.url()
  console.log('5. 当前 URL:', url)
  expect(url).toContain('/dashboard')

  // 验证页面内容
  const content = await page.textContent('body')
  expect(content).toContain('autoads')

  // 截图
  await page.screenshot({
    path: 'test-screenshots/admin-logged-in.png',
    fullPage: true
  })

  console.log('✅ 管理员登录成功！')
})
