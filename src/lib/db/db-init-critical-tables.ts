import type { DatabaseAdapter } from './database'
import { DB_INIT_CRITICAL_TABLES, DB_INIT_SMART_MIN_TABLE_COUNT } from './db-init-constants'

export async function countExistingPublicTables(
  db: DatabaseAdapter,
  tables: readonly string[] = DB_INIT_CRITICAL_TABLES
): Promise<number> {
  let existingCount = 0
  for (const table of tables) {
    const result = await db.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = ? AND table_name = ?)',
      ['public', table]
    )
    if (result[0]?.exists) {
      existingCount++
    }
  }
  return existingCount
}

export function isTableCountReady(
  existingCount: number,
  tables: readonly string[],
  options?: { minimumCount?: number }
): boolean {
  const required = options?.minimumCount ?? tables.length
  return existingCount >= required
}

export async function areAllCriticalTablesPresent(
  db: DatabaseAdapter,
  tables: readonly string[] = DB_INIT_CRITICAL_TABLES
): Promise<boolean> {
  const count = await countExistingPublicTables(db, tables)
  return isTableCountReady(count, tables)
}

export async function isSmartInitTablesReady(db: DatabaseAdapter): Promise<{
  existingCount: number
  ready: boolean
}> {
  const existingCount = await countExistingPublicTables(db, DB_INIT_CRITICAL_TABLES)
  return {
    existingCount,
    ready: isTableCountReady(existingCount, DB_INIT_CRITICAL_TABLES, {
      minimumCount: DB_INIT_SMART_MIN_TABLE_COUNT,
    }),
  }
}
