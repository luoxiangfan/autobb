import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/[id]/generate-creatives-stream/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
  markBucketGenerated: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  applyKeywordSupplementationOnce: vi.fn(),
  generateAdCreative: vi.fn(),
}))

const adCreativeFns = vi.hoisted(() => ({
  createAdCreative: vi.fn(),
}))

const feedbackFns = vi.hoisted(() => ({
  getSearchTermFeedbackHints: vi.fn(),
}))

const keywordSelectionFns = vi.hoisted(() => ({
  selectCreativeKeywords: vi.fn(),
}))

const qualityLoopFns = vi.hoisted(() => ({
  runCreativeGenerationQualityLoop: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getAvailableBuckets: vi.fn(),
  getKeywordsByLinkTypeAndBucket: vi.fn(),
}))

const generatorMetaFns = vi.hoisted(() => ({
  getThemeByBucket: vi.fn(),
}))

const creativeTypeFns = vi.hoisted(() => ({
  getCreativeTypeForBucketSlot: vi.fn(),
  mapCreativeTypeToBucketSlot: vi.fn(),
  normalizeCanonicalCreativeType: vi.fn(),
}))

const sseFns = vi.hoisted(() => ({
  isControllerOpen: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
  markBucketGenerated: offerFns.markBucketGenerated,
}))

vi.mock('@/lib/ad-creative-gen', () => ({
  applyKeywordSupplementationOnce: generatorFns.applyKeywordSupplementationOnce,
  generateAdCreative: generatorFns.generateAdCreative,
}))

vi.mock('@/lib/ad-creative', () => ({
  createAdCreative: adCreativeFns.createAdCreative,
}))

vi.mock('@/lib/search-term-feedback-hints', () => ({
  getSearchTermFeedbackHints: feedbackFns.getSearchTermFeedbackHints,
}))

vi.mock('@/lib/creative-keyword-selection', () => ({
  CREATIVE_BRAND_KEYWORD_RESERVE: 2,
  CREATIVE_KEYWORD_MAX_COUNT: 20,
  selectCreativeKeywords: keywordSelectionFns.selectCreativeKeywords,
}))

vi.mock('@/lib/ad-creative-quality-loop', () => ({
  AD_CREATIVE_MAX_AUTO_RETRIES: 2,
  AD_CREATIVE_REQUIRED_MIN_SCORE: 70,
  evaluateCreativeForQuality: vi.fn(),
  runCreativeGenerationQualityLoop: qualityLoopFns.runCreativeGenerationQualityLoop,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getKeywordsByLinkTypeAndBucket: keywordPoolFns.getKeywordsByLinkTypeAndBucket,
}))

vi.mock('@/lib/ad-creative-generator', () => ({
  getThemeByBucket: generatorMetaFns.getThemeByBucket,
}))

vi.mock('@/lib/creative-type', () => ({
  getCreativeTypeForBucketSlot: creativeTypeFns.getCreativeTypeForBucketSlot,
  mapCreativeTypeToBucketSlot: creativeTypeFns.mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType: creativeTypeFns.normalizeCanonicalCreativeType,
}))

vi.mock('@/lib/sse-helper', () => ({
  isControllerOpen: sseFns.isControllerOpen,
}))

function createEvaluation() {
  return {
    passed: true,
    reasons: [],
    failureType: null,
    rsaGate: { passed: true },
    ruleGate: { passed: true },
    adStrength: {
      finalRating: 'GOOD',
      finalScore: 88,
      rsaQualityGate: { passed: true },
      localEvaluation: {
        dimensions: {
          relevance: { score: 12 },
          quality: { score: 12 },
          completeness: { score: 12 },
          diversity: { score: 12 },
          compliance: { score: 12 },
          brandSearchVolume: { score: 12 },
          competitivePositioning: { score: 12 },
        },
      },
      combinedSuggestions: [],
    },
  }
}

const MODEL_INTENT_BUCKET_INTENT = '商品型号/产品族意图导向 - 聚焦当前商品型号/产品族，关键词统一完全匹配'
const PRODUCT_INTENT_BUCKET_INTENT = '商品需求意图导向 - 聚焦商品功能/场景需求，承接高覆盖需求流量'

function parseSsePayload(payload: string) {
  return payload
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.replace(/^data:\s*/, ''))
    .map((chunk) => JSON.parse(chunk))
}

describe('POST /api/offers/:id/generate-creatives-stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '0'

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      brand: 'BrandX',
      category: 'robot vacuum',
      scrape_status: 'completed',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      url: 'https://example.com/product',
    })
    offerFns.markBucketGenerated.mockResolvedValue(undefined)

    feedbackFns.getSearchTermFeedbackHints.mockResolvedValue({
      hardNegativeTerms: [],
      softSuppressTerms: [],
      highPerformingTerms: [],
      sourceRows: 0,
    })

    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A', 'B', 'D'])
    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValue({
      keywords: [],
      intent: 'test',
      bucket: 'B',
      strategy: 'focused',
    })
    sseFns.isControllerOpen.mockReturnValue(true)

    creativeTypeFns.normalizeCanonicalCreativeType.mockImplementation((value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase()
      if (normalized === 'brand_focus' || normalized === 'brand_intent') return 'brand_intent'
      if (normalized === 'model_focus' || normalized === 'model_intent') return 'model_intent'
      if (normalized === 'brand_product' || normalized === 'product_intent') return 'product_intent'
      return null
    })
    creativeTypeFns.mapCreativeTypeToBucketSlot.mockImplementation((value: unknown) => {
      if (value === 'brand_intent') return 'A'
      if (value === 'model_intent') return 'B'
      if (value === 'product_intent') return 'D'
      return null
    })
    creativeTypeFns.getCreativeTypeForBucketSlot.mockImplementation((bucket: string) => {
      if (bucket === 'A') return 'brand_intent'
      if (bucket === 'B') return 'model_intent'
      return 'product_intent'
    })

    generatorMetaFns.getThemeByBucket.mockImplementation((bucket: string) => {
      if (bucket === 'B') return MODEL_INTENT_BUCKET_INTENT
      if (bucket === 'D') return PRODUCT_INTENT_BUCKET_INTENT
      return '品牌意图导向 - 聚焦品牌与核心商品锚点'
    })

    generatorFns.generateAdCreative.mockResolvedValue({
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum', 'x200 vacuum'],
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 900, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'x200 vacuum', searchVolume: 700, source: 'SEARCH_TERM', matchType: 'PHRASE' },
      ],
      negativeKeywords: [],
      callouts: [],
      sitelinks: [],
      theme: '商品型号/产品族意图导向 - 聚焦当前商品型号/产品族，关键词统一完全匹配',
      explanation: 'Focus on the verified model.',
      ai_model: 'gemini-2.5-pro',
    })

    generatorFns.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywords: Array.isArray(keywordsWithVolume) ? keywordsWithVolume.map((item: any) => item.keyword) : [],
      keywordsWithVolume: Array.isArray(keywordsWithVolume) ? keywordsWithVolume : [],
      keywordSupplementation: null,
    }))

    keywordSelectionFns.selectCreativeKeywords.mockImplementation(({ keywords, keywordsWithVolume }: any) => ({
      keywords,
      keywordsWithVolume,
    }))

    adCreativeFns.createAdCreative.mockResolvedValue({ id: 401 })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementation(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })
  })

  afterEach(() => {
    delete process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED
    vi.restoreAllMocks()
  })

  it('streams canonical model intent result for legacy creativeType/bucket inputs', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'model_focus',
        bucket: 'C',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const payload = await res.text()
    const events = parseSsePayload(payload)
    const resultEvent = events.find((event) => event.type === 'result')

    expect(res.status).toBe(200)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenCalledWith(96)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        bucket: 'B',
        bucketIntent: MODEL_INTENT_BUCKET_INTENT,
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(keywordSelectionFns.selectCreativeKeywords).toHaveBeenCalledWith(expect.objectContaining({
      creativeType: 'model_intent',
      bucket: 'B',
    }))
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        creative_type: 'model_intent',
        keyword_bucket: 'B',
        bucket_intent: MODEL_INTENT_BUCKET_INTENT,
      })
    )
    expect(offerFns.markBucketGenerated).toHaveBeenCalledWith(96, 'B')
    expect(resultEvent).toBeTruthy()
    expect(resultEvent.creativeType).toBe('model_intent')
    expect(resultEvent.bucket).toBe('B')
    expect(resultEvent.bucketIntent).toBe(MODEL_INTENT_BUCKET_INTENT)
    expect(resultEvent.generatedBuckets).toEqual(['B'])
    expect(resultEvent.finalPublishDecision).toEqual({
      status: 'PENDING_LAUNCH_SCORE_CHECK',
      stage: 'campaign_publish',
      hardBlockSource: 'launch_score',
    })
    expect(resultEvent.qualityGate).toEqual(expect.objectContaining({
      passed: true,
      warning: false,
      rsaGatePassed: true,
      ruleGatePassed: true,
    }))
    expect(resultEvent.optimization).toEqual(expect.objectContaining({
      attempts: 1,
      targetRating: 'GOOD',
      achieved: true,
      qualityGatePassed: true,
    }))
    expect(resultEvent.optimization.history[0]).toEqual(expect.objectContaining({
      gatePassed: true,
      gateReasons: [],
      passed: true,
    }))
    expect(resultEvent.creative).toEqual(expect.objectContaining({
      id: 401,
    }))
    expect(resultEvent.creative.audit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(resultEvent.creative.keywordSourceAudit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(resultEvent.adStrength.audit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(resultEvent.offer).toEqual(expect.objectContaining({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com/product',
    }))
  })

  it('falls back legacy bucket C to product intent in stream mode when creativeType is omitted and no model anchor evidence exists', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        bucket: 'C',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const payload = await res.text()
    const events = parseSsePayload(payload)
    const resultEvent = events.find((event) => event.type === 'result')

    expect(res.status).toBe(200)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        bucket: 'D',
        bucketIntent: PRODUCT_INTENT_BUCKET_INTENT,
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(keywordSelectionFns.selectCreativeKeywords).toHaveBeenCalledWith(expect.objectContaining({
      creativeType: 'product_intent',
      bucket: 'D',
    }))
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        creative_type: 'product_intent',
        keyword_bucket: 'D',
        bucket_intent: PRODUCT_INTENT_BUCKET_INTENT,
      })
    )
    expect(offerFns.markBucketGenerated).toHaveBeenCalledWith(96, 'D')
    expect(resultEvent).toBeTruthy()
    expect(resultEvent.creativeType).toBe('product_intent')
    expect(resultEvent.bucket).toBe('D')
    expect(resultEvent.bucketIntent).toBe(PRODUCT_INTENT_BUCKET_INTENT)
    expect(resultEvent.generatedBuckets).toEqual(['D'])
  })

  it('emits structured persistence gate error and skips save when hard persistence gate fails', async () => {
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '1'
    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['BrandX Official Store'],
      descriptions: ['Buy no'],
      keywords: ['brandx official store', 'x200 vacuum'],
      keywordsWithVolume: [
        { keyword: 'brandx official store', searchVolume: 900, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'x200 vacuum', searchVolume: 700, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
      ],
      negativeKeywords: [],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Low keyword count for hard persistence gate.',
      ai_model: 'gemini-2.5-pro',
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'model_focus',
        bucket: 'B',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const payload = await res.text()
    const events = parseSsePayload(payload)
    const errorEvent = events.find((event) => event.type === 'error')

    expect(res.status).toBe(200)
    expect(errorEvent).toBeTruthy()
    expect(errorEvent).toEqual(expect.objectContaining({
      code: 'CREATIVE_PERSISTENCE_GATE_FAILED',
    }))
    expect(errorEvent.details).toEqual(expect.objectContaining({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({ code: expect.any(String) }),
      ]),
    }))
    expect(adCreativeFns.createAdCreative).not.toHaveBeenCalled()
    expect(offerFns.markBucketGenerated).not.toHaveBeenCalled()
  })
})
