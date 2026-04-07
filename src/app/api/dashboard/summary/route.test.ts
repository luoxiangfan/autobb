import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/summary/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  generateCacheKey: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  listOffers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/api-cache', () => ({
  apiCache: {
    get: cacheFns.get,
    set: cacheFns.set,
  },
  generateCacheKey: cacheFns.generateCacheKey,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/offers', () => ({
  listOffers: offerFns.listOffers,
}))

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })
    cacheFns.generateCacheKey.mockReturnValue('dashboard-summary:user:7:test')
    cacheFns.get.mockReturnValue(null)

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 8 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 2 }
      }
      return {
        total_campaigns: 2,
        total_offers: 3,
        total_clicks: 10,
        total_impressions: 100,
        total_cost: 5,
        avg_cpc: 0.5,
        avg_ctr: 0.1,
      }
    })
    dbFns.query.mockResolvedValue([])
    dbFns.getDatabase.mockResolvedValue({
      type: 'postgres',
      queryOne: dbFns.queryOne,
      query: dbFns.query,
    })
    offerFns.listOffers.mockResolvedValue({
      offers: [{ id: 11, brand: 'Demo' }],
      total: 1,
    })
  })

  it('returns cached response in normal mode', async () => {
    cacheFns.get.mockReturnValue({
      kpis: { totalCampaigns: 99 },
      riskAlerts: [],
      topOffers: [],
      timestamp: '2026-03-03T00:00:00.000Z',
    })

    const req = new NextRequest('http://localhost/api/dashboard/summary?days=30')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.cached).toBe(true)
    expect(data.kpis?.totalCampaigns).toBe(99)
    expect(cacheFns.set).not.toHaveBeenCalled()
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(offerFns.listOffers).not.toHaveBeenCalled()
  })

  it('refresh=true bypasses read cache and writes back cache', async () => {
    cacheFns.get.mockReturnValue({
      kpis: { totalCampaigns: 99 },
      riskAlerts: [],
      topOffers: [],
      timestamp: '2026-03-03T00:00:00.000Z',
    })

    const req = new NextRequest('http://localhost/api/dashboard/summary?days=30&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.cached).toBe(false)
    expect(cacheFns.get).not.toHaveBeenCalled()
    expect(cacheFns.set).toHaveBeenCalledWith(
      'dashboard-summary:user:7:test',
      expect.objectContaining({
        kpis: expect.any(Object),
        riskAlerts: expect.any(Array),
        topOffers: expect.any(Array),
      }),
      120000
    )
  })

  it('noCache=true bypasses read/write cache', async () => {
    cacheFns.get.mockReturnValue({
      kpis: { totalCampaigns: 99 },
      riskAlerts: [],
      topOffers: [],
      timestamp: '2026-03-03T00:00:00.000Z',
    })

    const req = new NextRequest('http://localhost/api/dashboard/summary?days=30&noCache=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.cached).toBe(false)
    expect(cacheFns.get).not.toHaveBeenCalled()
    expect(cacheFns.set).not.toHaveBeenCalled()
  })

  it('does not exclude removed campaigns from performance aggregates or risk alerts', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/summary?days=30&refresh=true')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(String(dbFns.queryOne.mock.calls[0]?.[0] || '')).not.toContain("WHERE c.user_id = ?\n      AND c.status != 'REMOVED'")
    expect(String(dbFns.query.mock.calls[0]?.[0] || '')).not.toContain("AND c.status != 'REMOVED'")
  })

  it('uses affiliate commission totals for KPI conversions', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/summary?days=30&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.kpis?.totalConversions).toBe(10)
    expect(data.kpis?.totalCommission).toBe(10)
  })
})
