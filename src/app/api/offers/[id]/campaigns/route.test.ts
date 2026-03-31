import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/offers/[id]/campaigns/route'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

const googleAdsFns = vi.hoisted(() => ({
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
}))

const pythonFns = vi.hoisted(() => ({
  executeGAQLQueryPython: vi.fn(),
}))

const trackerFns = vi.hoisted(() => ({
  trackApiUsage: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    query: dbFns.query,
    queryOne: dbFns.queryOne,
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
}))

vi.mock('@/lib/google-ads-api-tracker', () => ({
  trackApiUsage: trackerFns.trackApiUsage,
  ApiOperationType: {
    REPORT: 'REPORT',
  },
}))

describe('GET /api/offers/:id/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            google_campaign_id: '23578044853',
            google_ads_account_id: 9,
            campaign_name: 'Campaign A',
            max_cpc: 0.5,
            campaign_config: null,
            status: 'ENABLED',
            customer_id: '1234567890',
            account_name: 'Account A',
            currency: 'USD',
            parent_mcc_id: null,
            service_account_id: 'sa-1',
            is_active: 1,
            is_deleted: 0,
            created_at: '2026-03-16T00:00:00.000Z',
          },
        ]
      }
      return []
    })
  })

  it('uses linked service account without requiring OAuth base credentials', async () => {
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '2233445566',
    })
    pythonFns.executeGAQLQueryPython.mockResolvedValue([])

    const req = new NextRequest('http://localhost/api/offers/777/campaigns', {
      method: 'GET',
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '777' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.count).toBe(1)
    expect(data.campaigns[0].id).toBe('23578044853')
    expect(data.campaigns[0].currentCpc).toBe(0.5)
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(1, 'sa-1')
    expect(googleAdsFns.getGoogleAdsCredentialsFromDB).not.toHaveBeenCalled()
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })
})
