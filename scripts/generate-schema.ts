#!/usr/bin/env tsx
/**
 * 生成数据库初始化 SQL 文件
 *
 * 从 db-schema-generator 生成 migrations/000_init_schema.pg.sql（PostgreSQL）。
 * 生产 consolidated 脚本见 migrations/000_init_schema_consolidated.pg.sql。
 *
 * 用法: npx tsx scripts/generate-schema.ts
 */

import fs from 'fs'
import path from 'path'
import { generatePostgresSchema, TABLE_COUNT, SCHEMA_VERSION } from '@/lib/db/db-schema-generator'

const migrationsDir = path.join(process.cwd(), 'migrations')

if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true })
}

console.log('🚀 开始生成 PostgreSQL Schema 文件...\n')
console.log(`📊 Schema 版本: ${SCHEMA_VERSION}`)
console.log(`📊 表数量: ${TABLE_COUNT}\n`)

const postgresSchema = generatePostgresSchema()
const postgresPath = path.join(migrationsDir, '000_init_schema.pg.sql')
fs.writeFileSync(postgresPath, postgresSchema)
console.log(`✅ PostgreSQL Schema: ${postgresPath}`)
console.log(`   大小: ${(postgresSchema.length / 1024).toFixed(2)} KB`)

console.log('\n✅ Schema 文件生成完成！')
console.log('\n使用方法:')
console.log('  psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql')
console.log('  npm run db:migrate')
