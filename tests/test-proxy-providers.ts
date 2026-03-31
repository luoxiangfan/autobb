/**
 * 代理Provider扩展测试
 * 验证IPRocket和Oxylabs两种格式的支持
 */

import { ProxyProviderRegistry } from '../src/lib/proxy/providers/provider-registry'
import { fetchProxyIp } from '../src/lib/proxy/fetch-proxy-ip'

/**
 * 测试Oxylabs URL解析
 */
async function testOxylabsProvider() {
  console.log('\n========== 测试Oxylabs Provider ==========\n')

  // 测试URL
  const oxylabsUrl = 'https://customer-xxrenzhe_pQhay-cc-fr:CV6~qENiY5l2i@pr.oxylabs.io:7777'

  try {
    // 1. 测试Provider检测
    const provider = ProxyProviderRegistry.getProvider(oxylabsUrl)
    console.log(`✅ Provider检测成功: ${provider.name}`)

    // 2. 测试URL验证
    const validation = provider.validate(oxylabsUrl)
    console.log(`📋 验证结果:`, validation)
    console.log(`   - 有效: ${validation.isValid}`)
    console.log(`   - 国家代码: ${validation.countryCode}`)
    console.log(`   - 错误: ${validation.errors.length === 0 ? '无' : validation.errors.join(', ')}`)

    // 3. 测试凭证提取
    const credentials = await provider.extractCredentials(oxylabsUrl)
    console.log(`\n🎉 提取成功:`)
    console.log(`   - Host: ${credentials.host}`)
    console.log(`   - Port: ${credentials.port}`)
    console.log(`   - Username: ${credentials.username}`)
    console.log(`   - Password: ${credentials.password}`)
    console.log(`   - Full Address: ${credentials.fullAddress}`)

    // 4. 测试完整fetchProxyIp流程（跳过健康检查）
    console.log(`\n🔄 测试完整fetchProxyIp流程...`)
    const fullResult = await fetchProxyIp(oxylabsUrl, 1, true)
    console.log(`✅ fetchProxyIp成功: ${fullResult.fullAddress}`)

    console.log('\n✅ Oxylabs Provider测试通过！')
    return true
  } catch (error) {
    console.error(`\n❌ Oxylabs Provider测试失败:`, error)
    return false
  }
}

/**
 * 测试IPRocket URL支持（模拟）
 */
async function testIPRocketProvider() {
  console.log('\n========== 测试IPRocket Provider ==========\n')

  const iprocketUrl = 'https://api.iprocket.io/api?username=test&password=test&cc=ROW&ips=1&proxyType=http&responseType=txt'

  try {
    // 1. 测试Provider检测
    const provider = ProxyProviderRegistry.getProvider(iprocketUrl)
    console.log(`✅ Provider检测成功: ${provider.name}`)

    // 2. 测试URL验证
    const validation = provider.validate(iprocketUrl)
    console.log(`📋 验证结果:`, validation)
    console.log(`   - 有效: ${validation.isValid}`)
    console.log(`   - 国家代码: ${validation.countryCode}`)
    console.log(`   - 错误: ${validation.errors.length === 0 ? '无' : validation.errors.join(', ')}`)

    console.log('\n✅ IPRocket Provider检测通过！')
    console.log('ℹ️  注意: 完整API调用测试需要真实的IPRocket API密钥')

    return true
  } catch (error) {
    console.error(`\n❌ IPRocket Provider测试失败:`, error)
    return false
  }
}

/**
 * 测试不支持的URL格式
 */
async function testUnsupportedUrl() {
  console.log('\n========== 测试不支持的URL格式 ==========\n')

  const unsupportedUrl = 'https://unknown-proxy-provider.com/api'

  try {
    ProxyProviderRegistry.getProvider(unsupportedUrl)
    console.error('❌ 应该抛出错误但没有')
    return false
  } catch (error) {
    console.log(`✅ 正确抛出错误: ${error instanceof Error ? error.message : String(error)}`)
    return true
  }
}

/**
 * 运行所有测试
 */
async function runTests() {
  console.log('🚀 开始代理Provider扩展测试\n')

  const results = {
    oxylabs: false,
    iprocket: false,
    unsupported: false,
  }

  // 测试Oxylabs
  results.oxylabs = await testOxylabsProvider()

  // 测试IPRocket
  results.iprocket = await testIPRocketProvider()

  // 测试不支持的URL
  results.unsupported = await testUnsupportedUrl()

  // 总结
  console.log('\n========== 测试总结 ==========\n')
  console.log(`Oxylabs Provider: ${results.oxylabs ? '✅ 通过' : '❌ 失败'}`)
  console.log(`IPRocket Provider: ${results.iprocket ? '✅ 通过' : '❌ 失败'}`)
  console.log(`不支持URL检测: ${results.unsupported ? '✅ 通过' : '❌ 失败'}`)

  const allPassed = Object.values(results).every(r => r)
  console.log(`\n${allPassed ? '🎉 所有测试通过！' : '⚠️ 部分测试失败'}`)

  return allPassed
}

// 运行测试
runTests()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
