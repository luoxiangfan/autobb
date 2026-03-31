#!/usr/bin/env tsx
/**
 * 重建本地 SQLite 数据库（基于初始化 schema + migrations 增量迁移）
 *
 * 使用方式：
 *   1) 默认路径：tsx scripts/rebuild-sqlite-db.ts
 *   2) 指定路径：DATABASE_PATH=/path/to/autoads.db tsx scripts/rebuild-sqlite-db.ts
 *
 * 行为：
 * - 备份现有 DB / WAL / SHM 文件（同目录 .bak-时间戳 后缀）
 * - 用 migrations/000_init_schema_consolidated.sqlite.sql 重建基础表结构
 * - 使用 better-sqlite3 直接执行增量迁移（migrations/ 下除 000_ 外的 .sql）
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function moveIfExists(filePath: string, suffix: string): void {
  if (!fs.existsSync(filePath)) return
  const backupPath = `${filePath}.${suffix}`
  fs.renameSync(filePath, backupPath)
  console.log(`✅ 已备份: ${filePath} -> ${backupPath}`)
}

function isIgnorableSqliteMigrationError(message: string): boolean {
  // 仅忽略“幂等性相关”的常见错误；其它错误一律中止
  const patterns: RegExp[] = [
    /duplicate column name/i,
    /already exists/i,
    /duplicate index/i,
    /UNIQUE constraint failed/i,
    /no such (table|index|trigger|view):/i, // 迁移中常见的 DROP ... IF EXISTS 兼容问题
  ]
  return patterns.some(p => p.test(message))
}

/**
 * 将 SQL 文本切分为“顶层语句”列表（支持 SQLite trigger 的 BEGIN...END; 语法块）
 * - 忽略行注释（-- ...）
 * - 支持块注释（/* ... *\/）
 * - 避免在字符串字面量/标识符引号内分割
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''

  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let inTrigger = false

  const pushCurrent = () => {
    const trimmed = current.trim()
    if (trimmed) statements.push(trimmed)
    current = ''
    inTrigger = false
  }

  const endsWithTriggerEnd = (text: string): boolean => {
    // 判断当前 trigger 语句是否以 END [;] 结尾（忽略大小写与空白）
    // 这里在遇到分号时调用，所以只需检查分号前的最后一个 token 是否为 END
    const withoutTrailing = text.replace(/[\s;]*$/g, '')
    const m = withoutTrailing.match(/\bEND\b\s*$/i)
    return !!m
  }

  const maybeEnterTrigger = () => {
    if (inTrigger) return
    const prefix = current.trimStart().slice(0, 60).toUpperCase()
    if (prefix.startsWith('CREATE TRIGGER') || prefix.startsWith('CREATE TEMP TRIGGER')) {
      inTrigger = true
    }
  }

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        current += ch
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }

    // comment start
    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true
        i++
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }
    }

    // quote toggle (handle escaped single quote '' inside string)
    if (!inDoubleQuote && !inBacktick) {
      if (ch === '\'' && !inSingleQuote) {
        inSingleQuote = true
      } else if (ch === '\'' && inSingleQuote) {
        if (next === '\'') {
          // escaped ''
          current += ch + next
          i++
          continue
        }
        inSingleQuote = false
      }
    }

    if (!inSingleQuote && !inBacktick) {
      if (ch === '"' && !inDoubleQuote) inDoubleQuote = true
      else if (ch === '"' && inDoubleQuote) inDoubleQuote = false
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '`' && !inBacktick) inBacktick = true
      else if (ch === '`' && inBacktick) inBacktick = false
    }

    current += ch
    maybeEnterTrigger()

    // statement delimiter
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && ch === ';') {
      if (inTrigger) {
        if (endsWithTriggerEnd(current)) {
          pushCurrent()
        }
      } else {
        pushCurrent()
      }
    }
  }

  if (current.trim()) {
    statements.push(current.trim())
  }

  return statements
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
  const dataDir = path.dirname(dbPath)
  const schemaPath = path.join(process.cwd(), 'migrations', '000_init_schema_consolidated.sqlite.sql')
  const migrationsDir = path.join(process.cwd(), 'migrations')

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`找不到初始化文件: ${schemaPath}`)
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const suffix = `bak-${timestamp()}`
  moveIfExists(dbPath, suffix)
  moveIfExists(`${dbPath}-wal`, suffix)
  moveIfExists(`${dbPath}-shm`, suffix)

  const { default: Database } = await import('better-sqlite3').catch((error: any) => {
    const message = error?.message || String(error)
    throw new Error(
      `无法加载 better-sqlite3（本机 Node 版本与已编译的 native 模块不匹配）。\n` +
      `建议使用 Node 20 运行本脚本（例如 nvm 安装的 v20），或执行 npm rebuild better-sqlite3。\n` +
      `原始错误: ${message}`
    )
  })

  console.log(`\n🧱 使用初始化文件创建SQLite数据库: ${dbPath}`)
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8')
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.exec(schemaSql)

    // ✅ 为后续迁移准备基础管理员用户（部分迁移会写入 created_by = 1）
    // 这里只用于满足外键约束，不涉及真实密码/登录逻辑
    db.exec(`
      INSERT OR IGNORE INTO users (
        id, username, email, password_hash, display_name,
        role, package_type, package_expires_at,
        must_change_password, is_active, created_at, updated_at
      ) VALUES (
        1, 'autoads', 'admin@autoads.com', 'rebuild-placeholder-hash', 'AutoAds Administrator',
        'admin', 'lifetime', '2099-12-31T23:59:59.000Z',
        1, 1, datetime('now'), datetime('now')
      );
    `)
  } finally {
    // 后续还需要执行增量迁移，暂不关闭
  }
  console.log('✅ 初始化 schema 执行完成')

  console.log('\n🔄 执行增量迁移（migrations/）...')
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`找不到 migrations 目录: ${migrationsDir}`)
  }

  // migration_history：与应用内迁移系统保持一致（含 file_hash）
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      file_hash TEXT,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // 兼容：旧 schema 里的 migration_history 可能缺少 file_hash 列
  const mhCols = db.prepare(`PRAGMA table_info(migration_history)`).all() as Array<{ name: string }>
  const hasFileHash = mhCols.some(col => col.name === 'file_hash')
  if (!hasFileHash) {
    db.exec(`ALTER TABLE migration_history ADD COLUMN file_hash TEXT`)
  }

  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .filter(file => !file.endsWith('.pg.sql'))
    .filter(file => !file.startsWith('000_'))
    .filter(file => !file.includes('archived'))
    .sort()

  console.log(`📋 发现 ${migrationFiles.length} 个迁移文件`)

  const upsertStmt = db.prepare(`
    INSERT INTO migration_history (migration_name, file_hash, executed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(migration_name) DO UPDATE SET
      file_hash = excluded.file_hash,
      executed_at = datetime('now')
  `)

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf-8')
    const hash = crypto.createHash('md5').update(sql).digest('hex')

    try {
      const statements = splitSqlStatements(sql)
      for (const stmt of statements) {
        if (!stmt.trim()) continue
        try {
          db.exec(stmt)
        } catch (stmtError: any) {
          const msg = stmtError?.message || String(stmtError)
          if (isIgnorableSqliteMigrationError(msg)) {
            continue
          }
          throw stmtError
        }
      }
      upsertStmt.run(file, hash)
      process.stdout.write(`✅ ${file}\n`)
    } catch (error: any) {
      const message = error?.message || String(error)
      process.stdout.write(`❌ ${file}\n`)
      throw new Error(`迁移失败: ${file}\n错误: ${message}`)
    }
  }

  db.close()

  console.log('\n🎉 SQLite 数据库重建完成')
}

main().catch((error) => {
  console.error('❌ 重建失败:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
