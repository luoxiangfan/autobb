import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/[id]/generate-ad-creative/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
  markBucketGenerated: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  applyKeywordSupplementationOnce: vi.fn(),
  generateAdCreative: vi.fn(),
  generateAdCreativesBatch: vi.fn(),
}))

const adCreativeFns = vi.hoisted(() => ({
  createAdCreative: vi.fn(),
  listAdCreativesByOffer: vi.fn(),
}))

const feedbackFns = vi.hoisted(() => ({
  getSearchTermFeedbackHints: vi.fn(),
}))

const keywordSelectionFns = vi.hoisted(() => ({
  selectCreativeKeywords: vi.fn(),
}))

const qualityLoopFns = vi.hoisted(() => ({
  evaluateCreativeForQuality: vi.fn(),
  runCreativeGenerationQualityLoop: vi.fn(),
}))

const generatorMetaFns = vi.hoisted(() => ({
  getThemeByBucket: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getAvailableBuckets: vi.fn(),
  getKeywordsByLinkTypeAndBucket: vi.fn(),
}))

const creativeTypeFns = vi.hoisted(() => ({
  deriveCanonicalCreativeType: vi.fn(),
  getCreativeTypeForBucketSlot: vi.fn(),
  mapCreativeTypeToBucketSlot: vi.fn(),
  normalizeCanonicalCreativeType: vi.fn(),
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
      finalScore: 86,
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

const MODEL_INTENT_BUCKET_INTENT = '热门商品型号/产品族意图导向 - 聚焦店铺热门商品型号/产品族，关键词统一完全匹配'
const PRODUCT_INTENT_BUCKET_INTENT = '商品需求意图导向 - 聚焦商品功能/场景需求，承接高覆盖需求流量'

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
  markBucketGenerated: offerFns.markBucketGenerated,
}))

vi.mock('@/lib/ad-creative-gen', () => ({
  applyKeywordSupplementationOnce: generatorFns.applyKeywordSupplementationOnce,
  generateAdCreative: generatorFns.generateAdCreative,
  generateAdCreativesBatch: generatorFns.generateAdCreativesBatch,
}))

vi.mock('@/lib/ad-creative', () => ({
  createAdCreative: adCreativeFns.createAdCreative,
  listAdCreativesByOffer: adCreativeFns.listAdCreativesByOffer,
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
  evaluateCreativeForQuality: qualityLoopFns.evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop: qualityLoopFns.runCreativeGenerationQualityLoop,
}))

vi.mock('@/lib/ad-creative-generator', () => ({
  getThemeByBucket: generatorMetaFns.getThemeByBucket,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getKeywordsByLinkTypeAndBucket: keywordPoolFns.getKeywordsByLinkTypeAndBucket,
}))

vi.mock('@/lib/creative-type', () => ({
  deriveCanonicalCreativeType: creativeTypeFns.deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot: creativeTypeFns.getCreativeTypeForBucketSlot,
  mapCreativeTypeToBucketSlot: creativeTypeFns.mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType: creativeTypeFns.normalizeCanonicalCreativeType,
}))

describe('POST /api/offers/:id/generate-ad-creative', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '0'

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      brand: 'Eufy',
      category: 'robot vacuum',
      scrape_status: 'completed',
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      url: 'https://example.com/store',
      generated_buckets: null,
    })

    offerFns.markBucketGenerated.mockResolvedValue(undefined)

    feedbackFns.getSearchTermFeedbackHints.mockResolvedValue({
      hardNegativeTerms: [],
      softSuppressTerms: [],
      highPerformingTerms: [],
      sourceRows: 0,
    })

    generatorMetaFns.getThemeByBucket.mockImplementation((bucket: string) => {
      if (bucket === 'B') return MODEL_INTENT_BUCKET_INTENT
      if (bucket === 'D') return PRODUCT_INTENT_BUCKET_INTENT
      return '品牌意图导向 - 聚焦品牌与核心商品锚点'
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B'])
    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValue({ keywords: [] })
    generatorFns.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywords: Array.isArray(keywordsWithVolume) ? keywordsWithVolume.map((item: any) => item.keyword) : [],
      keywordsWithVolume: Array.isArray(keywordsWithVolume) ? keywordsWithVolume : [],
      keywordSupplementation: null,
    }))

    creativeTypeFns.normalizeCanonicalCreativeType.mockImplementation((value: unknown) => {
      if (value === 'brand_intent' || value === 'model_intent' || value === 'product_intent') {
        return value
      }

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
    creativeTypeFns.deriveCanonicalCreativeType.mockImplementation((payload: any) => {
      const explicitType = String(payload?.creativeType || '').trim().toLowerCase()
      if (explicitType === 'brand_intent') return 'brand_intent'
      if (explicitType === 'model_intent') return 'model_intent'
      if (explicitType === 'product_intent') return 'product_intent'

      const bucket = String(payload?.keywordBucket || '').trim().toUpperCase()
      if (bucket === 'A') return 'brand_intent'
      if (bucket === 'B' || bucket === 'C') return 'model_intent'
      return 'product_intent'
    })

    keywordSelectionFns.selectCreativeKeywords.mockImplementation(({ keywords, keywordsWithVolume }: any) => ({
      keywords,
      keywordsWithVolume,
    }))

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementation(async ({ generate }: any) => {
      return await generate({ attempt: 1 })
    })
  })

  afterEach(() => {
    delete process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED
    vi.restoreAllMocks()
  })

  it('returns generator error details and avoids persistence when store model intent evidence is missing', async () => {
    const readinessError =
      '店铺热门商品信息不足，无法生成商品型号/产品族意图创意：未提取到可验证的型号/产品族锚点，请先重抓或补充店铺商品数据。'

    generatorFns.generateAdCreative.mockRejectedValueOnce(new Error(readinessError))

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledTimes(1)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        bucket: 'B',
        bucketIntent: MODEL_INTENT_BUCKET_INTENT,
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(adCreativeFns.createAdCreative).not.toHaveBeenCalled()
    expect(offerFns.markBucketGenerated).not.toHaveBeenCalled()
    expect(data.error.code).toBe('CREA_5002')
    expect(data.error.details.originalError).toBe(readinessError)
  })

  it('returns live generatedBuckets based on current available slots instead of stale generated_buckets field', async () => {
    offerFns.findOfferById.mockResolvedValueOnce({
      id: 96,
      user_id: 1,
      brand: 'Eufy',
      category: 'robot vacuum',
      scrape_status: 'completed',
      page_type: 'store',
      target_country: 'US',
      target_language: 'en',
      url: 'https://example.com/store',
      generated_buckets: '["A"]',
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A', 'B', 'D'])

    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['Eufy X10 Omni'],
      descriptions: ['Shop the Eufy X10 Omni robot vacuum'],
      keywords: ['eufy x10 omni'],
      keywordsWithVolume: [
        { keyword: 'eufy x10 omni', searchVolume: 1800, source: 'KEYWORD_POOL', matchType: 'EXACT' },
      ],
      callouts: [],
      sitelinks: [],
      theme: '热门商品型号/产品族意图导向 - 聚焦店铺热门商品型号/产品族，关键词统一完全匹配',
      explanation: 'Focused on the verified store hot model.',
      ai_model: 'gemini-2.5-pro',
    })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    adCreativeFns.createAdCreative.mockResolvedValueOnce({
      id: 502,
      offer_id: 96,
      user_id: 1,
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: MODEL_INTENT_BUCKET_INTENT,
      keywords: ['eufy x10 omni'],
      headlines: ['Eufy X10 Omni'],
      descriptions: ['Shop the Eufy X10 Omni robot vacuum'],
      theme: MODEL_INTENT_BUCKET_INTENT,
      final_url: 'https://example.com/store',
      final_url_suffix: null,
      score_breakdown: {},
      generation_round: 1,
      creation_status: 'completed',
      created_at: '2026-03-16T00:00:00.000Z',
      updated_at: '2026-03-16T00:00:00.000Z',
      keyword_pool_id: null,
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(offerFns.markBucketGenerated).toHaveBeenCalledWith(96, 'B')
    expect(data.bucket).toBe('B')
    expect(data.creativeType).toBe('model_intent')
    expect(data.generatedBuckets).toEqual(['B'])
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
    expect(data.audit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
    expect(data.keywordSourceAudit).toMatchObject({
      totalKeywords: expect.any(Number),
    })
  })

  it('falls back legacy bucket C to product intent when creativeType is omitted and no model anchor evidence exists', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A', 'B', 'D'])

    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['Eufy Robot Vacuums'],
      descriptions: ['Shop Eufy robot vacuum picks for everyday cleaning'],
      keywords: ['eufy robot vacuum'],
      keywordsWithVolume: [
        { keyword: 'eufy robot vacuum', searchVolume: 2100, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      callouts: [],
      sitelinks: [],
      theme: PRODUCT_INTENT_BUCKET_INTENT,
      explanation: 'Focus on product demand intent keywords.',
      ai_model: 'gemini-2.5-pro',
    })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    adCreativeFns.createAdCreative.mockResolvedValueOnce({
      id: 503,
      offer_id: 96,
      user_id: 1,
      creative_type: 'product_intent',
      keyword_bucket: 'D',
      bucket_intent: PRODUCT_INTENT_BUCKET_INTENT,
      keywords: ['eufy robot vacuum'],
      headlines: ['Eufy Robot Vacuums'],
      descriptions: ['Shop Eufy robot vacuum picks for everyday cleaning'],
      theme: PRODUCT_INTENT_BUCKET_INTENT,
      final_url: 'https://example.com/store',
      final_url_suffix: null,
      score_breakdown: {},
      generation_round: 1,
      creation_status: 'completed',
      created_at: '2026-03-16T00:00:00.000Z',
      updated_at: '2026-03-16T00:00:00.000Z',
      keyword_pool_id: null,
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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
    expect(data.bucket).toBe('D')
    expect(data.creativeType).toBe('product_intent')
    expect(data.generatedBuckets).toEqual(['D'])
  })

  it('keeps AI keyword candidates in single mode instead of overwriting them with precomputed bucket seeds', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A', 'B', 'D'])
    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValueOnce({
      keywords: [
        {
          keyword: 'eufy replacement filter',
          searchVolume: 260,
          competition: 'LOW',
          competitionIndex: 15,
          lowTopPageBid: 0.2,
          highTopPageBid: 0.8,
          matchType: 'PHRASE',
        },
      ],
    })

    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['Eufy X10 Omni'],
      descriptions: ['Shop the Eufy X10 Omni robot vacuum'],
      keywords: ['eufy x10 omni'],
      keywordsWithVolume: [
        {
          keyword: 'eufy x10 omni',
          searchVolume: 1800,
          source: 'AI_GENERATED',
          sourceType: 'AI_GENERATED',
          matchType: 'PHRASE',
        },
      ],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Keep verified AI model candidates.',
      ai_model: 'gemini-2.5-pro',
    })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    adCreativeFns.createAdCreative.mockResolvedValueOnce({
      id: 504,
      offer_id: 96,
      user_id: 1,
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: MODEL_INTENT_BUCKET_INTENT,
      keywords: ['eufy x10 omni'],
      headlines: ['Eufy X10 Omni'],
      descriptions: ['Shop the Eufy X10 Omni robot vacuum'],
      theme: MODEL_INTENT_BUCKET_INTENT,
      final_url: 'https://example.com/store',
      final_url_suffix: null,
      score_breakdown: {},
      generation_round: 1,
      creation_status: 'completed',
      created_at: '2026-03-16T00:00:00.000Z',
      updated_at: '2026-03-16T00:00:00.000Z',
      keyword_pool_id: null,
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    expect(res.status).toBe(200)

    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        creative_type: 'model_intent',
        keyword_bucket: 'B',
        keywords: expect.arrayContaining(['eufy x10 omni']),
        keywordsWithVolume: expect.arrayContaining([
          expect.objectContaining({
            keyword: 'eufy x10 omni',
            source: 'AI_GENERATED',
          }),
        ]),
      })
    )
  })

  it('uses bucket seed + supplementation in batch mode to keep keyword pipeline consistent with single mode', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A', 'B', 'D'])
    keywordPoolFns.getKeywordsByLinkTypeAndBucket.mockResolvedValueOnce({
      keywords: [
        {
          keyword: 'eufy x10 omni vacuum',
          searchVolume: 1200,
          competition: 'MEDIUM',
          competitionIndex: 32,
          lowTopPageBid: 0.3,
          highTopPageBid: 0.9,
          matchType: 'PHRASE',
        },
      ],
    })

    generatorFns.generateAdCreativesBatch.mockResolvedValueOnce([
      {
        headlines: ['Eufy X10 Omni'],
        descriptions: ['Shop Eufy X10 Omni robot vacuum'],
        keywords: ['eufy x10 omni'],
        keywordsWithVolume: [
          { keyword: 'eufy x10 omni', searchVolume: 1800, source: 'AI_GENERATED', matchType: 'PHRASE' },
        ],
        callouts: [],
        sitelinks: [],
        theme: MODEL_INTENT_BUCKET_INTENT,
        explanation: 'batch-1',
        ai_model: 'gemini-2.5-pro',
      },
      {
        headlines: ['Eufy X10 Pro'],
        descriptions: ['Shop Eufy X10 Pro robot vacuum'],
        keywords: ['eufy x10 pro'],
        keywordsWithVolume: [
          { keyword: 'eufy x10 pro', searchVolume: 1700, source: 'AI_GENERATED', matchType: 'PHRASE' },
        ],
        callouts: [],
        sitelinks: [],
        theme: MODEL_INTENT_BUCKET_INTENT,
        explanation: 'batch-2',
        ai_model: 'gemini-2.5-pro',
      },
    ])

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    }).mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    adCreativeFns.createAdCreative
      .mockResolvedValueOnce({ id: 601 })
      .mockResolvedValueOnce({ id: 602 })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
        batch: true,
        count: 2,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(keywordPoolFns.getKeywordsByLinkTypeAndBucket).toHaveBeenCalledWith(
      96,
      'store',
      'B'
    )
    expect(generatorFns.generateAdCreativesBatch).toHaveBeenCalledWith(
      96,
      1,
      2,
      expect.objectContaining({
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(generatorFns.applyKeywordSupplementationOnce).toHaveBeenCalled()
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledTimes(2)
    expect(adCreativeFns.createAdCreative).toHaveBeenNthCalledWith(
      1,
      1,
      96,
      expect.objectContaining({
        keywords: expect.arrayContaining(['eufy x10 omni']),
        keywordsWithVolume: expect.arrayContaining([
          expect.objectContaining({
            keyword: 'eufy x10 omni',
            source: 'AI_GENERATED',
          }),
        ]),
      })
    )
    expect(adCreativeFns.createAdCreative).toHaveBeenNthCalledWith(
      2,
      1,
      96,
      expect.objectContaining({
        keywords: expect.arrayContaining(['eufy x10 pro']),
        keywordsWithVolume: expect.arrayContaining([
          expect.objectContaining({
            keyword: 'eufy x10 pro',
            source: 'AI_GENERATED',
          }),
        ]),
      })
    )
    expect(data.count).toBe(2)
  })

  it('uses finalized executable keywords for retry exclusion in single mode', async () => {
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
          keyword: 'x10 omni',
          searchVolume: 1800,
          source: 'KEYWORD_POOL',
          sourceType: 'CANONICAL_BUCKET_VIEW',
          matchType: 'EXACT',
        },
      ],
    })

    keywordSelectionFns.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume, keywords }: any) => {
      const candidateList = Array.isArray(keywordsWithVolume)
        ? keywordsWithVolume
        : Array.isArray(keywords)
          ? keywords.map((keyword: string) => ({ keyword, searchVolume: 0 }))
          : []
      const chosen = candidateList.find((item: any) => item.keyword === 'x10 omni') || candidateList[0]
      return {
        keywords: chosen ? [chosen.keyword] : [],
        keywordsWithVolume: chosen ? [chosen] : [],
        truncated: false,
        sourceQuotaAudit,
      }
    })

    generatorFns.generateAdCreative
      .mockResolvedValueOnce({
        headlines: ['Eufy Official Store'],
        descriptions: ['Shop Eufy direct'],
        keywords: ['eufy official store'],
        keywordsWithVolume: [
          { keyword: 'eufy official store', searchVolume: 900, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        ],
        callouts: [],
        sitelinks: [],
        theme: MODEL_INTENT_BUCKET_INTENT,
        explanation: 'Too generic.',
        ai_model: 'gemini-2.5-pro',
      })
      .mockResolvedValueOnce({
        headlines: ['Eufy X10 Pro'],
        descriptions: ['Upgrade to Eufy X10 Pro'],
        keywords: ['eufy x10 pro'],
        keywordsWithVolume: [
          { keyword: 'eufy x10 pro', searchVolume: 700, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
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

    adCreativeFns.createAdCreative.mockResolvedValueOnce({
      id: 700,
      offer_id: 96,
      user_id: 1,
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: MODEL_INTENT_BUCKET_INTENT,
      keywords: ['eufy x10 omni'],
      headlines: ['Eufy X10 Omni'],
      descriptions: ['Shop the Eufy X10 Omni robot vacuum'],
      theme: MODEL_INTENT_BUCKET_INTENT,
      final_url: 'https://example.com/store',
      final_url_suffix: null,
      score_breakdown: {},
      generation_round: 2,
      creation_status: 'completed',
      created_at: '2026-03-16T00:00:00.000Z',
      updated_at: '2026-03-16T00:00:00.000Z',
      keyword_pool_id: null,
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    expect(res.status).toBe(200)
    expect(generatorFns.generateAdCreative).toHaveBeenNthCalledWith(
      2,
      96,
      1,
      expect.objectContaining({
        excludeKeywords: expect.arrayContaining(['x10 omni']),
      })
    )
  })

  it('returns 422 and skips persistence in single mode when hard quality gate fails', async () => {
    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['Eufy Official Store'],
      descriptions: ['Shop Eufy direct'],
      keywords: ['eufy official store'],
      keywordsWithVolume: [
        { keyword: 'eufy official store', searchVolume: 900, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
      ],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Too generic.',
      ai_model: 'gemini-2.5-pro',
    })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation: any = createEvaluation()
      evaluation.passed = false
      evaluation.failureType = 'rule_gate_failed'
      evaluation.reasons = ['missing intent anchor']
      evaluation.ruleGate = { passed: false, reasons: ['missing intent anchor'] }
      evaluation.adStrength.finalRating = 'AVERAGE'
      evaluation.adStrength.finalScore = 63
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
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

  it('returns 422 and skips persistence in single mode when hard persistence gate fails', async () => {
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '1'
    generatorFns.generateAdCreative.mockResolvedValueOnce({
      headlines: ['Eufy Official Store'],
      descriptions: ['Buy no'],
      keywords: ['eufy official store', 'x10 vacuum'],
      keywordsWithVolume: [
        { keyword: 'eufy official store', searchVolume: 900, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'x10 vacuum', searchVolume: 700, source: 'AI_GENERATED', sourceType: 'AI_GENERATED', matchType: 'PHRASE' },
      ],
      callouts: [],
      sitelinks: [],
      theme: MODEL_INTENT_BUCKET_INTENT,
      explanation: 'Low keyword count for hard persistence gate.',
      ai_model: 'gemini-2.5-pro',
    })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: null })
      const evaluation = createEvaluation()
      return {
        attempts: 1,
        selectedCreative: creative,
        selectedEvaluation: evaluation,
        history: [evaluation],
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/generate-ad-creative', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bucket: 'B',
        creativeType: 'model_intent',
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
})
