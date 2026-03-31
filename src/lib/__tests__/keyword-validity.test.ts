import { describe, expect, it } from 'vitest'
import { analyzeKeywordLanguageCompatibility } from '../keyword-validity'

describe('keyword-validity language governance', () => {
  it('enforces target-language-only hints in IT market while rejecting English/German content words', () => {
    const pureBrandKeywords = ['waterdrop']

    const englishItalianMixed = analyzeKeywordLanguageCompatibility({
      keyword: 'waterdrop filtro ufficiale x16',
      targetLanguage: 'it',
      pureBrandKeywords,
    })
    const englishMixed = analyzeKeywordLanguageCompatibility({
      keyword: 'waterdrop official filter x16',
      targetLanguage: 'it',
      pureBrandKeywords,
    })
    const germanMixed = analyzeKeywordLanguageCompatibility({
      keyword: 'waterdrop alkalisches mineral x16',
      targetLanguage: 'it',
      pureBrandKeywords,
    })

    expect(englishItalianMixed.hardReject).toBe(false)
    expect(englishItalianMixed.softDemote).toBe(false)
    expect(englishMixed.hardReject).toBe(true)
    expect(englishMixed.allowedLanguageHints).toEqual(['it'])
    expect(germanMixed.hardReject).toBe(true)
    expect(germanMixed.detectedLanguageHints).toContain('de')
  })

  it('rejects de-only lexical signals for italian target in production-like mixed keywords', () => {
    const pureBrandKeywords = ['waterdrop']

    const deSamples = [
      'waterdrop stufige filtration tanklos',
      'waterdrop rein zum abfluss 3',
      'waterdrop 1200 gpd schneller durchfluss',
      'waterdrop x16 umkehrosmose system',
    ]

    for (const keyword of deSamples) {
      const result = analyzeKeywordLanguageCompatibility({
        keyword,
        targetLanguage: 'it',
        pureBrandKeywords,
      })
      expect(result.hardReject).toBe(true)
      expect(result.detectedLanguageHints).toContain('de')
    }

    const germanTargetResult = analyzeKeywordLanguageCompatibility({
      keyword: 'waterdrop x16 umkehrosmose system',
      targetLanguage: 'de',
      pureBrandKeywords,
    })
    expect(germanTargetResult.hardReject).toBe(false)
  })

  it('treats brand, model, and neutral spec tokens as language-neutral', () => {
    const result = analyzeKeywordLanguageCompatibility({
      keyword: 'dreo ac516s 14 inch',
      targetLanguage: 'it',
      pureBrandKeywords: ['dreo'],
    })

    expect(result.hardReject).toBe(false)
    expect(result.softDemote).toBe(false)
    expect(result.contentTokenCount).toBe(0)
  })
})
