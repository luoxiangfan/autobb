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

  it('writes auth context JSON with generation and configured TTL (secrets stripped)', async () => {
    await writeGoogleAdsAuthContextToRedis(7, defaultOAuthAuthContext, 2)

    expect(GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS).toBe(
      GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC * 1000
    )
    const payload = JSON.parse(String(redisFns.set.mock.calls[0][1]))
    expect(payload.generation).toBe(2)
    expect(payload.ctx.userId).toBe(defaultOAuthAuthContext.userId)
    expect(payload.ctx.secretsStripped).toBe(true)
    expect(payload.ctx.oauthCredentials?.refresh_token).toBeNull()
    expect(payload.ctx.oauthCredentials?.client_secret).toBeNull()
    expect(redisFns.set).toHaveBeenCalledWith(
      expect.stringContaining('google-ads:auth-context:7'),
      expect.any(String),
      'EX',
      GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC
    )
  })

  it('reads cached auth context when generation matches', async () => {
    redisFns.get.mockResolvedValueOnce(
      JSON.stringify({ generation: 1, ctx: defaultOAuthAuthContext })
    )

    const ctx = await readGoogleAdsAuthContextFromRedis(7, { minGeneration: 1 })

    expect(ctx?.userId).toBe(defaultOAuthAuthContext.userId)
  })

  it('rejects stale generation in Redis payload', async () => {
    redisFns.get.mockResolvedValueOnce(
      JSON.stringify({ generation: 1, ctx: defaultOAuthAuthContext })
    )

    const ctx = await readGoogleAdsAuthContextFromRedis(7, { minGeneration: 2 })

    expect(ctx).toBeNull()
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

  it('waits for peer-written cache with generation gate', async () => {
    redisFns.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({ generation: 3, ctx: defaultOAuthAuthContext })
      )

    const ctx = await waitForPeerGoogleAdsAuthContext(7, { minGeneration: 3 })

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
