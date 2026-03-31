/**
 * 最终验证：检查所有配置是否已迁移到新端点
 */

import { getDatabase } from '../src/lib/db'

async function finalCheck() {
  const db = getDatabase()

  console.log('🔍 最终验证：检查迁移完整性...\n')

  // 1. 检查代码中的配置
  console.log('=' .repeat(80))
  console.log('1. 代码配置检查')
  console.log('=' .repeat(80))

  const { GEMINI_PROVIDERS } = await import('../src/lib/gemini-config')
  console.log(`✓ gemini-config.ts relay endpoint: ${GEMINI_PROVIDERS.relay.endpoint}`)
  console.log(`  预期: https://aicode.cat`)
  console.log(`  状态: ${GEMINI_PROVIDERS.relay.endpoint === 'https://aicode.cat' ? '✅ 正确' : '❌ 错误'}\n`)

  // 2. 检查数据库中的配置
  console.log('=' .repeat(80))
  console.log('2. 数据库配置检查')
  console.log('=' .repeat(80))

  // 检查旧端点
  const oldEndpoints = await db.query(`
    SELECT id, user_id, value
    FROM system_settings
    WHERE key = 'gemini_endpoint'
      AND value LIKE '%thunderrelay%'
  `)

  if (oldEndpoints.length > 0) {
    console.log(`❌ 发现 ${oldEndpoints.length} 条旧端点配置:`)
    oldEndpoints.forEach((s: any) => {
      console.log(`   - User ID: ${s.user_id}, Value: ${s.value}`)
    })
  } else {
    console.log(`✅ 没有发现旧端点配置\n`)
  }

  // 检查新端点
  const newEndpoints = await db.query(`
    SELECT id, user_id, value
    FROM system_settings
    WHERE key = 'gemini_endpoint'
      AND value = 'https://aicode.cat'
  `)

  console.log(`新端点 (https://aicode.cat) 配置数量: ${newEndpoints.length}`)
  if (newEndpoints.length > 0) {
    console.log(`✅ 找到 ${newEndpoints.length} 个用户使用新端点`)
    newEndpoints.forEach((s: any) => {
      console.log(`   - User ID: ${s.user_id}`)
    })
  }
  console.log('')

  // 检查所有 relay provider 用户
  const relayUsers = await db.query(`
    SELECT s1.user_id, s2.value as endpoint
    FROM system_settings s1
    LEFT JOIN system_settings s2
      ON s1.user_id = s2.user_id
      AND s2.category = 'ai'
      AND s2.key = 'gemini_endpoint'
    WHERE s1.category = 'ai'
      AND s1.key = 'gemini_provider'
      AND s1.value = 'relay'
  `)

  console.log(`Relay provider 用户数量: ${relayUsers.length}`)
  if (relayUsers.length > 0) {
    console.log(`详细信息:`)
    relayUsers.forEach((u: any) => {
      const status = u.endpoint === 'https://aicode.cat' ? '✅' :
                     u.endpoint?.includes('thunderrelay') ? '❌ 旧端点' :
                     u.endpoint ? '⚠️ 其他端点' : '⚠️ 未配置'
      console.log(`   - User ID: ${u.user_id}, Endpoint: ${u.endpoint || '未配置'} ${status}`)
    })
  }
  console.log('')

  // 3. 总结
  console.log('=' .repeat(80))
  console.log('3. 迁移完整性总结')
  console.log('=' .repeat(80))

  const issues: string[] = []

  // 检查代码配置
  if (GEMINI_PROVIDERS.relay.endpoint !== 'https://aicode.cat') {
    issues.push('❌ gemini-config.ts 中的 relay endpoint 未更新')
  }

  // 检查数据库
  if (oldEndpoints.length > 0) {
    issues.push(`❌ 数据库中仍有 ${oldEndpoints.length} 条旧端点配置`)
  }

  // 检查 relay 用户
  const relayUsersWithOldEndpoint = relayUsers.filter((u: any) =>
    u.endpoint?.includes('thunderrelay')
  )
  if (relayUsersWithOldEndpoint.length > 0) {
    issues.push(`❌ ${relayUsersWithOldEndpoint.length} 个 relay 用户仍使用旧端点`)
  }

  if (issues.length === 0) {
    console.log('✅ 迁移完成！所有配置已成功更新到新端点\n')
    console.log('摘要:')
    console.log(`   - 代码配置: ✅ 已更新`)
    console.log(`   - 数据库配置: ✅ 已更新`)
    console.log(`   - Relay用户: ${relayUsers.length} 个用户使用新端点`)
  } else {
    console.log('⚠️ 迁移未完成，发现以下问题:\n')
    issues.forEach(issue => console.log(`   ${issue}`))
    console.log('\n需要修复这些问题后重新验证。')
  }

  console.log('=' .repeat(80))

  await db.close()
  process.exit(issues.length > 0 ? 1 : 0)
}

finalCheck().catch(error => {
  console.error('❌ 验证失败:', error)
  process.exit(1)
})
