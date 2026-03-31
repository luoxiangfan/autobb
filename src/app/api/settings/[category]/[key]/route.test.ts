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
  })

  it('reads affiliate_sync key from user-only setting source', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req, {
      params: { category: 'affiliate_sync', key: 'yeahpromos_site_id' },
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getUserOnlySetting).toHaveBeenCalledWith('affiliate_sync', 'yeahpromos_site_id', 7)
    expect(settingsFns.getSetting).not.toHaveBeenCalled()
    expect(payload.setting.value).toBe('11282')
  })

  it('rejects unauthenticated affiliate_sync key read', async () => {
    const req = new NextRequest('http://localhost/api/settings/affiliate_sync/yeahpromos_site_id')

    const res = await GET(req, {
      params: { category: 'affiliate_sync', key: 'yeahpromos_site_id' },
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
      params: { category: 'affiliate_sync', key: 'yeahpromos_site_id' },
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
      params: { category: 'affiliate_sync', key: 'yeahpromos_site_id' },
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSetting).toHaveBeenCalledWith('affiliate_sync', 'yeahpromos_site_id', '11930', 7)
  })
})
