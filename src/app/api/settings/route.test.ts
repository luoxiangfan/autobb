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
    })
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
        expect.objectContaining({ key: 'partnerboost_base_url', value: 'https://app.partnerboost.com' }),
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
        expect.objectContaining({ key: 'partnerboost_base_url', value: 'https://app.partnerboost.com' }),
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
          { category: 'affiliate_sync', key: 'partnerboost_base_url', value: 'https://custom.example.com' },
          { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_interval_hours', value: '12' },
          { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith([
      { category: 'affiliate_sync', key: 'partnerboost_base_url', value: 'https://app.partnerboost.com' },
      { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_interval_hours', value: '1' },
      { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
    ], 7)
  })

  it('rejects affiliate_sync updates when user context is missing', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        updates: [
          { category: 'affiliate_sync', key: 'yeahpromos_site_id', value: '11282' },
        ],
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
    expect(payload.error).toContain('需要登录')
    expect(settingsFns.clearUserSettings).not.toHaveBeenCalled()
  })
})
