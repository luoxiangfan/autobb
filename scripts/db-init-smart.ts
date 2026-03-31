#!/usr/bin/env tsx
/**
 * 智能数据库初始化脚本
 *
 * 功能：
 * 1. 检查数据库是否存在
 * 2. 如果不存在，创建数据库和表结构
 * 3. 如果存在但未初始化，创建缺失的表
 * 4. 确保管理员账号存在
 * 5. 支持 SQLite 和 PostgreSQL
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getDatabase, closeDatabase } from '../src/lib/db.js'
import * as bcrypt from 'bcrypt'

const crypto = require('crypto')

// 默认管理员信息
const DEFAULT_ADMIN = {
  username: 'autoads',
  email: 'admin@autoads.com',
  password: process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64'),
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
}

// 关键表列表
const CRITICAL_TABLES = [
  'users',
  'offers',
  'campaigns',
  'system_settings',
  'industry_benchmarks',
  'batch_tasks',
  'upload_records',
  'offer_tasks',
]

/**
 * 检查 SQLite 数据库是否已初始化
 */
async function checkSQLiteInitialized(dbPath: string): Promise<boolean> {
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const tableList = CRITICAL_TABLES.map(t => `'${t}'`).join(',')
    const query = `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN (${tableList});`

    const result = execSync(`sqlite3 "${dbPath}" "${query}"`, {
      encoding: 'utf-8'
    }).trim()

    const count = parseInt(result)
    console.log(`📊 检查结果: ${count}/${CRITICAL_TABLES.length} 个关键表存在`)

    // 如果有6个或以上关键表存在，认为数据库已初始化
    return count >= 6
  } catch (error) {
    console.warn('⚠️ 检查数据库失败:', error)
    return false
  }
}

/**
 * 检查 PostgreSQL 数据库是否已初始化
 */
async function checkPostgresInitialized(): Promise<boolean> {
  const db = getDatabase()
  try {
    let initializedCount = 0
    for (const table of CRITICAL_TABLES) {
      const result = await db.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
        [table]
      )
      if (result[0].exists) {
        initializedCount++
      }
    }
    console.log(`📊 检查结果: ${initializedCount}/${CRITICAL_TABLES.length} 个关键表存在`)

    // 如果有6个或以上关键表存在，认为数据库已初始化
    return initializedCount >= 6
  } catch (error) {
    console.warn('⚠️ 检查数据库失败:', error)
    return false
  } finally {
    await closeDatabase()
  }
}

/**
 * 初始化 SQLite 数据库
 */
async function initializeSQLite(dbPath: string, schemaPath: string): Promise<void> {
  console.log('📦 正在创建 SQLite 数据库...')

  // 创建数据库和表
  execSync(`sqlite3 "${dbPath}" < "${schemaPath}"`, {
    stdio: 'inherit',
  })

  console.log('✅ SQLite 数据库创建成功')
}

/**
 * 初始化 PostgreSQL 数据库
 */
async function initializePostgres(): Promise<void> {
  console.log('📦 PostgreSQL 数据库初始化...')
  console.log('⚠️ 请确保 PostgreSQL 数据库已创建并配置正确')
  console.log('⚠️ 运行 npm run db:migrate 来创建表结构')
}

/**
 * 确保管理员账号存在
 */
async function ensureAdminAccount(): Promise<void> {
  console.log('🔑 检查管理员账号...')

  const password = DEFAULT_ADMIN.password
  const db = getDatabase()
  const isPostgres = db.type === 'postgres'

  try {
    const existingAdmin = await db.queryOne<{ id: number; username: string; email: string }>(
      "SELECT id, username, email FROM users WHERE username = ?",
      [DEFAULT_ADMIN.username]
    )

    const passwordHash = await bcrypt.hash(password, 10)

    if (!existingAdmin) {
      console.log('➕ 创建管理员账号...')

      if (isPostgres) {
        await db.exec(
          `INSERT INTO users (
            username, email, password_hash, display_name, role,
            package_type, package_expires_at, must_change_password,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
            false,
            true,
          ]
        )
      } else {
        await db.exec(
          `INSERT INTO users (
            username, email, password_hash, display_name, role,
            package_type, package_expires_at, must_change_password,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
            0,
            1,
          ]
        )
      }

      console.log('✅ 管理员账号创建成功')
    } else {
      console.log('🔄 管理员账号已存在，重置密码...')

      if (isPostgres) {
        await db.exec(
          "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE username = ?",
          [passwordHash, DEFAULT_ADMIN.username]
        )
      } else {
        await db.exec(
          "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE username = ?",
          [passwordHash, DEFAULT_ADMIN.username]
        )
      }

      console.log('✅ 管理员密码已重置')
    }

    console.log('')
    console.log('='.repeat(60))
    console.log('🔑 管理员登录信息')
    console.log('='.repeat(60))
    console.log('用户名:', DEFAULT_ADMIN.username)
    console.log('密码:', password)
    console.log('邮箱:', DEFAULT_ADMIN.email)
    console.log('='.repeat(60))
    console.log('')
    console.log('⚠️  请妥善保存密码！')
  } catch (error) {
    console.error('❌ 管理员账号操作失败:', error)
    throw error
  } finally {
    await closeDatabase()
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 智能数据库初始化脚本启动...\n')

  // 检查数据库类型
  const db = getDatabase()
  const isPostgres = db.type === 'postgres'
  await closeDatabase()

  if (isPostgres) {
    // PostgreSQL 初始化
    const initialized = await checkPostgresInitialized()
    if (!initialized) {
      console.log('⚠️ PostgreSQL 数据库未初始化')
      console.log('请运行: npm run db:migrate')
      process.exit(1)
    }
  } else {
    // SQLite 初始化
    const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
    const schemaPath = path.join(process.cwd(), 'migrations', '000_init_schema_consolidated.sqlite.sql')

    const initialized = await checkSQLiteInitialized(dbPath)

    if (!initialized) {
      console.log('📦 SQLite 数据库未初始化，正在创建...')
      await initializeSQLite(dbPath, schemaPath)
    } else {
      console.log('✅ SQLite 数据库已初始化，跳过表创建')
    }
  }

  // 确保管理员账号存在
  await ensureAdminAccount()

  console.log('🎉 数据库初始化完成！')
}

main().catch((error) => {
  console.error('❌ 初始化失败:', error)
  process.exit(1)
})
