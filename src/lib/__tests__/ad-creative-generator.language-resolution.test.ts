import { describe, expect, it } from 'vitest'

import type { GeneratedAdCreativeData } from '../ad-creative'
import {
  enforceLanguagePurityGate,
  resolveCreativeTargetLanguage,
} from '../ad-creative-generator'

describe('ad-creative-generator language resolution', () => {
  it('falls back to country-language mapping when target language is missing', () => {
    const resolved = resolveCreativeTargetLanguage('', 'IT')
    expect(resolved.languageCode).toBe('it')
    expect(resolved.languageName).toBe('Italian')
    expect(resolved.usedCountryFallback).toBe(true)
  })

  it('uses explicit target language when it is valid', () => {
    const resolved = resolveCreativeTargetLanguage('Spanish', 'IT')
    expect(resolved.languageCode).toBe('es')
    expect(resolved.languageName).toBe('Spanish')
    expect(resolved.usedCountryFallback).toBe(false)
  })

  it('falls back to country-language mapping when target language is invalid', () => {
    const resolved = resolveCreativeTargetLanguage('Klingon', 'DE')
    expect(resolved.languageCode).toBe('de')
    expect(resolved.languageName).toBe('German')
    expect(resolved.usedCountryFallback).toBe(true)
  })

  it('enforces non-latin language purity replacements for japanese assets', () => {
    const creative: GeneratedAdCreativeData = {
      headlines: [
        '{KeyWord:BrandX} Official',
        'BrandX Official Store',
        'Best Vacuum Deals',
        'Top Rated Choice',
      ],
      descriptions: [
        'Shop now and save big.',
        'Fast shipping and support.',
      ],
      keywords: [
        'ブランドx 掃除機',
        'ブランドx 公式',
      ],
      callouts: [],
      sitelinks: [],
      theme: 'test',
      explanation: 'test',
    }

    const fixes = enforceLanguagePurityGate(creative, 'B', 'ja', 'BrandX')
    const mergedCopy = `${creative.headlines.slice(1).join(' ')} ${creative.descriptions.join(' ')}`

    expect(fixes.headlineFixes + fixes.descriptionFixes).toBeGreaterThan(0)
    expect(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(mergedCopy)).toBe(true)
    expect(mergedCopy.toLowerCase()).not.toContain('shop now')
  })
})
