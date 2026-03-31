import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/offers/[id]/creatives/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const adCreativeFns = vi.hoisted(() => ({
  findAdCreativesByOfferId: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/ad-creative', () => ({
  findAdCreativesByOfferId: adCreativeFns.findAdCreativesByOfferId,
}))

describe('GET /api/offers/:id/creatives', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
    })

    adCreativeFns.findAdCreativesByOfferId.mockResolvedValue([
      {
        id: 301,
        version: 1,
        headlines: ['BrandX Robot Vacuum'],
        descriptions: ['Product demand copy'],
        keywords: ['brandx robot vacuum'],
        keywordsWithVolume: [
          { keyword: 'brandx robot vacuum', searchVolume: 4200, matchType: 'PHRASE', source: 'KEYWORD_POOL' },
        ],
        theme: 'Robot Vacuum Needs',
        creative_type: null,
        keyword_bucket: 'S',
        final_url: 'https://example.com/store',
        score: 83,
        creation_status: 'draft',
        created_at: '2026-03-17T00:00:00.000Z',
      },
    ])
  })

  it('returns canonical creativeType alongside compatibility keywordBucket', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/creatives', {
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '96' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.creatives).toHaveLength(1)
    expect(payload.data.creatives[0].creativeType).toBe('product_intent')
    expect(payload.data.creatives[0].keywordBucket).toBe('D')
  })
})
