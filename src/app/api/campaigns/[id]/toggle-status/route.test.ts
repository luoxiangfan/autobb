import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/campaigns/[id]/toggle-status/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

const transitionFns = vi.hoisted(() => ({
  applyCampaignTransition: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateDashboardCache: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: adsFns.updateGoogleAdsCampaignStatus,
  getGoogleAdsCredentialsFromDB: adsFns.getGoogleAdsCredentialsFromDB,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

vi.mock('@/lib/campaign-state-machine', () => ({
  applyCampaignTransition: transitionFns.applyCampaignTransition,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateDashboardCache: cacheFns.invalidateDashboardCache,
}))

describe('PUT /api/campaigns/:id/toggle-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adsFns.getGoogleAdsCredentialsFromDB.mockResolvedValue({
      useServiceAccount: false,
      login_customer_id: '9988776655',
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'oauth-refresh-token',
    })
    adsFns.updateGoogleAdsCampaignStatus.mockResolvedValue(undefined)
    transitionFns.applyCampaignTransition.mockResolvedValue({ updatedCount: 1 })
    campaignFns.findCampaignById.mockResolvedValue({
      id: 1,
      status: 'PAUSED',
    })
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns')) {
        return {
          id: 1,
          campaign_id: '1234567890',
          google_campaign_id: '1234567890',
          google_ads_account_id: 10,
          status: 'ENABLED',
          is_deleted: 0,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 10,
          customer_id: '1122334455',
          parent_mcc_id: null,
          service_account_id: null,
          is_active: 1,
          is_deleted: 0,
          status: 'ENABLED',
        }
      }
      return undefined
    })
  })

  it('returns 401 when missing user header', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })

    expect(res.status).toBe(401)
  })

  it('updates status and invalidates dashboard cache when succeeded', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.status).toBe('PAUSED')
    expect(adsFns.updateGoogleAdsCampaignStatus).toHaveBeenCalledWith({
      customerId: '1122334455',
      refreshToken: 'oauth-refresh-token',
      campaignId: '1234567890',
      status: 'PAUSED',
      accountId: 10,
      userId: 7,
      loginCustomerId: '9988776655',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(transitionFns.applyCampaignTransition).toHaveBeenCalledWith({
      userId: 7,
      campaignId: 1,
      action: 'TOGGLE_STATUS',
      payload: { status: 'PAUSED' },
    })
    expect(cacheFns.invalidateDashboardCache).toHaveBeenCalledWith(7)
  })

  it('uses linked service account without requiring OAuth base credentials', async () => {
    adsFns.getGoogleAdsCredentialsFromDB.mockRejectedValue(
      new Error('用户(ID=7)未配置完整的 Google Ads 凭证。请在设置页面配置所有必需参数。')
    )
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '2233445566',
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns')) {
        return {
          id: 1,
          campaign_id: '1234567890',
          google_campaign_id: '1234567890',
          google_ads_account_id: 10,
          status: 'ENABLED',
          is_deleted: 0,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 10,
          customer_id: '1122334455',
          parent_mcc_id: null,
          service_account_id: 'sa-1',
          is_active: 1,
          is_deleted: 0,
          status: 'ENABLED',
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(7, 'sa-1')
    expect(adsFns.getGoogleAdsCredentialsFromDB).not.toHaveBeenCalled()
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
    expect(adsFns.updateGoogleAdsCampaignStatus).toHaveBeenCalledWith({
      customerId: '1122334455',
      refreshToken: '',
      campaignId: '1234567890',
      status: 'PAUSED',
      accountId: 10,
      userId: 7,
      loginCustomerId: '2233445566',
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })
  })
})
