import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getKeywordVolumesForExistingMock } = vi.hoisted(() => ({
  getKeywordVolumesForExistingMock: vi.fn(),
}))

vi.mock('../unified-keyword-service', () => ({
  getKeywordVolumesForExisting: getKeywordVolumesForExistingMock,
}))

import {
  DEFAULT_COVERAGE_KEYWORD_CONFIG,
  DEFAULT_SYNTHETIC_CONFIG,
  canGenerateCoverageCreative,
  canGenerateSyntheticCreative,
  getCoverageBucketKeywords,
} from '../offer-keyword-pool'

describe('offer-keyword-pool coverage aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getKeywordVolumesForExistingMock.mockResolvedValue([])
  })

  it('keeps legacy synthetic config as an alias of coverage config', () => {
    expect(DEFAULT_SYNTHETIC_CONFIG).toBe(DEFAULT_COVERAGE_KEYWORD_CONFIG)
  })

  it('keeps legacy synthetic availability helper aligned with coverage helper', async () => {
    await expect(canGenerateCoverageCreative(1)).resolves.toBe(false)
    await expect(canGenerateSyntheticCreative(1)).resolves.toBe(false)
  })

  it('builds coverage keywords from canonical D coverage candidates, including store coverage buckets', async () => {
    const keywords = await getCoverageBucketKeywords({
      id: 1,
      offerId: 1,
      userId: 1,
      brandKeywords: [
        { keyword: 'acme', searchVolume: 1000, source: 'BRAND', matchType: 'EXACT', isPureBrand: true },
      ],
      bucketAKeywords: [],
      bucketBKeywords: [],
      bucketCKeywords: [],
      bucketDKeywords: [],
      bucketAIntent: '',
      bucketBIntent: '',
      bucketCIntent: '',
      bucketDIntent: '',
      storeBucketAKeywords: [
        { keyword: 'acme robot vacuum collection', searchVolume: 400, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      storeBucketBKeywords: [
        { keyword: 'acme pet hair cleaning', searchVolume: 350, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      storeBucketCKeywords: [
        { keyword: 'acme x10 pro omni', searchVolume: 300, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      storeBucketDKeywords: [
        { keyword: 'acme authorized service', searchVolume: 250, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      storeBucketSKeywords: [
        { keyword: 'acme vacuum deals', searchVolume: 500, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      storeBucketAIntent: '',
      storeBucketBIntent: '',
      storeBucketCIntent: '',
      storeBucketDIntent: '',
      storeBucketSIntent: '',
      linkType: 'store',
      totalKeywords: 5,
      clusteringModel: null,
      clusteringPromptVersion: null,
      balanceScore: null,
      createdAt: '',
      updatedAt: '',
    } as any, 1, 'US', {
      ...DEFAULT_COVERAGE_KEYWORD_CONFIG,
      sortByVolume: false,
      maxNonBrandKeywords: 20,
      minSearchVolume: 0,
    })

    const keywordTexts = keywords.map((item) => item.keyword)

    expect(keywordTexts).toContain('acme')
    expect(keywordTexts).toContain('acme vacuum deals')
    expect(keywordTexts).toContain('acme authorized service')
    expect(keywordTexts).toContain('acme x10 pro omni')
  })

  it('passes normalized language codes into coverage volume lookups', async () => {
    await getCoverageBucketKeywords({
      id: 2,
      offerId: 2,
      userId: 1,
      brandKeywords: [
        { keyword: 'acme', searchVolume: 1000, source: 'BRAND', matchType: 'EXACT', isPureBrand: true },
      ],
      bucketAKeywords: [],
      bucketBKeywords: [],
      bucketCKeywords: [],
      bucketDKeywords: [
        { keyword: 'acme security camera', searchVolume: 0, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      bucketAIntent: '',
      bucketBIntent: '',
      bucketCIntent: '',
      bucketDIntent: '',
      storeBucketAKeywords: [],
      storeBucketBKeywords: [],
      storeBucketCKeywords: [],
      storeBucketDKeywords: [],
      storeBucketSKeywords: [],
      storeBucketAIntent: '',
      storeBucketBIntent: '',
      storeBucketCIntent: '',
      storeBucketDIntent: '',
      storeBucketSIntent: '',
      linkType: 'product',
      totalKeywords: 1,
      clusteringModel: null,
      clusteringPromptVersion: null,
      balanceScore: null,
      createdAt: '',
      updatedAt: '',
    } as any, 1, 'US', {
      ...DEFAULT_COVERAGE_KEYWORD_CONFIG,
      sortByVolume: true,
      minSearchVolume: 0,
      language: 'English',
    })

    expect(getKeywordVolumesForExistingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'US',
        language: 'en',
        userId: 1,
      })
    )
  })
})
