import Database from 'better-sqlite3'
import path from 'path'
import { hashPassword } from '../src/lib/crypto'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始数据库迁移：添加用户管理字段...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

try {
  // 开始事务
  db.exec('BEGIN TRANSACTION')

  console.log('\n📋 Step 1: 检查并添加缺失字段...\n')

  // 检查username字段是否存在
  const columns = db.prepare("PRAGMA table_info(users)").all() as any[]
  const columnNames = columns.map((col: any) => col.name)

  if (!columnNames.includes('username')) {
    console.log('  ✅ 添加 username 字段')
    db.exec('ALTER TABLE users ADD COLUMN username TEXT UNIQUE')
  } else {
    console.log('  ⏭️  username 字段已存在')
  }

  if (!columnNames.includes('must_change_password')) {
    console.log('  ✅ 添加 must_change_password 字段')
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0')
  } else {
    console.log('  ⏭️  must_change_password 字段已存在')
  }

  if (!columnNames.includes('valid_from')) {
    console.log('  ✅ 添加 valid_from 字段')
    db.exec('ALTER TABLE users ADD COLUMN valid_from TEXT')
  } else {
    console.log('  ⏭️  valid_from 字段已存在')
  }

  if (!columnNames.includes('valid_until')) {
    console.log('  ✅ 添加 valid_until 字段')
    db.exec('ALTER TABLE users ADD COLUMN valid_until TEXT')
  } else {
    console.log('  ⏭️  valid_until 字段已存在')
  }

  if (!columnNames.includes('created_by')) {
    console.log('  ✅ 添加 created_by 字段')
    db.exec('ALTER TABLE users ADD COLUMN created_by INTEGER')
  } else {
    console.log('  ⏭️  created_by 字段已存在')
  }

  console.log('\n📋 Step 2: 创建默认管理员账号...\n')

  // 检查是否已存在管理员账号
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get('autoads', 'admin@autoads.dev')

  if (!existingAdmin) {
    // 创建默认管理员账号
    // 注意：因为hashPassword是异步的，这里需要同步版本
    const crypto = require('crypto')
    const bcrypt = require('bcrypt')

    const defaultPassword = '***REMOVED***'
    const passwordHash = bcrypt.hashSync(defaultPassword, 10)

    db.prepare(`
      INSERT INTO users (
        username, email, password_hash, display_name,
        role, package_type, valid_from, valid_until,
        is_active, must_change_password, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      'autoads',
      'admin@autoads.dev',
      passwordHash,
      'System Administrator',
      'admin',
      'lifetime',
      '2025-01-01',
      '2099-12-31',
      1, // is_active
      0  // must_change_password (管理员不需要强制修改密码)
    )

    console.log('  ✅ 创建默认管理员账号')
    console.log('     用户名: autoads')
    console.log('     密码: ***REMOVED***')
    console.log('     套餐: 终身买断制')
    console.log('     有效期: 至2099-12-31')
  } else {
    console.log('  ⏭️  管理员账号已存在，跳过创建')
  }

  console.log('\n📋 Step 3: 为现有用户补充默认值...\n')

  // 为现有用户设置默认值
  const updateCount = db.prepare(`
    UPDATE users
    SET
      must_change_password = COALESCE(must_change_password, 0),
      valid_from = COALESCE(valid_from, date('now')),
      valid_until = COALESCE(valid_until, date('now', '+7 days')),
      package_type = COALESCE(package_type, 'trial')
    WHERE username IS NULL OR username = ''
  `).run()

  console.log(`  ✅ 更新了 ${updateCount.changes} 个用户的默认值`)

  // 提交事务
  db.exec('COMMIT')

  console.log('\n✅ 数据库迁移完成！\n')

  // 显示统计信息
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_users,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_count,
      SUM(CASE WHEN package_type = 'trial' THEN 1 ELSE 0 END) as trial_users,
      SUM(CASE WHEN package_type = 'yearly' THEN 1 ELSE 0 END) as yearly_users,
      SUM(CASE WHEN package_type = 'lifetime' THEN 1 ELSE 0 END) as lifetime_users
    FROM users
  `).get() as any

  console.log('📊 用户统计:')
  console.log(`   - 总用户数: ${stats.total_users}`)
  console.log(`   - 管理员: ${stats.admin_count}`)
  console.log(`   - 试用用户: ${stats.trial_users}`)
  console.log(`   - 年卡用户: ${stats.yearly_users}`)
  console.log(`   - 终身用户: ${stats.lifetime_users}`)

} catch (error) {
  // 回滚事务
  try {
    db.exec('ROLLBACK')
  } catch (rollbackError) {
    console.error('回滚失败:', rollbackError)
  }

  console.error('\n❌ 数据库迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
}
