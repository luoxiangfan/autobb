/**
 * 更新数据库中的旧 Gemini relay 端点配置
 */

import { getDatabase } from '../src/lib/db'

const OLD_ENDPOINT = 'https://cc.thunderrelay.com/gemini'
const NEW_ENDPOINT = 'https://aicode.cat'

async function updateEndpoints() {
  const db = getDatabase()

  console.log('🔄 开始更新数据库中的 Gemini relay 端点配置...\n')

  // 查找所有旧端点
  const oldEndpoints = await db.query(`
    SELECT id, user_id, category, key, value
    FROM system_settings
    WHERE key = 'gemini_endpoint'
      AND value = $1
  `, [OLD_ENDPOINT])

  if (oldEndpoints.length === 0) {
    console.log('✅ 没有找到需要更新的端点配置')
    await db.close()
    return
  }

  console.log(`📋 找到 ${oldEndpoints.length} 条需要更新的端点配置：\n`)

  oldEndpoints.forEach((setting: any) => {
    console.log(`  - User ID: ${setting.user_id || '全局'} (ID: ${setting.id})`)
  })

  console.log(`\n🔄 更新端点: ${OLD_ENDPOINT} → ${NEW_ENDPOINT}\n`)

  // 更新端点
  const result = await db.exec(`
    UPDATE system_settings
    SET value = $1
    WHERE key = 'gemini_endpoint'
      AND value = $2
  `, [NEW_ENDPOINT, OLD_ENDPOINT])

  console.log(`✅ 成功更新 ${result.changes} 条记录\n`)

  // 验证更新结果
  const verifyNew = await db.query(`
    SELECT id, user_id, value
    FROM system_settings
    WHERE key = 'gemini_endpoint'
      AND value = $1
  `, [NEW_ENDPOINT])

  const verifyOld = await db.query(`
    SELECT COUNT(*) as count
    FROM system_settings
    WHERE key = 'gemini_endpoint'
      AND value = $1
  `, [OLD_ENDPOINT])

  console.log('📊 更新后验证:')
  console.log(`  - 新端点记录数: ${verifyNew.length}`)
  console.log(`  - 旧端点记录数: ${verifyOld[0]?.count || 0}`)

  if (verifyOld[0]?.count > 0) {
    console.log('\n⚠️  警告: 仍有旧端点记录未更新')
  } else {
    console.log('\n✅ 所有旧端点已成功更新为新端点')
  }

  await db.close()
}

updateEndpoints().catch(error => {
  console.error('❌ 更新失败:', error)
  process.exit(1)
})
