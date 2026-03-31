import { describe, expect, it } from 'vitest'

import { resolveAdCreativePromptKeywordPlan } from '../ad-creative-generator'

describe('resolveAdCreativePromptKeywordPlan', () => {
  it('combines validated extracted keywords with capped title/about seeds', () => {
    const plan = resolveAdCreativePromptKeywordPlan({
      extractedKeywords: [
        { keyword: 'brandx x200 vacuum' },
        { keyword: 'brandx robot vacuum' },
        { keyword: 'brandx vacuum cleaner' },
        { keyword: 'brandx cordless vacuum' },
      ],
      titleAboutKeywordSeeds: [
        'buy brandx x200 vacuum',
        'brandx x200 setup guide',
      ],
      offerBrand: 'BrandX',
      targetLanguage: 'en',
    })

    expect(plan.validatedPromptKeywords).toEqual([
      'brandx x200 vacuum',
      'brandx robot vacuum',
      'brandx vacuum cleaner',
      'brandx cordless vacuum',
    ])
    expect(plan.contextualPromptKeywords).toEqual(['buy brandx x200 vacuum'])
    expect(plan.promptKeywords).toEqual([
      'brandx x200 vacuum',
      'brandx robot vacuum',
      'brandx vacuum cleaner',
      'brandx cordless vacuum',
      'buy brandx x200 vacuum',
    ])
  })

  it('falls back to brand-filtered ai keywords when extracted keywords are absent', () => {
    const plan = resolveAdCreativePromptKeywordPlan({
      aiKeywords: [
        'brandx robot vacuum',
        'robot vacuum deals',
        'brandx x200',
      ],
      offerBrand: 'BrandX',
      targetLanguage: 'en',
    })

    expect(plan.validatedPromptKeywords).toEqual([
      'brandx robot vacuum',
      'brandx x200',
    ])
    expect(plan.contextualPromptKeywords).toEqual([])
    expect(plan.promptKeywords).toEqual([
      'brandx robot vacuum',
      'brandx x200',
    ])
  })

  it('filters non-target extracted keywords while retaining neutral model/spec terms', () => {
    const plan = resolveAdCreativePromptKeywordPlan({
      extractedKeywords: [
        { keyword: 'waterdrop filtro ufficiale x16' },
        { keyword: 'waterdrop official filter x16' },
        { keyword: 'waterdrop nsf ansi 58' },
      ],
      offerBrand: 'Waterdrop',
      targetLanguage: 'it',
    })

    expect(plan.validatedPromptKeywords).toEqual([
      'waterdrop filtro ufficiale x16',
      'waterdrop nsf ansi 58',
    ])
    expect(plan.promptKeywords).toEqual([
      'waterdrop filtro ufficiale x16',
      'waterdrop nsf ansi 58',
    ])
  })

  it('applies target-language gate to title/about seeds before intent capping', () => {
    const plan = resolveAdCreativePromptKeywordPlan({
      extractedKeywords: [
        { keyword: 'waterdrop filtro x16' },
        { keyword: 'waterdrop filtro cucina' },
        { keyword: 'waterdrop cartuccia x16' },
        { keyword: 'waterdrop sistema osmosi' },
      ],
      titleAboutKeywordSeeds: [
        'acquistare waterdrop filtro x16',
        'buy waterdrop filter x16',
      ],
      offerBrand: 'Waterdrop',
      targetLanguage: 'it',
    })

    expect(plan.contextualPromptKeywords).toEqual(['acquistare waterdrop filtro x16'])
    expect(plan.promptKeywords).not.toContain('buy waterdrop filter x16')
  })
})
