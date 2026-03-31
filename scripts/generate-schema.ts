#!/usr/bin/env tsx
/**
 * 生成数据库初始化 SQL 文件
 *
 * 从 db-schema.ts 单一权威来源生成：
 * - migrations/000_init_schema.sqlite.sql (SQLite)
 * - migrations/000_init_schema.pg.sql (PostgreSQL)
 *
 * 用法: npx tsx scripts/generate-schema.ts
 */

import fs from 'fs'
import path from 'path'
import { generateSQLiteSchema, generatePostgresSchema, TABLE_COUNT, SCHEMA_VERSION } from '../src/lib/db-schema-generator'

const migrationsDir = path.join(process.cwd(), 'migrations')

// 确保 migrations 目录存在
if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true })
}

console.log('🚀 开始生成数据库 Schema 文件...\n')
console.log(`📊 Schema 版本: ${SCHEMA_VERSION}`)
console.log(`📊 表数量: ${TABLE_COUNT}\n`)

// 生成 SQLite Schema
const sqliteSchema = generateSQLiteSchema()
const sqlitePath = path.join(migrationsDir, '000_init_schema.sqlite.sql')
fs.writeFileSync(sqlitePath, sqliteSchema)
console.log(`✅ SQLite Schema: ${sqlitePath}`)
console.log(`   大小: ${(sqliteSchema.length / 1024).toFixed(2)} KB`)

// 生成 PostgreSQL Schema
const postgresSchema = generatePostgresSchema()
const postgresPath = path.join(migrationsDir, '000_init_schema.pg.sql')
fs.writeFileSync(postgresPath, postgresSchema)
console.log(`✅ PostgreSQL Schema: ${postgresPath}`)
console.log(`   大小: ${(postgresSchema.length / 1024).toFixed(2)} KB`)

console.log('\n✅ Schema 文件生成完成！')
console.log('\n使用方法:')
console.log('  SQLite:     npm run db:init')
console.log('  PostgreSQL: Docker容器启动时自动执行 scripts/db-init.ts')
