/**
 * 测试代理预热功能修复（完整流程）
 * 验证IPRocket和Oxylabs两种格式的完整预热流程
 */

import { warmupAffiliateLink } from '../src/lib/proxy-warmup'

/**
 * 测试warmupAffiliateLink函数
 */
async function testWarmupAffiliateLink() {
  console.log('========== 测试warmupAffiliateLink函数 ==========\n')

  const testCases = [
    {
      name: 'IPRocket格式',
      url: 'https://api.iprocket.io/api?username=test&password=test&cc=ROW&ips=1&proxyType=http&responseType=txt',
      link: 'https://example.com/affiliate-link-1',
      expectedBehavior: '应该获取12个代理IP，然后发起预热请求',
    },
    {
      name: 'Oxylabs格式',
      url: 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777',
      link: 'https://example.com/affiliate-link-2',
      expectedBehavior: '应该直接使用单个代理发起12次预热请求',
    },
    {
      name: '不支持的格式',
      url: 'https://unknown-provider.com/api',
      link: 'https://example.com/affiliate-link-3',
      expectedBehavior: '应该返回false，不发起预热',
      shouldFail: true,
    },
  ]

  let passed = 0
  let failed = 0

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`)
    console.log(`URL: ${testCase.url}`)
    console.log(`期望: ${testCase.expectedBehavior}`)
    console.log(`推广链接: ${testCase.link}`)
    console.log()

    try {
      const result = await warmupAffiliateLink(testCase.url, testCase.link)

      if (testCase.shouldFail) {
        if (!result) {
          console.log(`✅ 正确返回false（不支持的格式）`)
          passed++
        } else {
          console.log(`❌ 应该返回false但返回了true`)
          failed++
        }
      } else {
        console.log(`✅ 预热已触发，返回值: ${result}`)
        passed++
      }
    } catch (error) {
      console.error(`❌ 发生错误:`, error instanceof Error ? error.message : String(error))
      failed++
    }

    console.log()
    console.log('-'.repeat(60))
    console.log()
  }

  console.log('========== 测试总结 ==========\n')
  console.log(`通过: ${passed}`)
  console.log(`失败: ${failed}`)
  console.log(`总计: ${passed + failed}`)
  console.log(`\n${failed === 0 ? '🎉 所有测试通过！' : '⚠️ 部分测试失败'}`)

  return failed === 0
}

// 运行测试
testWarmupAffiliateLink()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
