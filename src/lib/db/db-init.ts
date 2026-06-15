/**
 * 数据库自动初始化模块
 *
 * 在应用启动时自动检查并初始化数据库：
 * 1. 连接 PostgreSQL（DATABASE_URL）
 * 2. 创建数据库表结构（如果不存在）
 * 3. 创建默认管理员账号
 * 4. 导入管理员配置（PostgreSQL 生产环境）
 * 5. 插入默认系统配置
 * 6. 自动执行增量迁移（新增）
 */

import { getDatabase } from './database'
import { hashPassword } from '../auth'
import {
  applyConsolidatedSchemaStatements,
  loadConsolidatedSchemaStatements,
} from './apply-consolidated-schema'
import { splitSqlStatements } from './sql-splitter'
import {
  listIncrementalMigrationFiles,
  migrationHistoryName,
  resolveMigrationFilePath,
} from './migration-file-discovery'
import { normalizeMigrationSql } from './migration-sql-preprocess'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

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
    'users', // 用户表
    'offers', // Offer 表
    'campaigns', // Campaign 表
    'system_settings', // 系统设置表
    'industry_benchmarks', // 行业基准表
    'batch_tasks', // 批量任务表
    'upload_records', // 上传记录表
    'offer_tasks', // Offer提取任务表
  ]

  try {
    for (const table of criticalTables) {
      const result = await db.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = ?)',
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

/**
 * 初始化 PostgreSQL 数据库
 */
async function initializePostgreSQL(): Promise<void> {
  console.log('🐘 Initializing PostgreSQL database...')

  try {
    // 1. 从生成的SQL文件创建表结构
    const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema_consolidated.pg.sql')
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`PostgreSQL schema file not found: ${sqlPath}`)
    }

    const statements = loadConsolidatedSchemaStatements(sqlPath)

    console.log('\n📋 Creating database tables...')
    const databaseUrl = process.env.DATABASE_URL
    if (
      !databaseUrl ||
      (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://'))
    ) {
      throw new Error('DATABASE_URL is required for PostgreSQL initialization')
    }

    const initSql = postgres(databaseUrl, { max: 1 })
    try {
      const { ok, skipped } = await applyConsolidatedSchemaStatements(initSql, statements)
      console.log(
        `✅ Schema created from migrations/000_init_schema_consolidated.pg.sql (${ok} statements, ${skipped} skipped)`
      )
    } finally {
      await initSql.end({ timeout: 5 })
    }

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

  try {
    const existingAdmin = await db.queryOne('SELECT id FROM users WHERE username = ? OR role = ?', [
      DEFAULT_ADMIN.username,
      'admin',
    ])

    const passwordHash = await hashPassword(DEFAULT_ADMIN.password)

    if (existingAdmin) {
      console.log('⚠️  Admin account already exists, updating password...')

      await db.exec(
        'UPDATE users SET password_hash = ?, must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = ? OR role = ?',
        [passwordHash, DEFAULT_ADMIN.username, 'admin']
      )

      console.log('✅ Admin password updated')
    } else {
      await db.exec(
        `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, TRUE, TRUE)`,
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
 * - ensureAdminAccount: 每次启动都调用
 *
 * 行为：
 * - 如果管理员不存在：创建新账号
 * - 如果管理员已存在：更新密码（如果环境变量中配置了新密码）
 */
async function ensureAdminAccount(): Promise<void> {
  console.log('\n👤 Checking admin account...')

  const db = await getDatabase()

  try {
    const existingAdmin = await db.queryOne('SELECT id FROM users WHERE username = ? OR role = ?', [
      DEFAULT_ADMIN.username,
      'admin',
    ])

    const passwordHash = await hashPassword(DEFAULT_ADMIN.password)

    if (existingAdmin) {
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('⚠️  Admin account exists, updating password from environment variable...')

        await db.exec(
          'UPDATE users SET password_hash = ?, must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = ? OR role = ?',
          [passwordHash, DEFAULT_ADMIN.username, 'admin']
        )

        console.log('✅ Admin password updated')
      } else {
        await db.exec(
          'UPDATE users SET must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE WHERE username = ? OR role = ?',
          [DEFAULT_ADMIN.username, 'admin']
        )
        console.log('✅ Admin account exists (password unchanged)')
      }
    } else {
      console.log('⚠️  Admin account not found, creating...')

      await db.exec(
        `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active, openclaw_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, TRUE, TRUE)`,
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

  const defaultSettings = [
    // Google Ads API配置
    {
      category: 'google_ads',
      key: 'login_customer_id',
      dataType: 'string',
      isSensitive: false,
      isRequired: true,
      description: 'Google Ads Login Customer ID (MCC账户ID)',
    },
    {
      category: 'google_ads',
      key: 'client_id',
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      description: 'Google Ads API Client ID（可选）',
    },
    {
      category: 'google_ads',
      key: 'client_secret',
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      description: 'Google Ads API Client Secret（可选）',
    },
    {
      category: 'google_ads',
      key: 'developer_token',
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      description: 'Google Ads Developer Token（可选）',
    },

    // AI配置 - Gemini API模式（支持多服务商）
    {
      category: 'ai',
      key: 'gemini_provider',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
      description: 'Gemini API 服务商',
      defaultValue: 'official',
    },
    {
      category: 'ai',
      key: 'gemini_endpoint',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
      description: 'Gemini API 端点（系统自动计算）',
    },
    {
      category: 'ai',
      key: 'gemini_api_key',
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      description: 'Gemini 官方 API Key',
    },
    {
      category: 'ai',
      key: 'gemini_relay_api_key',
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      description: '第三方中转服务 API Key',
    },
    {
      category: 'ai',
      key: 'gemini_model',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
      description: 'AI模型',
      defaultValue: 'gemini-3-flash-preview',
    },

    // 代理配置
    {
      category: 'proxy',
      key: 'urls',
      dataType: 'json',
      isSensitive: false,
      isRequired: false,
      description: '代理URL配置列表（JSON格式）',
    },

    // 系统配置
    {
      category: 'system',
      key: 'currency',
      dataType: 'string',
      isSensitive: false,
      isRequired: true,
      description: '默认货币',
      defaultValue: 'CNY',
    },
    {
      category: 'system',
      key: 'language',
      dataType: 'string',
      isSensitive: false,
      isRequired: true,
      description: '系统语言',
      defaultValue: 'zh-CN',
    },
    {
      category: 'system',
      key: 'data_sync_interval_hours',
      dataType: 'number',
      isSensitive: false,
      isRequired: true,
      description: '数据同步间隔(小时)',
      defaultValue: '4',
    },
    {
      category: 'system',
      key: 'link_check_enabled',
      dataType: 'boolean',
      isSensitive: false,
      isRequired: true,
      description: '是否启用链接检查',
      defaultValue: 'true',
    },
    {
      category: 'system',
      key: 'link_check_time',
      dataType: 'string',
      isSensitive: false,
      isRequired: true,
      description: '链接检查时间',
      defaultValue: '02:00',
    },
    {
      category: 'system',
      key: 'data_sync_mode',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
      description: '手动同步默认模式（incremental/full）',
      defaultValue: 'incremental',
    },
  ]

  try {
    for (const setting of defaultSettings) {
      const existing = await db.queryOne(
        'SELECT id FROM system_settings WHERE category = ? AND key = ? AND user_id IS NULL',
        [setting.category, setting.key]
      )

      if (!existing) {
        await db.exec(
          `INSERT INTO system_settings (user_id, category, key, data_type, is_sensitive, is_required, default_value, description)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
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
  if (!fs.existsSync(CONFIG_EXPORT_PATH)) {
    console.log('\n⏭️  No admin config export file found, skipping import')
    return
  }

  console.log('\n📥 Importing admin configuration...')

  try {
    const exportData = JSON.parse(fs.readFileSync(CONFIG_EXPORT_PATH, 'utf-8'))
    const db = await getDatabase()

    const adminResult = await db.query<{ id: number }>(
      'SELECT id FROM users WHERE username = ? OR role = ?',
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
      const existing = await db.query(
        'SELECT id FROM system_settings WHERE category = ? AND key = ? AND (user_id = ? OR user_id IS NULL)',
        [setting.category, setting.key, setting.user_id === null ? null : adminUserId]
      )

      if (existing.length > 0) {
        await db.exec(
          `UPDATE system_settings
           SET value = ?, encrypted_value = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [setting.value, setting.encrypted_value, existing[0].id]
        )
      } else {
        await db.exec(
          `INSERT INTO system_settings (
            user_id, category, key, value, encrypted_value,
            data_type, is_sensitive, is_required, default_value, description
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  // 行业基准数据（30个二级分类）
  const benchmarks = [
    // E-commerce 电商（6个子类）
    {
      l1: 'E-commerce',
      l2: 'Fashion & Apparel',
      code: 'ecom_fashion',
      ctr: 2.41,
      cpc: 0.45,
      cvr: 2.77,
    },
    {
      l1: 'E-commerce',
      l2: 'Electronics & Gadgets',
      code: 'ecom_electronics',
      ctr: 2.04,
      cpc: 0.68,
      cvr: 1.91,
    },
    { l1: 'E-commerce', l2: 'Home & Garden', code: 'ecom_home', ctr: 2.53, cpc: 0.52, cvr: 2.23 },
    {
      l1: 'E-commerce',
      l2: 'Health & Beauty',
      code: 'ecom_beauty',
      ctr: 2.78,
      cpc: 0.41,
      cvr: 3.19,
    },
    {
      l1: 'E-commerce',
      l2: 'Sports & Outdoors',
      code: 'ecom_sports',
      ctr: 2.35,
      cpc: 0.58,
      cvr: 2.01,
    },
    { l1: 'E-commerce', l2: 'Food & Beverage', code: 'ecom_food', ctr: 2.67, cpc: 0.38, cvr: 2.85 },

    // Travel 旅游（4个子类）
    {
      l1: 'Travel',
      l2: 'Luggage & Travel Gear',
      code: 'travel_luggage',
      ctr: 3.18,
      cpc: 0.95,
      cvr: 2.47,
    },
    {
      l1: 'Travel',
      l2: 'Hotels & Accommodation',
      code: 'travel_hotels',
      ctr: 4.68,
      cpc: 1.22,
      cvr: 2.57,
    },
    {
      l1: 'Travel',
      l2: 'Flights & Transportation',
      code: 'travel_flights',
      ctr: 4.29,
      cpc: 0.84,
      cvr: 2.14,
    },
    {
      l1: 'Travel',
      l2: 'Tours & Activities',
      code: 'travel_tours',
      ctr: 3.87,
      cpc: 0.76,
      cvr: 3.01,
    },

    // Technology 科技（4个子类）
    { l1: 'Technology', l2: 'Software & SaaS', code: 'tech_saas', ctr: 2.41, cpc: 3.5, cvr: 3.04 },
    {
      l1: 'Technology',
      l2: 'Consumer Electronics',
      code: 'tech_consumer',
      ctr: 2.18,
      cpc: 0.72,
      cvr: 1.84,
    },
    {
      l1: 'Technology',
      l2: 'B2B Tech Services',
      code: 'tech_b2b',
      ctr: 2.09,
      cpc: 4.21,
      cvr: 2.58,
    },
    { l1: 'Technology', l2: 'Mobile Apps', code: 'tech_apps', ctr: 3.24, cpc: 0.52, cvr: 4.12 },

    // Finance 金融（4个子类）
    {
      l1: 'Finance',
      l2: 'Banking & Credit',
      code: 'finance_banking',
      ctr: 2.91,
      cpc: 3.77,
      cvr: 4.19,
    },
    { l1: 'Finance', l2: 'Insurance', code: 'finance_insurance', ctr: 2.13, cpc: 4.52, cvr: 1.87 },
    {
      l1: 'Finance',
      l2: 'Investment & Trading',
      code: 'finance_investment',
      ctr: 1.92,
      cpc: 5.14,
      cvr: 2.23,
    },
    {
      l1: 'Finance',
      l2: 'Cryptocurrency',
      code: 'finance_crypto',
      ctr: 2.47,
      cpc: 2.89,
      cvr: 1.56,
    },

    // Education 教育（3个子类）
    { l1: 'Education', l2: 'Online Courses', code: 'edu_online', ctr: 3.39, cpc: 2.13, cvr: 3.67 },
    {
      l1: 'Education',
      l2: 'Academic Programs',
      code: 'edu_academic',
      ctr: 2.87,
      cpc: 3.42,
      cvr: 2.94,
    },
    {
      l1: 'Education',
      l2: 'Professional Training',
      code: 'edu_professional',
      ctr: 2.65,
      cpc: 2.78,
      cvr: 3.21,
    },

    // Healthcare 医疗健康（3个子类）
    {
      l1: 'Healthcare',
      l2: 'Medical Services',
      code: 'health_medical',
      ctr: 3.12,
      cpc: 2.89,
      cvr: 3.78,
    },
    {
      l1: 'Healthcare',
      l2: 'Pharmaceuticals',
      code: 'health_pharma',
      ctr: 2.68,
      cpc: 1.95,
      cvr: 2.47,
    },
    {
      l1: 'Healthcare',
      l2: 'Wellness & Fitness',
      code: 'health_wellness',
      ctr: 3.45,
      cpc: 0.89,
      cvr: 3.92,
    },

    // Automotive 汽车（2个子类）
    { l1: 'Automotive', l2: 'Vehicle Sales', code: 'auto_sales', ctr: 2.14, cpc: 2.46, cvr: 2.53 },
    {
      l1: 'Automotive',
      l2: 'Auto Parts & Services',
      code: 'auto_parts',
      ctr: 2.67,
      cpc: 1.24,
      cvr: 3.14,
    },

    // Real Estate 房地产（2个子类）
    {
      l1: 'Real Estate',
      l2: 'Residential',
      code: 'realestate_residential',
      ctr: 2.03,
      cpc: 1.89,
      cvr: 1.94,
    },
    {
      l1: 'Real Estate',
      l2: 'Commercial',
      code: 'realestate_commercial',
      ctr: 1.87,
      cpc: 2.67,
      cvr: 1.72,
    },

    // Entertainment 娱乐（2个子类）
    {
      l1: 'Entertainment',
      l2: 'Gaming',
      code: 'entertainment_gaming',
      ctr: 3.56,
      cpc: 0.47,
      cvr: 2.87,
    },
    {
      l1: 'Entertainment',
      l2: 'Streaming & Media',
      code: 'entertainment_media',
      ctr: 3.21,
      cpc: 0.65,
      cvr: 2.34,
    },
  ]

  try {
    for (const benchmark of benchmarks) {
      await db.exec(
        `INSERT INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (industry_code) DO NOTHING`,
        [benchmark.l1, benchmark.l2, benchmark.code, benchmark.ctr, benchmark.cpc, benchmark.cvr]
      )
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
    await runStep('汇率数据', async () => {
      const { ensureExchangeRatesOnStartup } = await import('../common/exchange-rates-service')
      await ensureExchangeRatesOnStartup()
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

  await runStep('PostgreSQL初始化', async () => {
    await initializePostgreSQL()
  })

  // 初始化完成后也执行迁移（确保所有增量迁移都被应用）
  await runStep('增量迁移检查', async () => {
    await runPendingMigrations()
  })
  await runStep('汇率数据', async () => {
    const { ensureExchangeRatesOnStartup } = await import('../common/exchange-rates-service')
    await ensureExchangeRatesOnStartup()
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
    const { initializeQueue } = await import('../queue/init-queue')
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
 * 迁移文件命名规范：migrations/{编号}_{描述}.pg.sql；000 开头为初始化 schema，不参与增量迁移
 */
async function runPendingMigrations(): Promise<void> {
  // PostgreSQL: 迁移前对齐序列，避免 prompt_versions 主键冲突
  await alignPostgresSequences()

  const migrationsDir = path.join(process.cwd(), 'migrations')

  console.log(`🔍 Checking migrations in: ${migrationsDir}`)

  // 检查迁移目录是否存在
  if (!fs.existsSync(migrationsDir)) {
    console.log('⚠️  Migrations directory not found, skipping migrations')
    return
  }

  // 确保 migration_history 表存在
  await ensureMigrationHistoryTable()

  // 获取所有迁移文件（含 archived_* 子目录）
  const migrationFiles = listIncrementalMigrationFiles(migrationsDir)

  if (migrationFiles.length === 0) {
    console.log('📋 No migration files found')
    return
  }

  // 获取已执行的迁移（含 hash）
  const executedMigrations = await getExecutedMigrations()

  // 分类迁移文件：新文件 vs 内容变更
  const pendingMigrations: Array<{ file: string; reason: 'new' | 'changed' }> = []

  for (const file of migrationFiles) {
    const historyName = migrationHistoryName(file)
    const filePath = resolveMigrationFilePath(migrationsDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const currentHash = calculateFileHash(content)

    if (!executedMigrations.has(historyName) && !executedMigrations.has(file)) {
      // 新迁移文件
      pendingMigrations.push({ file, reason: 'new' })
    } else {
      // 检查内容是否变更
      const recordedHash = executedMigrations.get(historyName) ?? executedMigrations.get(file)
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
  const newMigrations = pendingMigrations.filter((m) => m.reason === 'new')
  const changedMigrations = pendingMigrations.filter((m) => m.reason === 'changed')

  console.log(`\n📦 Found ${pendingMigrations.length} migrations to execute:`)
  if (newMigrations.length > 0) {
    console.log(`   🆕 New: ${newMigrations.length}`)
    newMigrations.forEach((m) => console.log(`      - ${m.file}`))
  }
  if (changedMigrations.length > 0) {
    console.log(`   🔄 Changed: ${changedMigrations.length}`)
    changedMigrations.forEach((m) => console.log(`      - ${m.file}`))
  }
  console.log('')

  // 执行每个迁移
  let successCount = 0
  let failCount = 0

  for (const { file: migrationFile, reason } of pendingMigrations) {
    const historyName = migrationHistoryName(migrationFile)
    const filePath = resolveMigrationFilePath(migrationsDir, migrationFile)
    const sqlContent = fs.readFileSync(filePath, 'utf-8')
    const fileHash = calculateFileHash(sqlContent)

    const reasonIcon = reason === 'new' ? '🆕' : '🔄'
    console.log(`${reasonIcon} Executing: ${migrationFile}`)

    try {
      await executeMigration(historyName, sqlContent)
      await recordMigration(historyName, fileHash)
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id SERIAL PRIMARY KEY,
      migration_name TEXT NOT NULL UNIQUE,
      file_hash TEXT,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
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
    results.forEach((row) => {
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
 * 执行单个迁移
 */
async function executeMigration(name: string, sql: string): Promise<void> {
  const db = await getDatabase()

  const statements = splitSqlStatements(normalizeMigrationSql(sql))

  const rawSql = (db as any).getRawConnection()
  await rawSql.begin(async (tx: any) => {
    for (const stmt of statements) {
      if (!stmt.trim()) {
        continue
      }

      try {
        await tx.savepoint(async (sp: any) => {
          await sp.unsafe(stmt)
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (
          errorMsg.includes('already exists') ||
          errorMsg.includes('duplicate key value violates unique constraint')
        ) {
          console.log(`   ⏭️  Skipped (already exists): ${stmt.substring(0, 60)}...`)
        } else {
          throw error
        }
      }
    }
  })
}

/**
 * 记录迁移执行历史（含 file_hash）
 */
async function recordMigration(name: string, fileHash: string): Promise<void> {
  const db = await getDatabase()

  await db.query(
    `INSERT INTO migration_history (migration_name, file_hash)
     VALUES (?, ?)
     ON CONFLICT (migration_name) DO UPDATE SET
       file_hash = EXCLUDED.file_hash,
       executed_at = CURRENT_TIMESTAMP`,
    [name, fileHash]
  )
}

// 全局标记：是否需要恢复队列任务（声明在全局作用域）
declare global {
  var __queueRecoveryPending: boolean | undefined

  var __queueRecoveryData:
    | Array<{
        id: number | string
        user_id: number
        url?: string
        brand?: string | null
        task_type?: string
        status: string
        retry_count?: number
        offer_id?: number
        data?: any
      }>
    | undefined
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
 * 原因：instrumentation阶段无法安全导入复杂模块（offer-extraction 队列依赖较重）
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
      const tableResult = await db.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'offer_tasks')"
      )
      const tableExists = tableResult[0].exists

      if (!tableExists) {
        console.log('  ℹ️  数据库: offer_tasks表不存在，跳过清理')
      } else {
        const result = await db.exec(`
          DELETE FROM offer_tasks
          WHERE status IN ('pending', 'running')
        `)
        dbClearedCount = result.changes
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
  async function scanKeysByPattern(
    redisClient: any,
    pattern: string,
    scanCount = 200
  ): Promise<string[]> {
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
        details: { pendingCleared: 0, runningCleared: 0, userQueuesCleared: 0 },
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

    const allTaskIds = [...new Set([...pendingTaskIds, ...runningTaskIds])] // 去重

    // 使用pipeline批量删除，提高效率
    const pipeline = redisClient.pipeline()

    // 4. 删除所有类型的pending队列
    const taskTypes = [
      'offer-extraction',
      'batch-offer-creation',
      'offer-creation',
      'offer-scrape',
      'offer-enhance',
      'sync',
      'backup',
      'link-check',
      'cleanup',
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
      details: { pendingCleared, runningCleared, userQueuesCleared },
    }
  } catch (error) {
    console.error('❌ Redis清空失败:', error)
    return {
      clearedCount: 0,
      details: { pendingCleared: 0, runningCleared: 0, userQueuesCleared: 0 },
    }
  }
}

// 导入Redis客户端
async function getRedisClient(): Promise<any> {
  try {
    const { getRedisClient } = await import('@/lib/common')
    return getRedisClient()
  } catch (error) {
    console.error('导入Redis客户端失败:', error)
    return null
  }
}
