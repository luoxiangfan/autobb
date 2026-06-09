import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  type: 'sqlite' as const,
  exec: vi.fn(),
  queryOne: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

import { syncGoogleAdsOAuthFieldsFromSettings } from '@/lib/google-ads-oauth'

describe('syncGoogleAdsOAuthFieldsFromSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue(undefined)
  })

  it('returns false when no refresh token on file', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      refresh_token: '',
      is_active: 1,
    })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, { client_id: 'new-id.apps.googleusercontent.com' })
    ).resolves.toBe(false)
    expect(dbFns.exec).not.toHaveBeenCalled()
  })

  it('syncs oauth fields when refresh token exists', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        refresh_token: 'rt-1',
        is_active: 1,
      })
      .mockResolvedValueOnce({ user_id: 1 })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, {
        client_id: '123.apps.googleusercontent.com',
        developer_token: 'dev-token-123456789012345',
      })
    ).resolves.toBe(true)

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      expect.arrayContaining(['123.apps.googleusercontent.com', 'dev-token-123456789012345', 1])
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(1)
  })

  it('rejects invalid developer_token when syncing', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        refresh_token: 'rt-1',
        client_secret: 'GOCSPX-real-secret',
        is_active: 1,
      })
      .mockResolvedValueOnce({ user_id: 1 })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, {
        developer_token: 'GOCSPX-mistaken-token',
      })
    ).rejects.toThrow(/Developer Token/)
    expect(dbFns.exec).not.toHaveBeenCalled()
  })
})
