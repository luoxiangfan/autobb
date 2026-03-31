#!/usr/bin/env tsx
/**
 * 确保管理员账号存在
 * 服务启动时执行：如果 autoads 管理员不存在则创建，如果存在则重置密码
 * 密码来自环境变量 DEFAULT_ADMIN_PASSWORD
 */

import { getDatabase, closeDatabase } from '../src/lib/db.js'
import { hashPassword } from '../src/lib/crypto.js'

async function ensureAdminAccount() {
  const password = process.env.DEFAULT_ADMIN_PASSWORD

  // 验证必需的环境变量
  if (!password) {
    console.error('❌ 错误: 必须设置环境变量 DEFAULT_ADMIN_PASSWORD')
    console.error('   用法: DEFAULT_ADMIN_PASSWORD="your-password" npx tsx scripts/ensure-admin-account.ts')
    process.exit(1)
  }

  const db = getDatabase()
  const isPostgres = db.type === 'postgres'

  try {
    console.log('🔍 检查管理员账号是否存在...')

    // 查询 autoads 管理员是否存在
    const existingAdmin = await db.queryOne<{ id: number; username: string; email: string }>(
      "SELECT id, username, email FROM users WHERE username = ?",
      ['autoads']
    )

    const passwordHash = await hashPassword(password)

    if (!existingAdmin) {
      // 管理员不存在，创建新账号
      console.log('➕ 管理员账号不存在，正在创建...')

      if (isPostgres) {
        // PostgreSQL 版本
        await db.exec(
          `INSERT INTO users (
            username,
            email,
            password_hash,
            display_name,
            role,
            package_type,
            package_expires_at,
            must_change_password,
            is_active,
            openclaw_enabled,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            'autoads',
            'admin@autoads.com',
            passwordHash,
            'AutoAds Administrator',
            'admin',
            'lifetime',
            '2099-12-31 23:59:59',
            false,
            true,
            true,
          ]
        )
      } else {
        // SQLite 版本
        await db.exec(
          `INSERT INTO users (
            username,
            email,
            password_hash,
            display_name,
            role,
            package_type,
            package_expires_at,
            must_change_password,
            is_active,
            openclaw_enabled,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            'autoads',
            'admin@autoads.com',
            passwordHash,
            'AutoAds Administrator',
            'admin',
            'lifetime',
            '2099-12-31 23:59:59',
            0, // false for SQLite
            1, // true for SQLite
            1, // true for SQLite
          ]
        )
      }

      console.log('✅ 管理员账号创建成功')
      console.log('')
      console.log('='.repeat(60))
      console.log('🔑 管理员登录信息')
      console.log('='.repeat(60))
      console.log('用户名: autoads')
      console.log(`密码: ${password}`)
      console.log('邮箱: admin@autoads.com')
      console.log('角色: admin')
      console.log('套餐类型: lifetime')
      console.log('='.repeat(60))
    } else {
      // 管理员已存在，重置密码
      console.log('🔄 管理员账号已存在，正在重置密码...')

      if (isPostgres) {
        // PostgreSQL 版本
        await db.exec(
          "UPDATE users SET password_hash = ?, must_change_password = FALSE, is_active = TRUE, openclaw_enabled = TRUE, updated_at = NOW() WHERE username = ?",
          [passwordHash, 'autoads']
        )
      } else {
        // SQLite 版本
        await db.exec(
          "UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1, openclaw_enabled = 1, updated_at = datetime('now') WHERE username = ?",
          [passwordHash, 'autoads']
        )
      }

      console.log('✅ 管理员密码已重置')
      console.log('')
      console.log('='.repeat(60))
      console.log('🔑 管理员登录信息')
      console.log('='.repeat(60))
      console.log('用户名: autoads')
      console.log(`密码: ${password}`)
      console.log('邮箱: admin@autoads.com')
      console.log('='.repeat(60))
    }

    console.log('')
    console.log('⚠️  请妥善保存密码！')
  } catch (error) {
    console.error('❌ 操作失败:', error)
    process.exit(1)
  } finally {
    await closeDatabase()
  }
}

ensureAdminAccount().catch(console.error)
