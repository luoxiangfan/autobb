/**
 * PostgreSQL database helper functions
 *
 * @module db-helpers
 */

/**
 * Extract inserted row id from db.exec() result (INSERT ... RETURNING id).
 */
export function getInsertedId(result: { changes: number; lastInsertRowid?: number } | any): number {
  const pgResult = result as any
  if (pgResult.lastInsertRowid !== undefined) {
    return Number(pgResult.lastInsertRowid)
  }
  if (Array.isArray(pgResult) && pgResult.length > 0 && pgResult[0]?.id !== undefined) {
    return Number(pgResult[0].id)
  }
  if (pgResult.id !== undefined) {
    return Number(pgResult.id)
  }
  throw new Error('PostgreSQL INSERT 未返回 id (请确保 SQL 包含 RETURNING id 或 db.exec 自动添加)')
}

export function isDbRowActive(value: unknown): boolean {
  return value === true || value === 1
}

export function boolCondition(field: string, value: boolean): string {
  return `${field} = ${String(value)}`
}

export function boolParam(value: boolean): boolean {
  return value
}

/** SQL fragment: row not soft-deleted (BOOLEAN is_deleted). */
export function notDeletedClause(alias: string): string {
  return `(${alias}.is_deleted = FALSE OR ${alias}.is_deleted IS NULL)`
}

export function nowFunc(): string {
  return 'NOW()'
}

export function dateMinusDays(days: number): string {
  return `CURRENT_DATE - INTERVAL '${days} days'`
}

export function datetimeMinusHours(hours: number): string {
  return `CURRENT_TIMESTAMP - INTERVAL '${hours} hours'`
}

export function datetimeMinusMinutes(minutes: number): string {
  return `CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes'`
}

/** Timestamp comparison: now minus N whole days. */
export function datetimeMinusDays(days: number): string {
  return `CURRENT_TIMESTAMP - INTERVAL '${days} days'`
}

/** Parameterized: CURRENT_TIMESTAMP - (? * INTERVAL '1 day'). */
export function datetimeMinusDaysParam(param = '?'): string {
  return `CURRENT_TIMESTAMP - (${param} * INTERVAL '1 day')`
}

/** Parameterized: CURRENT_TIMESTAMP - (? * INTERVAL '1 hour'). */
export function datetimeMinusHoursParam(param = '?'): string {
  return `CURRENT_TIMESTAMP - (${param} * INTERVAL '1 hour')`
}

export function toBool(value: any): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return value === 1 || value === '1' || value === true
}

export function generateUpsertSql(
  table: string,
  conflictColumns: string[],
  insertColumns: string[],
  updateColumns: string[]
): string {
  const placeholders = insertColumns.map(() => '?').join(', ')
  const conflictClause = conflictColumns.join(', ')
  const updateClause = updateColumns.map((col) => `${col} = excluded.${col}`).join(', ')

  return `
    INSERT INTO ${table} (${insertColumns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${conflictClause})
    DO UPDATE SET ${updateClause}
  `
}

export type UniqueConstraintMatchOptions = {
  /** PostgreSQL constraint name substring */
  constraint?: string
  /** Table name substring in error message */
  table?: string
}

/** Detect PostgreSQL unique constraint violations (SQLSTATE 23505). */
export function isUniqueConstraintViolation(
  error: unknown,
  options?: UniqueConstraintMatchOptions
): boolean {
  const code = String((error as { code?: string })?.code || '')
  const message = String((error as Error)?.message || error || '')

  if (code === '23505') {
    if (options?.constraint && !message.includes(options.constraint)) return false
    if (options?.table && !message.includes(options.table)) return false
    return true
  }

  if (!/duplicate key value violates unique constraint/i.test(message)) {
    return false
  }
  if (options?.constraint && !message.includes(options.constraint)) return false
  if (options?.table && !message.includes(options.table)) return false
  return true
}
