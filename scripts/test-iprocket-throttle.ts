/**
 * 测试 IPRocket API 频率限制功能
 *
 * 验证：
 * 1. 频率限制是否生效
 * 2. 调用间隔是否 >= 100ms
 * 3. 并发调用是否正确排队
 */

import { fetchProxyIp } from '../src/lib/proxy/fetch-proxy-ip'

// IPRocket API URL（从环境变量或配置读取）
const IPROCKET_API_URL = process.env.IPROCKET_API_URL || 'https://api.iprocket.io/api?username=test&password=test&cc=US&ips=1&proxyType=http&responseType=txt'

async function testIprocketThrottle() {
  console.log('='.repeat(80))
  console.log('测试 IPRocket API 频率限制功能')
  console.log('='.repeat(80))

  console.log('\n📋 测试配置:')
  console.log(`  - API URL: ${IPROCKET_API_URL.replace(/password=[^&]+/, 'password=***')}`)
  console.log(`  - 最小调用间隔: 100ms`)
  console.log(`  - 测试次数: 10 次并发调用`)

  console.log('\n🚀 开始测试...\n')

  const startTime = Date.now()
  const callTimes: number[] = []

  // 并发发起 10 次调用
  const promises = Array.from({ length: 10 }, async (_, i) => {
    const callStartTime = Date.now()
    console.log(`[${i + 1}] 发起调用...`)

    try {
      await fetchProxyIp(IPROCKET_API_URL, 1, true) // maxRetries=1, skipHealthCheck=true
      const callEndTime = Date.now()
      const elapsed = callEndTime - callStartTime
      callTimes.push(callEndTime)
      console.log(`[${i + 1}] ✅ 成功 (耗时: ${elapsed}ms)`)
    } catch (error: any) {
      const callEndTime = Date.now()
      const elapsed = callEndTime - callStartTime
      callTimes.push(callEndTime)
      console.log(`[${i + 1}] ❌ 失败: ${error.message} (耗时: ${elapsed}ms)`)
    }
  })

  await Promise.all(promises)

  const totalTime = Date.now() - startTime

  console.log('\n' + '='.repeat(80))
  console.log('📊 测试结果')
  console.log('='.repeat(80))

  console.log(`\n总耗时: ${totalTime}ms`)
  console.log(`平均每次调用: ${(totalTime / 10).toFixed(0)}ms`)

  // 计算调用间隔
  console.log('\n调用间隔分析:')
  const intervals: number[] = []
  for (let i = 1; i < callTimes.length; i++) {
    const interval = callTimes[i] - callTimes[i - 1]
    intervals.push(interval)
    console.log(`  [${i}→${i + 1}] ${interval}ms`)
  }

  const minInterval = Math.min(...intervals)
  const maxInterval = Math.max(...intervals)
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length

  console.log(`\n间隔统计:`)
  console.log(`  - 最小间隔: ${minInterval}ms`)
  console.log(`  - 最大间隔: ${maxInterval}ms`)
  console.log(`  - 平均间隔: ${avgInterval.toFixed(0)}ms`)

  // 验证结果
  console.log('\n' + '='.repeat(80))
  console.log('✅ 验证结果')
  console.log('='.repeat(80))

  if (minInterval >= 100) {
    console.log(`\n✅ 频率限制生效：最小间隔 ${minInterval}ms >= 100ms`)
  } else {
    console.log(`\n❌ 频率限制失效：最小间隔 ${minInterval}ms < 100ms`)
  }

  if (intervals.every(i => i >= 100)) {
    console.log(`✅ 所有调用间隔都 >= 100ms`)
  } else {
    const violationCount = intervals.filter(i => i < 100).length
    console.log(`⚠️ 有 ${violationCount} 次调用间隔 < 100ms`)
  }
}

// 运行测试
testIprocketThrottle().catch(console.error)
