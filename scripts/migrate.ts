#!/usr/bin/env tsx
/**
 * PostgreSQL database migration script
 *
 * Usage: DATABASE_URL=postgresql://... npm run db:migrate
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { splitSqlStatements } from '../src/lib/sql-splitter'
import {
  listIncrementalMigrationFiles,
  migrationHistoryName,
  resolveMigrationFilePath,
} from '../src/lib/migration-file-discovery'
import { normalizeMigrationSql } from '../src/lib/migration-sql-preprocess'

const DATABASE_URL = process.env.DATABASE_URL
if (
  !DATABASE_URL ||
  (!DATABASE_URL.startsWith('postgres://') && !DATABASE_URL.startsWith('postgresql://'))
) {
  console.error('❌ DATABASE_URL is required (postgresql:// or postgres://)')
  process.exit(1)
}

const MIGRATIONS_DIR = 'migrations'

console.log('═'.repeat(60))
console.log('🔄 AutoAds 数据库迁移 (PostgreSQL)')
console.log('═'.repeat(60))
console.log(`📁 迁移目录: ${MIGRATIONS_DIR}`)
console.log('')

async function migratePostgres() {
  const postgres = (await import('postgres')).default
  const sql = postgres(DATABASE_URL!)
  console.log('✅ 数据库连接成功\n')

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        migration_name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `

    const appliedRows = await sql`SELECT migration_name FROM migration_history`
    const appliedMigrations = new Set(appliedRows.map((row) => row.migration_name))

    const migrationsPath = path.join(process.cwd(), MIGRATIONS_DIR)
    const migrationFiles = listIncrementalMigrationFiles(migrationsPath)

    console.log(`📋 发现 ${migrationFiles.length} 个迁移文件`)
    console.log(`✅ 已执行 ${appliedMigrations.size} 个迁移\n`)

    let executedCount = 0

    for (const file of migrationFiles) {
      const migrationName = migrationHistoryName(file)
      const legacyMigrationName = migrationName.replace(/\.pg\.sql$/i, '').replace(/\.sql$/i, '')

      if (appliedMigrations.has(migrationName) || appliedMigrations.has(legacyMigrationName)) {
        console.log(`⏭️  跳过: ${file} (已执行)`)
        continue
      }

      console.log(`🔄 执行: ${file}`)

      try {
        const sqlContent = normalizeMigrationSql(
          fs.readFileSync(resolveMigrationFilePath(migrationsPath, file), 'utf-8')
        )
        const statements = splitSqlStatements(sqlContent)

        await sql.begin(async (tx) => {
          for (const stmt of statements) {
            const trimmed = stmt.trim()
            if (!trimmed) continue
            try {
              await tx.unsafe(trimmed)
            } catch (error: any) {
              const errorMsg = error?.message ? String(error.message) : String(error)
              if (
                errorMsg.includes('already exists') ||
                errorMsg.includes('duplicate key value violates unique constraint')
              ) {
                console.log(`   ⏭️  Skipped (already exists): ${trimmed.substring(0, 60)}...`)
                continue
              }
              throw error
            }
          }
          await tx`INSERT INTO migration_history (migration_name) VALUES (${migrationName})`
        })

        console.log(`✅ 完成: ${file}\n`)
        executedCount++
      } catch (error: any) {
        console.error(`❌ 失败: ${file}`)
        console.error(`   错误: ${error.message}\n`)
        await sql.end()
        process.exit(1)
      }
    }

    return executedCount
  } finally {
    await sql.end()
  }
}

async function main() {
  try {
    const executedCount = await migratePostgres()

    console.log('═'.repeat(60))
    if (executedCount > 0) {
      console.log(`✅ 成功执行 ${executedCount} 个迁移！`)
    } else {
      console.log('✅ 数据库已是最新状态，无需迁移')
    }
    console.log('═'.repeat(60))
  } catch (error) {
    console.error('\n❌ 数据库迁移失败:', error)
    process.exit(1)
  }
}

main()
