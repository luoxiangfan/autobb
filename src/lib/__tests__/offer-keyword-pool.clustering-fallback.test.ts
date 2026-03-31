import { describe, expect, it, vi } from 'vitest'

vi.mock('../prompt-loader', () => ({
  loadPrompt: vi.fn(async () => [
    'brand={{brandName}}',
    'category={{productCategory}}',
    'type={{linkType}}',
    '{{keywords}}',
  ].join('\n')),
}))

vi.mock('../gemini', () => ({
  generateContent: vi.fn(async () => {
    const error: any = new Error('Gemini API调用失败: 403 Forbidden')
    error.response = { status: 403 }
    throw error
  }),
}))

vi.mock('../ai-token-tracker', () => ({
  recordTokenUsage: vi.fn(async () => undefined),
  estimateTokenCost: vi.fn(() => 0),
}))

import { clusterKeywordsByIntent } from '../offer-keyword-pool'

describe('clusterKeywordsByIntent fallback', () => {
  it('falls back to deterministic product buckets when AI clustering returns 403', async () => {
    const keywords = [
      'brandx x200',
      'brandx review',
      'brandx feature comparison',
      'brandx discount',
    ]

    const buckets = await clusterKeywordsByIntent(
      keywords,
      'BrandX',
      'camera',
      1,
      'US',
      'en',
      'product'
    )

    expect(buckets.bucketA.keywords.length).toBeGreaterThan(0)
    expect(buckets.bucketB.keywords.length).toBeGreaterThan(0)
    expect(buckets.bucketC.keywords.length).toBeGreaterThan(0)
    expect(buckets.bucketD.keywords.length).toBeGreaterThan(0)
    expect(buckets.statistics.totalKeywords).toBe(keywords.length)
  })

  it('falls back to deterministic store buckets in batched mode when AI clustering returns 403', async () => {
    const keywords = Array.from({ length: 50 }, (_, index) => {
      if (index % 5 === 0) return `brandx review ${index}`
      if (index % 5 === 1) return `brandx discount ${index}`
      if (index % 5 === 2) return `brandx near me ${index}`
      if (index % 5 === 3) return `brandx model ${index}`
      return `brandx support ${index}`
    })

    const buckets = await clusterKeywordsByIntent(
      keywords,
      'BrandX',
      'retail',
      1,
      'US',
      'en',
      'store'
    )

    expect(Array.isArray(buckets.bucketS?.keywords)).toBe(true)
    expect((buckets.bucketS?.keywords.length || 0)).toBeGreaterThanOrEqual(keywords.length)
    expect(
      buckets.bucketA.keywords.length +
      buckets.bucketB.keywords.length +
      buckets.bucketC.keywords.length +
      buckets.bucketD.keywords.length
    ).toBeGreaterThan(0)
  })
})
