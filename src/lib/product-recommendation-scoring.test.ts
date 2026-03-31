import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.fn()
const recordTokenUsageMock = vi.fn()
const estimateTokenCostMock = vi.fn(() => 0.1234)

vi.mock('./gemini', () => ({
  generateContent: generateContentMock,
}))

vi.mock('./ai-token-tracker', () => ({
  recordTokenUsage: recordTokenUsageMock,
  estimateTokenCost: estimateTokenCostMock,
}))

function createProduct(id: number, overrides: Record<string, any> = {}) {
  return {
    id,
    asin: `B000000${String(id).padStart(3, '0')}`,
    product_name: `Product ${id}`,
    brand: id <= 3 ? 'Apple' : 'Generic Brand',
    price_amount: id <= 3 ? 49.99 : 4.99,
    review_count: id <= 3 ? 5000 : 3,
    commission_rate: id <= 3 ? 15 : 1,
    commission_amount: id <= 3 ? 55 : 1,
    allowed_countries_json: JSON.stringify(['US', 'UK', 'CA', 'DE', 'FR']),
    product_url: 'https://amazon.com/dp/B000000001',
    promo_link: 'https://example.com/promo',
    is_blacklisted: false,
    is_confirmed_invalid: false,
    last_synced_at: '2026-03-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('product recommendation scoring', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    vi.resetModules()
    generateContentMock.mockReset()
    recordTokenUsageMock.mockReset()
    estimateTokenCostMock.mockClear()

    delete process.env.REDIS_URL

    generateContentMock.mockImplementation(async (params: any) => {
      if (params.operationType !== 'product_score_combined_analysis') {
        throw new Error(`unexpected operation type: ${params.operationType}`)
      }

      return {
        text: JSON.stringify({
          seasonality: {
            seasonality: 'all-year',
            holidays: [],
            isPeakSeason: false,
            monthsUntilPeak: 0,
            reasoning: 'steady demand',
          },
          productAnalysis: {
            category: 'electronics',
            targetAudience: ['unisex'],
            pricePositioning: 'premium',
            useScenario: ['daily', 'travel'],
            productFeatures: ['smart', 'portable'],
            reasoning: 'good fit',
          },
        }),
        usage: { inputTokens: 21, outputTokens: 31, totalTokens: 52 },
        model: 'gemini-3-flash-preview',
        apiType: 'direct-api',
      }
    })
  })

  afterAll(() => {
    if (originalRedisUrl) {
      process.env.REDIS_URL = originalRedisUrl
    } else {
      delete process.env.REDIS_URL
    }
  })

  it('reranks only the configured top-k products with AI', async () => {
    const { calculateHybridProductRecommendationScores } = await import('./product-recommendation-scoring')
    const products = Array.from({ length: 12 }, (_, index) => createProduct(index + 1))

    const result = await calculateHybridProductRecommendationScores(products as any, 1, {
      includeSeasonalityAnalysis: true,
      aiRerankTopK: 3,
    })

    expect(result.summary).toMatchObject({
      totalProducts: 12,
      aiCandidates: 3,
      aiCompleted: 3,
      ruleOnly: 9,
    })
    expect(result.results.filter((item) => item.usedAI)).toHaveLength(3)
    expect(generateContentMock).toHaveBeenCalledTimes(3)
  })

  it('uses the combined analysis payload size and no longer depends on prompt templates', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')

    await calculateProductRecommendationScore(createProduct(3001) as any, 11, {
      includeSeasonalityAnalysis: true,
    })

    const firstCallParams = generateContentMock.mock.calls[0]?.[0]
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'product_score_combined_analysis',
        maxOutputTokens: 640,
      }),
      11
    )
    expect(firstCallParams?.responseSchema?.properties?.seasonality?.required || []).not.toContain('reasoning')
    expect(firstCallParams?.responseSchema?.properties?.productAnalysis?.required || []).not.toContain('reasoning')
  })

  it('parses markdown-wrapped JSON for combined product score analysis', async () => {
    generateContentMock.mockResolvedValueOnce({
      text: `\`\`\`json
{
  "seasonality": {
    "seasonality": "all-year",
    "holidays": [],
    "isPeakSeason": false,
    "monthsUntilPeak": 0,
    "reasoning": "stable demand"
  },
  "productAnalysis": {
    "category": "electronics",
    "targetAudience": ["unisex"],
    "pricePositioning": "premium",
    "useScenario": ["daily"],
    "productFeatures": ["smart"],
    "reasoning": "clear utility"
  }
}
\`\`\``,
      usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
      model: 'gemini-3-flash-preview',
      apiType: 'direct-api',
    })

    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(createProduct(3002) as any, 11, {
      includeSeasonalityAnalysis: true,
    })

    expect(result.seasonalityAnalysis?.seasonality).toBe('all-year')
    expect(result.productAnalysis?.pricePositioning).toBe('premium')
    expect(result.dimensions.seasonality.score).toBeGreaterThan(0)
  })

  it('retries once when first response is not parseable JSON', async () => {
    generateContentMock
      .mockResolvedValueOnce({
        text: 'Here is the analysis summary in natural language only.',
        usage: { inputTokens: 13, outputTokens: 21, totalTokens: 34 },
        model: 'gemini-3-flash-preview',
        apiType: 'direct-api',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          seasonality: {
            seasonality: 'all-year',
            holidays: [],
            isPeakSeason: false,
            monthsUntilPeak: 0,
            reasoning: 'steady',
          },
          productAnalysis: {
            category: 'electronics',
            targetAudience: ['unisex'],
            pricePositioning: 'premium',
            useScenario: ['daily'],
            productFeatures: ['smart'],
            reasoning: 'utility',
          },
        }),
        usage: { inputTokens: 12, outputTokens: 20, totalTokens: 32 },
        model: 'gemini-3-flash-preview',
        apiType: 'direct-api',
      })

    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(createProduct(3003) as any, 11, {
      includeSeasonalityAnalysis: true,
    })

    expect(generateContentMock).toHaveBeenCalledTimes(2)
    expect(generateContentMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      operationType: 'product_score_combined_analysis',
      temperature: 0.1,
      maxOutputTokens: 640,
    }))
    expect(generateContentMock.mock.calls[1][0]).toEqual(expect.objectContaining({
      operationType: 'product_score_combined_analysis',
      temperature: 0,
      maxOutputTokens: 320,
    }))
    expect(String(generateContentMock.mock.calls[1][0]?.prompt || '')).toContain('The previous output was invalid JSON.')
    expect(recordTokenUsageMock).toHaveBeenCalledTimes(2)
    expect(result.seasonalityAnalysis?.seasonality).toBe('all-year')
    expect(result.productAnalysis?.pricePositioning).toBe('premium')
  })

  it('falls back to deterministic analysis when both attempts are not parseable', async () => {
    generateContentMock
      .mockResolvedValueOnce({
        text: 'This is not JSON.',
        usage: { inputTokens: 10, outputTokens: 18, totalTokens: 28 },
        model: 'gemini-3-flash-preview',
        apiType: 'direct-api',
      })
      .mockResolvedValueOnce({
        text: 'Still not valid JSON output.',
        usage: { inputTokens: 9, outputTokens: 14, totalTokens: 23 },
        model: 'gemini-3-flash-preview',
        apiType: 'direct-api',
      })

    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(createProduct(3004) as any, 11, {
      includeSeasonalityAnalysis: true,
    })

    expect(generateContentMock).toHaveBeenCalledTimes(2)
    expect(recordTokenUsageMock).toHaveBeenCalledTimes(2)
    expect(result.seasonalityAnalysis?.seasonality).toBe('all-year')
    expect(result.productAnalysis?.targetAudience).toEqual(['unisex'])
    expect(result.dimensions.seasonality.score).toBeGreaterThan(0)
  })

  it('caches AI analysis results and records token usage only on cache miss', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const product = createProduct(1001, { product_name: 'Cached Product' })

    await calculateProductRecommendationScore(product as any, 7, {
      includeSeasonalityAnalysis: true,
    })
    await calculateProductRecommendationScore(product as any, 7, {
      includeSeasonalityAnalysis: true,
    })

    expect(generateContentMock).toHaveBeenCalledTimes(1)
    expect(recordTokenUsageMock).toHaveBeenCalledTimes(1)
    expect(recordTokenUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      operationType: 'product_score_combined_analysis',
      totalTokens: 52,
    }))
  })

  it('does not share cached AI analysis across different ASINs', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const baseOverrides = {
      product_name: 'Same Product',
      brand: 'Same Brand',
      price_amount: 29.99,
    }

    await calculateProductRecommendationScore(
      createProduct(2001, { ...baseOverrides, asin: 'BASIN00001' }) as any,
      9,
      { includeSeasonalityAnalysis: true }
    )

    await calculateProductRecommendationScore(
      createProduct(2002, { ...baseOverrides, asin: 'BASIN00002' }) as any,
      9,
      { includeSeasonalityAnalysis: true }
    )

    expect(generateContentMock).toHaveBeenCalledTimes(2)
    expect(recordTokenUsageMock).toHaveBeenCalledTimes(2)
  })

  it('treats ASIN products with empty landing URL as Amazon product pages', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(
      createProduct(4001, {
        asin: 'B0ASINONLY01',
        product_url: null,
        promo_link: null,
        short_promo_link: null,
        commission_rate: 12,
        commission_amount: 12,
        review_count: 100,
        price_amount: 49.99,
        brand: 'AcmeBrand',
        allowed_countries_json: JSON.stringify(['US', 'UK', 'CA']),
      }) as any,
      1,
      { includeSeasonalityAnalysis: false }
    )

    expect(result.dimensions.marketFit.details.landingPageScore).toBe(100)
    expect(result.reasons).toContain('Amazon产品页,信任度和转化率高')
    expect(result.reasons).not.toContain('非Amazon落地页,信任度相对较低')
  })

  it('treats non-canonical Amazon URLs as Amazon store pages', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(
      createProduct(4002, {
        asin: null,
        product_url: 'https://www.amazon.com/somebrand',
        promo_link: null,
        short_promo_link: null,
        commission_rate: 12,
        commission_amount: 12,
        review_count: 100,
        price_amount: 49.99,
        brand: 'AcmeBrand',
        allowed_countries_json: JSON.stringify(['US', 'UK', 'CA']),
      }) as any,
      1,
      { includeSeasonalityAnalysis: false }
    )

    expect(result.dimensions.marketFit.details.landingPageScore).toBe(85)
    expect(result.reasons).not.toContain('非Amazon落地页,信任度相对较低')
  })

  it('keeps non-Amazon store URLs as lower-trust landing pages', async () => {
    const { calculateProductRecommendationScore } = await import('./product-recommendation-scoring')
    const result = await calculateProductRecommendationScore(
      createProduct(4003, {
        asin: null,
        product_url: 'https://example.com/store/front',
        promo_link: null,
        short_promo_link: null,
        commission_rate: 12,
        commission_amount: 12,
        review_count: 100,
        price_amount: 49.99,
        brand: 'AcmeBrand',
        allowed_countries_json: JSON.stringify(['US', 'UK', 'CA']),
      }) as any,
      1,
      { includeSeasonalityAnalysis: false }
    )

    expect(result.dimensions.marketFit.details.landingPageScore).toBe(45)
    expect(result.reasons).toContain('非Amazon落地页,信任度相对较低')
  })
})
