import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  queryOne: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
  assertNoConflictingGoogleAdsAuth: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
  assertNoConflictingGoogleAdsAuth: authContextFns.assertNoConflictingGoogleAdsAuth,
}))

import {
  GoogleAdsSettingsAuthConflictError,
  upsertGoogleAdsOAuthConfigFromSettings,
} from '@/lib/google-ads/settings/settings-store'

describe('upsertGoogleAdsOAuthConfigFromSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue(undefined)
    authContextFns.assertNoConflictingGoogleAdsAuth.mockResolvedValue(undefined)
  })

  it('rejects oauth field save when service account is already configured', async () => {
    authContextFns.assertNoConflictingGoogleAdsAuth.mockRejectedValue(
      new Error('当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。')
    )

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, { client_id: 'new-id.apps.googleusercontent.com' })
    ).rejects.toBeInstanceOf(GoogleAdsSettingsAuthConflictError)

    expect(dbFns.exec).not.toHaveBeenCalled()
    expect(authContextFns.assertNoConflictingGoogleAdsAuth).toHaveBeenCalledWith(1, 'oauth')
  })

  it('skips auth conflict check for legacy migration path', async () => {
    authContextFns.assertNoConflictingGoogleAdsAuth.mockRejectedValue(
      new Error('当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。')
    )

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(
        1,
        { client_id: 'legacy-id.apps.googleusercontent.com' },
        { skipAuthConflictCheck: true, skipAuthContextInvalidate: true }
      )
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: false })

    expect(authContextFns.assertNoConflictingGoogleAdsAuth).not.toHaveBeenCalled()
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).not.toHaveBeenCalled()
  })

  it('creates credential row when saving config before OAuth', async () => {
    dbFns.queryOne.mockResolvedValueOnce(undefined)

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, { client_id: 'new-id.apps.googleusercontent.com' })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: false })

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO google_ads_credentials'),
      expect.arrayContaining(['new-id.apps.googleusercontent.com'])
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(1)
  })

  it('updates oauth fields on existing row', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      user_id: 1,
      client_id: '123.apps.googleusercontent.com',
      client_secret: 'GOCSPX-existing',
      refresh_token: 'rt-1',
      is_active: 1,
    })

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, {
        client_id: '123.apps.googleusercontent.com',
        developer_token: 'dev-token-123456789012345',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: false })

    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      expect.arrayContaining(['123.apps.googleusercontent.com', 'dev-token-123456789012345', 1])
    )
  })

  it('flags oauthClientCredentialsChanged when client_id changes', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      user_id: 1,
      client_id: 'old-id.apps.googleusercontent.com',
      client_secret: 'GOCSPX-existing',
      refresh_token: 'rt-1',
      is_active: 1,
    })

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, {
        client_id: 'new-id.apps.googleusercontent.com',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: true })
  })

  it('flags oauthClientCredentialsChanged when client_secret changes', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      user_id: 1,
      client_id: '123.apps.googleusercontent.com',
      client_secret: 'GOCSPX-old',
      refresh_token: 'rt-1',
      is_active: 1,
    })

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, {
        client_secret: 'GOCSPX-new-secret-value',
      })
    ).resolves.toEqual({ synced: true, oauthClientCredentialsChanged: true })
  })

  it('rejects invalid developer_token when saving', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      user_id: 1,
      client_secret: 'GOCSPX-real-secret',
      refresh_token: 'rt-1',
      is_active: 1,
    })

    await expect(
      upsertGoogleAdsOAuthConfigFromSettings(1, {
        developer_token: 'GOCSPX-mistaken-token',
      })
    ).rejects.toThrow(/Developer Token/)
    expect(dbFns.exec).not.toHaveBeenCalled()
  })

  it('uses injected db adapter for credential reads and writes', async () => {
    const injectedDb = {
      queryOne: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn(),
    }

    await upsertGoogleAdsOAuthConfigFromSettings(
      1,
      { client_id: 'injected-id.apps.googleusercontent.com' },
      { db: injectedDb, skipAuthContextInvalidate: true }
    )

    expect(injectedDb.queryOne).toHaveBeenCalled()
    expect(injectedDb.exec).toHaveBeenCalled()
    expect(dbFns.exec).not.toHaveBeenCalled()
  })
})
