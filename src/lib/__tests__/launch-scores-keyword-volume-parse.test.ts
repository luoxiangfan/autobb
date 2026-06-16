import { describe, expect, it } from 'vitest'
import {
  mapCampaignKeywordToVolumeInput,
  parseKeywordsWithVolumeJson,
  resolveKeywordsWithVolumeForLaunch,
  resolveKeywordsWithVolumeForLaunchScore,
} from '../launch-score/server'

describe('parseKeywordsWithVolumeJson', () => {
  it('returns empty array for blank input', () => {
    expect(parseKeywordsWithVolumeJson(null)).toEqual([])
    expect(parseKeywordsWithVolumeJson('')).toEqual([])
  })

  it('parses valid JSON array', () => {
    expect(
      parseKeywordsWithVolumeJson(JSON.stringify([{ keyword: 'a', searchVolume: 10 }]))
    ).toEqual([{ keyword: 'a', searchVolume: 10 }])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseKeywordsWithVolumeJson('{not-json')).toEqual([])
  })
})

describe('resolveKeywordsWithVolumeForLaunch', () => {
  it('prefers config keywords over stored JSON', () => {
    const result = resolveKeywordsWithVolumeForLaunch({
      configKeywords: ['from-config'],
      keywordsWithVolumeJson: JSON.stringify([{ keyword: 'from-db', searchVolume: 1 }]),
      fallbackKeywords: ['fallback'],
    })
    expect(result).toEqual([{ keyword: 'from-config', matchType: 'PHRASE' }])
  })

  it('uses stored JSON when config empty', () => {
    const result = resolveKeywordsWithVolumeForLaunch({
      configKeywords: [],
      keywordsWithVolumeJson: JSON.stringify([{ keyword: 'from-db', searchVolume: 1 }]),
    })
    expect(result).toEqual([{ keyword: 'from-db', searchVolume: 1 }])
  })
})

describe('resolveKeywordsWithVolumeForLaunchScore', () => {
  it('prefers Step3 config keywords over creative DB', () => {
    const result = resolveKeywordsWithVolumeForLaunchScore(
      {
        keywords: ['db-fallback'],
        keywords_with_volume: JSON.stringify([{ keyword: 'from-db', searchVolume: 1 }]),
      },
      { keywords: ['step3'] }
    )
    expect(result).toEqual([{ keyword: 'step3', matchType: 'PHRASE', text: 'step3' }])
  })
})

describe('mapCampaignKeywordToVolumeInput', () => {
  it('maps string keywords', () => {
    expect(mapCampaignKeywordToVolumeInput('brand')).toEqual({
      keyword: 'brand',
      matchType: 'PHRASE',
    })
  })

  it('prefers text over keyword field', () => {
    expect(
      mapCampaignKeywordToVolumeInput({
        text: 'from-text',
        keyword: 'from-keyword',
        searchVolume: 100,
      })
    ).toEqual({
      keyword: 'from-text',
      searchVolume: 100,
      matchType: undefined,
      competition: undefined,
    })
  })

  it('falls back to keyword when text missing', () => {
    expect(mapCampaignKeywordToVolumeInput({ keyword: 'only-keyword', searchVolume: 5 })).toEqual({
      keyword: 'only-keyword',
      searchVolume: 5,
      matchType: undefined,
      competition: undefined,
    })
  })
})
