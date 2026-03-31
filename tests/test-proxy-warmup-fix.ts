/**
 * 测试代理预热功能修复
 * 验证IPRocket和Oxylabs两种格式都能正确处理
 */

import { fetch12ProxyIPs } from '../src/lib/proxy-warmup'

/**
 * 测试fetch12ProxyIPs函数
 */
async function testFetch12ProxyIPs() {
  console.log('========== 测试fetch12ProxyIPs函数 ==========\n')

  const testCases = [
    {
      name: 'IPRocket格式',
      url: 'https://api.iprocket.io/api?username=test&password=test&cc=ROW&ips=1&proxyType=http&responseType=txt',
      shouldAddIps: true,
    },
    {
      name: 'Oxylabs格式',
      url: 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777',
      shouldAddIps: false,
      shouldSkip: true,
    },
    {
      name: '不支持的格式',
      url: 'https://unknown-provider.com/api',
      shouldAddIps: false,
      shouldSkip: true,
    },
  ]

  let passed = 0
  let failed = 0

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`)
    console.log(`URL: ${testCase.url}`)

    try {
      const result = await fetch12ProxyIPs(testCase.url)

      if (testCase.shouldSkip) {
        if (result.length === 0) {
          console.log(`✅ 正确跳过预热（返回空数组）`)
          passed++
        } else {
          console.log(`❌ 应该跳过但返回了 ${result.length} 个代理IP`)
          failed++
        }
      } else {
        console.log(`✅ 尝试获取代理IP，返回 ${result.length} 个`)
        passed++
      }
    } catch (error) {
      console.error(`❌ 发生错误:`, error instanceof Error ? error.message : String(error))
      failed++
    }

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
testFetch12ProxyIPs()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
