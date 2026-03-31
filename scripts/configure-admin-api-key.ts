/**
 * 为管理员用户配置新的 Gemini relay API Key
 */

import { getDatabase } from '../src/lib/db'

const ADMIN_USERNAME = 'autoads'
const NEW_API_KEY = process.env.GEMINI_RELAY_API_KEY || process.env.NEW_API_KEY

if (!NEW_API_KEY) {
  console.error('❌ GEMINI_RELAY_API_KEY (或 NEW_API_KEY) 环境变量未设置')
  process.exit(1)
}

async function configureAdminApiKey() {
  const db = getDatabase()

  console.log('🔧 配置管理员用户的 Gemini relay API Key...\n')

  // 查找管理员用户
  const admin = await db.queryOne(`
    SELECT id, username, email
    FROM users
    WHERE username = $1
  `, [ADMIN_USERNAME])

  if (!admin) {
    console.error(`❌ 未找到管理员用户: ${ADMIN_USERNAME}`)
    await db.close()
    process.exit(1)
  }

  console.log(`✅ 找到管理员用户:`)
  console.log(`   ID: ${admin.id}`)
  console.log(`   用户名: ${admin.username}`)
  console.log(`   邮箱: ${admin.email || 'N/A'}\n`)

  // 检查现有配置
  const existingProvider = await db.queryOne(`
    SELECT value
    FROM system_settings
    WHERE user_id = $1
      AND category = 'ai'
      AND key = 'gemini_provider'
  `, [admin.id])

  const existingApiKey = await db.queryOne(`
    SELECT value
    FROM system_settings
    WHERE user_id = $1
      AND category = 'ai'
      AND key = 'gemini_relay_api_key'
  `, [admin.id])

  console.log('📋 现有配置:')
  console.log(`   Provider: ${existingProvider?.value || '未配置'}`)
  console.log(`   Relay API Key: ${existingApiKey?.value ? '已配置' : '未配置'}\n`)

  // 更新或插入 provider 配置
  if (existingProvider) {
    await db.exec(`
      UPDATE system_settings
      SET value = 'relay'
      WHERE user_id = $1
        AND category = 'ai'
        AND key = 'gemini_provider'
    `, [admin.id])
    console.log('✅ 更新 gemini_provider 为 relay')
  } else {
    await db.exec(`
      INSERT INTO system_settings (user_id, category, key, value)
      VALUES ($1, 'ai', 'gemini_provider', 'relay')
    `, [admin.id])
    console.log('✅ 插入 gemini_provider 配置')
  }

  // 更新或插入 API Key 配置（使用 value 字段存储明文，用于测试）
  if (existingApiKey) {
    await db.exec(`
      UPDATE system_settings
      SET value = $1, encrypted_value = NULL
      WHERE user_id = $2
        AND category = 'ai'
        AND key = 'gemini_relay_api_key'
    `, [NEW_API_KEY, admin.id])
    console.log('✅ 更新 gemini_relay_api_key（明文存储用于测试）')
  } else {
    await db.exec(`
      INSERT INTO system_settings (user_id, category, key, value, encrypted_value)
      VALUES ($1, 'ai', 'gemini_relay_api_key', $2, NULL)
    `, [admin.id, NEW_API_KEY])
    console.log('✅ 插入 gemini_relay_api_key 配置（明文存储用于测试）')
  }

  // 更新 endpoint 配置
  const existingEndpoint = await db.queryOne(`
    SELECT value
    FROM system_settings
    WHERE user_id = $1
      AND category = 'ai'
      AND key = 'gemini_endpoint'
  `, [admin.id])

  if (existingEndpoint) {
    await db.exec(`
      UPDATE system_settings
      SET value = 'https://aicode.cat'
      WHERE user_id = $1
        AND category = 'ai'
        AND key = 'gemini_endpoint'
    `, [admin.id])
    console.log('✅ 更新 gemini_endpoint')
  } else {
    await db.exec(`
      INSERT INTO system_settings (user_id, category, key, value)
      VALUES ($1, 'ai', 'gemini_endpoint', 'https://aicode.cat')
    `, [admin.id])
    console.log('✅ 插入 gemini_endpoint 配置')
  }

  // 验证配置
  console.log('\n📊 验证配置:')
  const verifyProvider = await db.queryOne(`
    SELECT value FROM system_settings
    WHERE user_id = $1 AND category = 'ai' AND key = 'gemini_provider'
  `, [admin.id])

  const verifyApiKey = await db.queryOne(`
    SELECT value FROM system_settings
    WHERE user_id = $1 AND category = 'ai' AND key = 'gemini_relay_api_key'
  `, [admin.id])

  const verifyEndpoint = await db.queryOne(`
    SELECT value FROM system_settings
    WHERE user_id = $1 AND category = 'ai' AND key = 'gemini_endpoint'
  `, [admin.id])

  console.log(`   Provider: ${verifyProvider?.value}`)
  console.log(`   Endpoint: ${verifyEndpoint?.value}`)
  console.log(`   API Key: ${verifyApiKey?.value?.substring(0, 20)}...`)

  console.log('\n✅ 配置完成！')

  await db.close()
}

configureAdminApiKey().catch(error => {
  console.error('❌ 配置失败:', error)
  process.exit(1)
})
