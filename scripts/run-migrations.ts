/**
 * 数据库迁移执行脚本
 * 按顺序执行migrations目录下的SQL文件
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const migrationsDir = path.join(process.cwd(), 'scripts', 'migrations')

console.log('🚀 开始执行数据库迁移...')
console.log('📍 数据库路径:', dbPath)
console.log('📂 迁移脚本目录:', migrationsDir)

// 检查数据库是否存在
if (!fs.existsSync(dbPath)) {
  console.error('❌ 数据库文件不存在，请先运行 npm run init-db')
  process.exit(1)
}

// 创建数据库连接
const db = new Database(dbPath)

// 创建migrations_history表（如果不存在）
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_file TEXT NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

console.log('✅ 迁移历史表已就绪\n')

// 读取所有迁移文件
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(file => file.endsWith('.sql'))
  .sort() // 按文件名排序（001, 002, ...）

console.log(`📋 发现 ${migrationFiles.length} 个迁移文件:\n`)

let executedCount = 0
let skippedCount = 0

for (const file of migrationFiles) {
  // 检查是否已执行过
  const existingMigration = db.prepare(
    'SELECT * FROM migrations_history WHERE migration_file = ?'
  ).get(file) as { migration_file: string; executed_at: string } | undefined

  if (existingMigration) {
    console.log(`⏭️  跳过: ${file} (已于 ${existingMigration.executed_at} 执行)`)
    skippedCount++
    continue
  }

  console.log(`🔄 执行: ${file}`)

  try {
    // 读取并执行SQL文件
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')

    // 在事务中执行迁移
    db.transaction(() => {
      db.exec(sqlContent)

      // 记录到迁移历史
      db.prepare(
        'INSERT INTO migrations_history (migration_file) VALUES (?)'
      ).run(file)
    })()

    console.log(`✅ 完成: ${file}\n`)
    executedCount++

  } catch (error) {
    console.error(`❌ 失败: ${file}`)
    console.error(`   错误信息:`, error)
    console.error(`\n⚠️  迁移中止，已执行 ${executedCount} 个迁移`)
    process.exit(1)
  }
}

console.log('\n📊 迁移汇总:')
console.log(`   ✅ 成功执行: ${executedCount} 个`)
console.log(`   ⏭️  已跳过: ${skippedCount} 个`)
console.log(`   📝 总计: ${migrationFiles.length} 个`)

if (executedCount > 0) {
  console.log('\n✅ 数据库迁移完成！')
} else {
  console.log('\n✅ 所有迁移已是最新状态')
}

db.close()
