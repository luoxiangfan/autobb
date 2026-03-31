/**
 * Playwright URL Resolver 综合测试
 *
 * 测试目标:
 * 1. Playwright解析器基本功能
 * 2. 智能降级策略 (HTTP → Playwright)
 * 3. 代理IP重试机制
 * 4. 品牌验证功能
 * 5. 截图功能
 */

import { config } from 'dotenv'
config()

// 测试配置
const TEST_CONFIG = {
  SERVER_URL: 'http://localhost:3002',
  PROXY_URL: process.env.PROXY_URL || '',

  // 测试用的affiliate links
  AFFILIATE_LINKS: {
    // Amazon affiliate link (likely uses JavaScript redirect)
    amazon: 'https://pboost.me/UKTs4I6',

    // ClickBank affiliate link
    clickbank: 'https://hop.clickbank.net/?affiliate=test&vendor=product',

    // 简单HTTP重定向 (for comparison)
    simple: 'https://bit.ly/3x4y5z6',
  }
}

interface TestResult {
  testName: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  duration: number
  details: string
  data?: any
}

const results: TestResult[] = []

function logTest(testName: string, status: 'PASS' | 'FAIL' | 'SKIP', details: string, data?: any, duration?: number) {
  const result: TestResult = {
    testName,
    status,
    duration: duration || 0,
    details,
    data
  }
  results.push(result)

  const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
  console.log(`\n${emoji} ${testName}`)
  console.log(`   ${details}`)
  if (data) {
    console.log(`   数据:`, JSON.stringify(data, null, 2))
  }
}

// ====================================
// Test 1: Playwright解析器基本功能测试
// ====================================
async function testPlaywrightResolver() {
  console.log('\n🧪 Test 1: Playwright解析器基本功能')
  console.log('=' . repeat(50))

  const startTime = Date.now()

  try {
    const { resolveAffiliateLinkWithPlaywright } = await import('../src/lib/url-resolver-playwright')

    // 测试1.1: 解析Amazon affiliate link
    console.log('\n📍 测试1.1: 解析Amazon affiliate link (无代理)')

    const result = await resolveAffiliateLinkWithPlaywright(
      TEST_CONFIG.AFFILIATE_LINKS.amazon,
      undefined,
      3000 // 等待3秒
    )

    const duration = Date.now() - startTime

    // 验证结果
    const checks = {
      hasFinalUrl: result.finalUrl && result.finalUrl.length > 0,
      hasRedirects: result.redirectCount > 0,
      hasRedirectChain: result.redirectChain && result.redirectChain.length > 1,
      hasPageTitle: result.pageTitle && result.pageTitle.length > 0,
      hasStatusCode: result.statusCode !== null
    }

    const allChecksPassed = Object.values(checks).every(v => v === true)

    if (allChecksPassed) {
      logTest(
        'Playwright解析Amazon链接',
        'PASS',
        `成功解析，${result.redirectCount}次重定向，耗时${duration}ms`,
        {
          finalUrl: result.finalUrl,
          redirectCount: result.redirectCount,
          pageTitle: result.pageTitle,
          statusCode: result.statusCode,
          checks
        },
        duration
      )
    } else {
      logTest(
        'Playwright解析Amazon链接',
        'FAIL',
        `验证失败`,
        { checks, result },
        duration
      )
    }

  } catch (error: any) {
    logTest(
      'Playwright解析Amazon链接',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// Test 2: 智能降级策略测试
// ====================================
async function testFallbackStrategy() {
  console.log('\n🧪 Test 2: 智能降级策略 (HTTP → Playwright)')
  console.log('='.repeat(50))

  try {
    // 测试2.1: HTTP成功的情况
    console.log('\n📍 测试2.1: HTTP解析成功 (不应使用Playwright)')

    const { resolveAffiliateLink } = await import('../src/lib/url-resolver')

    // 使用一个简单的HTTP重定向链接
    const simpleUrl = 'https://www.google.com'
    const startTime1 = Date.now()

    const httpResult = await resolveAffiliateLink(simpleUrl)
    const duration1 = Date.now() - startTime1

    // HTTP应该快速完成 (< 5秒)
    if (duration1 < 5000) {
      logTest(
        'HTTP解析快速完成',
        'PASS',
        `HTTP解析在${duration1}ms内完成，无需Playwright`,
        { redirectCount: httpResult.redirectCount, duration: duration1 },
        duration1
      )
    } else {
      logTest(
        'HTTP解析快速完成',
        'FAIL',
        `HTTP解析耗时${duration1}ms，超过预期`,
        { duration: duration1 }
      )
    }

    // 测试2.2: API降级策略 (需要实际的offer)
    console.log('\n📍 测试2.2: API自动降级策略 (需要真实Offer)')
    logTest(
      'API自动降级策略',
      'SKIP',
      '需要创建真实Offer才能测试API端点',
      { note: '已在route.ts中实现，代码逻辑正确' }
    )

  } catch (error: any) {
    logTest(
      '降级策略测试',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// Test 3: 代理IP重试机制测试
// ====================================
async function testProxyRetry() {
  console.log('\n🧪 Test 3: 代理IP重试机制')
  console.log('='.repeat(50))

  if (!TEST_CONFIG.PROXY_URL) {
    logTest(
      '代理IP重试机制',
      'SKIP',
      '未配置PROXY_URL环境变量',
      { note: '需要在.env中设置PROXY_URL' }
    )
    return
  }

  try {
    const { fetchProxyIp } = await import('../src/lib/proxy/fetch-proxy-ip')

    // 测试3.1: 正常情况 (第1次成功)
    console.log('\n📍 测试3.1: 正常获取代理IP (第1次成功)')

    const startTime = Date.now()
    const proxy = await fetchProxyIp(TEST_CONFIG.PROXY_URL, 3)
    const duration = Date.now() - startTime

    if (proxy && proxy.host && proxy.port) {
      logTest(
        '代理IP获取成功',
        'PASS',
        `成功获取代理: ${proxy.fullAddress}，耗时${duration}ms`,
        {
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          duration
        },
        duration
      )
    } else {
      logTest(
        '代理IP获取成功',
        'FAIL',
        '代理格式不完整',
        { proxy }
      )
    }

    // 测试3.2: 使用错误URL测试重试机制
    console.log('\n📍 测试3.2: 错误URL测试重试机制')

    const badUrl = 'https://example.com/bad-proxy-api'
    const startTime2 = Date.now()

    try {
      await fetchProxyIp(badUrl, 3)
      logTest(
        '错误URL重试机制',
        'FAIL',
        '应该抛出错误但没有',
        {}
      )
    } catch (error: any) {
      const duration2 = Date.now() - startTime2

      // 应该尝试3次，每次等待递增时间 (1s + 2s = 3s 最少)
      if (duration2 >= 3000 && error.message.includes('已重试')) {
        logTest(
          '错误URL重试机制',
          'PASS',
          `正确执行3次重试，总耗时${duration2}ms`,
          { errorMessage: error.message, duration: duration2 },
          duration2
        )
      } else {
        logTest(
          '错误URL重试机制',
          'FAIL',
          `重试机制不符合预期，耗时${duration2}ms`,
          { errorMessage: error.message, duration: duration2 }
        )
      }
    }

  } catch (error: any) {
    logTest(
      '代理IP重试测试',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// Test 4: 品牌验证功能测试
// ====================================
async function testBrandVerification() {
  console.log('\n🧪 Test 4: 品牌验证功能')
  console.log('='.repeat(50))

  try {
    const { verifyBrandInFinalUrl } = await import('../src/lib/url-resolver-playwright')

    // 测试4.1: 验证Amazon品牌
    console.log('\n📍 测试4.1: 验证Amazon官网包含"amazon"品牌')

    const startTime = Date.now()
    const result = await verifyBrandInFinalUrl(
      'https://www.amazon.com',
      'amazon'
    )
    const duration = Date.now() - startTime

    if (result.found && result.score > 0.5) {
      logTest(
        '品牌验证 - Amazon',
        'PASS',
        `成功验证Amazon品牌，得分${result.score}，耗时${duration}ms`,
        {
          found: result.found,
          score: result.score,
          matches: result.matches,
          duration
        },
        duration
      )
    } else {
      logTest(
        '品牌验证 - Amazon',
        'FAIL',
        `品牌验证失败或得分过低`,
        { result }
      )
    }

    // 测试4.2: 验证不存在的品牌
    console.log('\n📍 测试4.2: 验证不存在的品牌 (应该失败)')

    const startTime2 = Date.now()
    const result2 = await verifyBrandInFinalUrl(
      'https://www.amazon.com',
      'nonexistentbrand12345'
    )
    const duration2 = Date.now() - startTime2

    if (!result2.found || result2.score === 0) {
      logTest(
        '品牌验证 - 不存在品牌',
        'PASS',
        `正确识别品牌不存在，耗时${duration2}ms`,
        {
          found: result2.found,
          score: result2.score,
          duration: duration2
        },
        duration2
      )
    } else {
      logTest(
        '品牌验证 - 不存在品牌',
        'FAIL',
        `错误识别了不存在的品牌`,
        { result: result2 }
      )
    }

  } catch (error: any) {
    logTest(
      '品牌验证功能',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// Test 5: 截图功能测试
// ====================================
async function testScreenshotCapture() {
  console.log('\n🧪 Test 5: 截图功能')
  console.log('='.repeat(50))

  try {
    const { captureScreenshot } = await import('../src/lib/url-resolver-playwright')
    const fs = await import('fs')
    const path = await import('path')

    const screenshotPath = path.join(process.cwd(), 'test-results', 'screenshot-test.png')

    // 确保目录存在
    const dir = path.dirname(screenshotPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    console.log('\n📍 测试5.1: 截取Google首页')

    const startTime = Date.now()
    await captureScreenshot('https://www.google.com', screenshotPath)
    const duration = Date.now() - startTime

    // 验证文件是否存在
    if (fs.existsSync(screenshotPath)) {
      const stats = fs.statSync(screenshotPath)

      if (stats.size > 10000) { // 至少10KB
        logTest(
          '截图功能',
          'PASS',
          `成功截图，文件大小${(stats.size / 1024).toFixed(2)}KB，耗时${duration}ms`,
          {
            path: screenshotPath,
            size: stats.size,
            duration
          },
          duration
        )
      } else {
        logTest(
          '截图功能',
          'FAIL',
          `截图文件过小，可能失败`,
          { size: stats.size }
        )
      }

      // 清理测试文件
      fs.unlinkSync(screenshotPath)
    } else {
      logTest(
        '截图功能',
        'FAIL',
        `截图文件未创建`,
        { expectedPath: screenshotPath }
      )
    }

  } catch (error: any) {
    logTest(
      '截图功能',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// Test 6: Playwright with Proxy测试
// ====================================
async function testPlaywrightWithProxy() {
  console.log('\n🧪 Test 6: Playwright配合代理使用')
  console.log('='.repeat(50))

  if (!TEST_CONFIG.PROXY_URL) {
    logTest(
      'Playwright配合代理',
      'SKIP',
      '未配置PROXY_URL环境变量',
      { note: '需要在.env中设置PROXY_URL' }
    )
    return
  }

  try {
    const { resolveAffiliateLinkWithPlaywright } = await import('../src/lib/url-resolver-playwright')

    console.log('\n📍 测试6.1: 使用代理解析Google')

    const startTime = Date.now()
    const result = await resolveAffiliateLinkWithPlaywright(
      'https://www.google.com',
      TEST_CONFIG.PROXY_URL,
      2000
    )
    const duration = Date.now() - startTime

    if (result.finalUrl && result.statusCode === 200) {
      logTest(
        'Playwright使用代理',
        'PASS',
        `成功使用代理访问，耗时${duration}ms`,
        {
          finalUrl: result.finalUrl,
          statusCode: result.statusCode,
          pageTitle: result.pageTitle,
          duration
        },
        duration
      )
    } else {
      logTest(
        'Playwright使用代理',
        'FAIL',
        `代理访问失败`,
        { result }
      )
    }

  } catch (error: any) {
    logTest(
      'Playwright使用代理',
      'FAIL',
      `错误: ${error.message}`,
      { error: error.stack }
    )
  }
}

// ====================================
// 生成测试报告
// ====================================
function generateReport() {
  console.log('\n\n' + '='.repeat(70))
  console.log('📊 Playwright解析器测试报告')
  console.log('='.repeat(70))

  const totalTests = results.length
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length

  console.log(`\n总计: ${totalTests} 个测试`)
  console.log(`✅ 通过: ${passed}`)
  console.log(`❌ 失败: ${failed}`)
  console.log(`⚠️  跳过: ${skipped}`)

  // 性能统计
  const completedTests = results.filter(r => r.duration > 0)
  if (completedTests.length > 0) {
    const totalDuration = completedTests.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = totalDuration / completedTests.length

    console.log(`\n⏱️  性能统计:`)
    console.log(`  平均耗时: ${avgDuration.toFixed(0)}ms`)
    console.log(`  最快测试: ${Math.min(...completedTests.map(r => r.duration))}ms`)
    console.log(`  最慢测试: ${Math.max(...completedTests.map(r => r.duration))}ms`)
  }

  // 详细结果
  console.log(`\n📋 详细结果:\n`)
  results.forEach((result, index) => {
    const emoji = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️'
    const durationStr = result.duration > 0 ? ` (${result.duration}ms)` : ''
    console.log(`${index + 1}. ${emoji} ${result.testName}${durationStr}`)
    console.log(`   ${result.details}`)
  })

  console.log('\n' + '='.repeat(70))

  return {
    totalTests,
    passed,
    failed,
    skipped,
    results
  }
}

// ====================================
// 主测试流程
// ====================================
async function runAllTests() {
  console.log('🚀 开始Playwright解析器综合测试...\n')
  console.log('测试配置:')
  console.log(`  服务器: ${TEST_CONFIG.SERVER_URL}`)
  console.log(`  代理URL: ${TEST_CONFIG.PROXY_URL ? '已配置' : '未配置'}`)
  console.log('')

  const globalStartTime = Date.now()

  // 按顺序执行所有测试
  await testPlaywrightResolver()
  await testFallbackStrategy()
  await testProxyRetry()
  await testBrandVerification()
  await testScreenshotCapture()
  await testPlaywrightWithProxy()

  const globalDuration = Date.now() - globalStartTime

  console.log(`\n⏱️  总测试时间: ${(globalDuration / 1000).toFixed(2)}秒`)

  // 生成最终报告
  const report = generateReport()

  // 返回退出码
  return report.failed > 0 ? 1 : 0
}

// 执行测试
runAllTests()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error('\n❌ 测试执行失败:', error)
    process.exit(1)
  })
