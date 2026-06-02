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

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => redisFns.client),
}))

import { getRedisClient } from '@/lib/redis-client'
import {
  GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS,
  GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC,
  invalidateGoogleAdsAuthContextRedis,
  readGoogleAdsAuthContextFromRedis,
  tryAcquireGoogleAdsAuthContextInflightLock,
  waitForPeerGoogleAdsAuthContext,
  writeGoogleAdsAuthContextToRedis,
} from '@/lib/google-ads-auth-context-redis'
import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'

describe('google-ads-auth-context-redis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisFns.client = {
      get: redisFns.get,
      set: redisFns.set,
      del: redisFns.del,
    }
    vi.mocked(getRedisClient).mockReturnValue(redisFns.client as never)
    redisFns.get.mockResolvedValue(null)
    redisFns.set.mockResolvedValue('OK')
    redisFns.del.mockResolvedValue(1)
  })

  it('writes auth context JSON with short TTL', async () => {
    await writeGoogleAdsAuthContextToRedis(7, defaultOAuthAuthContext)

    expect(GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS).toBe(
      GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC * 1000
    )
    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('google-ads:auth-context:7'),
      expect.any(String),
      'EX',
      2
    )
  })

  it('reads cached auth context from Redis', async () => {
    redisFns.get.mockResolvedValueOnce(JSON.stringify(defaultOAuthAuthContext))

    const ctx = await readGoogleAdsAuthContextFromRedis(7)

    expect(ctx?.userId).toBe(defaultOAuthAuthContext.userId)
  })

  it('acquires inflight lock with NX', async () => {
    redisFns.set.mockResolvedValueOnce('OK')

    const acquired = await tryAcquireGoogleAdsAuthContextInflightLock(7)

    expect(acquired).toBe(true)
    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('auth-context:inflight:7'),
      '1',
      'EX',
      expect.any(Number),
      'NX'
    )
  })

  it('waits for peer-written cache', async () => {
    redisFns.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(defaultOAuthAuthContext))

    const ctx = await waitForPeerGoogleAdsAuthContext(7)

    expect(ctx?.userId).toBe(defaultOAuthAuthContext.userId)
  })

  it('invalidates cache and inflight keys', async () => {
    await invalidateGoogleAdsAuthContextRedis(7)

    expect(redisFns.del).toHaveBeenCalledWith(
      expect.stringContaining('google-ads:auth-context:7'),
      expect.stringContaining('auth-context:inflight:7')
    )
  })
})
