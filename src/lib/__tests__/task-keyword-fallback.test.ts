import { describe, expect, it } from 'vitest'

import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'

describe('resolveTaskCampaignKeywords', () => {
  it('prefers configured keywords and negative keywords when provided', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: [
        { text: 'soocas', matchType: 'EXACT' },
        { keyword: 'soocas toothbrush', matchType: 'PHRASE' }
      ],
      configuredNegativeKeywords: ['free', ' trial '],
      fallbackKeywords: ['fallback kw'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.keywords).toEqual([
      { text: 'soocas', matchType: 'EXACT' },
      { keyword: 'soocas toothbrush', matchType: 'PHRASE' },
    ])
    expect(result.negativeKeywords).toEqual(['free', 'trial'])
    expect(result.usedKeywordFallback).toBe(false)
    expect(result.usedNegativeKeywordFallback).toBe(false)
  })

  it('falls back to creative keywords when campaignConfig keywords are missing', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: undefined,
      configuredNegativeKeywords: undefined,
      fallbackKeywords: ['soocas', 'soocas toothbrush'],
      fallbackNegativeKeywords: ['free', 'trial'],
    })

    expect(result.keywords).toEqual(['soocas', 'soocas toothbrush'])
    expect(result.negativeKeywords).toEqual(['free', 'trial'])
    expect(result.usedKeywordFallback).toBe(true)
    expect(result.usedNegativeKeywordFallback).toBe(true)
  })

  it('treats empty keyword arrays as missing and triggers fallback', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: [' ', { text: '   ' }],
      configuredNegativeKeywords: ['   '],
      fallbackKeywords: ['fallback kw'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.keywords).toEqual(['fallback kw'])
    expect(result.negativeKeywords).toEqual(['fallback neg'])
    expect(result.usedKeywordFallback).toBe(true)
    expect(result.usedNegativeKeywordFallback).toBe(true)
  })

  it('sanitizes configured keywords for policy-sensitive health terms while preserving metadata', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: [
        { text: 'novilla pain relief spinal support', matchType: 'EXACT', searchVolume: 0 },
        { keyword: 'novilla memory foam mattress', matchType: 'PHRASE', searchVolume: 320 },
      ],
      configuredNegativeKeywords: ['free'],
      fallbackKeywords: ['fallback keyword'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.usedKeywordFallback).toBe(false)
    expect(result.keywords).toHaveLength(2)
    expect((result.keywords[0] as { text?: string }).text?.toLowerCase()).not.toContain('pain relief')
    expect((result.keywords[0] as { text?: string }).text?.toLowerCase()).not.toContain('spinal support')
    expect((result.keywords[0] as { matchType?: string }).matchType).toBe('EXACT')
    expect((result.keywords[1] as { keyword?: string }).keyword).toBe('novilla memory foam mattress')
  })

  it('falls back to creative keywords when configured keywords are all dropped by policy hard blocks', () => {
    const result = resolveTaskCampaignKeywords({
      configuredKeywords: ['teen christian sleep tracker'],
      configuredNegativeKeywords: ['free'],
      fallbackKeywords: ['novilla full size mattress'],
      fallbackNegativeKeywords: ['fallback neg'],
    })

    expect(result.keywords).toEqual(['novilla full size mattress'])
    expect(result.usedKeywordFallback).toBe(true)
  })
})
