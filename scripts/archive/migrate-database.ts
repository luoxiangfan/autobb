/**
 * 数据库迁移管理工具
 * 支持 PostgreSQL 和 SQLite
 *
 * 使用方法：
 * - 运行所有迁移: tsx scripts/migrate-database.ts
 * - 运行指定迁移: tsx scripts/migrate-database.ts 001
 * - 查看迁移状态: tsx scripts/migrate-database.ts --status
 */

import { getDatabase } from '../src/lib/db'
import fs from 'fs'
import path from 'path'

const DB_TYPE = process.env.DATABASE_URL ? 'postgres' : 'sqlite'
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')

interface Migration {
  number: string
  name: string
  file: string
  executed: boolean
  executedAt?: Date
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  console.log(`🚀 数据库迁移工具 (${DB_TYPE === 'postgres' ? 'PostgreSQL' : 'SQLite'})\n`)

  const db = getDatabase()

  try {
    // 确保migration_history表存在
    await ensureMigrationHistoryTable(db)

    if (command === '--status' || command === '-s') {
      await showMigrationStatus(db)
    } else if (command && /^\d{3}$/.test(command)) {
      // 运行指定的迁移
      await runSpecificMigration(db, command)
    } else {
      // 运行所有pending迁移
      await runPendingMigrations(db)
    }
  } catch (error) {
    console.error('❌ 迁移失败:', error)
    process.exit(1)
  } finally {
    await db.close()
  }
}

async function ensureMigrationHistoryTable(db: any) {
  if (db.type === 'postgres') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `, [])
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `, [])
  }
}

async function getMigrationHistory(db: any): Promise<Set<string>> {
  const rows = await db.query('SELECT migration_name FROM migration_history', [])
  return new Set(rows.map((r: any) => r.migration_name))
}

async function getAllMigrations(): Promise<Migration[]> {
  const files = fs.readdirSync(MIGRATIONS_DIR)

  // 根据数据库类型筛选迁移文件
  const migrationFiles = files.filter(f => {
    if (f === '000_init_schema.sql' || f === '000_init_schema.pg.sql') {
      return false // 跳过初始化脚本
    }
    if (DB_TYPE === 'postgres') {
      return f.endsWith('.pg.sql') || (f.endsWith('.sql') && !f.includes('.pg.'))
    } else {
      return f.endsWith('.sql') && !f.endsWith('.pg.sql')
    }
  })

  const db = getDatabase()
  const executedMigrations = await getMigrationHistory(db)

  return migrationFiles
    .map(file => {
      const match = file.match(/^(\d{3})_(.+)\.(?:pg\.)?sql$/)
      if (!match) return null

      const [, number, name] = match
      return {
        number,
        name: name.replace(/_/g, ' '),
        file,
        executed: executedMigrations.has(file),
        executedAt: undefined
      }
    })
    .filter(Boolean)
    .sort((a, b) => a!.number.localeCompare(b!.number)) as Migration[]
}

async function showMigrationStatus(db: any) {
  const migrations = await getAllMigrations()

  console.log('📋 迁移状态:\n')
  console.log('序号 | 状态      | 迁移名称')
  console.log('-----|-----------|' + '-'.repeat(60))

  for (const m of migrations) {
    const status = m.executed ? '✅ 已执行' : '⏳ 待执行'
    console.log(`${m.number} | ${status} | ${m.name}`)
  }

  const pending = migrations.filter(m => !m.executed).length
  const total = migrations.length

  console.log('\n📊 统计:')
  console.log(`   - 总计: ${total}`)
  console.log(`   - 已执行: ${total - pending}`)
  console.log(`   - 待执行: ${pending}`)
}

async function runPendingMigrations(db: any) {
  const migrations = await getAllMigrations()
  const pending = migrations.filter(m => !m.executed)

  if (pending.length === 0) {
    console.log('✅ 所有迁移已执行，无需操作\n')
    return
  }

  console.log(`📋 发现 ${pending.length} 个待执行的迁移:\n`)

  for (const migration of pending) {
    console.log(`🔄 执行迁移 ${migration.number}: ${migration.name}`)
    await executeMigration(db, migration)
    console.log(`✅ 迁移 ${migration.number} 执行成功\n`)
  }

  console.log('✅ 所有迁移执行完成！\n')
}

async function runSpecificMigration(db: any, number: string) {
  const migrations = await getAllMigrations()
  const migration = migrations.find(m => m.number === number)

  if (!migration) {
    console.error(`❌ 未找到迁移: ${number}`)
    process.exit(1)
  }

  if (migration.executed) {
    console.log(`⚠️  迁移 ${number} 已经执行过，跳过`)
    return
  }

  console.log(`🔄 执行迁移 ${migration.number}: ${migration.name}\n`)
  await executeMigration(db, migration)
  console.log(`✅ 迁移 ${migration.number} 执行成功！\n`)
}

async function executeMigration(db: any, migration: Migration) {
  const filePath = path.join(MIGRATIONS_DIR, migration.file)
  const sqlContent = fs.readFileSync(filePath, 'utf-8')

  if (db.type === 'postgres') {
    await executePostgresMigration(db, sqlContent, migration)
  } else {
    await executeSQLiteMigration(db, sqlContent, migration)
  }

  // 记录迁移历史
  await db.exec(
    'INSERT INTO migration_history (migration_name) VALUES ($1)',
    [migration.file]
  )
}

async function executePostgresMigration(db: any, sqlContent: string, migration: Migration) {
  const sql = (db as any).getRawConnection()

  try {
    await sql.begin(async (tx: any) => {
      await tx.unsafe(sqlContent)
    })
  } catch (error: any) {
    console.error(`❌ PostgreSQL迁移失败: ${migration.file}`)
    console.error(`   错误: ${error.message}`)
    throw error
  }
}

async function executeSQLiteMigration(db: any, sqlContent: string, migration: Migration) {
  const rawDb = (db as any).getRawDatabase()

  // 分割SQL语句
  const statements = sqlContent
    .split(/;\s*\n/)
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

  const transaction = rawDb.transaction(() => {
    for (const stmt of statements) {
      try {
        rawDb.exec(stmt)
      } catch (error: any) {
        // 忽略"已存在"的错误
        if (!error.message.includes('already exists')) {
          console.error(`⚠️  SQL执行失败: ${stmt.substring(0, 80)}...`)
          console.error(`   错误: ${error.message}`)
          throw error
        }
      }
    }
  })

  try {
    transaction()
  } catch (error: any) {
    console.error(`❌ SQLite迁移失败: ${migration.file}`)
    console.error(`   错误: ${error.message}`)
    throw error
  }
}

// 运行主程序
main()
