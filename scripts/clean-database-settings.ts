import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🧹 清理数据库配置...')
console.log('📍 数据库路径:', dbPath)

// 创建数据库连接
const db = new Database(dbPath)

// 不应该存在的配置（需要删除）
const forbiddenSettings = [
  { category: 'ai', key: 'claude_api_key', reason: '不使用Claude API' },
  { category: 'ai', key: 'primary_model', reason: '应使用gemini_model' },
  { category: 'proxy', key: 'host', reason: '已改为使用url配置' },
  { category: 'proxy', key: 'port', reason: '已改为使用url配置' },
]

// 需要重命名的配置
const renamedSettings = [
  {
    oldCategory: 'ai',
    oldKey: 'primary_model',
    newCategory: 'ai',
    newKey: 'gemini_model',
    newDescription: 'Gemini模型版本'
  },
]

// 需要添加的缺失配置
const missingSettings = [
  { category: 'proxy', key: 'url', dataType: 'string', isSensitive: 0, isRequired: 0, description: '代理服务API地址，必须包含cc、ips、proxyType=http、responseType=txt参数' },
  { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: 0, isRequired: 1, description: 'Gemini模型版本', defaultValue: 'gemini-2.5-pro' },

  // Vertex AI配置项
  { category: 'ai', key: 'use_vertex_ai', dataType: 'boolean', isSensitive: 0, isRequired: 0, description: '是否使用Vertex AI（优先于直接API）', defaultValue: 'false' },
  { category: 'ai', key: 'gcp_project_id', dataType: 'string', isSensitive: 1, isRequired: 0, description: 'GCP项目ID（Vertex AI）' },
  { category: 'ai', key: 'gcp_location', dataType: 'string', isSensitive: 0, isRequired: 0, description: 'GCP区域（Vertex AI）', defaultValue: 'us-central1' },
  { category: 'ai', key: 'gcp_service_account_json', dataType: 'text', isSensitive: 1, isRequired: 0, description: 'GCP Service Account JSON（Vertex AI）' },
]

interface SettingRow {
  category: string
  config_key: string
}

try {
  let changesMade = false

  // 1. 删除禁止的配置项
  console.log('\n🗑️  删除禁止的配置项...')
  const deleteSetting = db.prepare(`
    DELETE FROM system_settings
    WHERE user_id IS NULL AND category = ? AND config_key = ?
  `)

  for (const forbidden of forbiddenSettings) {
    const result = deleteSetting.run(forbidden.category, forbidden.key)
    if (result.changes > 0) {
      console.log(`✅ 已删除: ${forbidden.category}.${forbidden.key} (${forbidden.reason})`)
      changesMade = true
    }
  }

  // 2. 检查并添加缺失的配置
  console.log('\n➕ 检查缺失的配置项...')
  const checkSetting = db.prepare(`
    SELECT config_key FROM system_settings
    WHERE user_id IS NULL AND category = ? AND config_key = ?
  `)

  const insertSetting = db.prepare(`
    INSERT INTO system_settings (
      user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const missing of missingSettings) {
    const exists = checkSetting.get(missing.category, missing.key)
    if (!exists) {
      insertSetting.run(
        null,
        missing.category,
        missing.key,
        missing.dataType,
        missing.isSensitive,
        missing.isRequired,
        missing.defaultValue || null,
        missing.description
      )
      console.log(`✅ 已添加: ${missing.category}.${missing.key}`)
      changesMade = true
    }
  }

  // 3. 重命名配置项
  console.log('\n🔄 重命名配置项...')
  const renameSetting = db.prepare(`
    UPDATE system_settings
    SET config_key = ?, description = ?
    WHERE user_id IS NULL AND category = ? AND config_key = ?
  `)

  for (const rename of renamedSettings) {
    const oldExists = checkSetting.get(rename.oldCategory, rename.oldKey) as SettingRow | undefined
    const newExists = checkSetting.get(rename.newCategory, rename.newKey) as SettingRow | undefined

    if (oldExists && !newExists) {
      const result = renameSetting.run(
        rename.newKey,
        rename.newDescription,
        rename.oldCategory,
        rename.oldKey
      )
      if (result.changes > 0) {
        console.log(`✅ 已重命名: ${rename.oldCategory}.${rename.oldKey} → ${rename.newCategory}.${rename.newKey}`)
        changesMade = true
      }
    }
  }

  // 4. 显示最终状态
  console.log('\n📊 清理后的配置项:')
  const allSettings = db.prepare(`
    SELECT category, config_key, description
    FROM system_settings
    WHERE user_id IS NULL
    ORDER BY category, config_key
  `).all()

  const groupedByCategory: Record<string, any[]> = {}
  for (const setting of allSettings as any[]) {
    if (!groupedByCategory[setting.category]) {
      groupedByCategory[setting.category] = []
    }
    groupedByCategory[setting.category].push(setting)
  }

  for (const [category, settings] of Object.entries(groupedByCategory)) {
    console.log(`\n  📁 ${category}:`)
    for (const setting of settings) {
      console.log(`     • ${setting.config_key}: ${setting.description}`)
    }
  }

  console.log('\n' + '='.repeat(60))

  if (changesMade) {
    console.log('\n✅ 清理完成！已修复配置问题。')
  } else {
    console.log('\n✅ 数据库配置已是最新状态，无需清理。')
  }

  console.log('\n💡 建议: 在设置页确认 system_settings 配置，或运行 npm run validate-schema')

} catch (error) {
  console.error('❌ 清理失败:', error)
  process.exit(1)
} finally {
  db.close()
}
