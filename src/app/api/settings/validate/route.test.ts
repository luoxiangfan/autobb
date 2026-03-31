import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/settings/validate/route'

const validateFns = vi.hoisted(() => ({
  validateGoogleAdsConfig: vi.fn(),
  validateGeminiConfig: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getAffiliateSyncSettingsMap: vi.fn(),
}))

const affiliateValidationFns = vi.hoisted(() => ({
  validateAffiliateSyncConfig: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  validateGoogleAdsConfig: validateFns.validateGoogleAdsConfig,
  validateGeminiConfig: validateFns.validateGeminiConfig,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getAffiliateSyncSettingsMap: settingsFns.getAffiliateSyncSettingsMap,
}))

vi.mock('@/lib/affiliate-sync-validation', () => ({
  validateAffiliateSyncConfig: affiliateValidationFns.validateAffiliateSyncConfig,
}))

describe('settings validate route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsFns.getAffiliateSyncSettingsMap.mockResolvedValue({
      partnerboost_token: 'saved-pb-token',
      partnerboost_base_url: 'https://app.partnerboost.com',
      yeahpromos_token: '',
      yeahpromos_site_id: '',
    })
    affiliateValidationFns.validateAffiliateSyncConfig.mockResolvedValue({
      valid: true,
      message: 'PartnerBoost 验证成功（接口可正常访问）',
      results: [{ platform: 'partnerboost', valid: true, message: 'ok' }],
    })
  })

  it('validates affiliate sync config with saved settings fallback', async () => {
    const req = new NextRequest('http://localhost/api/settings/validate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '9',
      },
      body: JSON.stringify({
        category: 'affiliate_sync',
        config: {
          partnerboost_token: '',
          yeahpromos_token: '',
          yeahpromos_site_id: '',
        },
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getAffiliateSyncSettingsMap).toHaveBeenCalledWith(9)
    expect(affiliateValidationFns.validateAffiliateSyncConfig).toHaveBeenCalledWith({
      partnerboostToken: 'saved-pb-token',
      partnerboostBaseUrl: 'https://app.partnerboost.com',
      yeahpromosToken: '',
      yeahpromosSiteId: '',
    })
    expect(payload.valid).toBe(true)
  })

  it('rejects affiliate sync validation without login', async () => {
    const req = new NextRequest('http://localhost/api/settings/validate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        category: 'affiliate_sync',
        config: {},
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toContain('需要登录')
    expect(affiliateValidationFns.validateAffiliateSyncConfig).not.toHaveBeenCalled()
  })
})
