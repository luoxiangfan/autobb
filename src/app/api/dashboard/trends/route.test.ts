import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/trends/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('GET /api/dashboard/trends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })
    dbFns.getDatabase.mockResolvedValue({
      query: dbFns.query,
    })
  })

  it('uses affiliate commission totals for trend conversions', async () => {
    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(date) as latest_date')) {
        return [{ currency: 'USD', total_cost: 60, latest_date: '2026-04-06' }]
      }
      if (sql.includes('SUM(impressions) as impressions') && sql.includes('FROM campaign_performance')) {
        return [
          { date: '2026-04-05', impressions: 1000, clicks: 100, cost: 50 },
          { date: '2026-04-06', impressions: 500, clicks: 50, cost: 10 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [
          { date: '2026-04-05', commission: 12.5 },
          { date: '2026-04-06', commission: 3 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return [
          { date: '2026-04-06', commission: 2 },
        ]
      }

      throw new Error(`unexpected sql: ${sql}`)
    })

    const req = new NextRequest('http://localhost/api/dashboard/trends?days=2')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.summary.totalCommission).toBe(17.5)
    expect(payload.data.summary.totalConversions).toBe(17.5)
    expect(payload.data.trends[0].conversions).toBe(12.5)
    expect(payload.data.trends[0].commission).toBe(12.5)
    expect(payload.data.trends[1].conversions).toBe(5)
    expect(payload.data.trends[1].commission).toBe(5)
  })

  it('falls back gracefully when unattributed failures table is missing', async () => {
    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(date) as latest_date')) {
        return [{ currency: 'USD', total_cost: 50, latest_date: '2026-04-06' }]
      }
      if (sql.includes('SUM(impressions) as impressions') && sql.includes('FROM campaign_performance')) {
        return [{ date: '2026-04-06', impressions: 100, clicks: 10, cost: 5 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-04-06', commission: 4 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        throw new Error('relation "openclaw_affiliate_attribution_failures" does not exist')
      }

      throw new Error(`unexpected sql: ${sql}`)
    })

    const req = new NextRequest('http://localhost/api/dashboard/trends?days=1')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.summary.totalCommission).toBe(4)
    expect(payload.data.trends[0].commission).toBe(4)
  })
})
