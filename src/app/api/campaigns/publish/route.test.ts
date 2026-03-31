import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/publish/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const campaignsFns = vi.hoisted(() => ({
  queryActiveCampaigns: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/active-campaigns-query', () => ({
  queryActiveCampaigns: campaignsFns.queryActiveCampaigns,
}))

describe('POST /api/campaigns/publish AutoAds enforced', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM offers')) {
        return {
          id: 11,
          url: 'https://example.com/p/11',
          brand: 'BrandA',
          target_country: 'US',
          target_language: 'en',
          scrape_status: 'completed',
          category: 'test',
          offer_name: 'Offer 11',
        }
      }
      if (sql.includes('FROM ad_creatives')) {
        return {
          id: 22,
          headlines: JSON.stringify(['h1']),
          descriptions: JSON.stringify(['d1']),
          keywords: JSON.stringify(['kw1']),
          negative_keywords: JSON.stringify([]),
          callouts: JSON.stringify([]),
          sitelinks: JSON.stringify([]),
          final_url: 'https://example.com/landing',
          final_url_suffix: '',
          is_selected: 1,
          keywords_with_volume: JSON.stringify([]),
          theme: 'default',
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 33,
          customer_id: '1234567890',
          parent_mcc_id: '9681914021',
          is_active: 1,
          status: 'ENABLED',
        }
      }
      return null
    })

    dbFns.exec.mockResolvedValue({ changes: 1 })

    campaignsFns.queryActiveCampaigns.mockResolvedValue({
      ownCampaigns: [],
      manualCampaigns: [{ id: '1001', name: 'Manual-Campaign', status: 'ENABLED' }],
      otherCampaigns: [],
      total: { enabled: 1, own: 0, manual: 1, other: 0 },
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('requires pause confirmation when manual campaigns exist', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260101',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrlSuffix: '',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('CONFIRM_PAUSE_OLD_CAMPAIGNS')
    expect(data.total.manual).toBe(1)
    expect(data.total.all).toBe(1)
  })

  it('accepts customer_id input for googleAdsAccountId and maps to internal account id', async () => {
    const queryOneSpy = dbFns.queryOne

    queryOneSpy.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM offers')) {
        return {
          id: 11,
          url: 'https://example.com/p/11',
          brand: 'BrandA',
          target_country: 'US',
          target_language: 'en',
          scrape_status: 'completed',
          category: 'test',
          offer_name: 'Offer 11',
        }
      }
      if (sql.includes('FROM ad_creatives')) {
        return {
          id: 22,
          headlines: JSON.stringify(['h1']),
          descriptions: JSON.stringify(['d1']),
          keywords: JSON.stringify(['kw1']),
          negative_keywords: JSON.stringify([]),
          callouts: JSON.stringify([]),
          sitelinks: JSON.stringify([]),
          final_url: 'https://example.com/landing',
          final_url_suffix: '',
          is_selected: 1,
          keywords_with_volume: JSON.stringify([]),
          theme: 'default',
        }
      }
      if (sql.includes('FROM google_ads_accounts') && sql.includes('REPLACE(customer_id')) {
        expect(params).toEqual([7, 1, '3178223819'])
        return {
          id: 33,
          customer_id: '317-822-3819',
          parent_mcc_id: '9681914021',
          is_active: 1,
          status: 'ENABLED',
        }
      }
      return null
    })

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: '3178223819',
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260101',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrlSuffix: '',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('CONFIRM_PAUSE_OLD_CAMPAIGNS')
    expect(campaignsFns.queryActiveCampaigns).toHaveBeenCalledWith(11, 33, 7)
  })

  it('accepts forceLaunch/skipLaunchScore aliases to bypass pause confirmation prompt', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM offers')) {
        return {
          id: 11,
          url: 'https://example.com/p/11',
          brand: 'BrandA',
          target_country: 'US',
          target_language: 'en',
          scrape_status: 'completed',
          category: 'test',
          offer_name: 'Offer 11',
        }
      }
      if (sql.includes('FROM ad_creatives')) {
        return {
          id: 22,
          headlines: JSON.stringify(['h1']),
          descriptions: JSON.stringify(['d1']),
          keywords: JSON.stringify(['kw1']),
          negative_keywords: JSON.stringify([]),
          callouts: JSON.stringify([]),
          sitelinks: JSON.stringify([]),
          final_url: 'https://example.com/landing',
          final_url_suffix: '',
          is_selected: 1,
          keywords_with_volume: JSON.stringify([]),
          theme: 'default',
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 33,
          customer_id: '1234567890',
          parent_mcc_id: '9681914021',
          is_active: 1,
          status: 'ENABLED',
        }
      }
      if (sql.includes('FROM google_ads_service_accounts')) {
        return { id: 'svc-1' }
      }
      return null
    })

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        forceLaunch: true,
        skipLaunchScore: true,
        campaignConfig: {
          campaignName: 'BrandA-US-20260101',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrlSuffix: '',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json().catch(() => ({}))

    if (res.status === 422) {
      expect(data.action).not.toBe('CONFIRM_PAUSE_OLD_CAMPAIGNS')
    }
  })

  it('does not require pause confirmation for cross-brand campaigns and only warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const queryOneSpy = dbFns.queryOne

    queryOneSpy.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM offers')) {
        return {
          id: 11,
          url: 'https://example.com/p/11',
          brand: 'BrandA',
          target_country: 'US',
          target_language: 'en',
          scrape_status: 'completed',
          category: 'test',
          offer_name: 'Offer 11',
        }
      }
      if (sql.includes('FROM ad_creatives')) {
        return {
          id: 22,
          headlines: JSON.stringify(['h1']),
          descriptions: JSON.stringify(['d1']),
          keywords: JSON.stringify(['kw1']),
          negative_keywords: JSON.stringify([]),
          callouts: JSON.stringify([]),
          sitelinks: JSON.stringify([]),
          final_url: 'https://example.com/landing',
          final_url_suffix: '',
          is_selected: 1,
          keywords_with_volume: JSON.stringify([]),
          theme: 'default',
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 33,
          customer_id: '1234567890',
          parent_mcc_id: '9681914021',
          is_active: 1,
          status: 'ENABLED',
        }
      }
      if (sql.includes('FROM google_ads_service_accounts')) {
        return { id: 'svc-1' }
      }
      return null
    })

    campaignsFns.queryActiveCampaigns.mockResolvedValueOnce({
      ownCampaigns: [],
      manualCampaigns: [],
      otherCampaigns: [{ id: '2001', name: 'BrandB-US-Search', status: 'ENABLED' }],
      total: { enabled: 1, own: 0, manual: 0, other: 1 },
    })

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260101',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrlSuffix: '',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).not.toBe(422)
    expect(data.action).not.toBe('CONFIRM_PAUSE_OLD_CAMPAIGNS')
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️ 检测到品牌冲突（仅警告，不阻断发布）',
      expect.objectContaining({
        accountId: 33,
        currentOfferId: 11,
        currentBrand: 'BrandA',
      })
    )

    warnSpy.mockRestore()
  })

  it('returns account access denied and deactivates account when Google Ads permission is revoked', async () => {
    campaignsFns.queryActiveCampaigns.mockRejectedValueOnce({
      errors: [
        {
          error_code: { authorization_error: 2 },
          message: "User doesn't have permission to access customer. Note: If you're accessing a client customer, the manager's customer id must be set in the 'login-customer-id' header.",
        },
      ],
      request_id: 'RA5IXgBLzdxpntDiNJDlUw',
    })

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260101',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrlSuffix: '',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('ACCOUNT_ACCESS_DENIED')
    expect(data.details.accountId).toBe(33)
    expect(data.details.requestId).toBe('RA5IXgBLzdxpntDiNJDlUw')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_accounts'),
      [0, 33, 7]
    )
  })
})
