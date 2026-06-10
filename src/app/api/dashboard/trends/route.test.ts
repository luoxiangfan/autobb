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

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 1)
    const day1 = formatLocalYmd(startDate)
    const day2 = formatLocalYmd(endDate)

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(date) as latest_date')) {
        return [{ currency: 'USD', total_cost: 60, latest_date: day2 }]
      }
      if (
        sql.includes('SUM(impressions) as impressions') &&
        sql.includes('FROM campaign_performance')
      ) {
        return [
          { date: day1, impressions: 1000, clicks: 100, cost: 50 },
          { date: day2, impressions: 500, clicks: 50, cost: 10 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [
          { date: day1, commission: 12.5 },
          { date: day2, commission: 3 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return [{ date: day2, commission: 2 }]
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
    const today = formatLocalYmd(new Date())

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(date) as latest_date')) {
        return [{ currency: 'USD', total_cost: 50, latest_date: today }]
      }
      if (
        sql.includes('SUM(impressions) as impressions') &&
        sql.includes('FROM campaign_performance')
      ) {
        return [{ date: today, impressions: 100, clicks: 10, cost: 5 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: today, commission: 4 }]
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
