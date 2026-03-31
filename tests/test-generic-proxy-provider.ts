/**
 * 测试GenericProxyProvider功能
 */

import { ProxyProviderRegistry } from '../src/lib/proxy/providers/provider-registry'

async function testGenericProxyProvider() {
  console.log('========== 测试GenericProxyProvider ==========\n')

  const testCases = [
    {
      name: '有效Generic格式（标准代理）',
      url: 'proxy.example.com:8080:username:password',
      shouldPass: true,
      expectedProvider: 'Generic'
    },
    {
      name: '有效Generic格式（IP格式）',
      url: '192.168.1.1:3128:user:pass',
      shouldPass: true,
      expectedProvider: 'Generic'
    },
    {
      name: '有效Generic格式（含国家代码）',
      url: 'proxy.server.com:1080:user_region-US:pass',
      shouldPass: true,
      expectedProvider: 'Generic',
      expectedCountry: 'US'
    },
    {
      name: '缺少用户名',
      url: 'proxy.example.com:8080::password',
      shouldPass: false,
    },
    {
      name: '缺少密码',
      url: 'proxy.example.com:8080:username:',
      shouldPass: false,
    },
    {
      name: '无效端口号',
      url: 'proxy.example.com:abc:username:password',
      shouldPass: false,
    },
    {
      name: '过短主机名',
      url: 'ab:8080:username:password',
      shouldPass: false,
    },
    {
      name: 'IPRocket格式（应被IPRocket处理）',
      url: 'https://api.iprocket.io/api?username=test&password=test&cc=US&ips=1&proxyType=http&responseType=txt',
      shouldPass: true,
      expectedProvider: 'IPRocket'
    },
    {
      name: 'Oxylabs格式（应被Oxylabs处理）',
      url: 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777',
      shouldPass: true,
      expectedProvider: 'Oxylabs'
    },
    {
      name: 'Abcproxy格式（应被Abcproxy处理）',
      url: 'na.02b22e116103ae77.abcproxy.vip:4950:abc4766772_6781_ds-zone-abc-region-US:Aa114524',
      shouldPass: true,
      expectedProvider: 'Abcproxy'
    },
    {
      name: 'HTTP URL格式（应被拒绝）',
      url: 'http://proxy.example.com:8080:username:password',
      shouldPass: false,
    },
  ]

  let passed = 0
  let failed = 0

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`)
    console.log(`URL: ${testCase.url}`)

    try {
      // 检查是否能识别
      const isSupported = ProxyProviderRegistry.isSupported(testCase.url)
      console.log(`是否支持: ${isSupported}`)

      if (testCase.shouldPass) {
        // 应该能处理
        const provider = ProxyProviderRegistry.getProvider(testCase.url)
        console.log(`Provider: ${provider.name}`)

        // 验证格式
        const validation = provider.validate(testCase.url)
        console.log(`验证结果: ${validation.isValid ? '✅ 通过' : '❌ 失败'}`)

        if (validation.errors.length > 0) {
          console.log(`验证错误: ${validation.errors.join(', ')}`)
        }

        // 提取凭证
        if (validation.isValid) {
          const credentials = await provider.extractCredentials(testCase.url)
          console.log(`解析结果:`)
          console.log(`  主机: ${credentials.host}`)
          console.log(`  端口: ${credentials.port}`)
          console.log(`  用户名: ${credentials.username}`)
          console.log(`  密码: ${credentials.password}`)
          console.log(`  完整地址: ${credentials.fullAddress}`)

          // 验证国家代码
          if (testCase.expectedCountry && validation.countryCode) {
            if (validation.countryCode === testCase.expectedCountry) {
              console.log(`  国家代码: ${validation.countryCode} ✅`)
            } else {
              console.log(`  国家代码: ${validation.countryCode} ❌ (期望: ${testCase.expectedCountry})`)
            }
          }
        }

        if (validation.isValid && provider.name === testCase.expectedProvider) {
          console.log(`✅ 测试通过`)
          passed++
        } else if (!validation.isValid) {
          console.log(`❌ 期望通过但验证失败`)
          failed++
        } else {
          console.log(`❌ 识别为错误的Provider`)
          failed++
        }
      } else {
        // 应该不能处理或验证失败
        if (!isSupported) {
          console.log(`✅ 正确拒绝不支持的格式`)
          passed++
        } else {
          const provider = ProxyProviderRegistry.getProvider(testCase.url)
          const validation = provider.validate(testCase.url)
          if (!validation.isValid) {
            console.log(`✅ 正确验证失败`)
            passed++
          } else {
            console.log(`❌ 期望失败但通过了验证`)
            failed++
          }
        }
      }
    } catch (error) {
      if (!testCase.shouldPass) {
        console.log(`✅ 正确抛出错误: ${error instanceof Error ? error.message : String(error)}`)
        passed++
      } else {
        console.log(`❌ 意外错误:`, error)
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

// 运行测试
testGenericProxyProvider()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
