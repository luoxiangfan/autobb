import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  DB_INIT_CRITICAL_TABLES,
  DB_INIT_SMART_MIN_TABLE_COUNT,
  DEFAULT_ADMIN_PROFILE,
  resolveDefaultAdminPassword,
} from '@/lib/db/db-init-constants'
import {
  countExistingPublicTables,
  isSmartInitTablesReady,
  isTableCountReady,
} from '@/lib/db/db-init-critical-tables'
import {
  defaultAdminAccountExists,
  ensureDefaultAdminAccount,
  requireDefaultAdminPasswordFromEnv,
} from '@/lib/db/db-init-admin'
import { calculateMigrationFileHash } from '@/lib/db/db-init-migration-utils'
import type { DatabaseAdapter } from '@/lib/db/database'

function createMockDb(tableExists: Record<string, boolean>): DatabaseAdapter {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema.tables')) {
        const table = String(params?.[1] ?? '')
        return [{ exists: Boolean(tableExists[table]) }]
      }
      return []
    }),
    queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM users')) {
        const username = String(params?.[0] ?? '')
        return tableExists[`user:${username}`] ? { id: 1 } : undefined
      }
      return undefined
    }),
    exec: vi.fn(async () => ({ changes: 1 })),
    transaction: vi.fn(async (fn) => fn()),
    close: vi.fn(),
  }
}

describe('db-init-constants', () => {
  beforeEach(() => {
    delete process.env.DEFAULT_ADMIN_PASSWORD
  })

  it('exposes shared critical table list and admin profile', () => {
    expect(DB_INIT_CRITICAL_TABLES).toContain('users')
    expect(DEFAULT_ADMIN_PROFILE.username).toBe('autoads')
    expect(DB_INIT_SMART_MIN_TABLE_COUNT).toBeLessThan(DB_INIT_CRITICAL_TABLES.length)
  })

  it('resolveDefaultAdminPassword prefers env and otherwise generates random secret', () => {
    process.env.DEFAULT_ADMIN_PASSWORD = 'from-env'
    expect(resolveDefaultAdminPassword()).toBe('from-env')

    delete process.env.DEFAULT_ADMIN_PASSWORD
    const generated = resolveDefaultAdminPassword()
    expect(generated.length).toBeGreaterThan(20)
  })

  it('requireDefaultAdminPasswordFromEnv throws when env is missing', () => {
    expect(() => requireDefaultAdminPasswordFromEnv()).toThrow(
      'DEFAULT_ADMIN_PASSWORD environment variable is required'
    )
  })
})

describe('db-init-critical-tables', () => {
  it('counts existing public tables via adapter', async () => {
    const db = createMockDb({ users: true, offers: true, campaigns: false })
    const count = await countExistingPublicTables(db, ['users', 'offers', 'campaigns'])
    expect(count).toBe(2)
  })

  it('isTableCountReady supports strict and smart minimum thresholds', () => {
    const tables = DB_INIT_CRITICAL_TABLES
    expect(isTableCountReady(tables.length, tables)).toBe(true)
    expect(
      isTableCountReady(DB_INIT_SMART_MIN_TABLE_COUNT, tables, {
        minimumCount: DB_INIT_SMART_MIN_TABLE_COUNT,
      })
    ).toBe(true)
    expect(
      isTableCountReady(DB_INIT_SMART_MIN_TABLE_COUNT - 1, tables, {
        minimumCount: DB_INIT_SMART_MIN_TABLE_COUNT,
      })
    ).toBe(false)
  })

  it('isSmartInitTablesReady preserves smart init threshold', async () => {
    const partial: Record<string, boolean> = {}
    for (const [index, table] of DB_INIT_CRITICAL_TABLES.entries()) {
      partial[table] = index < DB_INIT_SMART_MIN_TABLE_COUNT
    }
    const db = createMockDb(partial)
    const result = await isSmartInitTablesReady(db)
    expect(result.existingCount).toBe(DB_INIT_SMART_MIN_TABLE_COUNT)
    expect(result.ready).toBe(true)
  })
})

describe('db-init-admin', () => {
  it('creates admin when missing', async () => {
    const db = createMockDb({})
    const result = await ensureDefaultAdminAccount(db, {
      password: 'test-password',
      setOpenclawEnabled: true,
      lookupByRole: true,
      logCredentials: 'none',
    })

    expect(result.created).toBe(true)
    expect(db.exec).toHaveBeenCalled()
  })

  it('keeps password unchanged in ensure-active-only mode', async () => {
    const db = createMockDb({ 'user:autoads': true })
    const result = await ensureDefaultAdminAccount(db, {
      password: 'ignored',
      onExisting: 'ensure-active-only',
      setOpenclawEnabled: true,
      lookupByRole: true,
      logCredentials: 'none',
    })

    expect(result.created).toBe(false)
    expect(result.passwordUpdated).toBe(false)
    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('must_change_password = false'),
      expect.any(Array)
    )
  })

  it('defaultAdminAccountExists respects lookup mode', async () => {
    const db = createMockDb({ 'user:autoads': true })
    expect(await defaultAdminAccountExists(db, false)).toBe(true)
    expect(await defaultAdminAccountExists(db, true)).toBe(true)
  })
})

describe('db-init-migration-utils', () => {
  it('calculateMigrationFileHash is stable for same content', () => {
    const hashA = calculateMigrationFileHash('ALTER TABLE users ADD COLUMN x INT;')
    const hashB = calculateMigrationFileHash('ALTER TABLE users ADD COLUMN x INT;')
    expect(hashA).toBe(hashB)
    expect(hashA).toHaveLength(32)
  })
})
