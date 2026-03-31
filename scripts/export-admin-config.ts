#!/usr/bin/env node

/**
 * 导出管理员配置脚本
 *
 * 从 SQLite 数据库导出 autoads 管理员的15个系统配置项
 * 导出到加密的 JSON 文件，用于迁移到 PostgreSQL 生产环境
 *
 * 配置包括：
 * - AI配置（7项）: Vertex AI 和 Gemini API 相关
 * - Google Ads配置（4项）: API 凭证
 * - 代理配置（1项）: 多国代理 URL
 * - 系统配置（5项）: 语言、货币、同步间隔等
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const EXPORT_DIR = path.join(process.cwd(), 'secrets')
const EXPORT_FILE = path.join(EXPORT_DIR, 'admin-config-export.json')

interface SystemSetting {
  id: number
  user_id: number | null
  category: string
  config_key: string
  config_value: string | null
  encrypted_value: string | null
  data_type: string
  is_sensitive: number
  is_required: number
  validation_status: string | null
  validation_message: string | null
  last_validated_at: string | null
  default_value: string | null
  description: string | null
  created_at: string
  updated_at: string
}

interface AdminUser {
  id: number
  username: string
  email: string
  role: string
  package_type: string
  package_expires_at: string
}

console.log('🚀 开始导出管理员配置...')
console.log('📍 数据库路径:', DB_PATH)

// 检查数据库文件是否存在
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH)
  process.exit(1)
}

// 连接到 SQLite 数据库
const db = new Database(DB_PATH, { readonly: true })

try {
  // 1. 查找 autoads 管理员用户
  console.log('\n👤 查找管理员用户...')

  const adminUser = db
    .prepare('SELECT id, username, email, role, package_type, package_expires_at FROM users WHERE username = ? OR role = ?')
    .get('autoads', 'admin') as AdminUser | undefined

  if (!adminUser) {
    console.error('❌ 未找到管理员用户（username=autoads 或 role=admin）')
    process.exit(1)
  }

  console.log('✅ 找到管理员用户:')
  console.log(`   ID: ${adminUser.id}`)
  console.log(`   用户名: ${adminUser.username}`)
  console.log(`   邮箱: ${adminUser.email}`)
  console.log(`   角色: ${adminUser.role}`)
  console.log(`   套餐类型: ${adminUser.package_type}`)

  // 2. 导出管理员的系统配置
  console.log('\n⚙️  导出系统配置...')

  const settings = db
    .prepare(
      `SELECT * FROM system_settings
       WHERE user_id = ? OR user_id IS NULL
       ORDER BY category, config_key`
    )
    .all(adminUser.id) as SystemSetting[]

  console.log(`✅ 找到 ${settings.length} 项配置`)

  // 3. 按类别分组配置
  const configByCategory: Record<string, SystemSetting[]> = {}
  for (const setting of settings) {
    if (!configByCategory[setting.category]) {
      configByCategory[setting.category] = []
    }
    configByCategory[setting.category].push(setting)
  }

  // 4. 显示配置摘要
  console.log('\n📋 配置摘要:')
  for (const [category, items] of Object.entries(configByCategory)) {
    console.log(`\n   ${category.toUpperCase()} (${items.length}项):`)
    for (const item of items) {
      const isSensitive = item.is_sensitive === 1
      const hasEncrypted = !!item.encrypted_value
      const hasValue = !!item.config_value

      let valueDisplay = ''
      if (isSensitive && hasEncrypted) {
        valueDisplay = '[加密]'
      } else if (hasValue) {
        valueDisplay = item.config_value!.length > 50
          ? item.config_value!.substring(0, 50) + '...'
          : item.config_value!
      } else {
        valueDisplay = '[未设置]'
      }

      console.log(`     - ${item.config_key}: ${valueDisplay}`)
    }
  }

  // 5. 创建导出数据结构
  const exportData = {
    exported_at: new Date().toISOString(),
    exported_from: 'SQLite',
    database_path: DB_PATH,
    admin_user: {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: adminUser.role,
      package_type: adminUser.package_type,
      package_expires_at: adminUser.package_expires_at,
    },
    settings: settings,
    settings_count: settings.length,
    categories: Object.keys(configByCategory),
  }

  // 6. 确保 secrets 目录存在
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
    console.log(`\n✅ 创建目录: ${EXPORT_DIR}`)
  }

  // 7. 写入 JSON 文件
  fs.writeFileSync(EXPORT_FILE, JSON.stringify(exportData, null, 2), 'utf-8')

  console.log('\n✅ 配置导出完成！')
  console.log(`📄 导出文件: ${EXPORT_FILE}`)
  console.log(`📊 导出统计:`)
  console.log(`   - 配置项数量: ${settings.length}`)
  console.log(`   - 配置类别: ${Object.keys(configByCategory).join(', ')}`)
  console.log(`   - 敏感配置: ${settings.filter((s) => s.is_sensitive === 1).length}`)
  console.log(`   - 加密配置: ${settings.filter((s) => !!s.encrypted_value).length}`)

  // 8. 安全提示
  console.log('\n⚠️  安全提示:')
  console.log('   - 导出文件包含加密的敏感数据（API密钥、凭证等）')
  console.log('   - 请确保导出文件存储在安全位置')
  console.log('   - secrets/ 目录已在 .gitignore 中排除，不会被提交到版本控制')
  console.log('   - 生产环境需要使用相同的加密密钥（ENCRYPTION_KEY）解密数据')

  console.log('\n📝 下一步:')
  console.log('   1. 将导出文件安全传输到生产环境')
  console.log('   2. 运行数据库初始化脚本导入配置到 PostgreSQL')
  console.log('   3. 验证所有配置项已正确导入')

} catch (error) {
  console.error('\n❌ 导出失败:', error)
  process.exit(1)
} finally {
  db.close()
}
