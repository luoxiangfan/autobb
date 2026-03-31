import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/[id]/generate-creatives/route'

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

function createEvaluation() {
  return {
    passed: true,
    reasons: [],
    failureType: null,
    rsaGate: { passed: true },
    ruleGate: { passed: true },
    adStrength: {
      finalRating: 'GOOD',
      finalScore: 84,
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

describe('POST /api/offers/:id/generate-creatives', () => {
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

    adCreativeFns.createAdCreative.mockResolvedValue({ id: 301 })

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

  it('normalizes legacy creativeType/bucket inputs to canonical model intent and persists canonical fields', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenCalledWith(96)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        bucket: 'B',
        bucketIntent: MODEL_INTENT_BUCKET_INTENT,
        bucketIntentEn: '聚焦当前商品型号/产品族，关键词统一完全匹配',
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
    expect(data.creativeType).toBe('model_intent')
    expect(data.bucket).toBe('B')
    expect(data.bucketIntent).toBe(MODEL_INTENT_BUCKET_INTENT)
    expect(data.generatedBuckets).toEqual(['B'])
    expect(data.finalPublishDecision).toEqual({
      status: 'PENDING_LAUNCH_SCORE_CHECK',
      stage: 'campaign_publish',
      hardBlockSource: 'launch_score',
    })
    expect(data.qualityGate).toEqual(expect.objectContaining({
      passed: true,
      warning: false,
      rsaGatePassed: true,
      ruleGatePassed: true,
    }))
    expect(data.optimization).toEqual(expect.objectContaining({
      attempts: 1,
      targetRating: 'GOOD',
      achieved: true,
      qualityGatePassed: true,
    }))
    expect(data.optimization.history[0]).toEqual(expect.objectContaining({
      gatePassed: true,
      gateReasons: [],
      passed: true,
    }))
    expect(data.creative).toEqual(expect.objectContaining({
      id: 301,
    }))
    expect(data.creative.audit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(data.creative.keywordSourceAudit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(data.adStrength.audit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(data.offer).toEqual(expect.objectContaining({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com/product',
    }))
  })

  it('falls back legacy bucket C to product intent when creativeType is omitted and no model anchor evidence exists', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    const data = await res.json()

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
    expect(data.creativeType).toBe('product_intent')
    expect(data.bucket).toBe('D')
    expect(data.bucketIntent).toBe(PRODUCT_INTENT_BUCKET_INTENT)
    expect(data.generatedBuckets).toEqual(['D'])
  })

  it('keeps AI candidates when bucket seeds are available instead of bucket-only overwrite', async () => {
    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValueOnce({
      keywords: [
        {
          keyword: 'brandx x200 replacement filter',
          searchVolume: 260,
          competition: 'LOW',
          competitionIndex: 15,
          lowTopPageBid: 0.2,
          highTopPageBid: 0.8,
          matchType: 'PHRASE',
        },
      ],
      intent: MODEL_INTENT_BUCKET_INTENT,
      bucket: 'B',
      strategy: 'focused',
    })

    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 900,
          source: 'AI_GENERATED',
          sourceType: 'AI_GENERATED',
          matchType: 'PHRASE',
        },
      ],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Keep model intent as first-class input.',
      ai_model: 'gemini-2.5-pro',
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    expect(res.status).toBe(200)

    const selectCall = keywordSelectionFns.selectCreativeKeywords.mock.calls.at(-1)?.[0] as any
    expect(Array.isArray(selectCall.keywords)).toBe(true)
    expect(selectCall.keywords.length).toBeGreaterThan(0)

    expect(Array.isArray(selectCall.keywordsWithVolume)).toBe(true)
    expect((selectCall.keywordsWithVolume || []).length).toBeGreaterThan(0)
  })

  it('returns 422 and skips persistence when hard quality gate fails', async () => {
    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation: any = createEvaluation()
      evaluation.passed = false
      evaluation.failureType = 'rule_gate_failed'
      evaluation.reasons = ['missing intent anchor']
      evaluation.ruleGate = { passed: false, reasons: ['missing intent anchor'] }
      evaluation.adStrength.finalRating = 'AVERAGE'
      evaluation.adStrength.finalScore = 62
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.error).toEqual(expect.objectContaining({
      code: 'CREATIVE_QUALITY_GATE_FAILED',
    }))
    expect(adCreativeFns.createAdCreative).not.toHaveBeenCalled()
    expect(offerFns.markBucketGenerated).not.toHaveBeenCalled()
  })

  it('returns 422 and skips persistence when hard persistence gate fails', async () => {
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '1'
    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['BrandX Official Store'],
      descriptions: ['Buy no'],
      keywords: ['brandx official store', 'x200 vacuum'],
      keywordsWithVolume: [
        { keyword: 'brandx official store', searchVolume: 900, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'x200 vacuum', searchVolume: 700, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
      ],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Low keyword count for hard persistence gate.',
      ai_model: 'gemini-2.5-pro',
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.error).toEqual(expect.objectContaining({
      code: 'CREATIVE_PERSISTENCE_GATE_FAILED',
    }))
    expect(adCreativeFns.createAdCreative).not.toHaveBeenCalled()
    expect(offerFns.markBucketGenerated).not.toHaveBeenCalled()
  })

  it('uses finalized executable keywords for retry exclusion on later attempts', async () => {
    const sourceQuotaAudit = {
      enabled: true,
      fallbackMode: false,
      targetCount: 1,
      requiredBrandCount: 0,
      acceptedBrandCount: 0,
      acceptedCount: 1,
      deferredCount: 0,
      deferredRefillCount: 0,
      deferredRefillTriggered: false,
      underfillBeforeRefill: 0,
      quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
      acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
    }

    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValueOnce({
      keywords: [
        {
          keyword: 'x200 vacuum',
          searchVolume: 1200,
          source: 'KEYWORD_POOL',
          sourceType: 'CANONICAL_BUCKET_VIEW',
          matchType: 'EXACT',
        },
      ],
      intent: MODEL_INTENT_BUCKET_INTENT,
      bucket: 'B',
      strategy: 'focused',
    })

    keywordSelectionFns.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume, keywords }: any) => {
      const candidateList = Array.isArray(keywordsWithVolume)
        ? keywordsWithVolume
        : Array.isArray(keywords)
          ? keywords.map((keyword: string) => ({ keyword, searchVolume: 0 }))
          : []
      const chosen = candidateList.find((item: any) => item.keyword === 'x200 vacuum') || candidateList[0]
      return {
        keywords: chosen ? [chosen.keyword] : [],
        keywordsWithVolume: chosen ? [chosen] : [],
        truncated: false,
        sourceQuotaAudit,
      }
    })

    generatorFns.generateAdCreative
      .mockResolvedValueOnce({
        headlines: ['BrandX Official Store'],
        descriptions: ['Shop BrandX directly'],
        keywords: ['brandx official store'],
        keywordsWithVolume: [
          { keyword: 'brandx official store', searchVolume: 800, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        ],
        callouts: [],
        sitelinks: [],
        theme: MODEL_INTENT_BUCKET_INTENT,
        explanation: 'Too generic.',
        ai_model: 'gemini-2.5-pro',
      })
      .mockResolvedValueOnce({
        headlines: ['BrandX X300 Vacuum'],
        descriptions: ['Upgrade to BrandX X300'],
        keywords: ['brandx x300 vacuum'],
        keywordsWithVolume: [
          { keyword: 'brandx x300 vacuum', searchVolume: 700, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        ],
        callouts: [],
        sitelinks: [],
        theme: MODEL_INTENT_BUCKET_INTENT,
        explanation: 'Retry candidate.',
        ai_model: 'gemini-2.5-pro',
      })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      await generate({ attempt: 1, retryFailureType: null })
      const creative = await generate({ attempt: 2, retryFailureType: 'quality_under_threshold' })
      const evaluation = createEvaluation()
      return {
        attempts: 2,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation, evaluation],
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives', {
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
    expect(res.status).toBe(200)
    const secondCallOptions = generatorFns.generateAdCreative.mock.calls[1]?.[2] as any
    expect(secondCallOptions).toEqual(expect.objectContaining({
      retryFailureType: 'quality_under_threshold',
      excludeKeywords: expect.any(Array),
    }))
  })
})
