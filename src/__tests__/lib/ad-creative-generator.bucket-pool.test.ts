import { describe, expect, it } from 'vitest'

import { getThemeByBucket } from '@/lib/creatives/generator/index'
import { resolveCreativeBucketPoolKeywords } from '@/lib/creatives/generator/test-exports'

function kw(keyword: string, searchVolume: number = 100) {
  return {
    keyword,
    searchVolume,
    source: 'KEYWORD_POOL',
    matchType: 'PHRASE' as const,
  }
}

function createPool(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    offerId: 1,
    userId: 1,
    brandKeywords: [kw('acme')],
    bucketAKeywords: [kw('acme robot vacuum')],
    bucketBKeywords: [kw('acme x10 vacuum')],
    bucketCKeywords: [kw('x10 robot vacuum')],
    bucketDKeywords: [kw('acme vacuum deals')],
    bucketAIntent: '',
    bucketBIntent: '',
    bucketCIntent: '',
    bucketDIntent: '',
    storeBucketAKeywords: [kw('acme robot vacuum')],
    storeBucketBKeywords: [kw('acme x10 vacuum')],
    storeBucketCKeywords: [kw('acme x10 pro omni')],
    storeBucketDKeywords: [kw('acme free shipping')],
    storeBucketSKeywords: [kw('acme vacuum deals')],
    storeBucketAIntent: '',
    storeBucketBIntent: '',
    storeBucketCIntent: '',
    storeBucketDIntent: '',
    storeBucketSIntent: '',
    linkType: 'product' as const,
    totalKeywords: 5,
    clusteringModel: null,
    clusteringPromptVersion: null,
    balanceScore: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('resolveCreativeBucketPoolKeywords', () => {
  it('rejects legacy bucket C', () => {
    const pool = createPool()

    expect(() => resolveCreativeBucketPoolKeywords(pool, 'C', 'A')).toThrow(
      'Invalid bucket type: C'
    )
  })

  it('rejects legacy bucket S', () => {
    const pool = createPool()

    expect(() => resolveCreativeBucketPoolKeywords(pool, 'S', 'A')).toThrow(
      'Invalid bucket type: S'
    )
  })

  it('returns canonical B keywords', () => {
    const pool = createPool()

    const bucketB = resolveCreativeBucketPoolKeywords(pool, 'B', 'A').map((item) => item.keyword)

    expect(bucketB).toContain('acme x10 vacuum')
    expect(bucketB).toContain('x10 robot vacuum')
  })

  it('uses the provided fallback bucket when no bucket is specified', () => {
    const pool = createPool()

    const fallbackA = resolveCreativeBucketPoolKeywords(pool, null, 'A').map((item) => item.keyword)
    const fallbackD = resolveCreativeBucketPoolKeywords(pool, null, 'D').map((item) => item.keyword)

    expect(fallbackA).toContain('acme robot vacuum')
    expect(fallbackD).toContain('acme vacuum deals')
    expect(fallbackD.length).toBeGreaterThanOrEqual(fallbackA.length)
  })

  it('uses store canonical buckets for store offers', () => {
    const pool = createPool({
      linkType: 'store',
      brandKeywords: [kw('acme')],
      storeBucketAKeywords: [kw('acme robot vacuum collection')],
      storeBucketBKeywords: [kw('acme x10 vacuum')],
      storeBucketCKeywords: [kw('acme x10 pro omni')],
      storeBucketDKeywords: [kw('acme authorized service')],
      storeBucketSKeywords: [kw('acme vacuum deals')],
    })

    const brandKeywords = resolveCreativeBucketPoolKeywords(pool, 'A', 'A').map(
      (item) => item.keyword
    )
    const productKeywords = resolveCreativeBucketPoolKeywords(pool, 'D', 'A').map(
      (item) => item.keyword
    )

    expect(brandKeywords).toContain('acme robot vacuum collection')
    expect(brandKeywords).toContain('acme x10 pro omni')
    expect(productKeywords).toContain('acme vacuum deals')
  })
})

describe('getThemeByBucket', () => {
  it('returns empty theme for legacy C and S buckets', () => {
    expect(getThemeByBucket('C', 'product')).toBe('')
    expect(getThemeByBucket('S', 'product')).toBe('')
  })
})
