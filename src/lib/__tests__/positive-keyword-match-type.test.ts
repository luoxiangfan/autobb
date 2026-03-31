import { describe, expect, it } from 'vitest'
import {
  normalizePositiveKeywordMatchType,
  resolvePositiveKeywordMatchType,
} from '../campaign-publish/positive-keyword-match-type'

describe('positive-keyword-match-type', () => {
  it('normalizes supported match types', () => {
    expect(normalizePositiveKeywordMatchType('exact')).toBe('EXACT')
    expect(normalizePositiveKeywordMatchType('PHRASE')).toBe('PHRASE')
    expect(normalizePositiveKeywordMatchType('BMM')).toBe('BROAD')
    expect(normalizePositiveKeywordMatchType('BROAD_MATCH_MODIFIER')).toBe('BROAD')
  })

  it('uses explicit match type for non-brand keywords', () => {
    const result = resolvePositiveKeywordMatchType({
      keyword: 'portable steam cleaner',
      brandName: 'PurSteam',
      explicitMatchType: 'BROAD',
    })
    expect(result).toBe('BROAD')
  })

  it('forces pure brand keyword to EXACT even when explicit is PHRASE', () => {
    const result = resolvePositiveKeywordMatchType({
      keyword: 'pursteam',
      brandName: 'PurSteam',
      explicitMatchType: 'PHRASE',
    })
    expect(result).toBe('EXACT')
  })

  it('falls back to keywordsWithVolume match type when explicit is missing', () => {
    const result = resolvePositiveKeywordMatchType({
      keyword: 'steam cleaner for home',
      brandName: 'PurSteam',
      mappedMatchType: 'BROAD',
    })
    expect(result).toBe('BROAD')
  })

  it('defaults to PHRASE when no signal is available', () => {
    const result = resolvePositiveKeywordMatchType({
      keyword: 'best steam mop',
      brandName: 'PurSteam',
    })
    expect(result).toBe('PHRASE')
  })
})
