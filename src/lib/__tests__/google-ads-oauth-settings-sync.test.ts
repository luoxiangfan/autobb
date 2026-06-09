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

  it('returns not synced when no refresh token on file', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      refresh_token: '',
      is_active: 1,
    })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, { client_id: 'new-id.apps.googleusercontent.com' })
    ).resolves.toEqual({ synced: false, oauthClientCredentialsChanged: false })
    expect(dbFns.exec).not.toHaveBeenCalled()
  })

  it('syncs oauth fields when refresh token exists', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        refresh_token: 'rt-1',
        client_id: '123.apps.googleusercontent.com',
        client_secret: 'GOCSPX-existing',
        is_active: 1,
      })
      .mockResolvedValueOnce({ user_id: 1 })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, {
        client_id: '123.apps.googleusercontent.com',
        developer_token: 'dev-token-123456789012345',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: false })

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      expect.arrayContaining(['123.apps.googleusercontent.com', 'dev-token-123456789012345', 1])
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(1)
  })

  it('flags oauthClientCredentialsChanged when client_id changes', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        refresh_token: 'rt-1',
        client_id: 'old-id.apps.googleusercontent.com',
        client_secret: 'GOCSPX-existing',
        is_active: 1,
      })
      .mockResolvedValueOnce({ user_id: 1 })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, {
        client_id: 'new-id.apps.googleusercontent.com',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: true })
  })

  it('flags oauthClientCredentialsChanged when client_secret changes', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        refresh_token: 'rt-1',
        client_id: '123.apps.googleusercontent.com',
        client_secret: 'GOCSPX-old',
        is_active: 1,
      })
      .mockResolvedValueOnce({ user_id: 1 })

    await expect(
      syncGoogleAdsOAuthFieldsFromSettings(1, {
        client_secret: 'GOCSPX-new-secret-value',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: true })
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
