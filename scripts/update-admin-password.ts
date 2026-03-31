#!/usr/bin/env tsx

/**
 * 更新autoads管理员密码
 * 使用bcrypt加密新密码并更新数据库
 */

import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import path from 'path'

const NEW_PASSWORD = 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='
const USERNAME = 'autoads'
const SALT_ROUNDS = 10
const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

async function updateAdminPassword() {
  try {
    console.log('🔐 更新管理员密码...\n')

    // 1. 生成bcrypt哈希
    console.log('1️⃣ 生成密码哈希...')
    const passwordHash = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS)
    console.log('   ✅ 密码哈希生成成功')
    console.log(`   Hash: ${passwordHash.substring(0, 30)}...\n`)

    // 2. 更新数据库
    console.log('2️⃣ 更新数据库...')
    const db = new Database(DB_PATH)

    const result = db.prepare(`
      UPDATE users
      SET password_hash = ?,
          updated_at = datetime('now')
      WHERE username = ?
    `).run(passwordHash, USERNAME)

    if (result.changes === 0) {
      throw new Error(`用户 ${USERNAME} 不存在`)
    }

    console.log('   ✅ 数据库更新成功')
    console.log(`   影响行数: ${result.changes}\n`)

    // 3. 验证更新
    console.log('3️⃣ 验证密码更新...')
    const user = db.prepare(`
      SELECT username, password_hash, updated_at
      FROM users
      WHERE username = ?
    `).get(USERNAME) as any

    if (!user) {
      throw new Error(`无法查询用户 ${USERNAME}`)
    }

    // 验证新密码
    const isValid = await bcrypt.compare(NEW_PASSWORD, user.password_hash)

    if (!isValid) {
      throw new Error('密码验证失败')
    }

    console.log('   ✅ 密码验证成功')
    console.log(`   用户名: ${user.username}`)
    console.log(`   更新时间: ${user.updated_at}\n`)

    // 关闭数据库连接
    db.close()

    console.log('✅ 管理员密码更新完成！')
    console.log('\n📋 新密码信息:')
    console.log(`   用户名: ${USERNAME}`)
    console.log(`   密码: ${NEW_PASSWORD}`)
    console.log('\n⚠️  请妥善保管新密码，不要将其提交到版本控制系统')

  } catch (error: any) {
    console.error('\n❌ 密码更新失败:', error.message)
    console.error(error)
    process.exit(1)
  }
}

// 执行密码更新
updateAdminPassword()
