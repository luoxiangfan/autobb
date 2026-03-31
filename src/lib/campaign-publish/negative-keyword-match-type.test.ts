import { describe, expect, it } from 'vitest'
import {
  inferNegativeKeywordMatchType,
  normalizeNegativeKeywordMatchTypeMap,
  normalizeMatchType,
  resolveNegativeKeywordMatchType,
} from './negative-keyword-match-type'

describe('negative keyword match type', () => {
  it('normalizes supported match types', () => {
    expect(normalizeMatchType('exact')).toBe('EXACT')
    expect(normalizeMatchType('phrase')).toBe('PHRASE')
    expect(normalizeMatchType('broad_match_modifier')).toBe('BROAD')
    expect(normalizeMatchType('invalid')).toBeNull()
  })

  it('normalizes explicit map and ignores invalid entries', () => {
    const map = normalizeNegativeKeywordMatchTypeMap({
      free: 'broad',
      'how to': 'phrase',
      junk: 'unknown',
    })

    expect(map.get('free')).toBe('BROAD')
    expect(map.get('how to')).toBe('PHRASE')
    expect(map.has('junk')).toBe(false)
  })

  it('uses phrase for multi-word terms by default', () => {
    expect(inferNegativeKeywordMatchType('how to')).toBe('PHRASE')
    expect(inferNegativeKeywordMatchType('near me')).toBe('PHRASE')
  })

  it('uses broad for high-intent blocker single words', () => {
    expect(inferNegativeKeywordMatchType('free')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('jobs')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('review')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('recruit')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('vs')).toBe('BROAD')
  })

  it('uses broad for common non-english blocker words', () => {
    expect(inferNegativeKeywordMatchType('gratis')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('下载')).toBe('BROAD')
    expect(inferNegativeKeywordMatchType('免费')).toBe('BROAD')
  })

  it('keeps ambiguous short tokens exact', () => {
    expect(inferNegativeKeywordMatchType('or')).toBe('EXACT')
    expect(inferNegativeKeywordMatchType('uk')).toBe('EXACT')
  })

  it('resolves with priority explicit > map > inferred', () => {
    const map = normalizeNegativeKeywordMatchTypeMap({
      free: 'broad',
      'how to': 'phrase',
    })

    expect(resolveNegativeKeywordMatchType({ keyword: 'free', explicitMap: map })).toBe('BROAD')
    expect(resolveNegativeKeywordMatchType({ keyword: 'how to', explicitMap: map })).toBe('PHRASE')
    expect(
      resolveNegativeKeywordMatchType({
        keyword: 'how to',
        explicitMap: map,
        explicitMatchType: 'exact',
      })
    ).toBe('EXACT')
    expect(resolveNegativeKeywordMatchType({ keyword: 'teslong' })).toBe('EXACT')
  })
})
