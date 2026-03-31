import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/campaigns/[id]/update-cpc/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const googleAdsFns = vi.hoisted(() => ({
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

const pythonFns = vi.hoisted(() => ({
  executeGAQLQueryPython: vi.fn(),
  updateCampaignPython: vi.fn(),
  updateAdGroupPython: vi.fn(),
}))

const trackerFns = vi.hoisted(() => ({
  trackApiUsage: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateOfferCache: vi.fn(),
  invalidateDashboardCache: vi.fn(),
}))

const redisFns = vi.hoisted(() => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  getCustomerWithCredentials: googleAdsFns.getCustomerWithCredentials,
  getGoogleAdsCredentialsFromDB: googleAdsFns.getGoogleAdsCredentialsFromDB,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
}))

vi.mock('@/lib/python-ads-client', () => ({
  executeGAQLQueryPython: pythonFns.executeGAQLQueryPython,
  updateCampaignPython: pythonFns.updateCampaignPython,
  updateAdGroupPython: pythonFns.updateAdGroupPython,
}))

vi.mock('@/lib/google-ads-mutate-helpers', () => ({
  normalizeGoogleAdsApiUpdateOperations: vi.fn((operations: any[]) => operations),
}))

vi.mock('@/lib/google-ads-api-tracker', () => ({
  trackApiUsage: trackerFns.trackApiUsage,
  ApiOperationType: {
    REPORT: 'REPORT',
    MUTATE: 'MUTATE',
    MUTATE_BATCH: 'MUTATE_BATCH',
  },
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: cacheFns.invalidateOfferCache,
  invalidateDashboardCache: cacheFns.invalidateDashboardCache,
}))

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: redisFns.getRedisClient,
}))

describe('PUT /api/campaigns/:id/update-cpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: {
        userId: 1,
      },
    })
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('returns 422 with expected googleCampaignId when local campaign id is used', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('AND google_campaign_id = ?')) {
        return undefined
      }
      if (sql.includes('WHERE user_id = ?') && sql.includes('AND id = ?')) {
        return {
          id: 1972,
          campaign_id: '23578044853',
          google_campaign_id: '23578044853',
          status: 'ENABLED',
          is_deleted: false,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/1972/update-cpc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        newCpc: 0.2,
      }),
    })

    const res = await PUT(req, { params: { id: '1972' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('USE_GOOGLE_CAMPAIGN_ID')
    expect(data.localCampaignId).toBe(1972)
    expect(data.googleCampaignId).toBe('23578044853')
    expect(data.expectedPath).toBe('/api/campaigns/23578044853/update-cpc')
  })

  it('invalidates related caches after successful max cpc update', async () => {
    const campaignQueryResults = [
      {
        campaign: {
          id: 23578044853,
          bidding_strategy_type: 'TARGET_SPEND',
          target_spend: {
            cpc_bid_ceiling_micros: 200000,
          },
        },
      },
    ]

    const customer = {
      query: vi.fn(async () => campaignQueryResults),
      campaigns: {
        update: vi.fn(async () => undefined),
      },
      adGroups: {
        update: vi.fn(async () => undefined),
      },
    }

    googleAdsFns.getCustomerWithCredentials.mockResolvedValue(customer)
    googleAdsFns.getGoogleAdsCredentialsFromDB.mockResolvedValue({
      useServiceAccount: false,
      login_customer_id: '9988776655',
      client_id: 'client-id',
      client_secret: 'client-secret',
      developer_token: 'dev-token',
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns') && sql.includes('google_campaign_id = ?')) {
        return {
          local_campaign_id: 12,
          google_ads_account_id: 9,
          offer_id: 88,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 9,
          customer_id: '1234567890',
          parent_mcc_id: '9988776655',
          service_account_id: null,
          is_active: 1,
          is_deleted: 0,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-cpc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        newCpc: 0.3,
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(1, 88)
    expect(cacheFns.invalidateDashboardCache).not.toHaveBeenCalled()
    expect(
      dbFns.exec.mock.calls.some(([sql, params]) =>
        String(sql).includes('UPDATE campaigns')
        && Array.isArray(params)
        && Number(params[0]) === 0.3
        && Number(params[1]) === 1
        && String(params[2]) === '23578044853'
      )
    ).toBe(true)
  })

  it('uses linked service account without requiring OAuth base credentials', async () => {
    googleAdsFns.getCustomerWithCredentials.mockResolvedValue({})
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '2233445566',
    })
    pythonFns.executeGAQLQueryPython.mockResolvedValue([
      {
        campaign: {
          id: 23578044853,
          bidding_strategy_type: 'TARGET_SPEND',
          target_spend: {
            cpc_bid_ceiling_micros: 200000,
          },
        },
      },
    ])
    pythonFns.updateCampaignPython.mockResolvedValue(undefined)

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns') && sql.includes('google_campaign_id = ?')) {
        return {
          local_campaign_id: 12,
          google_ads_account_id: 9,
          offer_id: 88,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 9,
          customer_id: '1234567890',
          parent_mcc_id: '2233445566',
          service_account_id: 'sa-1',
          is_active: 1,
          is_deleted: 0,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-cpc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        newCpc: 0.3,
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(1, 'sa-1')
    expect(googleAdsFns.getGoogleAdsCredentialsFromDB).not.toHaveBeenCalled()
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('handles service-account GAQL response wrapped in results field', async () => {
    googleAdsFns.getCustomerWithCredentials.mockResolvedValue({})
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '2233445566',
    })
    pythonFns.executeGAQLQueryPython.mockResolvedValue({
      results: [
        {
          campaign: {
            id: 23578044853,
            bidding_strategy_type: 'TARGET_SPEND',
            target_spend: {
              cpc_bid_ceiling_micros: 200000,
            },
          },
        },
      ],
    })
    pythonFns.updateCampaignPython.mockResolvedValue(undefined)

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns') && sql.includes('google_campaign_id = ?')) {
        return {
          local_campaign_id: 12,
          google_ads_account_id: 9,
          offer_id: 88,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 9,
          customer_id: '1234567890',
          parent_mcc_id: '2233445566',
          service_account_id: 'sa-1',
          is_active: 1,
          is_deleted: 0,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-cpc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        newCpc: 0.3,
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(pythonFns.updateCampaignPython).toHaveBeenCalledOnce()
  })
})
