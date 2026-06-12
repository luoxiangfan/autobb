#!/usr/bin/env tsx
/**
 * PostgreSQL database initialization helper
 *
 * 1. Verifies critical tables exist (run db:migrate first if missing)
 * 2. Ensures default admin account exists
 */

import { getDatabase, closeDatabase } from '../src/lib/db.js'
import * as bcrypt from 'bcrypt'
import crypto from 'crypto'

const DEFAULT_ADMIN = {
  username: 'autoads',
  email: 'admin@autoads.com',
  password: process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64'),
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
}

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

async function checkPostgresInitialized(): Promise<boolean> {
  const db = getDatabase()
  try {
    let initializedCount = 0
    for (const table of CRITICAL_TABLES) {
      const result = await db.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      )
      if (result[0].exists) {
        initializedCount++
      }
    }
    console.log(`📊 检查结果: ${initializedCount}/${CRITICAL_TABLES.length} 个关键表存在`)
    return initializedCount >= 6
  } catch (error) {
    console.warn('⚠️ 检查数据库失败:', error)
    return false
  } finally {
    await closeDatabase()
  }
}

async function ensureAdminAccount(): Promise<void> {
  console.log('🔑 检查管理员账号...')

  const password = DEFAULT_ADMIN.password
  const db = getDatabase()

  try {
    const existingAdmin = await db.queryOne<{ id: number; username: string; email: string }>(
      'SELECT id, username, email FROM users WHERE username = ?',
      [DEFAULT_ADMIN.username]
    )

    const passwordHash = await bcrypt.hash(password, 10)

    if (!existingAdmin) {
      console.log('➕ 创建管理员账号...')
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
      console.log('✅ 管理员账号创建成功')
    } else {
      console.log('🔄 管理员账号已存在，重置密码...')
      await db.exec('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE username = ?', [
        passwordHash,
        DEFAULT_ADMIN.username,
      ])
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

async function main() {
  console.log('🚀 PostgreSQL 数据库初始化检查...\n')

  const initialized = await checkPostgresInitialized()
  if (!initialized) {
    console.log('⚠️ 数据库未初始化，请先运行: npm run db:migrate')
    process.exit(1)
  }

  await ensureAdminAccount()
  console.log('🎉 数据库初始化完成！')
}

main().catch((error) => {
  console.error('❌ 初始化失败:', error)
  process.exit(1)
})
