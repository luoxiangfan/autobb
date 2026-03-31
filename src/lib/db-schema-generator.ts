/**
 * SQL 生成器 - 从 Schema 定义生成 SQLite 和 PostgreSQL 的 SQL
 *
 * 功能：
 * 1. 从 db-schema.ts 读取表定义
 * 2. 生成 SQLite 兼容的 SQL
 * 3. 生成 PostgreSQL 兼容的 SQL
 * 4. 生成迁移文件
 */

import { TABLES, DEFAULT_SETTINGS, SCHEMA_VERSION, TABLE_COUNT, TableDef, ColumnDef } from './db-schema'

// ============================================================================
// 类型转换
// ============================================================================

function toSQLiteType(type: ColumnDef['type']): string {
  switch (type) {
    case 'INTEGER':
    case 'BIGINT':
      return 'INTEGER'
    case 'TEXT':
    case 'JSON':
      return 'TEXT'
    case 'REAL':
      return 'REAL'
    case 'BOOLEAN':
      return 'INTEGER' // SQLite 用 0/1 表示布尔值
    case 'TIMESTAMP':
    case 'DATE':
      return 'TEXT' // SQLite 用 TEXT 存储日期时间
    default:
      return 'TEXT'
  }
}

function toPostgresType(type: ColumnDef['type']): string {
  switch (type) {
    case 'INTEGER':
      return 'INTEGER'
    case 'BIGINT':
      return 'BIGINT'
    case 'TEXT':
    case 'JSON':
      return 'TEXT'
    case 'REAL':
      return 'REAL'
    case 'BOOLEAN':
      return 'BOOLEAN'
    case 'TIMESTAMP':
      return 'TIMESTAMP'
    case 'DATE':
      return 'DATE'
    default:
      return 'TEXT'
  }
}

function toSQLiteDefault(value: string | number | boolean | null, type: ColumnDef['type']): string {
  if (value === null) return 'NULL'
  if (value === 'CURRENT_TIMESTAMP') return "(datetime('now'))"
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${value}'`
}

function toPostgresDefault(value: string | number | boolean | null, type: ColumnDef['type']): string {
  if (value === null) return 'NULL'
  if (value === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  return `'${value}'`
}

// ============================================================================
// SQLite SQL 生成
// ============================================================================

function generateSQLiteColumn(col: ColumnDef): string {
  const parts: string[] = [col.name, toSQLiteType(col.type)]

  if (col.primaryKey) {
    parts.push('PRIMARY KEY')
    if (col.autoIncrement) {
      parts.push('AUTOINCREMENT')
    }
  }

  if (col.notNull && !col.primaryKey) {
    parts.push('NOT NULL')
  }

  if (col.unique && !col.primaryKey) {
    parts.push('UNIQUE')
  }

  if (col.default !== undefined) {
    parts.push(`DEFAULT ${toSQLiteDefault(col.default, col.type)}`)
  }

  if (col.check) {
    parts.push(`CHECK(${col.check})`)
  }

  return parts.join(' ')
}

function generateSQLiteTable(table: TableDef): string {
  const lines: string[] = []

  // 开始创建表
  lines.push(`-- ${table.name}`)
  lines.push(`CREATE TABLE IF NOT EXISTS ${table.name} (`)

  // 列定义
  const columnDefs: string[] = []
  for (const col of table.columns) {
    columnDefs.push(`  ${generateSQLiteColumn(col)}`)
  }

  // 外键约束
  for (const col of table.columns) {
    if (col.references) {
      const onDelete = col.references.onDelete ? ` ON DELETE ${col.references.onDelete}` : ''
      columnDefs.push(`  FOREIGN KEY (${col.name}) REFERENCES ${col.references.table}(${col.references.column})${onDelete}`)
    }
  }

  // 唯一约束
  if (table.uniqueConstraints) {
    for (const cols of table.uniqueConstraints) {
      columnDefs.push(`  UNIQUE(${cols.join(', ')})`)
    }
  }

  lines.push(columnDefs.join(',\n'))
  lines.push(');')

  // 索引
  if (table.indexes) {
    for (const idx of table.indexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      lines.push(`CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${table.name}(${idx.columns.join(', ')});`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function generateSQLiteSchema(): string {
  const lines: string[] = []

  lines.push('-- ==========================================')
  lines.push('-- SQLite Schema Initialization')
  lines.push(`-- Version: ${SCHEMA_VERSION}`)
  lines.push(`-- Generated: ${new Date().toISOString().split('T')[0]}`)
  lines.push(`-- Tables: ${TABLE_COUNT}`)
  lines.push('-- ==========================================')
  lines.push('')
  lines.push('PRAGMA foreign_keys = ON;')
  lines.push('')

  // 生成所有表
  for (const table of TABLES) {
    lines.push(generateSQLiteTable(table))
  }

  // 生成默认系统配置
  lines.push('-- ==========================================')
  lines.push('-- Default System Settings')
  lines.push('-- ==========================================')
  lines.push('')

  for (const setting of DEFAULT_SETTINGS) {
    const isSensitive = setting.isSensitive ? 1 : 0
    const isRequired = setting.isRequired ? 1 : 0
    const defaultValue = setting.defaultValue ? `'${setting.defaultValue}'` : 'NULL'

    lines.push(`INSERT OR IGNORE INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)`)
    lines.push(`VALUES (NULL, '${setting.category}', '${setting.key}', '${setting.dataType}', ${isSensitive}, ${isRequired}, ${defaultValue}, '${setting.description}');`)
  }

  lines.push('')
  lines.push('-- ==========================================')
  lines.push('-- Initialization Complete')
  lines.push('-- ==========================================')

  return lines.join('\n')
}

// ============================================================================
// PostgreSQL SQL 生成
// ============================================================================

function generatePostgresColumn(col: ColumnDef, isPrimaryKey: boolean): string {
  const parts: string[] = [col.name]

  // 处理主键自增
  if (col.primaryKey && col.autoIncrement) {
    parts.push('SERIAL PRIMARY KEY')
    return parts.join(' ')
  }

  parts.push(toPostgresType(col.type))

  if (col.primaryKey) {
    parts.push('PRIMARY KEY')
  }

  if (col.notNull && !col.primaryKey) {
    parts.push('NOT NULL')
  }

  if (col.unique && !col.primaryKey) {
    parts.push('UNIQUE')
  }

  if (col.default !== undefined) {
    parts.push(`DEFAULT ${toPostgresDefault(col.default, col.type)}`)
  }

  if (col.check) {
    parts.push(`CHECK(${col.check})`)
  }

  return parts.join(' ')
}

function generatePostgresTable(table: TableDef): string {
  const lines: string[] = []

  // 开始创建表
  lines.push(`-- ${table.name}`)
  lines.push(`CREATE TABLE IF NOT EXISTS ${table.name} (`)

  // 检查是否有主键
  const hasPrimaryKey = table.columns.some(col => col.primaryKey)

  // 列定义
  const columnDefs: string[] = []
  for (const col of table.columns) {
    columnDefs.push(`  ${generatePostgresColumn(col, hasPrimaryKey)}`)
  }

  // 外键约束
  for (const col of table.columns) {
    if (col.references) {
      const onDelete = col.references.onDelete ? ` ON DELETE ${col.references.onDelete}` : ''
      columnDefs.push(`  FOREIGN KEY (${col.name}) REFERENCES ${col.references.table}(${col.references.column})${onDelete}`)
    }
  }

  // 唯一约束
  if (table.uniqueConstraints) {
    for (const cols of table.uniqueConstraints) {
      columnDefs.push(`  UNIQUE(${cols.join(', ')})`)
    }
  }

  lines.push(columnDefs.join(',\n'))
  lines.push(');')

  // 索引
  if (table.indexes) {
    for (const idx of table.indexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      lines.push(`CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${table.name}(${idx.columns.join(', ')});`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function generatePostgresSchema(): string {
  const lines: string[] = []

  lines.push('-- ==========================================')
  lines.push('-- PostgreSQL Schema Initialization')
  lines.push(`-- Version: ${SCHEMA_VERSION}`)
  lines.push(`-- Generated: ${new Date().toISOString().split('T')[0]}`)
  lines.push(`-- Tables: ${TABLE_COUNT}`)
  lines.push('-- ==========================================')
  lines.push('')

  // 生成所有表
  for (const table of TABLES) {
    lines.push(generatePostgresTable(table))
  }

  // 生成默认系统配置
  lines.push('-- ==========================================')
  lines.push('-- Default System Settings')
  lines.push('-- ==========================================')
  lines.push('')

  lines.push('INSERT INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)')
  lines.push('VALUES')

  const settingLines: string[] = []
  for (const setting of DEFAULT_SETTINGS) {
    const isSensitive = setting.isSensitive ? 'TRUE' : 'FALSE'
    const isRequired = setting.isRequired ? 'TRUE' : 'FALSE'
    const defaultValue = setting.defaultValue ? `'${setting.defaultValue}'` : 'NULL'

    settingLines.push(`  (NULL, '${setting.category}', '${setting.key}', '${setting.dataType}', ${isSensitive}, ${isRequired}, ${defaultValue}, '${setting.description}')`)
  }

  lines.push(settingLines.join(',\n'))
  lines.push('ON CONFLICT DO NOTHING;')

  lines.push('')
  lines.push('-- ==========================================')
  lines.push('-- Initialization Complete')
  lines.push('-- ==========================================')

  return lines.join('\n')
}

// ============================================================================
// 导出函数
// ============================================================================

export { TABLES, DEFAULT_SETTINGS, SCHEMA_VERSION, TABLE_COUNT }
