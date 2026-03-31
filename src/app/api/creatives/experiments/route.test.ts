import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/creatives/experiments/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
  })),
}))

describe('GET /api/creatives/experiments', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 99,
      authType: 'session',
    })

    dbFns.query.mockResolvedValue([
      {
        id: 1,
        experiment_name: 'Headline AB Test',
        experiment_type: 'headline',
        offer_id: 5,
        campaign_id: 12,
        variant_a: JSON.stringify({ title: 'A' }),
        variant_b: JSON.stringify({ title: 'B' }),
        metrics_a: JSON.stringify({ ctr: 0.04 }),
        metrics_b: JSON.stringify({ ctr: 0.03 }),
        winner: 'A',
        confidence: 88,
        conclusion: 'A performs better',
        status: 'completed',
        started_at: '2026-02-06T00:00:00.000Z',
        ended_at: '2026-02-07T00:00:00.000Z',
        created_at: '2026-02-07T00:00:00.000Z',
        campaign_name: 'Campaign 12',
        google_campaign_id: '123456',
        ad_creative_id: 777,
        offer_brand: 'BrandX',
        offer_name: 'OfferX',
        creative_headlines: JSON.stringify(['headline1']),
        creative_descriptions: JSON.stringify(['desc1']),
        creative_score: 82,
      },
    ])
  })

  it('returns 403 when unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/creatives/experiments')
    const res = await GET(req)

    expect(res.status).toBe(403)
  })

  it('returns experiment list with summary', async () => {
    const req = new NextRequest('http://localhost/api/creatives/experiments?limit=20&status=completed')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0].experimentName).toBe('Headline AB Test')
    expect(payload.data[0].metrics.a.ctr).toBe(0.04)
    expect(payload.summary.completed).toBe(1)
    expect(payload.filters.status).toBe('completed')
  })
})
