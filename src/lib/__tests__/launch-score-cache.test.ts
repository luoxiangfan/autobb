import { beforeEach, describe, expect, it, vi } from 'vitest'

const findCachedLaunchScoreMock = vi.fn()
const createLaunchScoreMock = vi.fn()

vi.mock('../launch-scores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../launch-scores')>()
  return {
    ...actual,
    findCachedLaunchScore: (...args: unknown[]) => findCachedLaunchScoreMock(...args),
    createLaunchScore: (...args: unknown[]) => createLaunchScoreMock(...args),
  }
})

import { computeContentHash } from '../launch-scores'
import { buildLaunchScoreHashes, saveLaunchScoreWithContentCache } from '../launch-score-cache'

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
    const changed = buildLaunchScoreHashes(
      { ...creative, headlines: ['H1', 'H3'] },
      offer
    )
    expect(changed.contentHash).not.toBe(base.contentHash)
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
