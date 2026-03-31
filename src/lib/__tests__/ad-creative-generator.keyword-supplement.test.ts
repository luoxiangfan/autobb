import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyKeywordSupplementationOnce, type KeywordWithVolume } from '../ad-creative-generator'

const { getKeywordPoolByOfferIdMock } = vi.hoisted(() => ({
  getKeywordPoolByOfferIdMock: vi.fn(),
}))

vi.mock('../offer-keyword-pool', async () => {
  const actual = await vi.importActual<typeof import('../offer-keyword-pool')>('../offer-keyword-pool')
  return {
    ...actual,
    getKeywordPoolByOfferId: getKeywordPoolByOfferIdMock,
  }
})

function makeKeywords(count: number, prefix: string): KeywordWithVolume[] {
  return Array.from({ length: count }, (_, index) => ({
    keyword: `${prefix} ${index + 1}`,
    searchVolume: Math.max(0, 1000 - index * 10),
    matchType: 'PHRASE',
    source: 'AI_GENERATED',
  }))
}

describe('ad-creative-generator keyword supplementation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    getKeywordPoolByOfferIdMock.mockResolvedValue(null)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('does not trigger supplementation and does not truncate when keyword count is already >= 10', async () => {
    const baseKeywords = makeKeywords(30, 'brandx performance tool')

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925 },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
    })

    expect(result.keywordSupplementation.triggered).toBe(false)
    expect(result.keywordsWithVolume).toHaveLength(30)
    expect(result.keywords).toHaveLength(30)
  })

  it('can bypass threshold gate when supplement-threshold flag is disabled', async () => {
    vi.stubEnv('CREATIVE_KEYWORD_SUPPLEMENT_THRESHOLD_GATE_ENABLED', 'false')
    const baseKeywords = Array.from({ length: 10 }, (_, index) => ({
      keyword: `brandx vacuum cleaner ${index + 1}`,
      searchVolume: 500 - index,
      matchType: 'PHRASE' as const,
      source: 'AI_GENERATED',
    }))

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925 },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      bucket: 'B',
      keywordsWithVolume: baseKeywords,
      poolCandidates: ['brandx x200 vacuum'],
    })

    expect(result.keywordSupplementation.triggered).toBe(true)
    expect(result.keywordSupplementation.afterCount).toBeGreaterThan(result.keywordSupplementation.beforeCount)
  })

  it('triggers once when <10 but does not force-fill to 10', async () => {
    const baseKeywords = makeKeywords(8, 'brandx repair part')
    const poolCandidates = ['brandx replacement cartridge']

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925, scraped_data: { rawProductTitle: '', rawAboutThisItem: [] } },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
      poolCandidates,
    })

    expect(result.keywordSupplementation.triggered).toBe(true)
    expect(result.keywordSupplementation.beforeCount).toBe(8)
    expect(result.keywordSupplementation.afterCount).toBe(9)
    expect(result.keywordSupplementation.addedKeywords).toHaveLength(1)
    expect(result.keywordSupplementation.addedKeywords[0].source).toBe('keyword_pool')
  })

  it('uses keyword pool first, then title/about candidates, and sets supplemented volume to 0', async () => {
    const baseKeywords = makeKeywords(9, 'brandx lawn accessory')
    const poolCandidates = ['brandx replacement blade']

    const result = await applyKeywordSupplementationOnce({
      offer: {
        id: 3925,
        scraped_data: {
          rawProductTitle: 'BrandX Cordless Garden Trimmer',
          rawAboutThisItem: ['Dual line cutting system for thick grass'],
        },
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
      poolCandidates,
    })

    expect(result.keywordSupplementation.triggered).toBe(true)
    expect(result.keywordSupplementation.addedKeywords.length).toBeGreaterThan(1)
    expect(result.keywordSupplementation.addedKeywords[0].source).toBe('keyword_pool')
    expect(result.keywordSupplementation.addedKeywords.some(k => k.source === 'title_about')).toBe(true)

    const addedKeywordSet = new Set(result.keywordSupplementation.addedKeywords.map(k => k.keyword))
    const supplementedEntries = result.keywordsWithVolume.filter(k => addedKeywordSet.has(k.keyword))
    expect(supplementedEntries.length).toBe(result.keywordSupplementation.addedKeywords.length)
    expect(supplementedEntries.every(k => k.searchVolume === 0)).toBe(true)
  })

  it('applies the cap only during supplementation (max total 20 when triggered)', async () => {
    const baseKeywords: KeywordWithVolume[] = [{
      keyword: 'brandx core product',
      searchVolume: 1200,
      matchType: 'PHRASE',
      source: 'AI_GENERATED',
    }]
    const poolCandidates = Array.from({ length: 40 }, (_, idx) => `brandx power tool ${idx + 1}`)

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925 },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
      poolCandidates,
    })

    expect(result.keywordSupplementation.triggered).toBe(true)
    expect(result.keywordSupplementation.beforeCount).toBe(1)
    expect(result.keywordSupplementation.afterCount).toBe(20)
    expect(result.keywordSupplementation.addedKeywords).toHaveLength(19)
    expect(result.keywordSupplementation.supplementCapApplied).toBe(true)
    expect(result.keywordsWithVolume).toHaveLength(20)
  })

  it('rejects generic title/about phrases such as EASY CLEAN and WIDE USE', async () => {
    const baseKeywords = makeKeywords(8, 'brandx cordless drill')

    const result = await applyKeywordSupplementationOnce({
      offer: {
        id: 3925,
        scraped_data: {
          rawProductTitle: 'BrandX Cordless Drill Set',
          rawAboutThisItem: [
            'EASY CLEAN',
            'WIDE USE',
            'Brushless Motor with 2 Batteries',
          ],
        },
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
    })

    const addedLower = result.keywordSupplementation.addedKeywords.map(k => k.keyword.toLowerCase())
    expect(addedLower).not.toContain('easy clean')
    expect(addedLower).not.toContain('wide use')
    expect(addedLower.some(k => k.includes('brushless') || k.includes('drill'))).toBe(true)
  })

  it('prefixes title/about supplements with brand and avoids duplicate brand tokens', async () => {
    const baseKeywords = makeKeywords(9, 'laser level guide')

    const result = await applyKeywordSupplementationOnce({
      offer: {
        id: 3925,
        scraped_data: {
          rawProductTitle: 'Dovoh Laser Level Calibration Tool',
          rawAboutThisItem: ['Dovoh laser level for indoor alignment'],
        },
      },
      userId: 1,
      brandName: 'Dovoh',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
    })

    const titleAboutAdded = result.keywordSupplementation.addedKeywords.filter(k => k.source === 'title_about')
    expect(titleAboutAdded.length).toBeGreaterThan(0)
    expect(titleAboutAdded.every(k => k.keyword.startsWith('dovoh '))).toBe(true)
    expect(titleAboutAdded.every(k => !k.keyword.includes('dovoh dovoh'))).toBe(true)
    expect(titleAboutAdded.every(k => k.keyword.split(/\s+/).filter(Boolean).length <= 5)).toBe(true)
  })

  it('drops title/about supplements when branded combination exceeds 5 words', async () => {
    const baseKeywords = makeKeywords(9, 'laser level guide')

    const result = await applyKeywordSupplementationOnce({
      offer: {
        id: 3925,
        scraped_data: {
          rawProductTitle: 'laser level kit',
          rawAboutThisItem: ['magnetic base for wall alignment'],
        },
      },
      userId: 1,
      brandName: 'dovoh precision tools official',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
    })

    const titleAboutAdded = result.keywordSupplementation.addedKeywords.filter(k => k.source === 'title_about')
    expect(result.keywordSupplementation.triggered).toBe(true)
    expect(titleAboutAdded).toHaveLength(0)
    expect(result.keywordsWithVolume).toHaveLength(9)
  })

  it('prefixes keyword_pool supplements with brand and keeps total words <= 5', async () => {
    const baseKeywords = makeKeywords(9, 'laser level guide')

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925, scraped_data: { rawProductTitle: '', rawAboutThisItem: [] } },
      userId: 1,
      brandName: 'Dovoh',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
      poolCandidates: ['laser level stand'],
    })

    const poolAdded = result.keywordSupplementation.addedKeywords.filter(k => k.source === 'keyword_pool')
    expect(poolAdded).toHaveLength(1)
    expect(poolAdded[0].keyword).toBe('dovoh laser level stand')
    expect(poolAdded[0].keyword.startsWith('dovoh ')).toBe(true)
    expect(poolAdded[0].keyword.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(5)
  })

  it('drops keyword_pool supplements when branded combination exceeds 5 words', async () => {
    const baseKeywords = makeKeywords(9, 'laser level guide')

    const result = await applyKeywordSupplementationOnce({
      offer: { id: 3925, scraped_data: { rawProductTitle: '', rawAboutThisItem: [] } },
      userId: 1,
      brandName: 'Dovoh',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
      poolCandidates: ['best laser level on amazon'],
    })

    const poolAdded = result.keywordSupplementation.addedKeywords.filter(k => k.source === 'keyword_pool')
    expect(poolAdded).toHaveLength(0)
    expect(result.keywordsWithVolume).toHaveLength(9)
  })

  it('falls back to original title/about behavior when brand is Unknown', async () => {
    const baseKeywords = makeKeywords(9, 'laser level guide')

    const result = await applyKeywordSupplementationOnce({
      offer: {
        id: 3925,
        scraped_data: {
          rawProductTitle: 'Laser Level Kit',
          rawAboutThisItem: ['Magnetic base for wall alignment'],
        },
      },
      userId: 1,
      brandName: 'Unknown',
      targetLanguage: 'English',
      keywordsWithVolume: baseKeywords,
    })

    const titleAboutAdded = result.keywordSupplementation.addedKeywords.filter(k => k.source === 'title_about')
    expect(titleAboutAdded.length).toBeGreaterThan(0)
    expect(titleAboutAdded.every(k => !k.keyword.startsWith('unknown '))).toBe(true)
  })
})
