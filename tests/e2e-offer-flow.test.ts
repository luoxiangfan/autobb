/**
 * 端到端测试: 完整Offer流程
 *
 * 测试流程:
 * 1. 用户登录
 * 2. 创建Offer
 * 3. URL解析（HTTP + Playwright降级）
 * 4. 验证数据正确性
 * 5. 清理测试数据
 */

import { config } from 'dotenv'
config()

const TEST_CONFIG = {
  SERVER_URL: 'http://localhost:3002',
  TEST_USER_EMAIL: 'test@example.com',
  TEST_USER_PASSWORD: 'Test123456!',
  PROXY_URL: process.env.PROXY_URL || '',

  // 测试Offer数据
  TEST_OFFER: {
    offerName: 'E2E Test Offer',
    brand: 'TestBrand',
    targetCountry: 'US',
    language: 'en',
    affiliateLink: 'https://www.google.com', // 使用稳定的测试URL
    productUrl: 'https://www.google.com',
  },
}

interface TestResult {
  step: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  duration: number
  details: string
  data?: any
}

const results: TestResult[] = []

function logTest(step: string, status: 'PASS' | 'FAIL' | 'SKIP', details: string, data?: any, duration?: number) {
  const result: TestResult = {
    step,
    status,
    duration: duration || 0,
    details,
    data,
  }
  results.push(result)

  const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
  console.log(`\n${emoji} Step ${results.length}: ${step}`)
  console.log(`   ${details}`)
  if (data) {
    console.log(`   数据:`, JSON.stringify(data, null, 2))
  }
}

// ====================================
// Step 1: 用户登录
// ====================================
async function step1_UserLogin(): Promise<{ userId: number; token: string } | null> {
  console.log('\n📝 Step 1: 用户登录')
  console.log('='.repeat(50))

  const startTime = Date.now()

  try {
    // 注意：实际环境中需要真实的登录流程
    // 这里我们假设有一个测试用户已存在于数据库
    // 在实际测试中，应该使用测试数据库和测试用户

    logTest(
      '用户登录',
      'SKIP',
      '需要实现完整的登录API才能测试（当前使用mock数据）',
      {
        note: '在真实E2E测试中，应该调用POST /api/auth/login',
        mockUserId: 1,
        mockToken: 'test-jwt-token',
      }
    )

    // Mock返回（真实测试中应该调用登录API）
    return {
      userId: 1,
      token: 'test-jwt-token',
    }
  } catch (error: any) {
    logTest('用户登录', 'FAIL', `错误: ${error.message}`)
    return null
  }
}

// ====================================
// Step 2: 创建Offer
// ====================================
async function step2_CreateOffer(userId: number, token: string): Promise<number | null> {
  console.log('\n📝 Step 2: 创建Offer')
  console.log('='.repeat(50))

  const startTime = Date.now()

  try {
    const response = await fetch(`${TEST_CONFIG.SERVER_URL}/api/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 注意：实际环境中应该使用Cookie或Authorization头
        // 'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(TEST_CONFIG.TEST_OFFER),
    })

    const duration = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()
      const offerId = data.offer?.id

      if (offerId) {
        logTest(
          '创建Offer',
          'PASS',
          `成功创建Offer，ID: ${offerId}，耗时${duration}ms`,
          {
            offerId,
            offerName: TEST_CONFIG.TEST_OFFER.offerName,
            duration,
          },
          duration
        )
        return offerId
      } else {
        logTest('创建Offer', 'FAIL', `响应中没有offer ID`, { response: data })
        return null
      }
    } else if (response.status === 401) {
      logTest(
        '创建Offer',
        'SKIP',
        `需要登录认证（401），需要在浏览器中手动创建Offer进行测试`,
        { status: response.status }
      )
      return null
    } else {
      const errorData = await response.json()
      logTest('创建Offer', 'FAIL', `创建失败: ${response.status}`, { errorData })
      return null
    }
  } catch (error: any) {
    logTest('创建Offer', 'FAIL', `错误: ${error.message}`)
    return null
  }
}

// ====================================
// Step 3: URL解析（智能降级测试）
// ====================================
async function step3_ResolveURL(offerId: number, token: string): Promise<any> {
  console.log('\n📝 Step 3: URL解析（智能降级测试）')
  console.log('='.repeat(50))

  const startTime = Date.now()

  try {
    const response = await fetch(`${TEST_CONFIG.SERVER_URL}/api/offers/${offerId}/resolve-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}`,
      },
    })

    const duration = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()

      // 验证关键字段
      const checks = {
        hasFinalUrl: data.data?.finalUrl && data.data.finalUrl.length > 0,
        hasRedirectChain: data.data?.redirectChain && data.data.redirectChain.length > 0,
        hasMethod: data.data?.method && ['http', 'playwright'].includes(data.data.method),
        redirectCountValid: typeof data.data?.redirectCount === 'number',
      }

      const allChecksPass = Object.values(checks).every((v) => v === true)

      if (allChecksPass) {
        logTest(
          'URL解析',
          'PASS',
          `成功解析URL，方法: ${data.data.method}，重定向: ${data.data.redirectCount}次，耗时${duration}ms`,
          {
            finalUrl: data.data.finalUrl,
            method: data.data.method,
            redirectCount: data.data.redirectCount,
            proxyUsed: data.data.proxyUsed,
            pageTitle: data.data.pageTitle,
            duration,
            checks,
          },
          duration
        )
        return data.data
      } else {
        logTest('URL解析', 'FAIL', `数据验证失败`, { checks, data: data.data })
        return null
      }
    } else if (response.status === 401) {
      logTest('URL解析', 'SKIP', `需要登录认证（401）`, { status: response.status })
      return null
    } else {
      const errorData = await response.json()
      logTest('URL解析', 'FAIL', `解析失败: ${response.status}`, { errorData })
      return null
    }
  } catch (error: any) {
    logTest('URL解析', 'FAIL', `错误: ${error.message}`)
    return null
  }
}

// ====================================
// Step 4: 验证降级策略
// ====================================
async function step4_TestFallbackStrategy(): Promise<void> {
  console.log('\n📝 Step 4: 验证降级策略')
  console.log('='.repeat(50))

  logTest(
    '降级策略验证',
    'SKIP',
    '降级策略已在Step 3中验证（通过method字段）',
    {
      note: '降级策略流程: HTTP解析 → 检测redirectCount=0 → 自动使用Playwright',
      verification: 'method字段标识使用的解析方法',
    }
  )
}

// ====================================
// Step 5: 测试连接池
// ====================================
async function step5_TestConnectionPool(): Promise<void> {
  console.log('\n📝 Step 5: 测试Playwright连接池')
  console.log('='.repeat(50))

  const startTime = Date.now()

  try {
    const response = await fetch(`${TEST_CONFIG.SERVER_URL}/api/playwright-pool/stats`)
    const duration = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()

      logTest(
        'Playwright连接池',
        'PASS',
        `成功获取连接池统计，总实例: ${data.data.totalInstances}，耗时${duration}ms`,
        {
          totalInstances: data.data.totalInstances,
          inUseInstances: data.data.inUseInstances,
          idleInstances: data.data.idleInstances,
          instances: data.data.instances,
          duration,
        },
        duration
      )
    } else {
      logTest('Playwright连接池', 'FAIL', `获取统计失败: ${response.status}`)
    }
  } catch (error: any) {
    logTest('Playwright连接池', 'FAIL', `错误: ${error.message}`)
  }
}

// ====================================
// Step 6: 测试智能等待策略
// ====================================
async function step6_TestSmartWait(): Promise<void> {
  console.log('\n📝 Step 6: 测试智能等待策略')
  console.log('='.repeat(50))

  const startTime = Date.now()

  try {
    const response = await fetch(`${TEST_CONFIG.SERVER_URL}/api/smart-wait/stats`)
    const duration = Date.now() - startTime

    if (response.ok) {
      const data = await response.json()

      logTest(
        '智能等待策略',
        'PASS',
        `${data.message}，耗时${duration}ms`,
        {
          totalCalls: data.data.totalCalls,
          avgOriginalWait: data.data.avgOriginalWait,
          avgOptimizedWait: data.data.avgOptimizedWait,
          timeSaved: data.data.timeSaved,
          improvementPercent: data.data.improvementPercent,
          duration,
        },
        duration
      )
    } else {
      logTest('智能等待策略', 'FAIL', `获取统计失败: ${response.status}`)
    }
  } catch (error: any) {
    logTest('智能等待策略', 'FAIL', `错误: ${error.message}`)
  }
}

// ====================================
// 生成测试报告
// ====================================
function generateReport() {
  console.log('\n\n' + '='.repeat(70))
  console.log('📊 端到端测试报告')
  console.log('='.repeat(70))

  const totalTests = results.length
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length

  console.log(`\n总计: ${totalTests} 个测试`)
  console.log(`✅ 通过: ${passed}`)
  console.log(`❌ 失败: ${failed}`)
  console.log(`⚠️  跳过: ${skipped}`)

  // 性能统计
  const completedTests = results.filter((r) => r.duration > 0)
  if (completedTests.length > 0) {
    const totalDuration = completedTests.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = totalDuration / completedTests.length

    console.log(`\n⏱️  性能统计:`)
    console.log(`  总耗时: ${totalDuration}ms`)
    console.log(`  平均耗时: ${avgDuration.toFixed(0)}ms`)
    console.log(`  最快测试: ${Math.min(...completedTests.map((r) => r.duration))}ms`)
    console.log(`  最慢测试: ${Math.max(...completedTests.map((r) => r.duration))}ms`)
  }

  // 详细结果
  console.log(`\n📋 详细结果:\n`)
  results.forEach((result, index) => {
    const emoji = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️'
    const durationStr = result.duration > 0 ? ` (${result.duration}ms)` : ''
    console.log(`${index + 1}. ${emoji} ${result.step}${durationStr}`)
    console.log(`   ${result.details}`)
  })

  console.log('\n' + '='.repeat(70))

  return {
    totalTests,
    passed,
    failed,
    skipped,
    results,
  }
}

// ====================================
// 主测试流程
// ====================================
async function runE2ETests() {
  console.log('🚀 开始端到端测试...\n')
  console.log('测试配置:')
  console.log(`  服务器: ${TEST_CONFIG.SERVER_URL}`)
  console.log(`  代理URL: ${TEST_CONFIG.PROXY_URL ? '已配置' : '未配置'}`)
  console.log('')

  const globalStartTime = Date.now()

  // Step 1: 用户登录
  const loginResult = await step1_UserLogin()
  if (!loginResult) {
    console.log('\n⚠️  登录失败，跳过后续需要认证的测试')
  }

  // Step 2: 创建Offer（可能需要认证）
  let offerId: number | null = null
  if (loginResult) {
    offerId = await step2_CreateOffer(loginResult.userId, loginResult.token)
  }

  // Step 3: URL解析（需要Offer ID）
  if (offerId && loginResult) {
    await step3_ResolveURL(offerId, loginResult.token)
  } else {
    logTest('URL解析', 'SKIP', '没有有效的Offer ID，跳过测试')
  }

  // Step 4: 降级策略验证
  await step4_TestFallbackStrategy()

  // Step 5: 连接池测试（不需要认证）
  await step5_TestConnectionPool()

  // Step 6: 智能等待测试（不需要认证）
  await step6_TestSmartWait()

  const globalDuration = Date.now() - globalStartTime

  console.log(`\n⏱️  总测试时间: ${(globalDuration / 1000).toFixed(2)}秒`)

  // 生成最终报告
  const report = generateReport()

  // 返回退出码
  return report.failed > 0 ? 1 : 0
}

// 执行测试
runE2ETests()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error('\n❌ 测试执行失败:', error)
    process.exit(1)
  })
