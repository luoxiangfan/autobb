import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, GET, PUT } from '@/app/api/settings/route'

const settingsFns = vi.hoisted(() => ({
  clearUserSettings: vi.fn(),
  getAllSettings: vi.fn(),
  getSettingsByCategory: vi.fn(),
  getUserOnlySettingsByCategory: vi.fn(),
  updateSettings: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  invalidateProxyPoolCache: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const authAssignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
}))

const settingsStoreFns = vi.hoisted(() => ({
  upsertGoogleAdsOAuthConfigFromSettings: vi.fn(),
  overlayGoogleAdsSettingsFromCredentialStore: vi.fn(
    async (settings: unknown[]) => settings as unknown[]
  ),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: authAssignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-settings-store')>()
  return {
    ...actual,
    upsertGoogleAdsOAuthConfigFromSettings: settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings,
    overlayGoogleAdsSettingsFromCredentialStore:
      settingsStoreFns.overlayGoogleAdsSettingsFromCredentialStore,
  }
})

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

vi.mock('@/lib/settings', () => ({
  clearUserSettings: settingsFns.clearUserSettings,
  getAllSettings: settingsFns.getAllSettings,
  getSettingsByCategory: settingsFns.getSettingsByCategory,
  getUserOnlySettingsByCategory: settingsFns.getUserOnlySettingsByCategory,
  updateSettings: settingsFns.updateSettings,
}))

vi.mock('@/lib/offer-utils', () => ({
  invalidateProxyPoolCache: offerFns.invalidateProxyPoolCache,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('settings route affiliate sync safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockResolvedValue({
      queryOne: vi.fn().mockResolvedValue(null),
      transaction: vi.fn(async (cb: () => Promise<void>) => cb()),
    })
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockResolvedValue({
      synced: true,
      oauthClientCredentialsChanged: false,
    })
    settingsStoreFns.overlayGoogleAdsSettingsFromCredentialStore.mockImplementation(
      async (settings) => settings
    )
    settingsFns.getAllSettings.mockResolvedValue([
      {
        category: 'affiliate_sync',
        key: 'partnerboost_base_url',
        value: 'https://custom.example.com',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'PartnerBoost API Base URL',
      },
      {
        category: 'affiliate_sync',
        key: 'openclaw_affiliate_sync_interval_hours',
        value: '12',
        dataType: 'number',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '佣金同步间隔',
      },
    ])
    settingsFns.getUserOnlySettingsByCategory.mockResolvedValue([
      {
        category: 'affiliate_sync',
        key: 'partnerboost_base_url',
        value: 'https://custom-user.example.com',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'PartnerBoost API Base URL',
      },
      {
        category: 'affiliate_sync',
        key: 'openclaw_affiliate_sync_interval_hours',
        value: '12',
        dataType: 'number',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '佣金同步间隔',
      },
    ])
    settingsFns.updateSettings.mockResolvedValue(undefined)
    settingsFns.clearUserSettings.mockResolvedValue({ cleared: 0 })
  })

  it('returns fixed defaults for affiliate sync readonly fields', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const payload = await res.json()
    const affiliateSettings = payload.settings.affiliate_sync

    expect(res.status).toBe(200)
    expect(affiliateSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'partnerboost_base_url',
          value: 'https://app.partnerboost.com',
        }),
        expect.objectContaining({ key: 'openclaw_affiliate_sync_interval_hours', value: '1' }),
      ])
    )
  })

  it('reads affiliate_sync category from user-only settings', async () => {
    settingsFns.getSettingsByCategory.mockResolvedValue([
      {
        category: 'affiliate_sync',
        key: 'partnerboost_base_url',
        value: 'https://global.example.com',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
      },
    ])

    const req = new NextRequest('http://localhost/api/settings?category=affiliate_sync', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getUserOnlySettingsByCategory).toHaveBeenCalledWith('affiliate_sync', 7)
    expect(settingsFns.getSettingsByCategory).not.toHaveBeenCalled()
    expect(payload.settings.affiliate_sync).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'partnerboost_base_url',
          value: 'https://app.partnerboost.com',
        }),
      ])
    )
  })

  it('forces fixed defaults when saving affiliate sync readonly fields', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [
          {
            category: 'affiliate_sync',
            key: 'partnerboost_base_url',
            value: 'https://custom.example.com',
          },
          {
            category: 'affiliate_sync',
            key: 'openclaw_affiliate_sync_interval_hours',
            value: '12',
          },
          { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [
        {
          category: 'affiliate_sync',
          key: 'partnerboost_base_url',
          value: 'https://app.partnerboost.com',
        },
        { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_interval_hours', value: '1' },
        { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
      ],
      7
    )
  })

  it('rejects affiliate_sync updates when user context is missing', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        updates: [{ category: 'affiliate_sync', key: 'yeahpromos_site_id', value: '11282' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('需要登录')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('deletes affiliate_sync config for current user', async () => {
    settingsFns.clearUserSettings.mockResolvedValue({ cleared: 4 })

    const req = new NextRequest('http://localhost/api/settings', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        category: 'affiliate_sync',
      }),
    })

    const res = await DELETE(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.category).toBe('affiliate_sync')
    expect(payload.target).toBe('affiliate-sync')
    expect(settingsFns.clearUserSettings).toHaveBeenCalledWith(
      'affiliate_sync',
      [
        'yeahpromos_token',
        'yeahpromos_site_id',
        'partnerboost_token',
        'partnerboost_base_url',
        'openclaw_affiliate_sync_interval_hours',
        'openclaw_affiliate_sync_mode',
      ],
      7
    )
  })

  it('rejects affiliate_sync delete when user context is missing', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        category: 'affiliate_sync',
      }),
    })

    const res = await DELETE(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toBeTruthy()
    expect(settingsFns.clearUserSettings).not.toHaveBeenCalled()
  })
})

describe('settings route google ads credential store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockResolvedValue({
      queryOne: vi.fn().mockResolvedValue(null),
      transaction: vi.fn(async (cb: () => Promise<void>) => cb()),
    })
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockResolvedValue({
      synced: true,
      oauthClientCredentialsChanged: true,
    })
    settingsStoreFns.overlayGoogleAdsSettingsFromCredentialStore.mockImplementation(
      async (settings) => settings
    )
    settingsFns.updateSettings.mockResolvedValue(undefined)
  })

  it('saves credential-backed and remainder google_ads updates in one transaction', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [
          { category: 'google_ads', key: 'client_id', value: 'cid-new.apps.googleusercontent.com' },
          { category: 'google_ads', key: 'campaign_sync_enabled', value: '1' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()
    const db = await dbFns.getDatabase.mock.results[0]?.value

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.oauthReauthRequired).toBe(true)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).toHaveBeenCalledWith(
      7,
      { client_id: 'cid-new.apps.googleusercontent.com' },
      { skipAuthContextInvalidate: true }
    )
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [{ category: 'google_ads', key: 'campaign_sync_enabled', value: '1' }],
      7
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(7)
  })

  it('skips oauth auth assert when updating non-credential google_ads keys only', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [{ category: 'google_ads', key: 'campaign_sync_enabled', value: '1' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(authAssignmentFns.assertUserCanModifyGoogleAdsAuth).not.toHaveBeenCalled()
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).not.toHaveBeenCalled()
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).not.toHaveBeenCalled()
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [{ category: 'google_ads', key: 'campaign_sync_enabled', value: '1' }],
      7
    )
  })

  it('returns 400 for google ads validation errors', async () => {
    const { GoogleAdsSettingsValidationError } = await import('@/lib/google-ads-settings-store')
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockRejectedValue(
      new GoogleAdsSettingsValidationError('Developer Token 配置看起来不正确')
    )

    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [{ category: 'google_ads', key: 'developer_token', value: 'bad-token' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('Developer Token')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('returns 500 for unexpected google ads save errors', async () => {
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockRejectedValue(
      new Error('database unavailable')
    )

    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [
          { category: 'google_ads', key: 'client_id', value: 'cid-new.apps.googleusercontent.com' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.error).toContain('database unavailable')
  })

  it('returns 401 when google ads updates are submitted without login', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        updates: [
          { category: 'google_ads', key: 'client_id', value: 'cid-new.apps.googleusercontent.com' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('需要登录')
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).not.toHaveBeenCalled()
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('uses generic save message when non-oauth google_ads settings fail', async () => {
    settingsFns.updateSettings.mockRejectedValue(new Error('settings table locked'))

    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [{ category: 'google_ads', key: 'campaign_sync_enabled', value: '1' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.error).toBe('settings table locked')
  })
})
