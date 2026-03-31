/**
 * 测试代理配置验证功能
 * 验证IPRocket和Oxylabs两种格式都能正确验证
 */

import { ProxyProviderRegistry } from '../src/lib/proxy/providers/provider-registry'

/**
 * 测试URL验证
 */
async function testProxyValidation() {
  console.log('========== 测试代理URL验证 ==========\n')

  const testCases = [
    {
      name: 'IPRocket格式',
      url: 'https://api.iprocket.io/api?username=test&password=test&cc=ROW&ips=1&proxyType=http&responseType=txt',
      country: 'ROW',
    },
    {
      name: 'Oxylabs格式',
      url: 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777',
      country: 'FR',
    },
    {
      name: '不支持的格式',
      url: 'https://unknown-provider.com/api',
      country: 'US',
      shouldFail: true,
    },
  ]

  let passed = 0
  let failed = 0

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`)
    console.log(`URL: ${testCase.url}`)
    console.log(`国家: ${testCase.country}`)

    try {
      const provider = ProxyProviderRegistry.getProvider(testCase.url)
      const validation = provider.validate(testCase.url)

      if (testCase.shouldFail) {
        console.log(`❌ 应该失败但成功了`)
        failed++
      } else if (validation.isValid) {
        console.log(`✅ 验证通过`)
        console.log(`   Provider: ${provider.name}`)
        console.log(`   国家代码: ${validation.countryCode}`)
        console.log(`   错误: ${validation.errors.length === 0 ? '无' : validation.errors.join(', ')}`)
        passed++
      } else {
        console.log(`❌ 验证失败: ${validation.errors.join(', ')}`)
        failed++
      }
    } catch (error) {
      if (testCase.shouldFail) {
        console.log(`✅ 正确抛出错误: ${error instanceof Error ? error.message : String(error)}`)
        passed++
      } else {
        console.log(`❌ 意外错误: ${error instanceof Error ? error.message : String(error)}`)
        failed++
      }
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

/**
 * 模拟配置验证场景
 */
async function testConfigValidation() {
  console.log('\n========== 模拟配置验证场景 ==========\n')

  const proxyConfigs = [
    {
      urls: JSON.stringify([
        { url: 'https://api.iprocket.io/api?username=user&password=pass&cc=UK&ips=1&proxyType=http&responseType=txt', country: 'UK' },
        { url: 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777', country: 'FR' },
      ])
    },
    {
      urls: JSON.stringify([
        { url: 'https://unknown-provider.com/api', country: 'US' },
      ])
    },
  ]

  for (let i = 0; i < proxyConfigs.length; i++) {
    console.log(`测试配置 ${i + 1}:`)
    console.log(JSON.stringify(proxyConfigs[i], null, 2))

    try {
      const config = proxyConfigs[i]
      const proxyUrls = JSON.parse(config.urls)

      const errors: string[] = []

      for (let j = 0; j < proxyUrls.length; j++) {
        const item = proxyUrls[j]
        if (!item.url || !item.country) {
          errors.push(`第${j + 1}个配置缺少必要字段`)
          continue
        }

        try {
          const provider = ProxyProviderRegistry.getProvider(item.url)
          const validation = provider.validate(item.url)

          if (!validation.isValid) {
            errors.push(`第${j + 1}个URL (${item.country}) 格式错误: ${validation.errors.join(', ')}`)
          } else {
            console.log(`✅ 第${j + 1}个URL验证通过: ${provider.name} Provider`)
          }
        } catch (error) {
          errors.push(`第${j + 1}个URL (${item.country}) 验证失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (errors.length > 0) {
        console.log(`❌ 验证失败: ${errors.join('；')}`)
      } else {
        console.log(`✅ 验证通过`)
      }
    } catch (error) {
      console.log(`❌ 配置JSON解析失败: ${error}`)
    }

    console.log()
  }
}

// 运行测试
testProxyValidation()
  .then(success => {
    return testConfigValidation().then(() => success)
  })
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
