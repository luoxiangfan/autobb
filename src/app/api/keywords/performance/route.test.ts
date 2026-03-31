import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/keywords/performance/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
  })),
}))

describe('GET /api/keywords/performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 42 },
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY COALESCE(cp.currency')) {
        return [
          { currency: 'USD', total_cost: 120.5 },
        ]
      }

      if (sql.includes('FROM keywords k')) {
        return [
          {
            keyword_id: 1,
            keyword_text: 'wireless earbuds',
            match_type: 'EXACT',
            keyword_status: 'ENABLED',
            ad_group_id: 10,
            ad_group_name: 'Earbuds Group',
            campaign_id: 20,
            campaign_name: 'Earbuds Campaign',
            offer_id: 30,
            offer_brand: 'SoundPeak',
            offer_name: 'Pro Earbuds',
            product_price: '$100',
            commission_payout: '10%',
            impressions: 1000,
            clicks: 100,
            conversions: 5,
            cost: 50,
            currency: 'USD',
          },
        ]
      }

      return []
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/keywords/performance?days=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns keyword performance metrics with summary', async () => {
    const req = new NextRequest('http://localhost/api/keywords/performance?days=7&limit=20')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0].keywordText).toBe('wireless earbuds')
    expect(payload.data[0].metrics.ctr).toBe(10)
    expect(payload.data[0].metrics.cvr).toBe(5)
    expect(payload.data[0].metrics.cpc).toBe(0.5)
    expect(payload.summary.roas).toBe(1)
    expect(payload.filters.currency).toBe('USD')
  })
})
