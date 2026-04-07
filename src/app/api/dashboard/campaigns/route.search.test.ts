import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/campaigns/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: (handler: any) => handler,
}))

describe('GET /api/dashboard/campaigns search operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })
    dbFns.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: dbFns.query,
      queryOne: dbFns.queryOne,
    })
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue({
      totalCampaigns: 0,
      activeCampaigns: 0,
      pausedCampaigns: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalCost: 0,
      totalConversions: 0,
    })
  })

  it('uses ILIKE for postgres search filtering', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/campaigns?search=roborock')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(dbFns.query).toHaveBeenCalledTimes(1)
    expect(dbFns.queryOne).toHaveBeenCalledTimes(1)

    const pageSql = String(dbFns.query.mock.calls[0]?.[0] || '')
    const pageParams = dbFns.query.mock.calls[0]?.[1] || []
    const summarySql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')
    const summaryParams = dbFns.queryOne.mock.calls[0]?.[1] || []

    expect(pageSql).toContain('c.campaign_name ILIKE ? OR o.brand ILIKE ?')
    expect(summarySql).toContain('c.campaign_name ILIKE ? OR o.brand ILIKE ?')
    expect(pageParams).toContain('%roborock%')
    expect(summaryParams).toContain('%roborock%')
  })

  it('aggregates conversions from affiliate commission tables', async () => {
    dbFns.query.mockResolvedValue([
      {
        campaignId: 101,
        campaignName: 'Demo Campaign',
        status: 'ENABLED',
        offerBrand: 'Demo',
        createdAt: '2026-04-01T00:00:00.000Z',
        impressions: 1000,
        clicks: 100,
        cost: 50,
        conversions: 12.34,
        currency: 'USD',
        ctr: 10,
        cpc: 0.5,
        conversionRate: 0.12,
      },
    ])
    dbFns.queryOne.mockResolvedValue({
      totalCampaigns: 1,
      activeCampaigns: 1,
      pausedCampaigns: 0,
      totalImpressions: 1000,
      totalClicks: 100,
      totalCost: 50,
      totalConversions: 12.34,
    })

    const req = new NextRequest('http://localhost/api/dashboard/campaigns')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data?.campaigns?.[0]?.conversions).toBe(12.34)
    expect(data.data?.summary?.totalConversions).toBe(12.34)

    const pageSql = String(dbFns.query.mock.calls[0]?.[0] || '')
    const summarySql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')

    expect(pageSql).toContain('FROM affiliate_commission_attributions')
    expect(pageSql).toContain('FROM openclaw_affiliate_attribution_failures')
    expect(pageSql).not.toContain('SUM(cp.conversions)')
    expect(summarySql).toContain('FROM affiliate_commission_attributions')
    expect(summarySql).toContain('FROM openclaw_affiliate_attribution_failures')
    expect(summarySql).not.toContain('SUM(conversions) as conversions')
  })
})
