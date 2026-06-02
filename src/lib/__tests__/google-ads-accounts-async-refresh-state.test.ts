import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisFns = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  client: null as {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  } | null,
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
  type: 'postgres' as 'postgres' | 'sqlite',
}))

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => redisFns.client),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: dbFns.type,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

import { getRedisClient } from '@/lib/redis-client'
import {
  buildGoogleAdsAccountSyncKey,
  cleanupStaleGoogleAdsAccountAsyncRefreshRows,
  completeGoogleAdsAccountAsyncRefresh,
  getGoogleAdsAccountAsyncRefreshState,
  renewGoogleAdsAccountAsyncRefreshLock,
  resetGoogleAdsAccountAsyncRefreshCleanupThrottleForTests,
  tryStartGoogleAdsAccountAsyncRefresh,
} from '@/lib/google-ads-accounts-async-refresh-state'

const syncKeyParams = {
  userId: 7,
  authType: 'oauth' as const,
  serviceAccountId: null,
}

describe('google-ads-accounts-async-refresh-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGoogleAdsAccountAsyncRefreshCleanupThrottleForTests()
    dbFns.type = 'postgres'
    redisFns.client = {
      get: redisFns.get,
      set: redisFns.set,
      del: redisFns.del,
    }
    vi.mocked(getRedisClient).mockReturnValue(redisFns.client as never)
    redisFns.get.mockResolvedValue(null)
    redisFns.set.mockResolvedValue('OK')
    redisFns.del.mockResolvedValue(1)
    dbFns.queryOne.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('buildGoogleAdsAccountSyncKey includes auth scope', () => {
    expect(
      buildGoogleAdsAccountSyncKey({
        userId: 1,
        authType: 'service_account',
        serviceAccountId: 'sa-1',
      })
    ).toBe('1:service_account:sa-1')
  })

  it('reads running state from Redis', async () => {
    const nowMs = Date.now()
    redisFns.get.mockResolvedValueOnce(
      JSON.stringify({
        status: 'running',
        startedAtMs: nowMs,
        updatedAtMs: nowMs,
      })
    )

    const state = await getGoogleAdsAccountAsyncRefreshState('7:oauth:')
    expect(state?.status).toBe('running')
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('falls back to DB when Redis is unavailable', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null)
    dbFns.queryOne.mockResolvedValueOnce({
      status: 'completed',
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
    })

    const state = await getGoogleAdsAccountAsyncRefreshState('7:oauth:')
    expect(state?.status).toBe('completed')
  })

  it('acquires lock via Redis NX and awaits DB mirror', async () => {
    redisFns.set.mockResolvedValueOnce('OK')

    const acquired = await tryStartGoogleAdsAccountAsyncRefresh('7:oauth:', syncKeyParams)

    expect(acquired).toBe(true)
    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('google-ads:accounts-async-refresh:7:oauth:'),
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX'
    )
    expect(dbFns.exec).toHaveBeenCalled()
  })

  it('releases Redis lock when DB mirror fails after Redis NX', async () => {
    redisFns.set.mockResolvedValueOnce('OK')
    dbFns.exec.mockRejectedValue(new Error('db down'))

    const acquired = await tryStartGoogleAdsAccountAsyncRefresh('7:oauth:', syncKeyParams)

    expect(acquired).toBe(false)
    expect(redisFns.del).toHaveBeenCalledWith(
      expect.stringContaining('google-ads:accounts-async-refresh:7:oauth:')
    )
  })

  it('writes SQLite-compatible timestamps for lock acquire', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null)
    dbFns.type = 'sqlite'

    const acquired = await tryStartGoogleAdsAccountAsyncRefresh('7:oauth:', syncKeyParams)

    expect(acquired).toBe(true)
    const insertCall = dbFns.exec.mock.calls.find(([sql]) => String(sql).includes('INSERT'))
    const insertParams = insertCall?.[1] as unknown[] | undefined
    expect(insertParams?.[4]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(String(insertParams?.[4])).not.toContain('T')
  })

  it('does not start when another instance holds a fresh Redis lock', async () => {
    const nowMs = Date.now()
    redisFns.get.mockResolvedValue(
      JSON.stringify({
        status: 'running',
        startedAtMs: nowMs,
        updatedAtMs: nowMs,
      })
    )
    redisFns.set.mockResolvedValueOnce(null)

    const acquired = await tryStartGoogleAdsAccountAsyncRefresh('7:oauth:', syncKeyParams)

    expect(acquired).toBe(false)
    const lockInsert = dbFns.exec.mock.calls.find(([sql]) => String(sql).includes('INSERT'))
    expect(lockInsert).toBeUndefined()
  })

  it('renews running lock in Redis and DB', async () => {
    const startedAtMs = Date.now() - 60_000

    await renewGoogleAdsAccountAsyncRefreshLock('7:oauth:', syncKeyParams, startedAtMs)

    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('7:oauth:'),
      expect.stringContaining('"status":"running"'),
      'EX',
      expect.any(Number)
    )
    expect(dbFns.exec).toHaveBeenCalled()
    const upsertParams = dbFns.exec.mock.calls.at(-1)?.[1] as unknown[] | undefined
    expect(upsertParams?.[4]).toBe('running')
  })

  it('persists completed state to Redis and DB', async () => {
    await completeGoogleAdsAccountAsyncRefresh('7:oauth:', syncKeyParams, {
      status: 'completed',
    })

    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('7:oauth:'),
      expect.stringContaining('"status":"completed"'),
      'EX',
      expect.any(Number)
    )
    expect(dbFns.exec).toHaveBeenCalled()
  })

  it('deletes old rows during cleanup', async () => {
    dbFns.type = 'sqlite'
    await cleanupStaleGoogleAdsAccountAsyncRefreshRows()

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM google_ads_accounts_async_refresh_state')
    )
  })
})
