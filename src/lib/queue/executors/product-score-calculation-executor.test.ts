import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = {
  type: 'sqlite',
  query: vi.fn(),
  exec: vi.fn(),
}

const queueMock = {
  getConfig: vi.fn(() => ({ taskTimeout: 900000 })),
  enqueue: vi.fn(),
}

const calculateHybridProductRecommendationScoresMock = vi.fn()
const batchGetCachedProductRecommendationScoresMock = vi.fn()
const cacheProductRecommendationScoreMock = vi.fn()
const acquireProductScoreExecutionMutexMock = vi.fn()
const consumeProductScoreRequeueRequestMock = vi.fn()
const findExistingProductScoreTaskMock = vi.fn()
const markProductScoreRequeueNeededMock = vi.fn()
const isProductScoreCalculationPausedMock = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbMock),
}))

vi.mock('@/lib/db-helpers', () => ({
  nowFunc: vi.fn(() => "datetime('now')"),
}))

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueManagerForTaskType: vi.fn(async () => queueMock),
}))

vi.mock('@/lib/product-recommendation-scoring', () => ({
  calculateHybridProductRecommendationScores: calculateHybridProductRecommendationScoresMock,
}))

vi.mock('@/lib/product-score-cache', () => ({
  batchGetCachedProductRecommendationScores: batchGetCachedProductRecommendationScoresMock,
  cacheProductRecommendationScore: cacheProductRecommendationScoreMock,
}))

vi.mock('@/lib/product-score-coordination', () => ({
  acquireProductScoreExecutionMutex: acquireProductScoreExecutionMutexMock,
  consumeProductScoreRequeueRequest: consumeProductScoreRequeueRequestMock,
  findExistingProductScoreTask: findExistingProductScoreTaskMock,
  markProductScoreRequeueNeeded: markProductScoreRequeueNeededMock,
}))

vi.mock('@/lib/product-score-control', () => ({
  isProductScoreCalculationPaused: isProductScoreCalculationPausedMock,
}))

function createTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    type: 'product-score-calculation',
    userId: 1,
    priority: 'normal',
    status: 'running',
    createdAt: Date.now(),
    data: {
      userId: 1,
      batchSize: 2,
      includeSeasonalityAnalysis: true,
      forceRecalculate: false,
      trigger: 'manual',
      ...overrides,
    },
  } as any
}

function normalizeFingerprintText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeFingerprintNumber(value: unknown): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(4) : ''
}

function normalizeAllowedCountries(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => normalizeFingerprintText(item))
        .filter(Boolean)
        .sort()
        .join(',')
    }
  } catch {
    // ignore
  }
  return normalizeFingerprintText(value)
}

function buildProductScoreInputFingerprint(product: Record<string, any>): string {
  const payload = [
    normalizeFingerprintText(product.asin),
    normalizeFingerprintText(product.product_name),
    normalizeFingerprintText(product.brand),
    normalizeFingerprintText(product.product_url),
    normalizeFingerprintText(product.promo_link),
    normalizeFingerprintText(product.short_promo_link),
    normalizeAllowedCountries(product.allowed_countries_json),
    normalizeFingerprintNumber(product.price_amount),
    normalizeFingerprintNumber(product.review_count),
    normalizeFingerprintNumber(product.commission_rate),
    normalizeFingerprintNumber(product.commission_amount),
    product.is_blacklisted ? '1' : '0',
    product.is_confirmed_invalid ? '1' : '0',
  ].join('|')

  return createHash('sha1').update(payload).digest('hex')
}

describe('executeProductScoreCalculation', () => {
  beforeEach(() => {
    delete process.env.PRODUCT_SCORE_AI_RERANK_TOP_K_MANUAL
    delete process.env.PRODUCT_SCORE_AI_RERANK_TOP_K_BACKGROUND

    dbMock.query.mockReset().mockResolvedValue([])
    dbMock.exec.mockReset().mockResolvedValue(undefined)
    queueMock.getConfig.mockClear()
    queueMock.enqueue.mockReset().mockResolvedValue('next-task-id')

    calculateHybridProductRecommendationScoresMock.mockReset()
    batchGetCachedProductRecommendationScoresMock.mockReset().mockResolvedValue(new Map())
    cacheProductRecommendationScoreMock.mockReset().mockResolvedValue(undefined)
    acquireProductScoreExecutionMutexMock.mockReset().mockResolvedValue({
      acquired: true,
      refresh: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    })
    consumeProductScoreRequeueRequestMock.mockReset().mockResolvedValue(null)
    findExistingProductScoreTaskMock.mockReset().mockResolvedValue(null)
    markProductScoreRequeueNeededMock.mockReset().mockResolvedValue(undefined)
    isProductScoreCalculationPausedMock.mockReset().mockResolvedValue(false)
  })

  it('skips execution when another task already holds the user mutex', async () => {
    acquireProductScoreExecutionMutexMock.mockResolvedValue({
      acquired: false,
      refresh: vi.fn(),
      release: vi.fn(),
    })

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(markProductScoreRequeueNeededMock).toHaveBeenCalledWith(1, expect.objectContaining({
      includeSeasonalityAnalysis: true,
      forceRecalculate: false,
      trigger: 'manual',
    }))
    expect(calculateHybridProductRecommendationScoresMock).not.toHaveBeenCalled()
  })

  it('schedules a follow-up task when a deferred request exists', async () => {
    dbMock.query.mockResolvedValue([
      { id: 101 },
    ])
    calculateHybridProductRecommendationScoresMock.mockResolvedValue({
      results: [
        {
          productId: 101,
          usedAI: false,
          score: {
            starRating: 4,
            totalScore: 78,
            reasons: ['rule-based'],
            seasonalityAnalysis: null,
            productAnalysis: null,
          },
        },
      ],
      summary: {
        totalProducts: 1,
        aiCandidates: 0,
        aiCompleted: 0,
        ruleOnly: 1,
      },
    })
    consumeProductScoreRequeueRequestMock.mockResolvedValue({
      includeSeasonalityAnalysis: true,
      forceFullRescore: true,
      trigger: 'sync-complete',
      updatedAt: new Date().toISOString(),
    })

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(calculateHybridProductRecommendationScoresMock).toHaveBeenCalledWith(
      expect.any(Array),
      1,
      expect.objectContaining({
        includeSeasonalityAnalysis: true,
        aiRerankTopK: 10,
      })
    )

    expect(queueMock.enqueue).toHaveBeenCalledWith(
      'product-score-calculation',
      expect.objectContaining({
        userId: 1,
        forceRecalculate: true,
        includeSeasonalityAnalysis: true,
        trigger: 'sync-complete',
      }),
      1,
      expect.objectContaining({ priority: 'normal' })
    )
  })

  it('includes legacy Amazon landing-page misclassification condition in incremental selection', async () => {
    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask({ forceRecalculate: false }))

    const querySql = String(dbMock.query.mock.calls[0]?.[0] || '')
    expect(querySql).toContain("NULLIF(TRIM(COALESCE(asin, '')), '') IS NOT NULL")
    expect(querySql).toContain("TRIM(COALESCE(product_url, '')) = ''")
    expect(querySql).toContain("COALESCE(recommendation_reasons, '') LIKE '%非Amazon落地页,信任度相对较低%'")
  })

  it('does not include legacy Amazon misclassification condition when force recalculation is enabled', async () => {
    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask({ forceRecalculate: true }))

    const querySql = String(dbMock.query.mock.calls[0]?.[0] || '')
    expect(querySql).not.toContain("COALESCE(recommendation_reasons, '') LIKE '%非Amazon落地页,信任度相对较低%'")
  })

  it('exits early when user paused score calculation', async () => {
    isProductScoreCalculationPausedMock.mockResolvedValue(true)

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(dbMock.query).not.toHaveBeenCalled()
    expect(calculateHybridProductRecommendationScoresMock).not.toHaveBeenCalled()
    expect(queueMock.enqueue).not.toHaveBeenCalled()
  })

  it('uses lower default rerank top-k for schedule trigger', async () => {
    dbMock.query.mockResolvedValue([{ id: 201 }])
    calculateHybridProductRecommendationScoresMock.mockResolvedValue({
      results: [
        {
          productId: 201,
          usedAI: false,
          score: {
            starRating: 3.8,
            totalScore: 73,
            reasons: ['rule-based'],
            seasonalityAnalysis: null,
            productAnalysis: null,
          },
        },
      ],
      summary: {
        totalProducts: 1,
        aiCandidates: 0,
        aiCompleted: 0,
        ruleOnly: 1,
      },
    })

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask({ trigger: 'schedule' }))

    expect(calculateHybridProductRecommendationScoresMock).toHaveBeenCalledWith(
      expect.any(Array),
      1,
      expect.objectContaining({
        includeSeasonalityAnalysis: true,
        aiRerankTopK: 3,
      })
    )
  })

  it('reuses fresh product-score cache and skips hybrid calculation', async () => {
    const cacheCalculatedAt = '2026-03-28T07:00:00.000Z'
    dbMock.query.mockResolvedValue([
      {
        id: 301,
        last_synced_at: '2026-03-28T06:30:00.000Z',
      },
    ])
    batchGetCachedProductRecommendationScoresMock.mockResolvedValue(
      new Map([
        [
          301,
          {
            recommendationScore: 4.2,
            recommendationReasons: ['cached'],
            seasonalityScore: 70,
            productAnalysis: { category: 'electronics' },
            scoreCalculatedAt: cacheCalculatedAt,
            cachedAt: Date.now(),
          },
        ],
      ])
    )

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(batchGetCachedProductRecommendationScoresMock).toHaveBeenCalledWith(1, [301])
    expect(calculateHybridProductRecommendationScoresMock).not.toHaveBeenCalled()
    expect(dbMock.exec).toHaveBeenCalledTimes(1)
    expect(String(dbMock.exec.mock.calls[0]?.[0] || '')).toContain('recommendation_score = ?')
    expect(dbMock.exec.mock.calls[0]?.[1]?.[0]).toBe(4.2)
  })

  it('reuses cache by input fingerprint even if last_synced_at is newer', async () => {
    const product = {
      id: 303,
      asin: 'B0CACHEFINGER',
      product_name: 'Cache Finger Product',
      brand: 'CacheBrand',
      product_url: 'https://amazon.com/dp/B0CACHEFINGER',
      promo_link: 'https://example.com/promo',
      short_promo_link: 'https://example.com/s',
      allowed_countries_json: JSON.stringify(['US', 'CA']),
      price_amount: 49.99,
      review_count: 1234,
      commission_rate: 8,
      commission_amount: 12.5,
      is_blacklisted: false,
      is_confirmed_invalid: false,
      last_synced_at: '2026-03-28T09:00:00.000Z',
    }
    dbMock.query.mockResolvedValue([product])
    batchGetCachedProductRecommendationScoresMock.mockResolvedValue(
      new Map([
        [
          303,
          {
            recommendationScore: 4.6,
            recommendationReasons: ['cached-by-fingerprint'],
            seasonalityScore: 70,
            productAnalysis: { category: 'electronics' },
            scoreCalculatedAt: '2026-03-28T08:00:00.000Z',
            inputFingerprint: buildProductScoreInputFingerprint(product),
            cachedAt: Date.now(),
          },
        ],
      ])
    )

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(calculateHybridProductRecommendationScoresMock).not.toHaveBeenCalled()
    expect(dbMock.exec).toHaveBeenCalled()
    expect(dbMock.exec.mock.calls[0]?.[1]?.[0]).toBe(4.6)
  })

  it('ignores stale cache when product synced after cached score', async () => {
    dbMock.query.mockResolvedValue([
      {
        id: 302,
        last_synced_at: '2026-03-28T08:30:00.000Z',
      },
    ])
    batchGetCachedProductRecommendationScoresMock.mockResolvedValue(
      new Map([
        [
          302,
          {
            recommendationScore: 4.2,
            recommendationReasons: ['cached'],
            seasonalityScore: 70,
            productAnalysis: { category: 'electronics' },
            scoreCalculatedAt: '2026-03-28T08:00:00.000Z',
            cachedAt: Date.now(),
          },
        ],
      ])
    )
    calculateHybridProductRecommendationScoresMock.mockResolvedValue({
      results: [
        {
          productId: 302,
          usedAI: false,
          score: {
            starRating: 3.6,
            totalScore: 72,
            reasons: ['rule-based'],
            seasonalityAnalysis: null,
            productAnalysis: null,
          },
        },
      ],
      summary: {
        totalProducts: 1,
        aiCandidates: 0,
        aiCompleted: 0,
        ruleOnly: 1,
      },
    })

    const { executeProductScoreCalculation } = await import('./product-score-calculation-executor')
    await executeProductScoreCalculation(createTask())

    expect(calculateHybridProductRecommendationScoresMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 302 })],
      1,
      expect.objectContaining({
        includeSeasonalityAnalysis: true,
        aiRerankTopK: 10,
      })
    )
  })
})
