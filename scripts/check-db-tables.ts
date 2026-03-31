#!/usr/bin/env tsx
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath, { readonly: true })

console.log('📊 数据库表结构检查\n')

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()
console.log(`✅ 找到 ${tables.length} 个表：`)
tables.forEach((t: any) => console.log(`  - ${t.name}`))

db.close()
