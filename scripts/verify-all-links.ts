/**
 * 最终验证：检查所有链接是否已更新到新端点
 */

async function finalLinkCheck() {
  console.log('🔍 验证所有链接已更新到新端点...\n')

  const { GEMINI_PROVIDERS } = await import('../src/lib/gemini-config')

  console.log('=' .repeat(80))
  console.log('检查结果')
  console.log('=' .repeat(80))

  const issues: string[] = []

  // 检查 endpoint
  console.log('\n1. API 端点 (endpoint)')
  console.log(`   relay.endpoint: ${GEMINI_PROVIDERS.relay.endpoint}`)
  if (GEMINI_PROVIDERS.relay.endpoint !== 'https://aicode.cat') {
    issues.push('❌ relay.endpoint 未更新')
    console.log('   状态: ❌ 错误')
  } else {
    console.log('   状态: ✅ 正确')
  }

  // 检查 apiKeyUrl
  console.log('\n2. API Key 注册链接 (apiKeyUrl)')
  console.log(`   relay.apiKeyUrl: ${GEMINI_PROVIDERS.relay.apiKeyUrl}`)
  if (GEMINI_PROVIDERS.relay.apiKeyUrl !== 'https://aicode.cat/register?ref=T6S73C2U') {
    issues.push('❌ relay.apiKeyUrl 未更新')
    console.log('   状态: ❌ 错误')
  } else {
    console.log('   状态: ✅ 正确')
  }

  // 总结
  console.log('\n' + '=' .repeat(80))
  console.log('总结')
  console.log('=' .repeat(80))

  if (issues.length === 0) {
    console.log('\n✅ 所有链接已成功更新到新端点！')
    console.log('\n配置详情:')
    console.log(`   - API 端点: https://aicode.cat`)
    console.log(`   - 注册链接: https://aicode.cat/register?ref=T6S73C2U`)
    console.log(`   - 邀请码: T6S73C2U`)
  } else {
    console.log('\n⚠️ 发现以下问题:\n')
    issues.forEach(issue => console.log(`   ${issue}`))
  }

  console.log('\n' + '=' .repeat(80))

  process.exit(issues.length > 0 ? 1 : 0)
}

finalLinkCheck().catch(error => {
  console.error('❌ 验证失败:', error)
  process.exit(1)
})
