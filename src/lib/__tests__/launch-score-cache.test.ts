import { beforeEach, describe, expect, it, vi } from 'vitest'

const findCachedLaunchScoreMock = vi.fn()
const createLaunchScoreMock = vi.fn()
const findLatestLaunchScoreMock = vi.fn()
const resolveLaunchScoreForCreativeCompareMock = vi.fn()

vi.mock('../launch-score', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../launch-score/server')>()
  return {
    ...actual,
    findCachedLaunchScore: (...args: unknown[]) => findCachedLaunchScoreMock(...args),
    createLaunchScore: (...args: unknown[]) => createLaunchScoreMock(...args),
    findLatestLaunchScore: (...args: unknown[]) => findLatestLaunchScoreMock(...args),
    resolveLaunchScoreForCreativeCompare: (...args: unknown[]) =>
      resolveLaunchScoreForCreativeCompareMock(...args),
  }
})

import { computeContentHash } from '../launch-score/server'
import {
  buildLaunchScoreHashes,
  pickBestAdCreativeByScore,
  readLaunchScoreForCreative,
  resolveLaunchScoreGetForCreative,
  saveLaunchScoreWithContentCache,
} from '../launch-score/server'

describe('buildLaunchScoreHashes', () => {
  const offer = {
    id: 1,
    target_country: 'US',
    target_language: 'en',
    final_url: 'https://example.com/o',
    url: 'https://example.com/o',
  } as any

  const creative = {
    id: 10,
    headlines: ['H1', 'H2'],
    descriptions: ['D1'],
    keywords: ['kw'],
    negativeKeywords: ['neg'],
    final_url: 'https://example.com/c',
  } as any

  it('returns stable hashes for the same content', () => {
    const a = buildLaunchScoreHashes(creative, offer)
    const b = buildLaunchScoreHashes(creative, offer)
    expect(a).toEqual(b)
  })

  it('changes content hash when headlines change', () => {
    const base = buildLaunchScoreHashes(creative, offer)
    const changed = buildLaunchScoreHashes({ ...creative, headlines: ['H1', 'H3'] }, offer)
    expect(changed.contentHash).not.toBe(base.contentHash)
  })

  it('uses Step3 config keywords for hash when provided', () => {
    const withConfig = buildLaunchScoreHashes(creative, offer, {
      keywords: [{ keyword: 'step3-kw', searchVolume: 200, matchType: 'EXACT' }],
    })
    const dbOnly = buildLaunchScoreHashes(
      {
        ...creative,
        keywordsWithVolume: [{ keyword: 'db-kw', searchVolume: 100, matchType: 'PHRASE' }],
      },
      offer
    )
    expect(withConfig.contentHash).not.toBe(dbOnly.contentHash)
  })

  it('changes content hash when keywordsWithVolume searchVolume changes', () => {
    const base = buildLaunchScoreHashes(
      {
        ...creative,
        keywordsWithVolume: [{ keyword: 'brand', searchVolume: 100, matchType: 'PHRASE' }],
      },
      offer
    )
    const changed = buildLaunchScoreHashes(
      {
        ...creative,
        keywordsWithVolume: [{ keyword: 'brand', searchVolume: 500, matchType: 'PHRASE' }],
      },
      offer
    )
    expect(changed.contentHash).not.toBe(base.contentHash)
  })
})

describe('computeContentHash keywordsWithVolume', () => {
  it('includes normalized volume entries in the hash', () => {
    const base = computeContentHash({
      headlines: ['h'],
      descriptions: ['d'],
      keywords: ['kw'],
      negativeKeywords: [],
      finalUrl: 'https://example.com',
      keywordsWithVolume: [{ keyword: 'kw', searchVolume: 10 }],
    })
    const changed = computeContentHash({
      headlines: ['h'],
      descriptions: ['d'],
      keywords: ['kw'],
      negativeKeywords: [],
      finalUrl: 'https://example.com',
      keywordsWithVolume: [{ keyword: 'kw', searchVolume: 99 }],
    })
    expect(changed).not.toBe(base)
  })
})

describe('readLaunchScoreForCreative', () => {
  const offer = {
    id: 1,
    target_country: 'US',
    target_language: 'en',
    final_url: 'https://example.com/o',
    url: 'https://example.com/o',
  } as any

  const creative = {
    id: 10,
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: ['kw'],
    negativeKeywords: [],
    final_url: 'https://example.com/c',
  } as any

  beforeEach(() => {
    findCachedLaunchScoreMock.mockReset()
    findLatestLaunchScoreMock.mockReset()
    resolveLaunchScoreForCreativeCompareMock.mockReset()
  })

  it('returns hash-matched score when cache hits', async () => {
    const cached = { id: 50, totalScore: 88 }
    findCachedLaunchScoreMock.mockResolvedValue(cached)

    const result = await readLaunchScoreForCreative(creative, offer, 1)

    expect(result).toEqual({ score: cached, staleScore: null })
    expect(resolveLaunchScoreForCreativeCompareMock).not.toHaveBeenCalled()
  })

  it('returns staleScore when cache misses but legacy row exists', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    findLatestLaunchScoreMock.mockResolvedValue({ id: 1, totalScore: 70 })
    const stale = { id: 40, totalScore: 65 }
    resolveLaunchScoreForCreativeCompareMock.mockResolvedValue({
      score: stale,
      scoreSource: 'creative',
    })

    const result = await readLaunchScoreForCreative(creative, offer, 1)

    expect(result).toEqual({ score: null, staleScore: stale })
  })

  it('returns empty when no cache and no stored score', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    findLatestLaunchScoreMock.mockResolvedValue(null)
    resolveLaunchScoreForCreativeCompareMock.mockResolvedValue({
      score: null,
      scoreSource: null,
    })

    const result = await readLaunchScoreForCreative(creative, offer, 1)

    expect(result).toEqual({ score: null, staleScore: null })
  })

  it('ignores legacy offer-level score when cache misses', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    findLatestLaunchScoreMock.mockResolvedValue({ id: 1, totalScore: 70, adCreativeId: null })
    resolveLaunchScoreForCreativeCompareMock.mockResolvedValue({
      score: { id: 40, totalScore: 65, adCreativeId: null },
      scoreSource: 'offer_latest',
    })

    const result = await readLaunchScoreForCreative(creative, offer, 1)

    expect(result).toEqual({ score: null, staleScore: null })
  })
})

describe('saveLaunchScoreWithContentCache', () => {
  const offer = {
    id: 1,
    target_country: 'US',
    target_language: 'en',
    final_url: 'https://example.com/o',
    url: 'https://example.com/o',
  } as any

  const creative = {
    id: 10,
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: ['kw'],
    negativeKeywords: [],
    final_url: 'https://example.com/c',
  } as any

  const analysis = {
    launchViability: { score: 30 },
    adQuality: { score: 25 },
    keywordStrategy: { score: 15 },
    basicConfig: { score: 10 },
    overallRecommendations: [],
  } as any

  beforeEach(() => {
    findCachedLaunchScoreMock.mockReset()
    createLaunchScoreMock.mockReset()
  })

  it('returns existing row without insert when hash matches', async () => {
    const existing = { id: 99, totalScore: 80 }
    findCachedLaunchScoreMock.mockResolvedValue(existing)

    const result = await saveLaunchScoreWithContentCache(1, 1, creative, offer, analysis)

    expect(result).toEqual({ launchScore: existing, created: false })
    expect(createLaunchScoreMock).not.toHaveBeenCalled()
  })

  it('inserts when no cached row exists', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    const inserted = { id: 100, totalScore: 82 }
    createLaunchScoreMock.mockResolvedValue(inserted)

    const result = await saveLaunchScoreWithContentCache(1, 1, creative, offer, analysis)

    expect(result).toEqual({ launchScore: inserted, created: true })
    expect(createLaunchScoreMock).toHaveBeenCalledTimes(1)
  })
})

describe('pickBestAdCreativeByScore', () => {
  it('returns null for empty list', () => {
    expect(pickBestAdCreativeByScore([])).toBeNull()
  })

  it('picks creative with highest score', () => {
    const creatives = [
      { id: 1, score: 70 },
      { id: 2, score: 95 },
      { id: 3, score: 80 },
    ] as any[]
    expect(pickBestAdCreativeByScore(creatives)?.id).toBe(2)
  })

  it('treats missing score as zero', () => {
    const creatives = [
      { id: 1, score: null },
      { id: 2, score: 1 },
    ] as any[]
    expect(pickBestAdCreativeByScore(creatives)?.id).toBe(2)
  })
})

const findAdCreativesByOfferIdMock = vi.fn()

vi.mock('../creatives/server', () => ({
  findAdCreativesByOfferId: (...args: unknown[]) => findAdCreativesByOfferIdMock(...args),
}))

describe('resolveLaunchScoreGetForCreative', () => {
  const offer = {
    id: 1,
    scrape_status: 'completed',
    target_country: 'US',
    target_language: 'en',
    final_url: 'https://example.com/o',
    url: 'https://example.com/o',
  } as any

  const creative = {
    id: 10,
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: ['kw'],
    negativeKeywords: [],
    final_url: 'https://example.com/c',
  } as any

  beforeEach(() => {
    findCachedLaunchScoreMock.mockReset()
    findLatestLaunchScoreMock.mockReset()
    resolveLaunchScoreForCreativeCompareMock.mockReset()
    findAdCreativesByOfferIdMock.mockReset()
    findAdCreativesByOfferIdMock.mockResolvedValue([creative])
  })

  it('returns hash-matched score without auto calculate', async () => {
    const cached = { id: 50, totalScore: 88 }
    findCachedLaunchScoreMock.mockResolvedValue(cached)

    const result = await resolveLaunchScoreGetForCreative(1, offer, creative, undefined, false)

    expect(result).toEqual({ launchScore: cached, usedCreativeId: 10 })
  })

  it('returns stale response when content hash misses', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    findLatestLaunchScoreMock.mockResolvedValue({ id: 1, totalScore: 70 })
    const stale = { id: 40, totalScore: 65 }
    resolveLaunchScoreForCreativeCompareMock.mockResolvedValue({
      score: stale,
      scoreSource: 'creative',
    })

    const result = await resolveLaunchScoreGetForCreative(1, offer, creative, undefined, false)

    expect(result.launchScore).toBeNull()
    expect(result.stale).toBe(true)
    expect(result.staleLaunchScoreId).toBe(40)
    expect(result.canAutoCalculate).toBe(true)
  })

  it('blocks auto calculate when scrape is incomplete', async () => {
    findCachedLaunchScoreMock.mockResolvedValue(null)
    findLatestLaunchScoreMock.mockResolvedValue(null)
    resolveLaunchScoreForCreativeCompareMock.mockResolvedValue({
      score: null,
      scoreSource: null,
    })

    const result = await resolveLaunchScoreGetForCreative(
      1,
      { ...offer, scrape_status: 'pending' },
      creative,
      undefined,
      true
    )

    expect(result.launchScore).toBeNull()
    expect(result.canAutoCalculate).toBe(false)
    expect(result.message).toContain('抓取')
  })
})
