/**
 * 数据库自动初始化模块
 *
 * 在应用启动时自动检查并初始化数据库：
 * 1. 检测数据库类型（SQLite 或 PostgreSQL）
 * 2. 创建数据库表结构（如果不存在）
 * 3. 创建默认管理员账号
 * 4. 导入管理员配置（PostgreSQL 生产环境）
 * 5. 插入默认系统配置
 * 6. 自动执行增量迁移（新增）
 */

import { getDatabase } from './db'
import { hashPassword } from './crypto'
import { splitSqlStatements } from './sql-splitter'
import fs from 'fs'
import path from 'path'

// 默认管理员信息
// 安全说明：密码从环境变量读取，如果未设置则生成32位随机密码
const crypto = require('crypto')
const DEFAULT_ADMIN = {
  username: 'autoads',
  email: 'admin@autoads.com',
  password: process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64'),
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
}

// 配置导出文件路径
const CONFIG_EXPORT_PATH = path.join(process.cwd(), 'secrets', 'admin-config-export.json')

/**
 * 检查数据库是否已初始化
 *
 * 检查多个关键表是否存在，而不仅仅是 users 表
 * 只有当所有关键表都存在时，才认为数据库已初始化
 */
async function isDatabaseInitialized(): Promise<boolean> {
  const db = await getDatabase()

  // 定义关键表列表 - 这些表必须全部存在才认为数据库已初始化
  const criticalTables = [
    'users',              // 用户表
    'offers',             // Offer 表
    'campaigns',          // Campaign 表
    'system_settings',    // 系统设置表
    'industry_benchmarks', // 行业基准表
    'batch_tasks',        // 批量任务表
    'upload_records',     // 上传记录表
    'offer_tasks',        // Offer提取任务表
  ]

  if (db.type === 'sqlite') {
    // SQLite: 检查所有关键表是否存在
    try {
      for (const table of criticalTables) {
        const result = await db.query<{ count: number }>(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?",
          [table]
        )
        if (result[0].count === 0) {
          console.log(`⚠️ 数据库初始化检查: 缺少关键表 '${table}'`)
          return false
        }
      }
      console.log('✅ 数据库初始化检查: 所有关键表都存在')
      return true
    } catch (error) {
      console.error('❌ 数据库初始化检查失败:', error)
      return false
    }
  } else {
    // PostgreSQL: 检查所有关键表是否存在
    try {
      for (const table of criticalTables) {
        const result = await db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          [table]
        )
        if (!result[0].exists) {
          console.log(`⚠️ 数据库初始化检查: 缺少关键表 '${table}'`)
          return false
        }
      }
      console.log('✅ 数据库初始化检查: 所有关键表都存在')
      return true
    } catch (error) {
      console.error('❌ 数据库初始化检查失败:', error)
      return false
    }
  }
}

/**
 * 初始化 SQLite 数据库
 */
async function initializeSQLite(): Promise<void> {
  console.log('📦 Initializing SQLite database...')

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
  const dataDir = path.dirname(dbPath)
  const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema_consolidated.sqlite.sql')

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log(`✅ Created data directory: ${dataDir}`)
  }

  if (!fs.existsSync(sqlPath)) {
    console.log('⚠️  SQLite schema file not found.')
    console.log(`   Expected: ${sqlPath}`)
    console.log('   Please run: npm run db:init')
    return
  }

  // 内存数据库无法依赖外部 db:init，必须在启动时自动灌入 schema。
  if (dbPath === ':memory:') {
    console.log('🧠 Detected in-memory SQLite, bootstrapping schema automatically...')
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')
    const db = await getDatabase()
    await db.exec(sqlContent)
    console.log('✅ In-memory SQLite schema initialized')
    return
  }

  // 文件数据库仍沿用手工初始化流程（避免误覆盖既有运维流程）。
  console.log('⚠️  SQLite database needs manual initialization.')
  console.log('   Please run: npm run db:init')
}

/**
 * 初始化 PostgreSQL 数据库
 */
async function initializePostgreSQL(): Promise<void> {
  console.log('🐘 Initializing PostgreSQL database...')

  try {
    // 1. 从生成的SQL文件创建表结构
    const sqlPath = path.join(process.cwd(), 'pg-migrations', '000_init_schema_consolidated.pg.sql')
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`PostgreSQL schema file not found: ${sqlPath}`)
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')
    const db = await getDatabase()
    const sql = (db as any).getRawConnection()

    console.log('\n📋 Creating database tables...')
    // 注意：整合初始化脚本可能包含自身的 BEGIN/COMMIT（历史迁移保留），因此不要再包一层事务
    await sql.unsafe(sqlContent)
    console.log('✅ Schema created from pg-migrations/000_init_schema_consolidated.pg.sql')

    // 2. 创建默认管理员账号
    await createDefaultAdmin()

    // 3. 插入默认系统配置
    await insertDefaultSystemSettings()

    // 4. 导入管理员配置（如果存在）
    await importAdminConfig()

    // 5. 插入行业基准数据
    await insertIndustryBenchmarks()

    console.log('\n✅ PostgreSQL database initialized successfully!')
  } catch (error) {
    console.error('❌ PostgreSQL initialization failed:', error)
    throw error
  }
}

/**
 * 创建默认管理员账号
 */
async function createDefaultAdmin(): Promise<void> {
  console.log('\n👤 Creating default admin account...')

  const db = await getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  try {
    // 检查管理员是否已存在
    let existingAdmin: any

    if (db.type === 'sqlite') {
      existingAdmin = await db.queryOne(
        'SELECT id FROM users WHERE username = ? OR role = ?',
        [DEFAULT_ADMIN.username, 'admin']
      )
    } else {
      const result = await asyncDb!.query(
        'SELECT id FROM users WHERE username = $1 OR role = $2',
        [DEFAULT_ADMIN.username, 'admin']
      )
      existingAdmin = result[0]
    }

    // 生成密码哈希
    const passwordHash = await hashPassword(DEFAULT_ADMIN.password)

    if (existingAdmin) {
      console.log('⚠️  Admin account already exists, updating password...')

      if (db.type === 'sqlite') {
        db.exec(
          'UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1, openclaw_enabled = 1 WHERE username = ? OR role = ?',
          [passwordHash, DEFAULT_ADMIN.username, 'admin']
        )
      } else {
        await asyncDb!.query(
          'UPDATE users SET password_hash = $1, must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = $2 OR role = $3',
          [passwordHash, DEFAULT_ADMIN.username, 'admin']
        )
      }

      console.log('✅ Admin password updated')
    } else {
      if (db.type === 'sqlite') {
        db.exec(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      } else {
        await asyncDb!.query(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE, TRUE)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      }

      console.log('✅ Default admin account created')
      console.log('\n🔑 Admin credentials:')
      console.log(`   Username: ${DEFAULT_ADMIN.username}`)
      console.log(`   Password: ${DEFAULT_ADMIN.password}`)
      console.log(`   Email: ${DEFAULT_ADMIN.email}`)
      console.log('\n⚠️  Security Notice:')
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('   ✅ Using password from DEFAULT_ADMIN_PASSWORD environment variable')
      } else {
        console.log('   ⚠️  Random password generated! Please save it immediately:')
        console.log(`   👉 ${DEFAULT_ADMIN.password}`)
        console.log('   Recommended: Set DEFAULT_ADMIN_PASSWORD in production environment')
      }
    }
  } catch (error) {
    console.error('❌ Failed to create admin account:', error)
    throw error
  }
}

/**
 * 确保管理员账号存在（启动时检查）
 *
 * 与 createDefaultAdmin() 的区别：
 * - createDefaultAdmin: 仅在数据库初始化时调用（PostgreSQL自动初始化）
 * - ensureAdminAccount: 每次启动都调用（SQLite开发环境需要）
 *
 * 行为：
 * - 如果管理员不存在：创建新账号
 * - 如果管理员已存在：更新密码（如果环境变量中配置了新密码）
 */
async function ensureAdminAccount(): Promise<void> {
  console.log('\n👤 Checking admin account...')

  const db = await getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  try {
    // 检查管理员是否已存在
    let existingAdmin: any

    if (db.type === 'sqlite') {
      existingAdmin = await db.queryOne(
        'SELECT id FROM users WHERE username = ? OR role = ?',
        [DEFAULT_ADMIN.username, 'admin']
      )
    } else {
      const result = await asyncDb!.query(
        'SELECT id FROM users WHERE username = $1 OR role = $2',
        [DEFAULT_ADMIN.username, 'admin']
      )
      existingAdmin = result[0]
    }

    // 生成密码哈希
    const passwordHash = await hashPassword(DEFAULT_ADMIN.password)

    if (existingAdmin) {
      // 管理员已存在，检查是否需要更新密码
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('⚠️  Admin account exists, updating password from environment variable...')

        if (db.type === 'sqlite') {
          db.exec(
            'UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1, openclaw_enabled = 1 WHERE username = ? OR role = ?',
            [passwordHash, DEFAULT_ADMIN.username, 'admin']
          )
        } else {
          await asyncDb!.query(
            'UPDATE users SET password_hash = $1, must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = $2 OR role = $3',
            [passwordHash, DEFAULT_ADMIN.username, 'admin']
          )
        }

        console.log('✅ Admin password updated')
      } else {
        // 兜底：即使不更新密码，也确保管理员不被强制修改密码
        if (db.type === 'sqlite') {
          db.exec(
            'UPDATE users SET must_change_password = 0, is_active = 1, openclaw_enabled = 1 WHERE username = ? OR role = ?',
            [DEFAULT_ADMIN.username, 'admin']
          )
        } else {
          await asyncDb!.query(
            'UPDATE users SET must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = $1 OR role = $2',
            [DEFAULT_ADMIN.username, 'admin']
          )
        }
        console.log('✅ Admin account exists (password unchanged)')
      }
    } else {
      // 管理员不存在，创建新账号
      console.log('⚠️  Admin account not found, creating...')

      if (db.type === 'sqlite') {
        db.exec(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      } else {
        await asyncDb!.query(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE, TRUE)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      }

      console.log('✅ Admin account created')
      console.log('\n🔑 Admin credentials:')
      console.log(`   Username: ${DEFAULT_ADMIN.username}`)
      console.log(`   Password: ${DEFAULT_ADMIN.password}`)
      console.log(`   Email: ${DEFAULT_ADMIN.email}`)
      console.log('\n⚠️  Security Notice:')
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('   ✅ Using password from DEFAULT_ADMIN_PASSWORD environment variable')
      } else {
        console.log('   ⚠️  Random password generated! Please save it immediately:')
        console.log(`   👉 ${DEFAULT_ADMIN.password}`)
        console.log('   Recommended: Set DEFAULT_ADMIN_PASSWORD in .env.local')
      }
    }
  } catch (error) {
    console.error('❌ Failed to ensure admin account:', error)
    throw error
  }
}

/**
 * 插入默认系统配置
 */
async function insertDefaultSystemSettings(): Promise<void> {
  console.log('\n⚙️  Inserting default system settings...')

  const db = await getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  const defaultSettings = [
    // Google Ads API配置
    { category: 'google_ads', key: 'login_customer_id', dataType: 'string', isSensitive: false, isRequired: true, description: 'Google Ads Login Customer ID (MCC账户ID)' },
    { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads API Client ID（可选）' },
    { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads API Client Secret（可选）' },
    { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads Developer Token（可选）' },

    // AI配置 - Gemini API模式（支持多服务商）
    { category: 'ai', key: 'gemini_provider', dataType: 'string', isSensitive: false, isRequired: false, description: 'Gemini API 服务商', defaultValue: 'official' },
    { category: 'ai', key: 'gemini_endpoint', dataType: 'string', isSensitive: false, isRequired: false, description: 'Gemini API 端点（系统自动计算）' },
    { category: 'ai', key: 'gemini_api_key', dataType: 'string', isSensitive: true, isRequired: false, description: 'Gemini 官方 API Key' },
    { category: 'ai', key: 'gemini_relay_api_key', dataType: 'string', isSensitive: true, isRequired: false, description: '第三方中转服务 API Key' },
    { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: false, isRequired: false, description: 'AI模型', defaultValue: 'gemini-3-flash-preview' },

    // 代理配置
    { category: 'proxy', key: 'urls', dataType: 'json', isSensitive: false, isRequired: false, description: '代理URL配置列表（JSON格式）' },

    // 系统配置
    { category: 'system', key: 'currency', dataType: 'string', isSensitive: false, isRequired: true, description: '默认货币', defaultValue: 'CNY' },
    { category: 'system', key: 'language', dataType: 'string', isSensitive: false, isRequired: true, description: '系统语言', defaultValue: 'zh-CN' },
    { category: 'system', key: 'sync_interval_hours', dataType: 'number', isSensitive: false, isRequired: true, description: '数据同步间隔(小时)', defaultValue: '4' },
    { category: 'system', key: 'link_check_enabled', dataType: 'boolean', isSensitive: false, isRequired: true, description: '是否启用链接检查', defaultValue: 'true' },
    { category: 'system', key: 'link_check_time', dataType: 'string', isSensitive: false, isRequired: true, description: '链接检查时间', defaultValue: '02:00' },
    { category: 'system', key: 'data_sync_mode', dataType: 'string', isSensitive: false, isRequired: false, description: '手动同步默认模式（incremental/full）', defaultValue: 'incremental' },
  ]

  try {
    for (const setting of defaultSettings) {
      if (db.type === 'sqlite') {
        // 检查配置是否已存在
        const existing = db.queryOne(
          'SELECT id FROM system_settings WHERE category = ? AND key = ? AND user_id IS NULL',
          [setting.category, setting.key]
        )

        if (!existing) {
          db.exec(
            `INSERT INTO system_settings (user_id, category, key, data_type, is_sensitive, is_required, default_value, description)
             VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
            [
              setting.category,
              setting.key,
              setting.dataType,
              setting.isSensitive ? 1 : 0,
              setting.isRequired ? 1 : 0,
              setting.defaultValue || null,
              setting.description,
            ]
          )
        }
      } else {
        // PostgreSQL
        const existing = await asyncDb!.query(
          'SELECT id FROM system_settings WHERE category = $1 AND key = $2 AND user_id IS NULL',
          [setting.category, setting.key]
        )

        if (existing.length === 0) {
          await asyncDb!.query(
            `INSERT INTO system_settings (user_id, category, key, data_type, is_sensitive, is_required, default_value, description)
             VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
            [
              setting.category,
              setting.key,
              setting.dataType,
              setting.isSensitive,
              setting.isRequired,
              setting.defaultValue || null,
              setting.description,
            ]
          )
        }
      }
    }

    console.log(`✅ Inserted ${defaultSettings.length} default settings`)
  } catch (error) {
    console.error('❌ Failed to insert default settings:', error)
    throw error
  }
}

/**
 * 导入管理员配置（从导出文件）
 */
async function importAdminConfig(): Promise<void> {
  // 只在 PostgreSQL 生产环境导入
  const db = await getDatabase()
  if (db.type !== 'postgres') {
    return
  }

  if (!fs.existsSync(CONFIG_EXPORT_PATH)) {
    console.log('\n⏭️  No admin config export file found, skipping import')
    return
  }

  console.log('\n📥 Importing admin configuration...')

  try {
    const exportData = JSON.parse(fs.readFileSync(CONFIG_EXPORT_PATH, 'utf-8'))
    const asyncDb = getDatabase()

    // 查找管理员用户ID
    const adminResult = await asyncDb.query<{ id: number }>(
      'SELECT id FROM users WHERE username = $1 OR role = $2',
      ['autoads', 'admin']
    )

    if (adminResult.length === 0) {
      console.error('❌ Admin user not found, cannot import config')
      return
    }

    const adminUserId = adminResult[0].id

    // 导入配置
    for (const setting of exportData.settings) {
      // 检查配置是否已存在
      const existing = await asyncDb.query(
        'SELECT id FROM system_settings WHERE category = $1 AND key = $2 AND (user_id = $3 OR user_id IS NULL)',
        [setting.category, setting.key, setting.user_id === null ? null : adminUserId]
      )

      if (existing.length > 0) {
        // 更新现有配置
        await asyncDb.query(
          `UPDATE system_settings
           SET value = $1, encrypted_value = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [setting.value, setting.encrypted_value, existing[0].id]
        )
      } else {
        // 插入新配置
        await asyncDb.query(
          `INSERT INTO system_settings (
            user_id, category, key, value, encrypted_value,
            data_type, is_sensitive, is_required, default_value, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            setting.user_id === null ? null : adminUserId,
            setting.category,
            setting.key,
            setting.value,
            setting.encrypted_value,
            setting.data_type,
            setting.is_sensitive === 1,
            setting.is_required === 1,
            setting.default_value,
            setting.description,
          ]
        )
      }
    }

    console.log(`✅ Imported ${exportData.settings.length} admin settings`)
  } catch (error) {
    console.error('❌ Failed to import admin config:', error)
    throw error
  }
}

/**
 * 插入行业基准数据
 */
async function insertIndustryBenchmarks(): Promise<void> {
  console.log('\n📊 Inserting industry benchmarks...')

  const db = await getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  // 行业基准数据（30个二级分类）
  const benchmarks = [
    // E-commerce 电商（6个子类）
    { l1: 'E-commerce', l2: 'Fashion & Apparel', code: 'ecom_fashion', ctr: 2.41, cpc: 0.45, cvr: 2.77 },
    { l1: 'E-commerce', l2: 'Electronics & Gadgets', code: 'ecom_electronics', ctr: 2.04, cpc: 0.68, cvr: 1.91 },
    { l1: 'E-commerce', l2: 'Home & Garden', code: 'ecom_home', ctr: 2.53, cpc: 0.52, cvr: 2.23 },
    { l1: 'E-commerce', l2: 'Health & Beauty', code: 'ecom_beauty', ctr: 2.78, cpc: 0.41, cvr: 3.19 },
    { l1: 'E-commerce', l2: 'Sports & Outdoors', code: 'ecom_sports', ctr: 2.35, cpc: 0.58, cvr: 2.01 },
    { l1: 'E-commerce', l2: 'Food & Beverage', code: 'ecom_food', ctr: 2.67, cpc: 0.38, cvr: 2.85 },

    // Travel 旅游（4个子类）
    { l1: 'Travel', l2: 'Luggage & Travel Gear', code: 'travel_luggage', ctr: 3.18, cpc: 0.95, cvr: 2.47 },
    { l1: 'Travel', l2: 'Hotels & Accommodation', code: 'travel_hotels', ctr: 4.68, cpc: 1.22, cvr: 2.57 },
    { l1: 'Travel', l2: 'Flights & Transportation', code: 'travel_flights', ctr: 4.29, cpc: 0.84, cvr: 2.14 },
    { l1: 'Travel', l2: 'Tours & Activities', code: 'travel_tours', ctr: 3.87, cpc: 0.76, cvr: 3.01 },

    // Technology 科技（4个子类）
    { l1: 'Technology', l2: 'Software & SaaS', code: 'tech_saas', ctr: 2.41, cpc: 3.50, cvr: 3.04 },
    { l1: 'Technology', l2: 'Consumer Electronics', code: 'tech_consumer', ctr: 2.18, cpc: 0.72, cvr: 1.84 },
    { l1: 'Technology', l2: 'B2B Tech Services', code: 'tech_b2b', ctr: 2.09, cpc: 4.21, cvr: 2.58 },
    { l1: 'Technology', l2: 'Mobile Apps', code: 'tech_apps', ctr: 3.24, cpc: 0.52, cvr: 4.12 },

    // Finance 金融（4个子类）
    { l1: 'Finance', l2: 'Banking & Credit', code: 'finance_banking', ctr: 2.91, cpc: 3.77, cvr: 4.19 },
    { l1: 'Finance', l2: 'Insurance', code: 'finance_insurance', ctr: 2.13, cpc: 4.52, cvr: 1.87 },
    { l1: 'Finance', l2: 'Investment & Trading', code: 'finance_investment', ctr: 1.92, cpc: 5.14, cvr: 2.23 },
    { l1: 'Finance', l2: 'Cryptocurrency', code: 'finance_crypto', ctr: 2.47, cpc: 2.89, cvr: 1.56 },

    // Education 教育（3个子类）
    { l1: 'Education', l2: 'Online Courses', code: 'edu_online', ctr: 3.39, cpc: 2.13, cvr: 3.67 },
    { l1: 'Education', l2: 'Academic Programs', code: 'edu_academic', ctr: 2.87, cpc: 3.42, cvr: 2.94 },
    { l1: 'Education', l2: 'Professional Training', code: 'edu_professional', ctr: 2.65, cpc: 2.78, cvr: 3.21 },

    // Healthcare 医疗健康（3个子类）
    { l1: 'Healthcare', l2: 'Medical Services', code: 'health_medical', ctr: 3.12, cpc: 2.89, cvr: 3.78 },
    { l1: 'Healthcare', l2: 'Pharmaceuticals', code: 'health_pharma', ctr: 2.68, cpc: 1.95, cvr: 2.47 },
    { l1: 'Healthcare', l2: 'Wellness & Fitness', code: 'health_wellness', ctr: 3.45, cpc: 0.89, cvr: 3.92 },

    // Automotive 汽车（2个子类）
    { l1: 'Automotive', l2: 'Vehicle Sales', code: 'auto_sales', ctr: 2.14, cpc: 2.46, cvr: 2.53 },
    { l1: 'Automotive', l2: 'Auto Parts & Services', code: 'auto_parts', ctr: 2.67, cpc: 1.24, cvr: 3.14 },

    // Real Estate 房地产（2个子类）
    { l1: 'Real Estate', l2: 'Residential', code: 'realestate_residential', ctr: 2.03, cpc: 1.89, cvr: 1.94 },
    { l1: 'Real Estate', l2: 'Commercial', code: 'realestate_commercial', ctr: 1.87, cpc: 2.67, cvr: 1.72 },

    // Entertainment 娱乐（2个子类）
    { l1: 'Entertainment', l2: 'Gaming', code: 'entertainment_gaming', ctr: 3.56, cpc: 0.47, cvr: 2.87 },
    { l1: 'Entertainment', l2: 'Streaming & Media', code: 'entertainment_media', ctr: 3.21, cpc: 0.65, cvr: 2.34 },
  ]

  try {
    for (const benchmark of benchmarks) {
      if (db.type === 'sqlite') {
        // 使用 INSERT OR IGNORE 避免重复
        db.exec(
          `INSERT OR IGNORE INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [benchmark.l1, benchmark.l2, benchmark.code, benchmark.ctr, benchmark.cpc, benchmark.cvr]
        )
      } else {
        // PostgreSQL: 使用 ON CONFLICT DO NOTHING
        await asyncDb!.query(
          `INSERT INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (industry_code) DO NOTHING`,
          [benchmark.l1, benchmark.l2, benchmark.code, benchmark.ctr, benchmark.cpc, benchmark.cvr]
        )
      }
    }

    console.log(`✅ Inserted ${benchmarks.length} industry benchmarks`)
  } catch (error) {
    console.error('❌ Failed to insert industry benchmarks:', error)
    throw error
  }
}

/**
 * 主初始化函数
 */
export async function initializeDatabase(): Promise<void> {
  const startupBeginAt = Date.now()
  console.log('🔍 Checking database initialization status...')

  async function runStep(stepName: string, fn: () => Promise<void>): Promise<void> {
    const stepStartedAt = Date.now()
    await fn()
    const stepElapsedMs = Date.now() - stepStartedAt
    console.log(`⏱️  ${stepName} 完成 (${stepElapsedMs}ms)`)
  }

  const isInitialized = await isDatabaseInitialized()

  if (isInitialized) {
    console.log('✅ Database already initialized, checking for pending migrations...')
    // 数据库已初始化，执行增量迁移
    await runStep('增量迁移检查', async () => {
      await runPendingMigrations()
    })
    // 🆕 确保管理员账号存在（如果不存在则创建，如果存在则更新密码）
    await runStep('管理员账号检查', async () => {
      await ensureAdminAccount()
    })
    // 检查未完成的队列任务
    await runStep('启动任务清理', async () => {
      await checkUnfinishedQueueTasks()
    })
    // 🆕 初始化队列系统（统一开发和生产环境）
    await runStep('统一队列初始化', async () => {
      await initializeQueueSystem()
    })
    console.log(`✅ 启动初始化完成（总耗时${Date.now() - startupBeginAt}ms）`)
    return
  }

  console.log('⚠️  Database not initialized, starting initialization...\n')

  const db = await getDatabase()

  if (db.type === 'sqlite') {
    await runStep('SQLite初始化', async () => {
      await initializeSQLite()
    })
  } else {
    await runStep('PostgreSQL初始化', async () => {
      await initializePostgreSQL()
    })
  }

  // 初始化完成后也执行迁移（确保所有增量迁移都被应用）
  await runStep('增量迁移检查', async () => {
    await runPendingMigrations()
  })
  // 🆕 初始化队列系统（统一开发和生产环境）
  await runStep('统一队列初始化', async () => {
    await initializeQueueSystem()
  })

  console.log(`✅ 启动初始化完成（总耗时${Date.now() - startupBeginAt}ms）`)
}

/**
 * 初始化队列系统
 *
 * 统一开发和生产环境的队列初始化逻辑
 * 在数据库初始化完成后调用，确保队列系统在服务启动时就绪
 */
async function initializeQueueSystem(): Promise<void> {
  try {
    const { initializeQueue } = await import('./queue/init-queue')
    await initializeQueue()
  } catch (error) {
    console.error('❌ 队列系统初始化失败:', error)
    // 队列初始化失败不应阻止应用启动
    // 队列会在首次使用时通过 ensureStarted() 自动初始化
  }
}

/**
 * 计算文件内容的 MD5 hash
 */
function calculateFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * PostgreSQL: 对齐关键序列，避免因 seed 数据显式 id 导致的主键冲突
 */
async function alignPostgresSequences(): Promise<void> {
  const db = await getDatabase()
  if (db.type !== 'postgres') {
    return
  }

  try {
    await db.query(`
      DO $$
      BEGIN
        IF to_regclass('public.prompt_versions') IS NOT NULL
           AND to_regclass('public.prompt_versions_id_seq') IS NOT NULL THEN
          PERFORM setval(
            'prompt_versions_id_seq',
            (SELECT COALESCE(MAX(id), 1) FROM prompt_versions)
          );
        END IF;
      END $$;
    `)
  } catch (error) {
    console.warn('⚠️ Failed to align PostgreSQL sequences:', error)
  }
}

/**
 * 自动执行增量迁移（支持内容变更检测）
 *
 * 核心功能：
 * 1. 扫描 migrations/ 目录下的所有 .sql 文件
 * 2. 检查 migration_history 表，跳过已执行且内容未变更的迁移
 * 3. 🆕 如果迁移文件内容有变更，重新执行该迁移
 * 4. 按文件名顺序执行未执行的迁移
 * 5. 记录执行结果和文件 hash 到 migration_history 表
 *
 * 迁移文件命名规范：
 * - SQLite: {编号}_{描述}.sql (如 037_add_keywords.sql)
 * - PostgreSQL: {编号}_{描述}.pg.sql (如 037_add_keywords.pg.sql)
 * - 000 开头的是初始化 schema，不参与增量迁移
 */
async function runPendingMigrations(): Promise<void> {
  const db = await getDatabase()

  // PostgreSQL: 迁移前对齐序列，避免 prompt_versions 主键冲突
  await alignPostgresSequences()

  // 🎯 根据数据库类型选择迁移目录
  const migrationsDir = db.type === 'postgres'
    ? path.join(process.cwd(), 'pg-migrations')
    : path.join(process.cwd(), 'migrations')

  console.log(`🔍 Checking migrations in: ${migrationsDir} (DB type: ${db.type})`)

  // 检查迁移目录是否存在
  if (!fs.existsSync(migrationsDir)) {
    console.log('⚠️  Migrations directory not found, skipping migrations')
    return
  }

  // 确保 migration_history 表存在
  await ensureMigrationHistoryTable()

  // 获取所有迁移文件
  const allFiles = fs.readdirSync(migrationsDir)

  // 根据数据库类型选择对应的迁移文件
  const fileExtension = db.type === 'postgres' ? '.pg.sql' : '.sql'
  const excludeExtension = db.type === 'postgres' ? '.sql' : '.pg.sql'

  const migrationFiles = allFiles
    .filter(file => {
      // 排除 README 和其他非 SQL 文件
      if (!file.endsWith('.sql')) return false
      // 排除初始化 schema（000 开头）
      if (file.startsWith('000_')) return false
      // 排除归档目录中的文件
      if (file.includes('archived')) return false
      // PostgreSQL: 只选择 .pg.sql 文件
      if (db.type === 'postgres') {
        return file.endsWith('.pg.sql')
      }
      // SQLite: 排除 .pg.sql 文件，选择普通 .sql 文件
      return !file.endsWith('.pg.sql')
    })
    .sort() // 按文件名排序

  if (migrationFiles.length === 0) {
    console.log('📋 No migration files found')
    return
  }

  // 获取已执行的迁移（含 hash）
  const executedMigrations = await getExecutedMigrations()

  // 分类迁移文件：新文件 vs 内容变更
  const pendingMigrations: Array<{ file: string; reason: 'new' | 'changed' }> = []

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const currentHash = calculateFileHash(content)

    if (!executedMigrations.has(file)) {
      // 新迁移文件
      pendingMigrations.push({ file, reason: 'new' })
    } else {
      // 检查内容是否变更
      const recordedHash = executedMigrations.get(file)
      if (recordedHash && recordedHash !== currentHash) {
        pendingMigrations.push({ file, reason: 'changed' })
      }
    }
  }

  if (pendingMigrations.length === 0) {
    console.log('✅ All migrations are up to date')
    return
  }

  // 统计并显示待执行的迁移
  const newMigrations = pendingMigrations.filter(m => m.reason === 'new')
  const changedMigrations = pendingMigrations.filter(m => m.reason === 'changed')

  console.log(`\n📦 Found ${pendingMigrations.length} migrations to execute:`)
  if (newMigrations.length > 0) {
    console.log(`   🆕 New: ${newMigrations.length}`)
    newMigrations.forEach(m => console.log(`      - ${m.file}`))
  }
  if (changedMigrations.length > 0) {
    console.log(`   🔄 Changed: ${changedMigrations.length}`)
    changedMigrations.forEach(m => console.log(`      - ${m.file}`))
  }
  console.log('')

  // 执行每个迁移
  let successCount = 0
  let failCount = 0

  for (const { file: migrationFile, reason } of pendingMigrations) {
    const filePath = path.join(migrationsDir, migrationFile)
    const sqlContent = fs.readFileSync(filePath, 'utf-8')
    const fileHash = calculateFileHash(sqlContent)

    const reasonIcon = reason === 'new' ? '🆕' : '🔄'
    console.log(`${reasonIcon} Executing: ${migrationFile}`)

    try {
      await executeMigration(migrationFile, sqlContent)
      await recordMigration(migrationFile, fileHash)
      console.log(`✅ Completed: ${migrationFile}`)
      successCount++
    } catch (error) {
      console.error(`❌ Failed: ${migrationFile}`)
      console.error(`   Error:`, error instanceof Error ? error.message : error)
      failCount++
      // 继续执行其他迁移，不中断流程
      // 但记录错误，让运维人员知道需要手动处理
    }
  }

  console.log(`\n📊 Migration summary:`)
  console.log(`   ✅ Success: ${successCount}`)
  if (failCount > 0) {
    console.log(`   ❌ Failed: ${failCount}`)
    console.log(`   ⚠️  Please check failed migrations and fix manually`)
  }
}

/**
 * 确保 migration_history 表存在（含 file_hash 列）
 */
async function ensureMigrationHistoryTable(): Promise<void> {
  const db = await getDatabase()

  if (db.type === 'sqlite') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        file_hash TEXT,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    // 添加 file_hash 列（如果不存在）
    const columns = await db.query<{ name: string }>(`PRAGMA table_info(migration_history)`)
    const hasFileHash = columns.some(col => col.name === 'file_hash')
    if (!hasFileHash) {
      await db.exec(`ALTER TABLE migration_history ADD COLUMN file_hash TEXT`)
    }
  } else {
    await db.query(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        migration_name TEXT NOT NULL UNIQUE,
        file_hash TEXT,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    // 添加 file_hash 列（如果不存在）
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'migration_history' AND column_name = 'file_hash'
        ) THEN
          ALTER TABLE migration_history ADD COLUMN file_hash TEXT;
        END IF;
      END $$;
    `)
  }
}

/**
 * 获取已执行的迁移列表（含 file_hash）
 */
async function getExecutedMigrations(): Promise<Map<string, string | null>> {
  const db = await getDatabase()
  const executed = new Map<string, string | null>()

  try {
    // 注意：db.query() 返回 Promise<T[]>，需要 await
    const results = await db.query<{ migration_name: string; file_hash: string | null }>(
      'SELECT migration_name, file_hash FROM migration_history'
    )

    // 存储迁移名称和对应的hash
    results.forEach(row => {
      const name = row.migration_name
      executed.set(name, row.file_hash)
      // 标准化：同时添加基础名称（去除 .sql 和 .pg.sql 后缀）
      const baseName = name.replace(/\.(pg\.)?sql$/, '')
      if (baseName !== name) {
        executed.set(baseName, row.file_hash)
        executed.set(baseName + '.sql', row.file_hash)
        executed.set(baseName + '.pg.sql', row.file_hash)
      } else {
        executed.set(name + '.sql', row.file_hash)
        executed.set(name + '.pg.sql', row.file_hash)
      }
    })
  } catch (error) {
    // 表可能不存在，返回空集合
    console.error('⚠️ Failed to get executed migrations:', error)
  }

  return executed
}

/**
 * SQLite 单条语句执行（区分 query / exec）
 */
async function executeSingleSqliteStatement(db: Awaited<ReturnType<typeof getDatabase>>, stmt: string): Promise<void> {
  if (/^SELECT\b/i.test(stmt)) {
    await db.query(stmt)
    return
  }

  if (/^PRAGMA\b/i.test(stmt)) {
    try {
      await db.query(stmt)
    } catch (pragmaError) {
      const pragmaMsg = pragmaError instanceof Error ? pragmaError.message : String(pragmaError)
      if (pragmaMsg.includes('does not return data')) {
        await db.exec(stmt)
      } else {
        throw pragmaError
      }
    }
    return
  }

  await db.exec(stmt)
}

function isSqliteAddColumnIfNotExistsSyntaxError(stmt: string, errorMsg: string): boolean {
  return (
    /\bALTER\s+TABLE\b/i.test(stmt) &&
    /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(stmt) &&
    /near\s+["']EXISTS["']\s*:\s*syntax error/i.test(errorMsg)
  )
}

function rewriteSqliteAddColumnIfNotExists(stmt: string): string {
  return stmt.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i, 'ADD COLUMN')
}

/**
 * 执行单个迁移
 */
async function executeMigration(name: string, sql: string): Promise<void> {
  const db = await getDatabase()

  // 分割多个 SQL 语句（按分号分割，但忽略字符串中的分号）
  const statements = splitSqlStatements(sql)

  if (db.type === 'sqlite') {
    // SQLite: 逐条执行
    // 注意：部分迁移会临时关闭 foreign_keys。若迁移失败且未恢复，会影响后续迁移与运行期行为。
    // 这里在 finally 中强制恢复，避免“失败后 foreign_keys 仍为 OFF”的隐性状态。
    try {
      for (let stmtIndex = 0; stmtIndex < statements.length; stmtIndex++) {
        const stmt = statements[stmtIndex]
        const trimmedStmt = stmt.trim()
        if (trimmedStmt) {
          let stmtForExecution = trimmedStmt
          try {
            try {
              // SQLite：区分“返回结果的查询”与“无返回的语句”
              // - SELECT 一定返回结果集（可能为空）
              // - PRAGMA 既可能返回结果（如 PRAGMA table_info），也可能仅设置参数（如 PRAGMA foreign_keys=ON）
              await executeSingleSqliteStatement(db, stmtForExecution)
            } catch (firstError) {
              const firstErrorMsg = firstError instanceof Error ? firstError.message : String(firstError)
              if (!isSqliteAddColumnIfNotExistsSyntaxError(stmtForExecution, firstErrorMsg)) {
                throw firstError
              }

              // 兼容旧版 SQLite：不支持 ADD COLUMN IF NOT EXISTS，回退为 ADD COLUMN，
              // 若列已存在会进入幂等错误分支被跳过。
              stmtForExecution = rewriteSqliteAddColumnIfNotExists(stmtForExecution)
              console.log(`   🔧 Rewritten for SQLite compatibility: ${stmtForExecution.substring(0, 80)}...`)
              try {
                await executeSingleSqliteStatement(db, stmtForExecution)
              } catch (retryError) {
                throw retryError
              }
            }
          } catch (error) {
            // 忽略 "column already exists" 等幂等性错误
            const errorMsg = error instanceof Error ? error.message : String(error)
            const isPromptVersionsUniqueConflict =
              errorMsg.includes('UNIQUE constraint failed: prompt_versions.prompt_id, prompt_versions.version') &&
              (/\bINSERT\s+INTO\s+prompt_versions\b/i.test(stmtForExecution) ||
                /\bUPDATE\s+prompt_versions\b/i.test(stmtForExecution))

            const isIdempotentError =
              errorMsg.includes('duplicate column name') ||
              errorMsg.includes('already exists') ||
              isPromptVersionsUniqueConflict

            if (!isIdempotentError) {
              const context =
                `${name}: statement ${stmtIndex + 1}/${statements.length} failed\n` +
                `${stmtForExecution.substring(0, 500)}${stmtForExecution.length > 500 ? '...' : ''}\n` +
                `Error: ${errorMsg}`
              throw new Error(context)
            }

            const reason = isPromptVersionsUniqueConflict ? 'prompt version already exists' : 'already exists'
            console.log(`   ⏭️  Skipped (${reason}): ${stmtForExecution.substring(0, 60)}...`)
          }
        }
      }
    } finally {
      try {
        await db.exec('PRAGMA foreign_keys = ON')
      } catch {
        // ignore
      }
    }
  } else {
    // PostgreSQL: 使用事务
    const rawSql = (db as any).getRawConnection()
    await rawSql.begin(async (tx: any) => {
      for (const stmt of statements) {
        if (!stmt.trim()) {
          continue
        }

        try {
          // 使用 SAVEPOINT 避免“已忽略错误导致事务中断”
          await tx.savepoint(async (sp: any) => {
            await sp.unsafe(stmt)
          })
        } catch (error) {
          // 忽略 "column already exists" 和 "duplicate key" 等幂等性错误
          const errorMsg = error instanceof Error ? error.message : String(error)
          if (
            errorMsg.includes('already exists') ||
            errorMsg.includes('duplicate key value violates unique constraint')
          ) {
            console.log(`   ⏭️  Skipped (already exists): ${stmt.substring(0, 60)}...`)
            // 不抛出异常，继续执行下一条语句
          } else {
            throw error
          }
        }
      }
    })
  }
}

/**
 * 记录迁移执行历史（含 file_hash）
 */
async function recordMigration(name: string, fileHash: string): Promise<void> {
  const db = await getDatabase()

  if (db.type === 'sqlite') {
    // 先尝试更新（如果存在），否则插入
    await db.exec(
      `INSERT INTO migration_history (migration_name, file_hash, executed_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(migration_name) DO UPDATE SET
         file_hash = excluded.file_hash,
         executed_at = datetime('now')`,
      [name, fileHash]
    )
  } else {
    await db.query(
      `INSERT INTO migration_history (migration_name, file_hash)
       VALUES ($1, $2)
       ON CONFLICT (migration_name) DO UPDATE SET
         file_hash = EXCLUDED.file_hash,
         executed_at = CURRENT_TIMESTAMP`,
      [name, fileHash]
    )
  }
}

// 全局标记：是否需要恢复队列任务（声明在全局作用域）
declare global {
  // eslint-disable-next-line no-var
  var __queueRecoveryPending: boolean | undefined
  // eslint-disable-next-line no-var
  var __queueRecoveryData: Array<{
    id: number | string
    user_id: number
    url?: string
    brand?: string | null
    task_type?: string
    status: string
    retry_count?: number
    offer_id?: number
    data?: any
  }> | undefined
}

/**
 * 检查未完成的队列任务
 *
 * 场景：服务重启时，内存队列中的任务会丢失
 * 解决：Redis优先恢复scrape任务，如果Redis不可用则从数据库恢复
 *
 * 恢复策略：
 * 1. Redis优先：从Redis队列读取pending/running状态的scrape任务
 * 2. 数据库回退：从offers表查询scrape_status为pending/in_progress的记录
 *
 * 注意：这里只做查询，实际恢复在首次API请求时触发
 * 原因：instrumentation阶段无法安全导入复杂模块（offer-scraping有复杂依赖）
 *
 * 恢复执行：由 @/lib/queue-recovery.ts 的 executeQueueRecoveryIfNeeded() 函数完成
 *
 * 🔥 KISS优化：避免任务堆积导致启动卡住
 * - 启动时清理过期任务（超过1小时）而非恢复
 * - 限制恢复数量（最多50个最近任务）
 * - 过期任务直接从Redis删除，不再尝试恢复
 */
async function checkUnfinishedQueueTasks(): Promise<void> {
  const db = await getDatabase()

  try {
    console.log('🔄 启动清理：清空所有未完成任务...')

    // 🔥 启动时清空所有未完成任务
    // 理由：
    // 1. 队列恢复功能已禁用，未完成任务无法恢复
    // 2. Redis是唯一真相来源，数据库pending/running状态已无效
    // 3. 应用重启时，running任务已失败，不应重试
    // 4. 避免状态不一致和僵尸任务
    // 5. 用户可以重新提交任务（成本低）

    // 1. 清空Redis中的所有未完成任务（pending + running僵尸任务）
    let redisClearedCount = 0
    try {
      const redisCleanup = await clearRedisAllUnfinishedTasks()
      redisClearedCount = redisCleanup.clearedCount
      if (redisClearedCount > 0 || redisCleanup.details.userQueuesCleared > 0) {
        console.log(`  ✅ Redis: 已清空 ${redisClearedCount} 个未完成任务`)
      } else {
        console.log(`  ✅ Redis: 队列状态正常，无需清理`)
      }
    } catch (error) {
      console.warn('  ⚠️ Redis清理失败（非关键错误）:', error)
    }

    // 2. 清空数据库中的pending/running任务（保留completed/failed历史）
    // 🔥 新增：检查offer_tasks表是否存在，避免在数据库未初始化时报错
    let dbClearedCount = 0
    try {
      // 检查offer_tasks表是否存在
      let tableExists = false
      if (db.type === 'sqlite') {
        const result = await db.query<{ count: number }>(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='offer_tasks'"
        )
        tableExists = result[0].count > 0
      } else {
        // PostgreSQL
        const result = await db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'offer_tasks')"
        )
        tableExists = result[0].exists
      }

      if (!tableExists) {
        console.log('  ℹ️  数据库: offer_tasks表不存在，跳过清理')
      } else {
        // 表存在，执行清理
        if (db.type === 'sqlite') {
          const result = await db.exec(`
            DELETE FROM offer_tasks
            WHERE status IN ('pending', 'running')
          `)
          dbClearedCount = result.changes
        } else {
          // PostgreSQL
          const result = await db.query(`
            DELETE FROM offer_tasks
            WHERE status IN ('pending', 'running')
          `)
          dbClearedCount = result.length
        }
        if (dbClearedCount > 0) {
          console.log(`  ✅ 数据库: 已清空 ${dbClearedCount} 个未完成任务`)
        }
      }
    } catch (error) {
      console.warn('  ⚠️ 数据库清理失败（非关键错误）:', error)
    }

    // 3. 清空全局恢复标志
    global.__queueRecoveryPending = false
    global.__queueRecoveryData = []

    console.log('✅ 启动清理完成：系统状态已重置，用户可重新提交任务')
  } catch (error) {
    console.error('❌ 启动清理失败:', error)
  }
}

/* 以下代码已废弃，保留供参考
async function checkUnfinishedQueueTasks_deprecated(): Promise<void> {
  const db = await getDatabase()
  if (db.type !== 'sqlite') return

  try {
    const { recentTasks, expiredCount, orphanedCount } = await cleanupAndRecoverFromRedis()

    if (recentTasks.length > 0) {
      const runningCount = recentTasks.filter(t => t.status === 'running').length
      const pendingCount = recentTasks.filter(t => t.status === 'pending').length

      console.log(`📋 队列恢复：发现 ${recentTasks.length} 个最近任务待恢复`)
      console.log(`   - running: ${runningCount}`)
      console.log(`   - pending: ${pendingCount}`)
      console.log(`   (将在首次API请求时自动恢复)`)

      // 存储待恢复数据到全局变量
      global.__queueRecoveryPending = true
      global.__queueRecoveryData = recentTasks.map(t => {
        // 根据任务数据的实际内容判断正确的任务类型
        let taskType = 'scrape' // 默认类型
        if (t.data?.affiliateLink || t.data?.affiliate_link) {
          taskType = 'offer-extraction'
        } else if (t.data?.taskType || t.data?.batchId) {
          taskType = t.data.taskType || 'batch-task'
        }
        // 如果没有匹配的类型，保持默认的 'scrape'

        return {
          id: t.id,
          user_id: t.userId,
          status: t.status,
          task_type: taskType,
          // 保留原始数据用于后续处理
          data: t.data,
          // 为scrape任务保留url和brand字段
          ...(taskType === 'scrape' && {
            url: t.data?.url,
            brand: t.data?.brand
          }),
          // 为offer-extraction任务保留affiliate_link字段
          ...(taskType === 'offer-extraction' && {
            affiliate_link: t.data?.affiliateLink || t.data?.affiliate_link,
            target_country: t.data?.targetCountry || t.data?.target_country
          })
        }
      })
      return
    }

    // 数据库回退恢复：从offers表查询未完成的scrape任务
    const unfinishedOffers = await db.query<{
      id: number
      user_id: number
      url: string
      brand: string | null
      scrape_status: string
      created_at: string
    }>(`
      SELECT id, user_id, url, brand, scrape_status, created_at
      FROM offers
      WHERE scrape_status IN ('pending', 'in_progress')
        AND created_at > datetime('now', '-7 days')
        AND deleted_at IS NULL
      ORDER BY
        CASE scrape_status
          WHEN 'in_progress' THEN 1
          WHEN 'pending' THEN 2
        END,
        created_at ASC
    `)

    // 查询未完成的offer_tasks（Offer提取任务）
    const unfinishedOfferTasks = await db.query<{
      id: string
      user_id: number
      status: string
      affiliate_link: string
      target_country: string
      skip_cache: number
      skip_warmup: number
      batch_id: string | null
      created_at: string
    }>(`
      SELECT id, user_id, status, affiliate_link, target_country, skip_cache, skip_warmup, batch_id, created_at
      FROM offer_tasks
      WHERE status IN ('pending', 'running')
        AND created_at > datetime('now', '-7 days')
      ORDER BY
        CASE status
          WHEN 'running' THEN 1
          WHEN 'pending' THEN 2
        END,
        created_at ASC
    `)

    // 查询未完成的batch_tasks（批量任务）
    // 🔧 2025-12-23: 先检查表是否存在，避免SQLite/PostgreSQL未初始化错误
    let unfinishedBatchTasks: any[] = []
    try {
      // 检查batch_tasks表是否存在（支持SQLite和PostgreSQL）
      let tableCheck: any
      if (db.type === 'sqlite') {
        tableCheck = await db.query<{ count: number }>(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='batch_tasks'"
        )
      } else {
        tableCheck = await db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          ['batch_tasks']
        )
        tableCheck = { count: tableCheck[0].exists ? 1 : 0 }
      }

      if (tableCheck[0].count > 0) {
        // 表存在，查询数据
        unfinishedBatchTasks = await db.query<{
          id: string
          user_id: number
          task_type: string
          status: string
          total_count: number
          completed_count: number
          failed_count: number
          source_file: string | null
          metadata: string | null
          created_at: string
        }>(`
          SELECT id, user_id, task_type, status, total_count, completed_count, failed_count, source_file, metadata, created_at
          FROM batch_tasks
          WHERE status IN ('pending', 'running', 'partial')
            AND created_at > datetime('now', '-7 days')
          ORDER BY
            CASE status
              WHEN 'running' THEN 1
              WHEN 'partial' THEN 2
              WHEN 'pending' THEN 3
            END,
            created_at ASC
        `)
      } else {
        console.log('⚠️ batch_tasks表不存在，跳过批量任务恢复检查')
      }
    } catch (batchError) {
      console.warn('⚠️ 检查batch_tasks表失败（非关键错误）:', batchError)
      // 继续执行，不中断初始化
    }

    const totalUnfinished = unfinishedOffers.length + unfinishedOfferTasks.length + unfinishedBatchTasks.length

    if (totalUnfinished === 0) {
      console.log('✅ 队列恢复：没有未完成的任务需要恢复')
      global.__queueRecoveryPending = false
      return
    }

    // 统计信息
    const scrapeInProgress = unfinishedOffers.filter(o => o.scrape_status === 'in_progress').length
    const scrapePending = unfinishedOffers.filter(o => o.scrape_status === 'pending').length

    const offerTasksRunning = unfinishedOfferTasks.filter(t => t.status === 'running').length
    const offerTasksPending = unfinishedOfferTasks.filter(t => t.status === 'pending').length

    const batchTasksRunning = unfinishedBatchTasks.filter(t => t.status === 'running').length
    const batchTasksPartial = unfinishedBatchTasks.filter(t => t.status === 'partial').length
    const batchTasksPending = unfinishedBatchTasks.filter(t => t.status === 'pending').length

    console.log(`📋 队列恢复：从数据库发现 ${totalUnfinished} 个未完成任务`)
    if (unfinishedOffers.length > 0) {
      console.log(`   [scrape] ${unfinishedOffers.length} 个: running=${scrapeInProgress}, pending=${scrapePending}`)
    }
    if (unfinishedOfferTasks.length > 0) {
      console.log(`   [offer-extraction] ${unfinishedOfferTasks.length} 个: running=${offerTasksRunning}, pending=${offerTasksPending}`)
    }
    if (unfinishedBatchTasks.length > 0) {
      console.log(`   [batch-tasks] ${unfinishedBatchTasks.length} 个: running=${batchTasksRunning}, partial=${batchTasksPartial}, pending=${batchTasksPending}`)
    }
    console.log(`   (将在首次API请求时自动恢复)`)

    // 存储待恢复数据到全局变量
    global.__queueRecoveryPending = true
    global.__queueRecoveryData = [
      // Scrape任务
      ...unfinishedOffers.map(o => ({
        id: o.id,
        user_id: o.user_id,
        url: o.url,
        brand: o.brand,
        status: o.scrape_status === 'in_progress' ? 'running' : 'pending',
        task_type: 'scrape'
      })),
      // Offer提取任务
      ...unfinishedOfferTasks.map(t => ({
        id: t.id,
        user_id: t.user_id,
        status: t.status,
        task_type: 'offer-extraction',
        affiliate_link: t.affiliate_link,
        target_country: t.target_country,
        skip_cache: t.skip_cache,
        skip_warmup: t.skip_warmup,
        batch_id: t.batch_id
      })),
      // 批量任务
      ...unfinishedBatchTasks.map(b => ({
        id: b.id,
        user_id: b.user_id,
        status: b.status,
        task_type: b.task_type, // 'offer-creation', 'offer-scrape', 'offer-enhance'
        total_count: b.total_count,
        completed_count: b.completed_count,
        failed_count: b.failed_count,
        source_file: b.source_file,
        metadata: b.metadata
      }))
    ]
  } catch (error) {
    console.error('❌ 检查队列任务失败:', error)
    global.__queueRecoveryPending = false
  }
}
*/

/**
 * 清空Redis中的所有未完成任务
 *
 * 🔥 全面清理策略（解决僵尸任务问题）：
 * 1. 使用正确的key prefix (autoads:queue:)
 * 2. 清空所有pending队列
 * 3. 清空running集合（关键：服务重启后所有running任务都是僵尸）
 * 4. 清空用户相关队列
 * 5. 从tasks hash中删除未完成任务的详情
 * 6. 保留completed和failed作为历史记录
 */
async function clearRedisAllUnfinishedTasks(): Promise<{
  clearedCount: number
  details: {
    pendingCleared: number
    runningCleared: number
    userQueuesCleared: number
  }
}> {
  async function scanKeysByPattern(redisClient: any, pattern: string, scanCount = 200): Promise<string[]> {
    const matched: string[] = []
    let cursor = '0'

    do {
      const [nextCursor, batch] = await redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        scanCount
      )
      cursor = String(nextCursor)
      if (Array.isArray(batch) && batch.length > 0) {
        matched.push(...batch)
      }
    } while (cursor !== '0')

    return matched
  }

  try {
    const redisClient = await getRedisClient()
    if (!redisClient) {
      return {
        clearedCount: 0,
        details: { pendingCleared: 0, runningCleared: 0, userQueuesCleared: 0 }
      }
    }

    // 🔥 关键修复：使用与UnifiedQueueManager一致的key prefix
    const redisKeyPrefix = process.env.REDIS_KEY_PREFIX || 'autoads:queue:'

    let pendingCleared = 0
    let runningCleared = 0
    let userQueuesCleared = 0

    // 1. 获取所有pending任务ID
    const pendingTaskIds = await redisClient.zrange(`${redisKeyPrefix}pending:all`, 0, -1)
    pendingCleared = pendingTaskIds.length

    // 2. 获取所有running任务ID（🔥 关键：这些都是僵尸任务）
    const runningTaskIds = await redisClient.smembers(`${redisKeyPrefix}running`)
    runningCleared = runningTaskIds.length

    // 3. 获取所有用户pending队列
    const userPendingKeys = await scanKeysByPattern(redisClient, `${redisKeyPrefix}user:*:pending`)
    userQueuesCleared = userPendingKeys.length

    const allTaskIds = [...new Set([...pendingTaskIds, ...runningTaskIds])]  // 去重

    // 使用pipeline批量删除，提高效率
    const pipeline = redisClient.pipeline()

    // 4. 删除所有类型的pending队列
    const taskTypes = [
      'scrape',
      'offer-extraction',
      'batch-offer-creation',
      'offer-creation',
      'offer-scrape',
      'offer-enhance',
      'sync',
      'ai-analysis',
      'backup',
      'export',
      'email',
      'link-check',
      'cleanup'
    ]
    for (const taskType of taskTypes) {
      pipeline.del(`${redisKeyPrefix}pending:${taskType}`)
    }

    // 5. 删除全局pending队列
    pipeline.del(`${redisKeyPrefix}pending:all`)

    // 6. 🔥 关键：删除running集合（清除所有僵尸任务）
    pipeline.del(`${redisKeyPrefix}running`)

    // 7. 删除所有用户pending队列
    for (const userKey of userPendingKeys) {
      pipeline.del(userKey)
    }

    // 8. 从tasks hash中删除所有未完成任务的详情
    for (const taskId of allTaskIds) {
      pipeline.hdel(`${redisKeyPrefix}tasks`, taskId)
    }

    await pipeline.exec()

    const clearedCount = allTaskIds.length

    // 输出详细清理日志
    if (clearedCount > 0 || userQueuesCleared > 0) {
      console.log(`  📊 Redis清理详情:`)
      console.log(`     - pending任务: ${pendingCleared}`)
      console.log(`     - running任务(僵尸): ${runningCleared}`)
      console.log(`     - 用户队列: ${userQueuesCleared}`)
    }

    return {
      clearedCount,
      details: { pendingCleared, runningCleared, userQueuesCleared }
    }
  } catch (error) {
    console.error('❌ Redis清空失败:', error)
    return {
      clearedCount: 0,
      details: { pendingCleared: 0, runningCleared: 0, userQueuesCleared: 0 }
    }
  }
}

/**
 * 清理Redis中的过期任务（不恢复）- 已废弃
 *
 * @deprecated 已由 clearRedisAllUnfinishedTasks() 替代
 */
const TASK_EXPIRY_MS = 60 * 60 * 1000  // 1小时过期

async function cleanupRedisExpiredTasks(): Promise<{
  expiredCount: number
  orphanedCount: number
}> {
  try {
    const redisClient = await getRedisClient()
    if (!redisClient) {
      return { expiredCount: 0, orphanedCount: 0 }
    }

    const redisKeyPrefix = process.env.REDIS_KEY_PREFIX || 'autoads:queue:'
    const taskTypes = ['scrape', 'offer-extraction', 'offer-creation', 'offer-scrape', 'offer-enhance']
    const now = Date.now()
    const expiryThreshold = now - TASK_EXPIRY_MS

    let expiredCount = 0
    let orphanedCount = 0

    // 获取数据库连接，用于检查Offer是否存在
    const db = await getDatabase()

    // 清理每个任务类型的pending队列
    for (const taskType of taskTypes) {
      const pendingKey = `${redisKeyPrefix}pending:${taskType}`
      const taskIds = await redisClient.zrange(pendingKey, 0, -1)

      for (const taskId of taskIds) {
        const taskJson = await redisClient.hget(`${redisKeyPrefix}tasks`, taskId)
        if (taskJson) {
          const task = JSON.parse(taskJson)
          const createdAt = task.createdAt || task.data?.createdAt || 0

          // 检查是否过期
          if (createdAt > 0 && createdAt < expiryThreshold) {
            await redisClient.zrem(pendingKey, taskId)
            await redisClient.hdel(`${redisKeyPrefix}tasks`, taskId)
            expiredCount++
            continue
          }

          // 检查关联的Offer是否已删除
          const offerId = task.data?.offerId || task.data?.offer_id
          if (offerId) {
            const offerExists = await checkOfferExists(db, offerId)
            if (!offerExists) {
              await redisClient.zrem(pendingKey, taskId)
              await redisClient.hdel(`${redisKeyPrefix}tasks`, taskId)
              orphanedCount++
            }
          }
        }
      }
    }

    // 清理running集合中的过期任务
    const runningTaskIds = await redisClient.smembers(`${redisKeyPrefix}running`)
    for (const taskId of runningTaskIds) {
      const taskJson = await redisClient.hget(`${redisKeyPrefix}tasks`, taskId)
      if (taskJson) {
        const task = JSON.parse(taskJson)
        const createdAt = task.createdAt || task.data?.createdAt || 0

        if (createdAt > 0 && createdAt < expiryThreshold) {
          await redisClient.srem(`${redisKeyPrefix}running`, taskId)
          await redisClient.hdel(`${redisKeyPrefix}tasks`, taskId)
          expiredCount++
        }
      }
    }

    return { expiredCount, orphanedCount }
  } catch (error) {
    console.error('❌ Redis清理失败:', error)
    return { expiredCount: 0, orphanedCount: 0 }
  }
}

/**
 * 🔥 KISS优化：清理过期任务并恢复最近任务（已废弃）
 *
 * 策略：
 * 1. 超过1小时的任务视为过期，直接从Redis删除
 * 2. 最多恢复50个最近的任务，避免启动时卡住
 * 3. 过期任务不再尝试恢复，减少资源浪费
 * 4. 关联Offer已删除的任务不恢复
 *
 * @deprecated 队列恢复功能已禁用，保留此函数供参考
 */
const MAX_RECOVERY_TASKS = 50          // 最多恢复50个任务

async function cleanupAndRecoverFromRedis(): Promise<{
  recentTasks: Array<{ id: string; userId: number; status: string; data: any; createdAt?: number }>
  expiredCount: number
  orphanedCount: number
}> {
  try {
    const redisClient = await getRedisClient()
    if (!redisClient) {
      console.log('⚠️ Redis未配置，跳过Redis恢复')
      return { recentTasks: [], expiredCount: 0, orphanedCount: 0 }
    }

    const redisKeyPrefix = process.env.REDIS_KEY_PREFIX || 'autoads:queue:'
    const taskTypes = ['scrape', 'offer-extraction', 'offer-creation', 'offer-scrape', 'offer-enhance']
    const now = Date.now()
    const expiryThreshold = now - TASK_EXPIRY_MS

    const allTasks: Array<{
      id: string
      userId: number
      status: string
      data: any
      createdAt: number
    }> = []
    const expiredTaskIds: string[] = []
    const orphanedTaskIds: string[] = []  // 关联Offer已删除的任务

    // 获取数据库连接，用于检查Offer是否存在
    const db = await getDatabase()

    // 从每个任务类型的队列中读取
    for (const taskType of taskTypes) {
      try {
        const pendingKey = `${redisKeyPrefix}pending:${taskType}`
        const taskIds = await redisClient.zrange(pendingKey, 0, -1)

        for (const taskId of taskIds) {
          try {
            const taskJson = await redisClient.hget(`${redisKeyPrefix}tasks`, taskId)
            if (taskJson) {
              const task = JSON.parse(taskJson)
              const createdAt = task.createdAt || task.data?.createdAt || 0

              // 检查是否过期
              if (createdAt > 0 && createdAt < expiryThreshold) {
                expiredTaskIds.push(taskId)
                await redisClient.zrem(pendingKey, taskId)
                continue
              }

              // 检查关联的Offer是否已删除
              const offerId = task.data?.offerId || task.data?.offer_id
              if (offerId) {
                const offerExists = await checkOfferExists(db, offerId)
                if (!offerExists) {
                  orphanedTaskIds.push(taskId)
                  await redisClient.zrem(pendingKey, taskId)
                  continue
                }
              }

              allTasks.push({
                id: task.id || taskId,
                userId: task.userId || 0,
                status: task.status || 'pending',
                createdAt: createdAt || now,
                data: { type: task.type, ...task.data }
              })
            }
          } catch (parseError) {
            console.warn(`⚠️ 解析Redis任务失败: ${taskId}`)
            expiredTaskIds.push(taskId)
          }
        }
      } catch (error) {
        console.warn(`⚠️ 从Redis读取${taskType}任务失败:`, error)
      }
    }

    // 检查running集合
    try {
      const runningTaskIds = await redisClient.smembers(`${redisKeyPrefix}running`)
      for (const taskId of runningTaskIds) {
        const taskJson = await redisClient.hget(`${redisKeyPrefix}tasks`, taskId)
        if (taskJson) {
          const task = JSON.parse(taskJson)
          const createdAt = task.createdAt || task.data?.createdAt || 0

          if (createdAt > 0 && createdAt < expiryThreshold) {
            expiredTaskIds.push(taskId)
            await redisClient.srem(`${redisKeyPrefix}running`, taskId)
            continue
          }

          // 检查关联的Offer是否已删除
          const offerId = task.data?.offerId || task.data?.offer_id
          if (offerId) {
            const offerExists = await checkOfferExists(db, offerId)
            if (!offerExists) {
              orphanedTaskIds.push(taskId)
              await redisClient.srem(`${redisKeyPrefix}running`, taskId)
              continue
            }
          }

          allTasks.push({
            id: task.id || taskId,
            userId: task.userId || 0,
            status: 'running',
            createdAt: createdAt || now,
            data: { type: task.type, ...task.data }
          })
        }
      }
    } catch (error) {
      console.warn('⚠️ 从Redis读取running任务失败:', error)
    }

    // 清理过期和孤立任务的详情数据
    const allCleanupIds = [...expiredTaskIds, ...orphanedTaskIds]
    if (allCleanupIds.length > 0) {
      try {
        await redisClient.hdel(`${redisKeyPrefix}tasks`, ...allCleanupIds)
      } catch (error) {
        console.warn('⚠️ 清理任务详情失败:', error)
      }
    }

    // 按创建时间排序，只保留最近的任务
    allTasks.sort((a, b) => b.createdAt - a.createdAt)
    const recentTasks = allTasks.slice(0, MAX_RECOVERY_TASKS)

    // 如果有超出限制的任务，也标记为过期清理
    if (allTasks.length > MAX_RECOVERY_TASKS) {
      const extraTasks = allTasks.slice(MAX_RECOVERY_TASKS)
      console.log(`⚠️ 任务数量超出限制，额外丢弃 ${extraTasks.length} 个旧任务`)
    }

    if (recentTasks.length > 0) {
      const taskTypeCount: Record<string, number> = {}
      recentTasks.forEach(t => {
        const type = t.data?.type || 'unknown'
        taskTypeCount[type] = (taskTypeCount[type] || 0) + 1
      })
      console.log(`✅ 队列恢复：找到 ${recentTasks.length} 个有效任务`)
      Object.entries(taskTypeCount).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count} 个`)
      })
    }

    return { recentTasks, expiredCount: expiredTaskIds.length, orphanedCount: orphanedTaskIds.length }
  } catch (error) {
    console.error('❌ Redis清理/恢复失败:', error)
    return { recentTasks: [], expiredCount: 0, orphanedCount: 0 }
  }
}

/**
 * 检查Offer是否存在（未删除）
 */
async function checkOfferExists(db: any, offerId: number): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM offers WHERE id = ? AND deleted_at IS NULL`,
      [offerId]
    ) as Array<{ count: number }>
    return result[0]?.count > 0
  } catch (error) {
    // 查询失败时默认认为存在，避免误删任务
    return true
  }
}

// 导入Redis客户端
async function getRedisClient(): Promise<any> {
  try {
    const { getRedisClient } = await import('@/lib/redis-client')
    return getRedisClient()
  } catch (error) {
    console.error('导入Redis客户端失败:', error)
    return null
  }
}
