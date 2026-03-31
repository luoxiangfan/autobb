/**
 * 数据库兼容性辅助函数
 * 用于处理 PostgreSQL 和 SQLite 之间的差异
 *
 * @module db-helpers
 * @created 2025-12-30
 */

import type { DatabaseAdapter } from './db'

/**
 * 统一处理 INSERT 返回的 ID
 *
 * PostgreSQL 使用 RETURNING id 返回数组格式: [{id: 123}]
 * SQLite 使用 lastInsertRowid 返回对象格式: {lastInsertRowid: 123, changes: 1}
 *
 * @param result - db.exec() 的返回结果
 * @param dbType - 数据库类型
 * @returns 插入的记录 ID
 * @throws 如果无法提取 ID 则抛出错误
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const result = await db.exec('INSERT INTO users (...) VALUES (...)', [...])
 * const userId = await getInsertedId(result, db.type)
 * ```
 */
export function getInsertedId(
  result: { changes: number; lastInsertRowid?: number } | any,
  dbType: 'sqlite' | 'postgres'
): number {
  if (dbType === 'postgres') {
    // PostgreSQL: INSERT ... RETURNING id 返回数组 [{id: 123}]
    // 或 Result 对象同时继承 Array 和 Object
    const pgResult = result as any
    // 优先检查 lastInsertRowid（如果 db.ts 已经解析好了）
    if (pgResult.lastInsertRowid !== undefined) {
      return Number(pgResult.lastInsertRowid)
    }
    // 检查数组格式（INSERT RETURNING）
    if (Array.isArray(pgResult) && pgResult.length > 0 && pgResult[0]?.id !== undefined) {
      return Number(pgResult[0].id)
    }
    // 兜底：直接尝试访问 id 属性
    if (pgResult.id !== undefined) {
      return Number(pgResult.id)
    }
    throw new Error('PostgreSQL INSERT 未返回 id (请确保 SQL 包含 RETURNING id 或 db.exec 自动添加)')
  } else {
    // SQLite: 返回 {lastInsertRowid: 123, changes: 1}
    if (result.lastInsertRowid === undefined || result.lastInsertRowid === null) {
      throw new Error('SQLite INSERT 未返回 lastInsertRowid')
    }
    return Number(result.lastInsertRowid)
  }
}

/**
 * 生成布尔字段的 SQL 条件表达式
 *
 * PostgreSQL 使用 BOOLEAN 类型 (true/false)
 * SQLite 使用 INTEGER 类型 (1/0)
 *
 * @param field - 字段名
 * @param value - 布尔值
 * @param dbType - 数据库类型
 * @returns SQL 条件字符串
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const condition = boolCondition('is_active', true, db.type)
 * // PostgreSQL: "is_active = true"
 * // SQLite: "is_active = 1"
 * ```
 */
export function boolCondition(
  field: string,
  value: boolean,
  dbType: 'sqlite' | 'postgres'
): string {
  const sqlValue = dbType === 'postgres' ? String(value) : (value ? '1' : '0')
  return `${field} = ${sqlValue}`
}

/**
 * 将布尔值转换为数据库参数值
 *
 * PostgreSQL 使用 true/false
 * SQLite 使用 1/0
 *
 * @param value - 布尔值
 * @param dbType - 数据库类型
 * @returns 数据库参数值
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const params = [
 *   userId,
 *   boolParam(isActive, db.type),  // PostgreSQL: true, SQLite: 1
 * ]
 * ```
 */
export function boolParam(
  value: boolean,
  dbType: 'sqlite' | 'postgres'
): boolean | number {
  return dbType === 'postgres' ? value : (value ? 1 : 0)
}

/**
 * 生成当前时间的 SQL 函数
 *
 * PostgreSQL 使用 NOW() 或 CURRENT_TIMESTAMP
 * SQLite 使用 datetime('now')
 *
 * @param dbType - 数据库类型
 * @returns SQL 时间函数字符串
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const sql = `UPDATE users SET updated_at = ${nowFunc(db.type)} WHERE id = ?`
 * // PostgreSQL: "UPDATE users SET updated_at = NOW() WHERE id = ?"
 * // SQLite: "UPDATE users SET updated_at = datetime('now') WHERE id = ?"
 * ```
 */
export function nowFunc(dbType: 'sqlite' | 'postgres'): string {
  return dbType === 'postgres' ? 'NOW()' : "datetime('now')"
}

/**
 * 生成日期减去N天的 SQL 表达式
 *
 * PostgreSQL: CURRENT_DATE - INTERVAL 'N days'
 * SQLite: date('now', '-N days')
 *
 * @param days - 天数
 * @param dbType - 数据库类型
 * @returns SQL 表达式字符串
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const dateExpr = dateMinusDays(7, db.type)
 * // PostgreSQL: "CURRENT_DATE - INTERVAL '7 days'"
 * // SQLite: "date('now', '-7 days')"
 * ```
 */
export function dateMinusDays(days: number, dbType: 'sqlite' | 'postgres'): string {
  return dbType === 'postgres'
    ? `CURRENT_DATE - INTERVAL '${days} days'`
    : `date('now', '-${days} days')`
}

/**
 * 生成时间戳减去N小时的 SQL 表达式
 *
 * PostgreSQL: CURRENT_TIMESTAMP - INTERVAL 'N hours'
 * SQLite: datetime('now', '-N hours')
 *
 * @param hours - 小时数
 * @param dbType - 数据库类型
 * @returns SQL 表达式字符串
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const timeExpr = datetimeMinusHours(2, db.type)
 * // PostgreSQL: "CURRENT_TIMESTAMP - INTERVAL '2 hours'"
 * // SQLite: "datetime('now', '-2 hours')"
 * ```
 */
export function datetimeMinusHours(hours: number, dbType: 'sqlite' | 'postgres'): string {
  return dbType === 'postgres'
    ? `CURRENT_TIMESTAMP - INTERVAL '${hours} hours'`
    : `datetime('now', '-${hours} hours')`
}

/**
 * 生成时间戳减去N分钟的 SQL 表达式
 *
 * PostgreSQL: CURRENT_TIMESTAMP - INTERVAL 'N minutes'
 * SQLite: datetime('now', '-N minutes')
 *
 * @param minutes - 分钟数
 * @param dbType - 数据库类型
 * @returns SQL 表达式字符串
 */
export function datetimeMinusMinutes(minutes: number, dbType: 'sqlite' | 'postgres'): string {
  return dbType === 'postgres'
    ? `CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes'`
    : `datetime('now', '-${minutes} minutes')`
}

/**
 * 将数据库返回的布尔值转换为 TypeScript boolean
 *
 * PostgreSQL 返回 true/false
 * SQLite 返回 1/0
 *
 * @param value - 数据库返回的值
 * @returns TypeScript boolean
 *
 * @example
 * ```typescript
 * const row = await db.queryOne('SELECT is_active FROM users WHERE id = ?', [userId])
 * const isActive = toBool(row.is_active)  // PostgreSQL: true, SQLite: 1 => 都返回 true
 * ```
 */
export function toBool(value: any): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return value === 1 || value === '1' || value === true
}

/**
 * 高级工具：执行 INSERT 并返回完整的记录对象
 *
 * 简化了常见的 INSERT + SELECT 模式
 *
 * @param db - 数据库适配器
 * @param insertSql - INSERT SQL 语句
 * @param insertParams - INSERT 参数
 * @param selectSql - SELECT SQL 语句 (应该包含 WHERE id = ? 条件)
 * @param selectParams - SELECT 额外参数 (id 会自动添加到第一位)
 * @returns 插入后的完整记录
 *
 * @example
 * ```typescript
 * const db = await getDatabase()
 * const user = await insertAndReturn(
 *   db,
 *   'INSERT INTO users (username, email) VALUES (?, ?)',
 *   ['john', 'john@example.com'],
 *   'SELECT * FROM users WHERE id = ? AND user_id = ?',
 *   [currentUserId]  // id 会自动添加到第一位
 * )
 * ```
 */
export async function insertAndReturn<T>(
  db: DatabaseAdapter,
  insertSql: string,
  insertParams: any[],
  selectSql: string,
  selectParams: any[] = []
): Promise<T | null> {
  const result = await db.exec(insertSql, insertParams)
  const insertedId = getInsertedId(result, db.type)

  // 将 id 添加到 SELECT 参数的第一位
  const fullParams = [insertedId, ...selectParams]
  const queryResult = await db.queryOne<T>(selectSql, fullParams)
  return queryResult ?? null
}

/**
 * 批量工具：根据数据库类型选择合适的 UPSERT 语法
 *
 * PostgreSQL: INSERT ... ON CONFLICT ... DO UPDATE
 * SQLite: INSERT ... ON CONFLICT ... DO UPDATE (SQLite 3.24+)
 *
 * @param table - 表名
 * @param conflictColumns - 冲突检测列
 * @param insertColumns - 插入的列
 * @param updateColumns - 更新的列
 * @param dbType - 数据库类型
 * @returns UPSERT SQL 语句
 */
export function generateUpsertSql(
  table: string,
  conflictColumns: string[],
  insertColumns: string[],
  updateColumns: string[],
  dbType: 'sqlite' | 'postgres'
): string {
  const placeholders = insertColumns.map(() => '?').join(', ')
  const conflictClause = conflictColumns.join(', ')
  const updateClause = updateColumns
    .map(col => `${col} = excluded.${col}`)
    .join(', ')

  return `
    INSERT INTO ${table} (${insertColumns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${conflictClause})
    DO UPDATE SET ${updateClause}
  `
}
