/**
 * SQL 生成器 - 从 Schema 定义生成 PostgreSQL 初始化 SQL
 */

import {
  TABLES,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  TABLE_COUNT,
  TableDef,
  ColumnDef,
  IndexDef,
} from './db-schema'

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

function toPostgresDefault(
  value: string | number | boolean | null,
  _type: ColumnDef['type']
): string {
  if (value === null) return 'NULL'
  if (value === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  return `'${value}'`
}

function generateIndexSql(table: TableDef, idx: IndexDef): string {
  const unique = idx.unique ? 'UNIQUE ' : ''
  const whereSuffix = idx.where ? ` WHERE ${idx.where}` : ''
  return `CREATE ${unique}INDEX IF NOT EXISTS ${idx.name} ON ${table.name}(${idx.columns.join(', ')})${whereSuffix};`
}

function generatePostgresColumn(col: ColumnDef, _isPrimaryKey: boolean): string {
  const parts: string[] = [col.name]

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

  lines.push(`-- ${table.name}`)
  lines.push(`CREATE TABLE IF NOT EXISTS ${table.name} (`)

  const hasPrimaryKey = table.columns.some((col) => col.primaryKey)

  const columnDefs: string[] = []
  for (const col of table.columns) {
    columnDefs.push(`  ${generatePostgresColumn(col, hasPrimaryKey)}`)
  }

  for (const col of table.columns) {
    if (col.references) {
      const onDelete = col.references.onDelete ? ` ON DELETE ${col.references.onDelete}` : ''
      columnDefs.push(
        `  FOREIGN KEY (${col.name}) REFERENCES ${col.references.table}(${col.references.column})${onDelete}`
      )
    }
  }

  if (table.uniqueConstraints) {
    for (const cols of table.uniqueConstraints) {
      columnDefs.push(`  UNIQUE(${cols.join(', ')})`)
    }
  }

  lines.push(columnDefs.join(',\n'))
  lines.push(');')

  if (table.indexes) {
    for (const idx of table.indexes) {
      lines.push(generateIndexSql(table, idx))
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

  for (const table of TABLES) {
    lines.push(generatePostgresTable(table))
  }

  lines.push('-- ==========================================')
  lines.push('-- Default System Settings')
  lines.push('-- ==========================================')
  lines.push('')

  lines.push(
    'INSERT INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)'
  )
  lines.push('VALUES')

  const settingLines: string[] = []
  for (const setting of DEFAULT_SETTINGS) {
    const isSensitive = setting.isSensitive ? 'TRUE' : 'FALSE'
    const isRequired = setting.isRequired ? 'TRUE' : 'FALSE'
    const defaultValue = setting.defaultValue ? `'${setting.defaultValue}'` : 'NULL'

    settingLines.push(
      `  (NULL, '${setting.category}', '${setting.key}', '${setting.dataType}', ${isSensitive}, ${isRequired}, ${defaultValue}, '${setting.description}')`
    )
  }

  lines.push(settingLines.join(',\n'))
  lines.push('ON CONFLICT DO NOTHING;')

  lines.push('')
  lines.push('-- ==========================================')
  lines.push('-- Initialization Complete')
  lines.push('-- ==========================================')

  return lines.join('\n')
}

export { TABLES, DEFAULT_SETTINGS, SCHEMA_VERSION, TABLE_COUNT }
