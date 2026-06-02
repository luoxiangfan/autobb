import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisFns = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  client: null as { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } | null,
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => redisFns.client),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres' as const,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

import { getRedisClient } from '@/lib/redis-client'
import {
  buildGoogleAdsAccountSyncKey,
  completeGoogleAdsAccountAsyncRefresh,
  getGoogleAdsAccountAsyncRefreshState,
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
    redisFns.client = {
      get: redisFns.get,
      set: redisFns.set,
    }
    vi.mocked(getRedisClient).mockReturnValue(redisFns.client as never)
    redisFns.get.mockResolvedValue(null)
    redisFns.set.mockResolvedValue('OK')
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

  it('acquires lock via Redis NX and mirrors to DB', async () => {
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
    expect(dbFns.exec).not.toHaveBeenCalled()
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
})
