import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/settings/[category]/[key]/route'

const settingsFns = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getUserOnlySetting: vi.fn(),
  updateSetting: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  invalidateProxyPoolCache: vi.fn(),
}))

const authAssignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const settingsStoreFns = vi.hoisted(() => ({
  getGoogleAdsCredentialBackedSettingValue: vi.fn(),
  upsertSingleGoogleAdsCredentialBackedSetting: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: authAssignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-settings-store')>()
  return {
    ...actual,
    getGoogleAdsCredentialBackedSettingValue:
      settingsStoreFns.getGoogleAdsCredentialBackedSettingValue,
    upsertSingleGoogleAdsCredentialBackedSetting:
      settingsStoreFns.upsertSingleGoogleAdsCredentialBackedSetting,
  }
})

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

vi.mock('@/lib/settings', () => ({
  getSetting: settingsFns.getSetting,
  getUserOnlySetting: settingsFns.getUserOnlySetting,
  updateSetting: settingsFns.updateSetting,
}))

vi.mock('@/lib/offer-utils', () => ({
  invalidateProxyPoolCache: offerFns.invalidateProxyPoolCache,
}))

describe('settings single-key route affiliate sync isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsFns.getUserOnlySetting.mockResolvedValue({
      category: 'affiliate_sync',
      key: 'yeahpromos_site_id',
      value: '11282',
      dataType: 'string',
      isSensitive: false,
      isRequired: false,
      validationStatus: null,
      validationMessage: null,
      lastValidatedAt: null,
      description: '',
    })
    settingsFns.updateSetting.mockResolvedValue(undefined)
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    settingsStoreFns.getGoogleAdsCredentialBackedSettingValue.mockResolvedValue('')
    settingsStoreFns.upsertSingleGoogleAdsCredentialBackedSetting.mockResolvedValue({
      synced: true,
      oauthClientCredentialsChanged: false,
    })
  })

  it('reads affiliate_sync key from user-only setting source', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req, {
      params: Promise.resolve({ category: 'affiliate_sync', key: 'yeahpromos_site_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getUserOnlySetting).toHaveBeenCalledWith(
      'affiliate_sync',
      'yeahpromos_site_id',
      7
    )
    expect(settingsFns.getSetting).not.toHaveBeenCalled()
    expect(payload.setting.value).toBe('11282')
  })

  it('rejects unauthenticated affiliate_sync key read', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id')

    const res = await GET(req, {
      params: Promise.resolve({ category: 'affiliate_sync', key: 'yeahpromos_site_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('需要登录')
  })

  it('rejects unauthenticated affiliate_sync key update', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: '11282' }),
    })

    const res = await PUT(req, {
      params: Promise.resolve({ category: 'affiliate_sync', key: 'yeahpromos_site_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('需要登录')
    expect(settingsFns.updateSetting).not.toHaveBeenCalled()
  })

  it('updates affiliate_sync key under current user context', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({ value: '11930' }),
    })

    const res = await PUT(req, {
      params: Promise.resolve({ category: 'affiliate_sync', key: 'yeahpromos_site_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSetting).toHaveBeenCalledWith(
      'affiliate_sync',
      'yeahpromos_site_id',
      '11930',
      7
    )
  })
})

describe('settings single-key route google_ads credential store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsFns.getSetting.mockResolvedValue({
      category: 'google_ads',
      key: 'client_id',
      value: null,
      dataType: 'string',
      isSensitive: true,
      isRequired: false,
      validationStatus: null,
      validationMessage: null,
      lastValidatedAt: null,
      description: 'OAuth Client ID',
    })
    settingsFns.updateSetting.mockResolvedValue(undefined)
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    settingsStoreFns.getGoogleAdsCredentialBackedSettingValue.mockResolvedValue(
      '123.apps.googleusercontent.com'
    )
    settingsStoreFns.upsertSingleGoogleAdsCredentialBackedSetting.mockResolvedValue({
      synced: true,
      oauthClientCredentialsChanged: true,
    })
  })

  it('reads google_ads oauth key from credential store overlay', async () => {
    const req = new NextRequest('http://localhost/api/settings/google_ads/client_id', {
      headers: { 'x-user-id': '3' },
    })

    const res = await GET(req, {
      params: Promise.resolve({ category: 'google_ads', key: 'client_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsStoreFns.getGoogleAdsCredentialBackedSettingValue).toHaveBeenCalledWith(
      3,
      'client_id',
      { isSensitive: true }
    )
    expect(payload.setting.value).toBe('123.apps.googleusercontent.com')
  })

  it('writes google_ads oauth key via credential store', async () => {
    const req = new NextRequest('http://localhost/api/settings/google_ads/client_id', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '3',
      },
      body: JSON.stringify({ value: 'new-id.apps.googleusercontent.com' }),
    })

    const res = await PUT(req, {
      params: Promise.resolve({ category: 'google_ads', key: 'client_id' }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(authAssignmentFns.assertUserCanModifyGoogleAdsAuth).toHaveBeenCalled()
    expect(settingsStoreFns.upsertSingleGoogleAdsCredentialBackedSetting).toHaveBeenCalledWith(
      3,
      'client_id',
      'new-id.apps.googleusercontent.com',
      { skipAuthContextInvalidate: true }
    )
    expect(settingsFns.updateSetting).not.toHaveBeenCalled()
    expect(payload.oauthReauthRequired).toBe(true)
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).toHaveBeenCalledWith(3)
  })
})
