import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextCacheForOwner: vi.fn(async () => {}),
}))

const assignmentFns = vi.hoisted(() => ({
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  invalidateGoogleAdsAuthContextCacheForOwner:
    authContextFns.invalidateGoogleAdsAuthContextCacheForOwner,
}))

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

import { refreshAccessToken } from '@/lib/google-ads/oauth/oauth'

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      assignment: null,
      isShared: false,
    })
    dbFns.queryOne.mockResolvedValue({
      client_id: 'cid',
      client_secret: 'secret',
      refresh_token: 'rt',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'new-access', expires_in: 3600 }),
      }))
    )
  })

  it('updates credentials and busts owner auth-context cache', async () => {
    const result = await refreshAccessToken(2)

    expect(result.access_token).toBe('new-access')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      ['new-access', expect.any(String), 1]
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextCacheForOwner).toHaveBeenCalledWith(1)
  })
})
