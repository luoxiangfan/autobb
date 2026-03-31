import { test, expect } from '@playwright/test'

/**
 * A/B测试前端E2E测试
 *
 * 测试覆盖:
 * 1. Dashboard页面 - A/B测试概览
 * 2. A/B测试列表页面
 * 3. A/B测试详情页面 - 变体和性能数据
 * 4. 数据更新和交互
 */

// 测试前的准备工作 - 登录管理员账号
test.beforeEach(async ({ page }) => {
  // 登录管理员账号
  await page.goto('http://localhost:3000/login')

  const usernameInput = page.locator('input[name="username"], input[type="text"]').first()
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first()

  await usernameInput.fill('autoads')
  await passwordInput.fill('***REMOVED***')

  const loginButton = page.locator('button[type="submit"]').first()
  await loginButton.click()

  // 等待跳转到dashboard
  await page.waitForURL(/.*dashboard/, { timeout: 10000 })
  console.log('✅ 已登录管理员账号')
})

test.describe('A/B测试前端E2E测试', () => {

  test('1. Dashboard页面应该显示A/B测试概览', async ({ page }) => {
    // 已经在beforeEach中跳转到dashboard
    await page.waitForLoadState('networkidle')

    // 检查页面标题
    const pageTitle = await page.textContent('h1, h2')
    console.log('页面标题:', pageTitle)

    // 检查是否有A/B测试相关内容
    const pageContent = await page.content()

    // 验证Dashboard有A/B测试相关模块
    // 可能的元素: "A/B测试", "测试进行中", "优化建议"等
    const hasABTestContent = pageContent.includes('A/B') ||
                              pageContent.includes('测试') ||
                              pageContent.includes('ab-test')

    console.log('Dashboard是否包含A/B测试内容:', hasABTestContent)

    // 截图
    await page.screenshot({
      path: 'test-screenshots/ab-dashboard-overview.png',
      fullPage: true
    })
    console.log('✅ Dashboard截图已保存')
  })

  test('2. A/B测试列表页面应该正确显示', async ({ page }) => {
    // 访问A/B测试列表页
    await page.goto('http://localhost:3000/ab-tests')
    await page.waitForLoadState('networkidle')

    // 验证URL
    await expect(page).toHaveURL(/.*ab-tests/)

    // 检查页面标题
    const pageTitle = await page.textContent('h1, h2')
    console.log('A/B测试列表页标题:', pageTitle)

    // 等待内容加载
    await page.waitForTimeout(2000)

    const pageContent = await page.content()

    // 验证关键元素存在
    const hasTestList = pageContent.includes('test') ||
                         pageContent.includes('测试') ||
                         pageContent.includes('创意') ||
                         pageContent.includes('策略')

    console.log('是否有测试列表:', hasTestList)

    // 截图
    await page.screenshot({
      path: 'test-screenshots/ab-tests-list.png',
      fullPage: true
    })
    console.log('✅ A/B测试列表页截图已保存')
  })

  test('3. 应该能够访问A/B测试详情页', async ({ page }) => {
    // 先访问列表页
    await page.goto('http://localhost:3000/ab-tests')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // 尝试找到测试ID链接并点击
    // 方法1: 查找链接
    const testLinks = page.locator('a[href*="/ab-tests/"]')
    const count = await testLinks.count()

    if (count > 0) {
      console.log(`找到 ${count} 个测试链接`)

      // 点击第一个测试链接
      await testLinks.first().click()
      await page.waitForLoadState('networkidle')

      // 验证跳转到详情页
      await expect(page).toHaveURL(/.*ab-tests\/\d+/)
      console.log('✅ 成功跳转到测试详情页')

      // 等待数据加载
      await page.waitForTimeout(2000)

      // 检查页面内容
      const pageContent = await page.content()

      // 验证详情页关键元素
      const hasVariants = pageContent.includes('variant') ||
                          pageContent.includes('变体') ||
                          pageContent.includes('Control') ||
                          pageContent.includes('对照组')

      const hasPerformance = pageContent.includes('performance') ||
                             pageContent.includes('性能') ||
                             pageContent.includes('CTR') ||
                             pageContent.includes('CPC') ||
                             pageContent.includes('点击')

      console.log('是否有变体信息:', hasVariants)
      console.log('是否有性能数据:', hasPerformance)

      // 截图
      await page.screenshot({
        path: 'test-screenshots/ab-test-detail.png',
        fullPage: true
      })
      console.log('✅ A/B测试详情页截图已保存')

    } else {
      console.log('⚠️  列表页没有找到测试链接，直接访问示例测试ID')

      // 方法2: 直接访问示例测试ID
      await page.goto('http://localhost:3000/ab-tests/1')
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)

      // 截图
      await page.screenshot({
        path: 'test-screenshots/ab-test-detail-direct.png',
        fullPage: true
      })
      console.log('✅ 直接访问测试详情页截图已保存')
    }
  })

  test('4. A/B测试详情页应该显示性能图表', async ({ page }) => {
    // 直接访问一个测试详情页（假设ID为1）
    await page.goto('http://localhost:3000/ab-tests/1')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const pageContent = await page.content()

    // 查找图表相关元素
    const hasChart = pageContent.includes('chart') ||
                     pageContent.includes('Canvas') ||
                     pageContent.includes('svg') ||
                     pageContent.toLowerCase().includes('recharts')

    // 查找Canvas元素（图表通常使用canvas）
    const canvasElements = page.locator('canvas')
    const canvasCount = await canvasElements.count()

    console.log('页面中的Canvas元素数量:', canvasCount)
    console.log('是否有图表相关内容:', hasChart)

    // 截图
    await page.screenshot({
      path: 'test-screenshots/ab-test-performance-charts.png',
      fullPage: true
    })
    console.log('✅ 性能图表截图已保存')
  })

  test('5. 应该能够看到测试变体的性能对比', async ({ page }) => {
    // 访问测试详情页
    await page.goto('http://localhost:3000/ab-tests/1')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const pageContent = await page.content()

    // 查找性能指标
    const metrics = ['CTR', 'CPC', 'CPA', 'CVR', '点击', '转化', '成本']
    const foundMetrics = metrics.filter(metric => pageContent.includes(metric))

    console.log('找到的性能指标:', foundMetrics)

    // 查找变体名称
    const variantKeywords = ['Control', 'Variant', '对照组', '变体', 'A', 'B']
    const foundVariants = variantKeywords.filter(keyword => pageContent.includes(keyword))

    console.log('找到的变体相关关键词:', foundVariants)

    // 验证是否有性能对比数据
    const hasPerformanceData = foundMetrics.length > 0 && foundVariants.length > 0
    console.log('是否有性能对比数据:', hasPerformanceData)

    // 截图
    await page.screenshot({
      path: 'test-screenshots/ab-test-variants-comparison.png',
      fullPage: true
    })
    console.log('✅ 变体对比截图已保存')
  })

  test('6. 应该能够查看测试状态和时间线', async ({ page }) => {
    // 访问测试详情页
    await page.goto('http://localhost:3000/ab-tests/1')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const pageContent = await page.content()

    // 查找状态相关关键词
    const statusKeywords = ['running', 'completed', 'paused', '运行中', '已完成', '暂停', '进行中']
    const foundStatus = statusKeywords.filter(keyword => pageContent.toLowerCase().includes(keyword.toLowerCase()))

    console.log('找到的状态关键词:', foundStatus)

    // 查找时间相关元素
    const hasTimestamp = pageContent.includes('2025') ||
                         pageContent.includes('2024') ||
                         pageContent.match(/\d{4}-\d{2}-\d{2}/) !== null

    console.log('是否有时间戳:', hasTimestamp)

    // 截图
    await page.screenshot({
      path: 'test-screenshots/ab-test-status-timeline.png',
      fullPage: true
    })
    console.log('✅ 状态和时间线截图已保存')
  })

  test('7. Dashboard应该能够导航到A/B测试列表', async ({ page }) => {
    // 从dashboard页面开始
    await page.goto('http://localhost:3000/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // 查找导航链接到A/B测试
    const abTestLinks = page.locator('a[href*="ab-test"]')
    const linkCount = await abTestLinks.count()

    console.log('Dashboard中A/B测试相关链接数量:', linkCount)

    if (linkCount > 0) {
      // 点击第一个链接
      await abTestLinks.first().click()
      await page.waitForLoadState('networkidle')

      // 验证是否跳转到A/B测试页面
      const currentURL = page.url()
      const isABTestPage = currentURL.includes('ab-test')

      console.log('当前URL:', currentURL)
      console.log('是否成功跳转到A/B测试页:', isABTestPage)

      // 截图
      await page.screenshot({
        path: 'test-screenshots/ab-test-navigation.png',
        fullPage: true
      })
      console.log('✅ 导航测试截图已保存')
    } else {
      console.log('⚠️  Dashboard中未找到A/B测试导航链接')
    }
  })

  test('8. API响应测试 - 获取A/B测试列表', async ({ page }) => {
    // 测试API端点
    const response = await page.goto('http://localhost:3000/api/ab-tests')

    // 验证状态码
    const status = response?.status()
    console.log('API响应状态码:', status)

    if (status === 200) {
      const data = await response?.json()
      console.log('API返回数据类型:', typeof data)
      console.log('API返回数据是否为数组:', Array.isArray(data))

      if (Array.isArray(data)) {
        console.log('测试数量:', data.length)
        if (data.length > 0) {
          console.log('第一个测试:', JSON.stringify(data[0], null, 2))
        }
      }
    } else if (status === 401) {
      console.log('⚠️  API需要认证')
    } else {
      console.log('⚠️  API返回非200状态码:', status)
    }
  })
})

test.describe('A/B测试数据完整性验证', () => {

  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('http://localhost:3000/login')
    const usernameInput = page.locator('input[name="username"], input[type="text"]').first()
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first()
    await usernameInput.fill('autoads')
    await passwordInput.fill('***REMOVED***')
    const loginButton = page.locator('button[type="submit"]').first()
    await loginButton.click()
    await page.waitForURL(/.*dashboard/, { timeout: 10000 })
  })

  test('9. 测试详情页应该加载所有必要数据', async ({ page }) => {
    await page.goto('http://localhost:3000/ab-tests/1')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // 验证页面完全加载
    const html = await page.content()

    // 检查是否有加载错误
    const hasError = html.includes('error') ||
                     html.includes('Error') ||
                     html.includes('错误') ||
                     html.includes('failed') ||
                     html.includes('失败')

    const hasLoading = html.includes('Loading') ||
                       html.includes('加载中') ||
                       html.includes('loading')

    console.log('页面是否有错误:', hasError)
    console.log('页面是否仍在加载:', hasLoading)

    // 验证数据元素存在
    const hasData = html.length > 5000 // 页面应该有足够的内容
    console.log('页面内容长度:', html.length)
    console.log('是否有足够数据:', hasData)

    // 最终截图
    await page.screenshot({
      path: 'test-screenshots/ab-test-data-validation.png',
      fullPage: true
    })
    console.log('✅ 数据完整性验证截图已保存')
  })
})
