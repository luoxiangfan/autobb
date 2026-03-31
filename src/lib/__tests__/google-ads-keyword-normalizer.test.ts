import { describe, expect, it } from 'vitest'
import {
  areKeywordsDuplicates,
  deduplicateKeywordsWithPriority,
  normalizeGoogleAdsKeyword
} from '../google-ads-keyword-normalizer'

describe('google-ads-keyword-normalizer', () => {
  it('normalizes punctuation and whitespace while preserving word boundaries', () => {
    expect(normalizeGoogleAdsKeyword('Dr. Mercola')).toBe('dr mercola')
    expect(normalizeGoogleAdsKeyword('dr-mercola')).toBe('dr mercola')
    expect(normalizeGoogleAdsKeyword('dr_mercola')).toBe('dr mercola')
    expect(normalizeGoogleAdsKeyword('  dr.   mercola  ')).toBe('dr mercola')
  })

  it('treats punctuation variants as duplicates', () => {
    expect(areKeywordsDuplicates('Dr. Mercola', 'dr mercola')).toBe(true)
    expect(areKeywordsDuplicates('dr.mercola', 'dr-mercola')).toBe(true)
  })

  it('does not collapse distinct spacing-only variants into one token', () => {
    expect(normalizeGoogleAdsKeyword('anker power bank')).toBe('anker power bank')
    expect(normalizeGoogleAdsKeyword('ankerpowerbank')).toBe('ankerpowerbank')
    expect(areKeywordsDuplicates('anker power bank', 'ankerpowerbank')).toBe(false)
  })

  it('deduplicates using normalized form', () => {
    const input = ['dr. mercola', 'dr mercola', 'dr-mercola', 'probiotics for women']
    const deduped = deduplicateKeywordsWithPriority(input, kw => kw)
    expect(deduped).toEqual(['dr. mercola', 'probiotics for women'])
  })
})

