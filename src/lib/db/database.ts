import postgres from 'postgres'
import { AsyncLocalStorage } from 'node:async_hooks'
import { parseDbDateTimeAsUtc } from './db-datetime'

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined>
  exec(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number }>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void> | void
}

// 无 id 列的表（主键为 cache_key / sync_key / user_id 等），INSERT 不可追加 RETURNING id
const INSERT_TABLES_WITHOUT_ID_COLUMN = new Set([
  'affiliate_product_raw_json_retirement',
  'brand_core_keyword_daily',
  'google_ads_accounts_async_refresh_state',
  'google_ads_auth_assignments',
  'openclaw_affiliate_commission_report_cache',
  'usd_exchange_rates',
])

export function prepareExecInsertSql(sql: string): string {
  let pgSql = sql.replace(/;\s*$/, '')
  const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql)
  const hasReturning = /\bRETURNING\b/i.test(pgSql)

  if (isInsert && !hasReturning) {
    const tableName = extractTableName(pgSql)
    if (!INSERT_TABLES_WITHOUT_ID_COLUMN.has(tableName)) {
      pgSql += ' RETURNING id'
    }
  }

  return pgSql
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (
    databaseUrl &&
    (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))
  ) {
    return databaseUrl
  }
  throw new Error(
    'DATABASE_URL is required (PostgreSQL). Example: postgresql://user:pass@localhost:5432/autoads'
  )
}

class PostgresAdapter implements DatabaseAdapter {
  private sql: postgres.Sql<{ bigint: number; date: Date }>
  private txStorage = new AsyncLocalStorage<any>()

  constructor(connectionString: string) {
    const cleanedUrl = connectionString.replace(/[?&]directConnection=[^&]*/g, '')
    const statementTimeoutRaw = Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || '60000')
    const statementTimeoutMs =
      Number.isFinite(statementTimeoutRaw) && statementTimeoutRaw >= 0
        ? Math.floor(statementTimeoutRaw)
        : 60000

    this.sql = postgres(cleanedUrl, {
      max: 10,
      idle_timeout: 60,
      max_lifetime: 300,
      connect_timeout: 10,
      connection: {
        statement_timeout: statementTimeoutMs,
      },
      types: {
        bigint: {
          to: 20,
          from: [20],
          parse: (x: string) => Number(x),
          serialize: (x: any) => String(x),
        },
        date: {
          to: 1184,
          from: [1082, 1114, 1184],
          serialize: (x: any) => (x instanceof Date ? x : new Date(x)).toISOString(),
          parse: (x: string) => parseDbDateTimeAsUtc(x),
        },
      },
    }) as unknown as postgres.Sql<{ bigint: number; date: Date }>
  }

  private getSqlClient(): any {
    return this.txStorage.getStore() ?? this.sql
  }

  private convertPlaceholders(sql: string): string {
    let index = 1
    return sql.replace(/\?/g, () => `$${index++}`)
  }

  private convertParams(params: any[], sql: string): any[] {
    const booleanFields = new Set([
      'is_active',
      'is_selected',
      'is_success',
      'must_change_password',
      'openclaw_enabled',
      'is_default',
      'is_manager',
      'is_manager_account',
      'enabled',
      'is_deleted',
      'is_sensitive',
      'is_required',
    ])

    const integerBooleanFields = new Set(['is_current', 'is_suspicious', 'is_resolved', 'success'])

    const fieldPositions: { field: string; paramIndex: number }[] = []
    let paramIndex = 0

    const sqlUpper = sql.toUpperCase()
    const setIndex = sqlUpper.indexOf('SET')
    if (setIndex !== -1) {
      const whereIndex = sqlUpper.indexOf('WHERE', setIndex)
      const endIndex = whereIndex !== -1 ? whereIndex : sql.length
      const setClause = sql.substring(setIndex + 3, endIndex)

      const fieldMatches = setClause.matchAll(/(\w+)\s*=\s*\?/g)
      for (const match of fieldMatches) {
        fieldPositions.push({ field: match[1], paramIndex: paramIndex++ })
      }
    }

    const whereMatches = sql.matchAll(/WHERE[^;]*/gi)
    for (const whereMatch of whereMatches) {
      const whereClause = whereMatch[0]
      const fieldMatches = whereClause.matchAll(/(\w+)\s*(?:=|IN\s*\()\s*\?/gi)
      for (const match of fieldMatches) {
        fieldPositions.push({ field: match[1], paramIndex: paramIndex++ })
      }
    }

    return params.map((p, index) => {
      if (p === undefined) return null

      const fieldPosition = fieldPositions.find((fp) => fp.paramIndex === index)
      const field = fieldPosition?.field

      if (
        field &&
        booleanFields.has(field.toLowerCase()) &&
        !integerBooleanFields.has(field.toLowerCase()) &&
        (p === 0 || p === 1)
      ) {
        return p === 1
      }

      return p
    })
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const pgSql = this.convertPlaceholders(sql)
    const cleanParams = this.convertParams(params, sql)

    if (process.env.NODE_ENV === 'development') {
      const placeholderCount = (pgSql.match(/\$[0-9]+/g) || []).length
      if (placeholderCount !== cleanParams.length) {
        console.error('❌ 参数数量不匹配!', {
          SQL: pgSql.substring(0, 200),
          占位符数量: placeholderCount,
          参数数量: cleanParams.length,
        })
      }
    }

    const result = await this.getSqlClient().unsafe(pgSql, cleanParams)
    return result as unknown as T[]
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const pgSql = this.convertPlaceholders(sql)
    const cleanParams = this.convertParams(params, sql)

    if (process.env.NODE_ENV === 'development') {
      const placeholderCount = (pgSql.match(/\$[0-9]+/g) || []).length
      if (placeholderCount !== cleanParams.length) {
        console.error('❌ 参数数量不匹配!', {
          SQL: pgSql.substring(0, 200),
          占位符数量: placeholderCount,
          参数数量: cleanParams.length,
        })
      }
    }

    const result = await this.getSqlClient().unsafe(pgSql, cleanParams)
    return result[0] as T | undefined
  }

  async exec(
    sql: string,
    params: any[] = []
  ): Promise<{ changes: number; lastInsertRowid?: number }> {
    let pgSql = this.convertPlaceholders(sql)
    const cleanParams = this.convertParams(params, sql)

    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      console.log('🔍 [PostgreSQL exec]', {
        table: extractTableName(sql),
        op: sql.trim().substring(0, 20).replace(/\s+/g, ' '),
      })
    }

    pgSql = prepareExecInsertSql(pgSql)

    let pgResult: any
    try {
      pgResult = await this.getSqlClient().unsafe(pgSql, cleanParams)
      if (isDev) {
        console.log('✅ [PostgreSQL exec] 完成:', { changes: pgResult?.count ?? pgResult?.length })
      }
    } catch (error: any) {
      console.error('❌ [PostgreSQL exec] 失败:', error.message, {
        table: extractTableName(sql),
      })
      throw error
    }

    let lastInsertRowid: number | undefined
    let changes = 0

    if (pgResult && typeof pgResult === 'object') {
      const pgAny = pgResult as any
      if (Array.isArray(pgAny) && pgAny.length > 0 && pgAny[0]?.id !== undefined) {
        changes = pgAny.length
        lastInsertRowid = pgAny[0].id
      } else if (pgAny.count !== undefined) {
        changes = typeof pgAny.count === 'number' ? pgAny.count : 0
        lastInsertRowid = pgAny.id ?? pgAny.lastInsertRowid
      } else {
        lastInsertRowid = pgAny.id ?? pgAny.lastInsertRowid
        if (lastInsertRowid !== undefined) {
          changes = 1
        }
      }
    }

    return { changes, lastInsertRowid: lastInsertRowid ?? undefined }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return (await this.getSqlClient().begin(async (tx: any) => {
      return await this.txStorage.run(tx, fn)
    })) as Promise<T>
  }

  async close(): Promise<void> {
    await this.sql.end()
  }

  getRawConnection(): postgres.Sql<{ bigint: number; date: Date }> {
    return this.sql
  }
}

function extractTableName(sql: string): string {
  const match = sql.match(/^\s*(?:INSERT|UPDATE|DELETE|SELECT)\s+(?:INTO\s+)?(\w+)/i)
  return match ? match[1] : 'unknown'
}

declare global {
  var __dbAdapter: DatabaseAdapter | undefined
}

/**
 * 获取 PostgreSQL 数据库适配器（单例）。
 * 须配置 DATABASE_URL（postgresql:// 或 postgres://）。
 */
export function getDatabase(): DatabaseAdapter {
  if (!global.__dbAdapter) {
    console.log('🐘 Initializing PostgreSQL connection...')
    global.__dbAdapter = new PostgresAdapter(requireDatabaseUrl())
  }
  return global.__dbAdapter!
}

export function closeDatabase(): void {
  if (global.__dbAdapter) {
    global.__dbAdapter.close()
    global.__dbAdapter = undefined
  }
}
