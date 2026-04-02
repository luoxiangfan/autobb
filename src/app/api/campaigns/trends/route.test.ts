import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/trends/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const campaignCacheFns = vi.hoisted(() => ({
  buildCampaignTrendsCacheHash: vi.fn(),
  getCachedCampaignTrends: vi.fn(),
  setCachedCampaignTrends: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/campaigns-read-cache', () => ({
  buildCampaignTrendsCacheHash: campaignCacheFns.buildCampaignTrendsCacheHash,
  getCachedCampaignTrends: campaignCacheFns.getCachedCampaignTrends,
  setCachedCampaignTrends: campaignCacheFns.setCachedCampaignTrends,
}))

describe('GET /api/campaigns/trends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
    campaignCacheFns.buildCampaignTrendsCacheHash.mockReturnValue('campaign-trends-hash')
    campaignCacheFns.getCachedCampaignTrends.mockResolvedValue(null)
    campaignCacheFns.setCachedCampaignTrends.mockResolvedValue(undefined)
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns cached payload without querying the database', async () => {
    const cachedPayload = {
      success: true,
      trends: [{ date: '2026-02-24', commission: 5 }],
      dateRange: { start: '2026-02-18', end: '2026-02-24', days: 7 },
      summary: {
        currency: 'USD',
        currencies: ['USD'],
        hasMixedCurrency: false,
      },
    }
    campaignCacheFns.getCachedCampaignTrends.mockResolvedValue(cachedPayload)

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual(cachedPayload)
    expect(campaignCacheFns.getCachedCampaignTrends).toHaveBeenCalledWith(1, 'campaign-trends-hash')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(campaignCacheFns.setCachedCampaignTrends).not.toHaveBeenCalled()
  })

  it('refresh=true bypasses read cache and writes fresh trends payload', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 5 }]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [{ date: '2026-02-24', currency: 'USD', impressions: 50, clicks: 10, cost: 5 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-02-24', currency: 'USD', commission: 3 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return []
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })
    campaignCacheFns.getCachedCampaignTrends.mockResolvedValue({
      success: true,
      trends: [{ date: 'cached' }],
    })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(campaignCacheFns.getCachedCampaignTrends).not.toHaveBeenCalled()
    expect(campaignCacheFns.setCachedCampaignTrends).toHaveBeenCalledWith(
      1,
      'campaign-trends-hash',
      expect.objectContaining({ success: true })
    )
  })

  it('returns multi-currency stacked trend fields and merged commissions', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', cost: 10 },
          { currency: 'CNY', cost: 20 },
        ]
      }

      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [
          { date: '2026-02-24', currency: 'USD', impressions: 100, clicks: 20, cost: 10 },
          { date: '2026-02-24', currency: 'CNY', impressions: 50, clicks: 5, cost: 20 },
        ]
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [
          { date: '2026-02-24', currency: 'USD', commission: 3 },
          { date: '2026-02-24', currency: 'CNY', commission: 4 },
        ]
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return [
          { date: '2026-02-24', currency: 'USD', commission: 2 },
          { date: '2026-02-24', currency: 'CNY', commission: 1 },
        ]
      }

      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('MIXED')
    expect(data.summary?.baseCurrency).toBe('USD')
    expect(data.summary?.currencies).toEqual(expect.arrayContaining(['USD', 'CNY']))
    expect(data.summary?.costsByCurrency).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: 'USD', amount: 10 }),
      expect.objectContaining({ currency: 'CNY', amount: 20 }),
    ]))
    expect(data.summary?.commissionsByCurrency).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: 'USD', amount: 5 }),
      expect.objectContaining({ currency: 'CNY', amount: 5 }),
    ]))

    const day24 = data.trends.find((row: any) => row.date === '2026-02-24')
    expect(day24).toBeTruthy()
    expect(day24.cost_USD).toBe(10)
    expect(day24.cost_CNY).toBe(20)
    expect(day24.commission_USD).toBe(5)
    expect(day24.commission_CNY).toBe(5)
    expect(day24.impressions).toBe(150)
    expect(day24.clicks).toBe(25)
  })

  it('includes all unattributed failures for campaign trend backend parity', async () => {
    const query = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 40 }]
      }

      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [{ date: '2026-02-27', currency: 'USD', impressions: 80, clicks: 8, cost: 40 }]
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-02-27', currency: 'USD', commission: 20.23 }]
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        expect(sql).toContain('1 = 1')
        expect(sql).not.toContain("COALESCE(reason_code, '') <> ?")
        expect(sql).not.toContain("COALESCE(reason_code, '') NOT IN")
        return [{ date: '2026-02-27', currency: 'USD', commission: 5.99 }]
      }

      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?start_date=2026-02-27&end_date=2026-02-27')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.trends).toHaveLength(1)
    expect(data.trends[0]?.date).toBe('2026-02-27')
    expect(data.trends[0]?.commission).toBe(26.22)
  })

  it('falls back when unattributed table is unavailable', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 5 }]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [{ date: '2026-02-24', currency: 'USD', impressions: 50, clicks: 10, cost: 5 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-02-24', currency: 'USD', commission: 3 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        throw new Error('relation "openclaw_affiliate_attribution_failures" does not exist')
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('USD')
    expect(data.trends.find((row: any) => row.date === '2026-02-24')?.commission).toBe(3)
  })

  it('keeps converted commission totals when commission currency is absent from ad cost currencies', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 42.33 }]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [{ date: '2026-03-07', currency: 'USD', impressions: 345, clicks: 39, cost: 42.33 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-03-07', currency: 'CNY', commission: 118.02 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return []
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?start_date=2026-03-07&end_date=2026-03-07')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currencies).toEqual(['USD'])
    expect(data.summary?.commissionsByCurrency).toEqual([
      expect.objectContaining({ currency: 'USD', amount: 0 }),
      expect.objectContaining({ currency: 'CNY', amount: 118.02 }),
    ])
    expect(Number(data.summary?.totalsConverted?.commission)).toBeGreaterThan(17)
    expect(Number(data.summary?.totalsConverted?.roas)).toBeCloseTo(0.4, 2)

    const day = data.trends.find((row: any) => row.date === '2026-03-07')
    expect(day?.commission_USD).toBe(0)
    expect(day?.commission_CNY).toBe(118.02)
    expect(Number(day?.commission)).toBeGreaterThan(17)
  })

  it('applies optional single-currency filter while keeping converted totals', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', cost: 12.5 },
          { currency: 'CNY', cost: 8.2 },
        ]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date), COALESCE(currency')) {
        return [
          { date: '2026-02-24', currency: 'USD', impressions: 80, clicks: 16, cost: 6.4 },
          { date: '2026-02-24', currency: 'CNY', impressions: 40, clicks: 8, cost: 3.2 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [
          { date: '2026-02-24', currency: 'USD', commission: 1 },
          { date: '2026-02-24', currency: 'CNY', commission: 2 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return [{ date: '2026-02-24', currency: 'CNY', commission: 1 }]
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7&currency=CNY')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('CNY')
    expect(data.summary?.currencies).toEqual(['CNY'])
    const day24 = data.trends.find((row: any) => row.date === '2026-02-24')
    expect(day24.cost_CNY).toBe(3.2)
    expect(day24.cost_USD).toBeUndefined()
    expect(day24.commission_CNY).toBe(3)
  })
})
