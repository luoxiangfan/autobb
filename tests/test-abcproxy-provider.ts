/**
 * 测试AbcproxyProvider功能
 */

import { ProxyProviderRegistry } from '../src/lib/proxy/providers/provider-registry'

async function testAbcproxyProvider() {
  console.log('========== 测试AbcproxyProvider ==========\n')

  const testCases = [
    {
      name: '有效Abcproxy格式',
      url: 'na.02b22e116103ae77.abcproxy.vip:4950:abc4766772_6781_ds-zone-abc-region-US:Aa114524',
      shouldPass: true,
    },
    {
      name: '缺少用户名',
      url: 'na.02b22e116103ae77.abcproxy.vip:4950::Aa114524',
      shouldPass: false,
    },
    {
      name: '缺少密码',
      url: 'na.02b22e116103ae77.abcproxy.vip:4950:abc4766772_6781_ds-zone-abc-region-US:',
      shouldPass: false,
    },
    {
      name: '无效端口号',
      url: 'na.02b22e116103ae77.abcproxy.vip:abc:abc4766772_6781_ds-zone-abc-region-US:Aa114524',
      shouldPass: false,
    },
    {
      name: '不包含abcproxy.vip',
      url: '127.0.0.1:4950:abc4766772_6781_ds-zone-abc-region-US:Aa114524',
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
        }

        if (validation.isValid && provider.name === 'Abcproxy') {
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
testAbcproxyProvider()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
