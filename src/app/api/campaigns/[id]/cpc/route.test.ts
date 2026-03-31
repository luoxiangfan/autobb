import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/[id]/cpc/route'
import { getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { executeGAQLQueryPython } from '@/lib/python-ads-client'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
    query: dbFns.query,
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(),
}))

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/python-ads-client', () => ({
  executeGAQLQueryPython: vi.fn(),
}))

describe('GET /api/campaigns/:id/cpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
  })

  it('returns 422 with expected googleCampaignId when local campaign id is used', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('AND c.google_campaign_id = ?')) {
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

    const req = new NextRequest('http://localhost/api/campaigns/1972/cpc', {
      method: 'GET',
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '1972' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('USE_GOOGLE_CAMPAIGN_ID')
    expect(data.localCampaignId).toBe(1972)
    expect(data.googleCampaignId).toBe('23578044853')
    expect(data.expectedPath).toBe('/api/campaigns/23578044853/cpc')
  })

  it('returns previous CPC value in history for legacy rows', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns c')) {
        return {
          local_campaign_id: 1966,
          google_ads_account_id: 1,
          max_cpc: null,
          campaign_config: JSON.stringify({ maxCpcBid: 0.48, biddingStrategy: 'MANUAL_CPC' }),
          offer_id: 3643,
          customer_id: '1234567890',
          currency: 'USD',
          parent_mcc_id: null,
          service_account_id: 'sa-1',
          is_active: true,
          is_deleted: false,
        }
      }
      return undefined
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cpc_adjustment_history')) {
        return [
          {
            adjustment_value: 0.58,
            adjustment_type: 'max_cpc',
            created_at: '2026-02-20 11:21:57.354221+00',
            campaign_id: 1966,
            campaign_ids: '["23575769704"]',
            success_count: 1,
            failure_count: 0,
          },
        ]
      }
      return []
    })

    vi.mocked(getServiceAccountConfig as any).mockResolvedValue({ id: 'sa-1' })
    vi.mocked(executeGAQLQueryPython as any).mockResolvedValue([
      {
        campaign: {
          id: '23575769704',
          status: 'ENABLED',
          bidding_strategy_type: 'TARGET_SPEND',
          target_spend: {
            cpc_bid_ceiling_micros: 580000,
          },
        },
      },
    ])

    const req = new NextRequest('http://localhost/api/campaigns/23575769704/cpc', {
      method: 'GET',
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '23575769704' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.currentCpc).toBe(0.58)
    expect(Array.isArray(data.history)).toBe(true)
    expect(data.history[0].value).toBe(0.48)
    expect(getGoogleAdsCredentialsFromDB).not.toHaveBeenCalled()
    expect(getServiceAccountConfig).toHaveBeenCalledWith(1, 'sa-1')
  })
})
