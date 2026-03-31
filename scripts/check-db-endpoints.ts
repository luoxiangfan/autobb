/**
 * 检查数据库中是否有旧的 Gemini 端点配置
 */

import { getDatabase } from '../src/lib/db'

async function checkEndpoints() {
  const db = getDatabase()

  console.log('🔍 检查数据库中的 Gemini 端点配置...\n')

  // 先检查表名
  const tables = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%setting%'
  `)

  console.log('📋 找到的 settings 相关表:', tables)

  if (tables.length === 0) {
    console.log('⚠️  未找到 settings 相关的表')
    console.log('   配置可能使用其他表存储，或完全在代码中硬编码')
    await db.close()
    return
  }

  // 使用找到的表名
  const tableName = tables[0].table_name
  console.log(`\n使用表: ${tableName}\n`)

  // 检查是否有 gemini_endpoint 相关配置
  const endpointSettings = await db.query(`
    SELECT id, user_id, category, key, value, encrypted_value
    FROM ${tableName}
    WHERE key LIKE '%gemini%endpoint%'
       OR key LIKE '%thunderrelay%'
       OR (key = 'gemini_provider' AND value = 'relay')
    ORDER BY user_id, key
  `)

  if (endpointSettings.length === 0) {
    console.log('✅ 数据库中没有找到 Gemini 端点相关配置')
    console.log('   （端点配置都是从代码中读取，不需要更新数据库）')
  } else {
    console.log(`📋 找到 ${endpointSettings.length} 条相关配置：\n`)

    endpointSettings.forEach((setting: any) => {
      console.log(`ID: ${setting.id}`)
      console.log(`  User ID: ${setting.user_id || '全局'}`)
      console.log(`  Category: ${setting.category}`)
      console.log(`  Key: ${setting.key}`)
      console.log(`  Value: ${setting.value || '(加密)'}`)
      console.log('')
    })

    // 统计使用 relay provider 的用户数量
    const relayUsers = endpointSettings.filter((s: any) =>
      s.key === 'gemini_provider' && s.value === 'relay'
    )

    if (relayUsers.length > 0) {
      console.log(`⚠️  有 ${relayUsers.length} 个用户正在使用 relay provider`)
      console.log('   迁移后，这些用户将自动使用新端点 https://aicode.cat')
    }
  }

  console.log('\n✅ 检查完成')

  await db.close()
}

checkEndpoints().catch(error => {
  console.error('❌ 检查失败:', error)
  process.exit(1)
})
