import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/analytics/roi/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

const failureFilterFns = vi.hoisted(() => ({
  buildAffiliateUnattributedFailureFilter: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/openclaw/affiliate-attribution-failures', () => ({
  buildAffiliateUnattributedFailureFilter: failureFilterFns.buildAffiliateUnattributedFailureFilter,
}))

describe('GET /api/analytics/roi', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    failureFilterFns.buildAffiliateUnattributedFailureFilter.mockReturnValue({
      sql: 'failure_reason IS NOT NULL',
      values: [],
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaign_performance cp') && sql.includes('total_cost')) {
        return { total_cost: 100 }
      }
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('total_revenue')) {
        return { total_revenue: 40, total_records: 2 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('total_revenue')) {
        return { total_revenue: 10, total_records: 1 }
      }
      return null
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT COALESCE(cp.currency, \'USD\') as currency')) {
        return [{ currency: 'USD' }]
      }
      if (sql.includes('SELECT DISTINCT COALESCE(currency, \'USD\') as currency') && sql.includes('affiliate_commission_attributions')) {
        return [{ currency: 'USD' }]
      }
      if (sql.includes('SELECT DISTINCT COALESCE(currency, \'USD\') as currency') && sql.includes('openclaw_affiliate_attribution_failures')) {
        return []
      }
      if (sql.includes('DATE(cp.date) as date')) {
        return [{ date: '2026-04-01', cost: 100 }]
      }
      if (sql.includes('report_date as date') && sql.includes('affiliate_commission_attributions')) {
        return [{ date: '2026-04-01', revenue: 40, conversions: 2 }]
      }
      if (sql.includes('report_date as date') && sql.includes('openclaw_affiliate_attribution_failures')) {
        return [{ date: '2026-04-01', revenue: 10, conversions: 1 }]
      }
      if (sql.includes('c.id as campaign_id') && sql.includes('campaign_performance cp')) {
        return [{ campaign_id: 1, campaign_name: 'Campaign A', offer_brand: 'Brand A', cost: 100, impressions: 1000, clicks: 50 }]
      }
      if (sql.includes('campaign_id') && sql.includes('affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        return [{ campaign_id: 1, revenue: 40, conversions: 2 }]
      }
      if (sql.includes('campaign_id') && sql.includes('openclaw_affiliate_attribution_failures') && sql.includes('GROUP BY campaign_id')) {
        return [{ campaign_id: 1, revenue: 10, conversions: 1 }]
      }
      if (sql.includes('o.id as offer_id') && sql.includes('COUNT(DISTINCT c.id) as campaign_count')) {
        return [{ offer_id: 11, brand: 'Brand A', offer_name: 'Offer A', campaign_count: 1, cost: 100 }]
      }
      if (sql.includes('offer_id') && sql.includes('affiliate_commission_attributions') && sql.includes('GROUP BY offer_id')) {
        return [{ offer_id: 11, revenue: 40, conversions: 2 }]
      }
      if (sql.includes('offer_id') && sql.includes('openclaw_affiliate_attribution_failures') && sql.includes('GROUP BY offer_id')) {
        return [{ offer_id: 11, revenue: 10, conversions: 1 }]
      }
      return []
    })
  })

  it('uses affiliate commission totals to compute revenue and roas', async () => {
    const req = new NextRequest('http://localhost/api/analytics/roi?start_date=2026-04-01&end_date=2026-04-01')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.overall.totalCost).toBe(100)
    expect(data.data.overall.totalRevenue).toBe(50)
    expect(data.data.overall.totalProfit).toBe(-50)
    expect(data.data.overall.roi).toBe(0.5)
    expect(data.data.overall.conversions).toBe(3)
    expect(data.data.byCampaign[0]).toEqual(expect.objectContaining({
      campaignId: 1,
      revenue: 50,
      conversions: 3,
      roi: 0.5,
    }))
    expect(data.data.byOffer[0]).toEqual(expect.objectContaining({
      offerId: 11,
      revenue: 50,
      conversions: 3,
      roi: 0.5,
    }))
  })
})
