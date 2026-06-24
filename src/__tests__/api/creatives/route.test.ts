import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/creatives/route'

const adCreativeFns = vi.hoisted(() => ({
  findAdCreativesByOfferId: vi.fn(),
  findAdCreativesByUserId: vi.fn(),
}))

vi.mock('@/lib/creatives/server', () => ({
  findAdCreativesByOfferId: adCreativeFns.findAdCreativesByOfferId,
  findAdCreativesByUserId: adCreativeFns.findAdCreativesByUserId,
  hasRequiredRsaAssetCounts: (creative: { headlines?: unknown; descriptions?: unknown }) => {
    const headlines = Array.isArray(creative.headlines) ? creative.headlines : []
    const descriptions = Array.isArray(creative.descriptions) ? creative.descriptions : []
    return headlines.length >= 3 && descriptions.length >= 2
  },
  deriveCanonicalCreativeType: vi.fn(({ creativeType, keywordBucket }: any) => {
    if (creativeType === 'brand_focus') return 'brand_intent'
    if (keywordBucket === 'B') return 'model_intent'
    return creativeType ?? null
  }),
  mapCreativeTypeToBucketSlot: vi.fn((creativeType: string | null) => {
    if (creativeType === 'brand_intent') return 'A'
    if (creativeType === 'model_intent') return 'B'
    return null
  }),
  normalizeCreativeBucketSlot: vi.fn((bucket: string | null | undefined) => bucket ?? null),
}))

describe('GET /api/creatives', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adCreativeFns.findAdCreativesByUserId.mockResolvedValue([
      {
        id: 1,
        offer_id: 10,
        user_id: 7,
        headlines: ['BrandX Vacuum'],
        descriptions: ['BrandX cleaning solution'],
        keywords: ['brandx vacuum'],
        keywordsWithVolume: [{ keyword: 'brandx vacuum', searchVolume: 5000, matchType: 'PHRASE' }],
        negativeKeywords: [],
        callouts: [],
        sitelinks: [],
        final_url: 'https://example.com/p/1',
        final_url_suffix: null,
        path1: null,
        path2: null,
        score: 80,
        score_breakdown: {},
        score_explanation: 'ok',
        version: 1,
        generation_round: 1,
        generation_prompt: null,
        theme: 'Brand Intent',
        creative_type: 'brand_focus',
        keyword_bucket: 'A',
        creation_status: 'draft',
        creation_error: null,
        ad_id: null,
        google_ad_id: null,
        google_ad_group_id: null,
        last_sync_at: null,
        created_at: '2026-03-17T00:00:00.000Z',
        updated_at: '2026-03-17T00:00:00.000Z',
        adStrength: null,
      },
      {
        id: 2,
        offer_id: 10,
        user_id: 7,
        headlines: ['BrandX X200 Vacuum'],
        descriptions: ['Model-focused copy'],
        keywords: ['brandx x200 vacuum'],
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 3200, matchType: 'EXACT' },
        ],
        negativeKeywords: [],
        callouts: [],
        sitelinks: [],
        final_url: 'https://example.com/p/2',
        final_url_suffix: null,
        path1: null,
        path2: null,
        score: 84,
        score_breakdown: {},
        score_explanation: 'ok',
        version: 1,
        generation_round: 1,
        generation_prompt: null,
        theme: 'X200 Series',
        creative_type: null,
        keyword_bucket: 'B',
        creation_status: 'draft',
        creation_error: null,
        ad_id: null,
        google_ad_id: null,
        google_ad_group_id: null,
        last_sync_at: null,
        created_at: '2026-03-17T00:00:00.000Z',
        updated_at: '2026-03-17T00:00:00.000Z',
        adStrength: null,
      },
    ])
  })

  it('returns canonical creativeType and canonical generated bucket slots', async () => {
    const req = new NextRequest('http://localhost/api/creatives', {
      headers: {
        'x-user-id': '7',
      },
    })

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.creatives).toHaveLength(2)
    expect(payload.creatives[0].creativeType).toBe('brand_intent')
    expect(payload.creatives[0].keywordBucket).toBe('A')
    expect(payload.creatives[1].creativeType).toBe('model_intent')
    expect(payload.creatives[1].keywordBucket).toBe('B')
    expect(payload.generatedBuckets).toEqual(['A', 'B'])
  })
})
