import { describe, expect, it } from 'vitest'
import { buildCreativeKeywordSet } from '../creative-keyword-set-builder'
import {
  evaluateMultiEntryTopNConsistency,
  evaluateMultiEntryTopSourceDistribution,
} from '../creative-keyword-consistency'

describe('creative keyword topN consistency benchmark', () => {
  it('keeps >=90% top20 overlap across entry profiles for same offer+bucket input', async () => {
    const baseCandidates = Array.from({ length: 30 }, (_, index) => ({
      keyword: `brandx x${200 + index} vacuum`,
      searchVolume: 5000 - index * 10,
      source: index % 2 === 0 ? 'SEARCH_TERM_HIGH_PERFORMING' : 'KEYWORD_PLANNER_ENRICHED',
      sourceType: index % 2 === 0 ? 'SEARCH_TERM_HIGH_PERFORMING' : 'KEYWORD_PLANNER_ENRICHED',
      matchType: 'PHRASE' as const,
    }))

    const baseInput = {
      offer: {
        brand: 'BrandX',
        category: 'Vacuum',
        product_name: 'X200',
        target_country: 'US',
        target_language: 'en',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'model_intent' as const,
      bucket: 'B' as const,
      keywordsWithVolume: baseCandidates as any,
      keywords: baseCandidates.map((item) => item.keyword),
      scopeLabel: 'consistency-benchmark',
      enableSupplementation: false,
      continueOnSupplementError: true,
      fallbackMode: false,
    }

    const sync = await buildCreativeKeywordSet({
      ...baseInput,
      scopeLabel: 'sync-B',
    })
    const stream = await buildCreativeKeywordSet({
      ...baseInput,
      scopeLabel: 'stream-B',
    })
    const single = await buildCreativeKeywordSet({
      ...baseInput,
      scopeLabel: 'single-B',
    })
    const differentiated = await buildCreativeKeywordSet({
      ...baseInput,
      scopeLabel: 'differentiated-B',
    })
    const queue = await buildCreativeKeywordSet({
      ...baseInput,
      scopeLabel: 'queue-B',
    })

    const consistency = evaluateMultiEntryTopNConsistency({
      baselineEntry: 'sync',
      topN: 20,
      threshold: 0.9,
      entryKeywords: {
        sync: sync.keywords,
        stream: stream.keywords,
        single: single.keywords,
        differentiated: differentiated.keywords,
        queue: queue.keywords,
      },
    })
    const sourceDistribution = evaluateMultiEntryTopSourceDistribution({
      baselineEntry: 'sync',
      topN: 20,
      maxDifferenceThreshold: 0.1,
      entryKeywordsWithSource: {
        sync: sync.keywordsWithVolume as any,
        stream: stream.keywordsWithVolume as any,
        single: single.keywordsWithVolume as any,
        differentiated: differentiated.keywordsWithVolume as any,
        queue: queue.keywordsWithVolume as any,
      },
    })

    expect(consistency.passed).toBe(true)
    for (const report of Object.values(consistency.reports)) {
      expect(report.overlapRate).toBeGreaterThanOrEqual(0.9)
    }
    expect(sourceDistribution.passed).toBe(true)
    for (const report of Object.values(sourceDistribution.reports)) {
      expect(report.maxAbsoluteDifference).toBeLessThanOrEqual(0.1)
    }
  })

  it('flags consistency failure when overlap is below threshold', () => {
    const consistency = evaluateMultiEntryTopNConsistency({
      baselineEntry: 'sync',
      topN: 20,
      threshold: 0.9,
      entryKeywords: {
        sync: Array.from({ length: 20 }, (_, idx) => `brandx keyword ${idx + 1}`),
        stream: Array.from({ length: 20 }, (_, idx) => `other keyword ${idx + 1}`),
      },
    })

    expect(consistency.passed).toBe(false)
    expect(consistency.reports.stream.overlapRate).toBe(0)
    expect(consistency.reports.stream.passed).toBe(false)
  })

  it('flags source distribution drift when top20 raw-source diff exceeds 10%', () => {
    const sourceDistribution = evaluateMultiEntryTopSourceDistribution({
      baselineEntry: 'sync',
      topN: 20,
      maxDifferenceThreshold: 0.1,
      entryKeywordsWithSource: {
        sync: Array.from({ length: 20 }, () => ({ rawSource: 'SEARCH_TERM' })),
        stream: [
          ...Array.from({ length: 10 }, () => ({ rawSource: 'SEARCH_TERM' })),
          ...Array.from({ length: 10 }, () => ({ rawSource: 'AI' })),
        ],
      },
    })

    expect(sourceDistribution.passed).toBe(false)
    expect(sourceDistribution.reports.stream.maxAbsoluteDifference).toBeGreaterThan(0.1)
  })
})
