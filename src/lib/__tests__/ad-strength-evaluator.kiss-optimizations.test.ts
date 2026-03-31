import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getKeywordSearchVolumesMock,
  getUserAuthTypeMock,
  generateContentMock,
} = vi.hoisted(() => ({
  getKeywordSearchVolumesMock: vi.fn(),
  getUserAuthTypeMock: vi.fn(),
  generateContentMock: vi.fn(),
}))

vi.mock('../keyword-planner', () => ({
  getKeywordSearchVolumes: getKeywordSearchVolumesMock,
}))

vi.mock('../google-ads-oauth', () => ({
  getUserAuthType: getUserAuthTypeMock,
}))

vi.mock('../gemini', () => ({
  generateContent: generateContentMock,
}))

import { evaluateAdStrength } from '../ad-strength-evaluator'

describe('ad-strength-evaluator KISS optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.AD_STRENGTH_ENABLE_CP_AI

    getKeywordSearchVolumesMock.mockResolvedValue([{ avgMonthlySearches: 0 }])
    getUserAuthTypeMock.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    generateContentMock.mockResolvedValue({ text: '{}' })
  })

  it('handles empty assets without NaN in completeness or overall score', async () => {
    const result = await evaluateAdStrength([], [], ['test keyword'], {
      brandName: 'TestBrand',
      targetCountry: 'US',
      targetLanguage: 'en',
      userId: 1,
    })

    expect(Number.isFinite(result.overallScore)).toBe(true)
    expect(result.dimensions.completeness.score).toBe(0)
  })

  it('does not award default brand volume points when total search volume is zero', async () => {
    const result = await evaluateAdStrength(
      [{ text: 'Official TestBrand Product', length: 26 }],
      [{ text: 'Learn more about TestBrand quality.', length: 35 }],
      ['testbrand product'],
      {
        brandName: 'TestBrand',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 1,
        keywordsWithVolume: [],
      }
    )

    expect(result.dimensions.brandSearchVolume.score).toBe(0)
    expect(result.dimensions.brandSearchVolume.details.totalBrandSearchVolume).toBe(0)
  })

  it('uses brand-signal proxy score when keyword planner volume is unavailable', async () => {
    getKeywordSearchVolumesMock.mockResolvedValue([
      {
        avgMonthlySearches: 0,
        volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
      },
    ])

    const result = await evaluateAdStrength(
      [{ text: 'Waterdrop Official', length: 18 }],
      [{ text: 'Learn more about Waterdrop systems.', length: 35 }],
      ['waterdrop x12', 'waterdrop filter'],
      {
        brandName: 'Waterdrop',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 1,
        keywordsWithVolume: [
          {
            keyword: 'waterdrop',
            searchVolume: 0,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
          },
          {
            keyword: 'waterdrop x12',
            searchVolume: 0,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
          },
          {
            keyword: 'waterdrop filter',
            searchVolume: 0,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
          },
        ],
      }
    )

    expect(result.dimensions.brandSearchVolume.score).toBeGreaterThan(0)
    expect(result.dimensions.brandSearchVolume.details.dataSource).toBe('unavailable')
    expect(result.dimensions.brandSearchVolume.details.fallbackMode).toBe('brand_signal_proxy')
    expect(result.dimensions.brandSearchVolume.details.brandKeywordCount).toBeGreaterThan(0)
  })

  it('backfills exact brand keyword volume when planner data is unavailable', async () => {
    getKeywordSearchVolumesMock.mockResolvedValue([
      {
        avgMonthlySearches: 0,
        volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
      },
    ])

    const result = await evaluateAdStrength(
      [{ text: 'Novilla Official', length: 16 }],
      [{ text: 'Shop Novilla mattress for better sleep.', length: 38 }],
      ['novilla mattress'],
      {
        brandName: 'Novilla',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 1,
        keywordsWithVolume: [
          {
            keyword: 'novilla',
            searchVolume: 2400,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
          },
          {
            keyword: 'novilla memory foam mattress',
            searchVolume: 370,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
          },
        ],
      }
    )

    expect(result.dimensions.brandSearchVolume.details.fallbackMode).toBe('exact_brand_keyword_backfill')
    expect(result.dimensions.brandSearchVolume.details.brandNameSearchVolume).toBe(2400)
    expect(result.dimensions.brandSearchVolume.details.totalBrandSearchVolume).toBe(2770)
    expect(result.dimensions.brandSearchVolume.details.dataSource).toBe('database')
    expect(result.dimensions.brandSearchVolume.score).toBeGreaterThanOrEqual(9)
  })

  it('avoids substring false positives in relevance matching', async () => {
    const result = await evaluateAdStrength(
      [{ text: 'Best Spring Savings', length: 19 }],
      [{ text: 'Upgrade your spring setup today.', length: 31 }],
      ['ring'],
      {
        targetCountry: 'US',
        targetLanguage: 'en',
      }
    )

    expect(result.dimensions.relevance.details.keywordCoverage).toBe(0)
    expect(result.dimensions.relevance.details.keywordEmbeddingRate).toBe(0)
  })

  it('skips competitive-positioning AI enhancement by default', async () => {
    await evaluateAdStrength(
      [
        { text: 'Save $100 20% Off The Only Official Choice', length: 41 },
        { text: 'Exclusive Premium Offer', length: 23 },
      ],
      [
        { text: 'Replace your old setup now for value for money.', length: 49 },
      ],
      ['premium offer'],
      {
        brandName: 'TestBrand',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 1,
      }
    )

    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('awards unique positioning for certification and official support signals', async () => {
    const result = await evaluateAdStrength(
      [
        { text: 'Waterdrop NSF/ANSI 58&372', length: 24 },
        { text: 'Supporto ufficiale Waterdrop', length: 27 },
      ],
      [
        { text: 'Sistema 1200 GPD con filtrazione certificata.', length: 45 },
      ],
      ['waterdrop filter'],
      {
        brandName: 'Waterdrop',
        targetCountry: 'IT',
        targetLanguage: 'Italian',
        userId: 1,
      }
    )

    expect(result.dimensions.competitivePositioning.details.uniqueMarketPosition).toBeGreaterThanOrEqual(2.5)
    expect(result.dimensions.competitivePositioning.score).toBeGreaterThan(0)
  })

  it('avoids substring false positives in competitive uniqueness detection', async () => {
    const result = await evaluateAdStrength(
      [
        { text: 'Dependable daily comfort', length: 24 },
      ],
      [
        { text: 'Reliable airflow for everyday use.', length: 33 },
      ],
      ['daily comfort'],
      {
        targetCountry: 'US',
        targetLanguage: 'en',
      }
    )

    expect(result.dimensions.competitivePositioning.details.uniqueMarketPosition).toBe(0)
  })

  it('supports multilingual CTA and urgency detection in quality scoring', async () => {
    const result = await evaluateAdStrength(
      [
        { text: '限时优惠 仅限今日', length: 8 },
        { text: '官方正品保障', length: 6 },
      ],
      [
        { text: '立即购买，领取专属优惠。', length: 13 },
        { text: '点击了解更多产品详情。', length: 12 },
      ],
      ['官方 正品'],
      {
        brandName: 'TestBrand',
        targetCountry: 'CN',
        targetLanguage: 'zh',
        userId: 1,
      }
    )

    expect(result.dimensions.quality.details.ctaPresence).toBeGreaterThan(0)
    expect(result.dimensions.quality.details.urgencyExpression).toBeGreaterThan(0)
  })

  it('keeps copy-intent alignment from dropping to zero for non-English bucket B creatives', async () => {
    const result = await evaluateAdStrength(
      [
        { text: 'Für Küche und Zuhause entwickelt', length: 31 },
        { text: 'Löst Wasserprobleme im Alltag', length: 28 },
      ],
      [
        { text: 'Jetzt kaufen und Wasserqualität verbessern.', length: 42 },
      ],
      ['wasserfilter küche', 'wasserqualität verbessern'],
      {
        brandName: 'Waterdrop',
        targetCountry: 'DE',
        targetLanguage: 'German',
        bucketType: 'B',
        userId: 1,
      }
    )

    expect(result.copyIntentMetrics?.typeIntentAlignmentScore || 0).toBeGreaterThanOrEqual(70)
    expect(result.copyIntentMetrics?.copyIntentCoverage || 0).toBeGreaterThan(0)
  })

  it('accepts model-led bucket B copy when scenario phrasing is limited', async () => {
    const result = await evaluateAdStrength(
      [
        { text: 'Novilla 12 Inch King Mattress', length: 28 },
        { text: 'Memory Foam Medium Firm Support', length: 31 },
      ],
      [
        { text: 'Buy Novilla king size mattress with cool pressure relief.', length: 58 },
        { text: 'Order 12 inch memory foam bed in a box today.', length: 47 },
      ],
      ['novilla king mattress 12 inch', 'memory foam mattress king size'],
      {
        brandName: 'Novilla',
        targetCountry: 'US',
        targetLanguage: 'English',
        bucketType: 'B',
        creativeType: 'model_intent',
        userId: 1,
      }
    )

    expect(result.copyIntentMetrics?.typeIntentAlignmentScore || 0).toBeGreaterThanOrEqual(70)
  })

  it('keeps bucket B intent aligned when model anchors are weak but scenario/solution signals are strong', async () => {
    const result = await evaluateAdStrength(
      [
        { text: 'RENPHO Eye Massager for Night Relief', length: 35 },
        { text: 'Relax tired eyes after long screen use', length: 38 },
      ],
      [
        { text: 'Buy now for soothing heat, strain relief, and better sleep.', length: 61 },
        { text: 'Quiet daily eye care for migraine discomfort at home.', length: 53 },
      ],
      ['renpho eye massager', 'eye strain relief', 'sleep relaxation eye mask'],
      {
        brandName: 'Renpho',
        targetCountry: 'US',
        targetLanguage: 'English',
        bucketType: 'B',
        creativeType: 'model_intent',
        userId: 1,
      }
    )

    expect(result.copyIntentMetrics?.typeIntentAlignmentScore || 0).toBeGreaterThanOrEqual(70)
  })

  it('enables competitive-positioning AI enhancement only when flag is true', async () => {
    process.env.AD_STRENGTH_ENABLE_CP_AI = 'true'
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        priceAdvantage: 3,
        uniqueMarketPosition: 3,
        competitiveComparison: 2,
        valueEmphasis: 2,
        confidence: 0.95,
      }),
    })

    await evaluateAdStrength(
      [
        { text: 'Save $120 20% Off The Only Official Choice', length: 42 },
      ],
      [
        { text: 'Replace old setup now for value for money.', length: 42 },
      ],
      ['official choice'],
      {
        brandName: 'TestBrand',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 1,
      }
    )

    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })
})
