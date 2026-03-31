import { describe, expect, it } from 'vitest'
import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsFinalUrlSuffix,
  sanitizeGoogleAdsPath
} from '../google-ads-ad-text'

describe('google-ads-ad-text', () => {
  it('counts DKI token as defaultText only', () => {
    const text = '{KeyWord:Sportsroyals} Official' // raw=31
    expect(getGoogleAdsTextEffectiveLength(text)).toBe('Sportsroyals'.length + ' Official'.length)
  })

  it('counts non-DKI text as raw length', () => {
    const text = 'Hello world'
    expect(getGoogleAdsTextEffectiveLength(text)).toBe(text.length)
  })

  it('counts CJK characters as double width (effective length)', () => {
    const text = '한글ab' // 2 CJK + 2 Latin
    expect(getGoogleAdsTextEffectiveLength(text)).toBe(2 * 2 + 2)
  })

  it('sanitizes prohibited ± symbol without breaking length constraints', () => {
    const text = '±0,02 mm Maßtoleranz'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('+/-0,02 mm Maßtoleranz')
  })

  it('sanitizes prohibited ~ symbol without breaking readability', () => {
    const text = 'Save ~30% Today'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Save 30% Today')
  })

  it('sanitizes fullwidth semicolon to avoid SYMBOLS policy', () => {
    const text = 'Limited；Offer'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Limited Offer')
  })

  it('sanitizes parenthesis symbols to avoid SYMBOLS policy', () => {
    const text = 'Bird Feeder (Camera)'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Bird Feeder Camera')
  })

  it('sanitizes quote-like symbols to avoid SYMBOLS policy', () => {
    const text = '„Super Speicher, einfache Montage" – 4,9 Sterne'
    expect(sanitizeGoogleAdsAdText(text, 90)).toBe('Super Speicher, einfache Montage – 4,9 Sterne')
  })

  it('sanitizes subscript digits to avoid SYMBOLS policy', () => {
    const text = 'LiFePO₄ Ready'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('LiFePO Ready')
  })

  it('removes prohibited emoji symbols', () => {
    const text = 'Top Picks 🔥 Today'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Top Picks Today')
  })

  it('removes decorative star symbols', () => {
    const text = 'Rated ★★★★★'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Rated')
  })

  it('normalizes mathematical alphanumeric symbols (fancy bold text)', () => {
    const text = '𝗚𝗼 𝗕𝗶𝗴 𝗼𝗻 𝗖𝗼𝗼𝗹'
    expect(sanitizeGoogleAdsAdText(text, 25)).toBe('Go Big on Cool')
  })

  it('normalizes excessive capitalization to reduce CAPITALIZATION policy risk', () => {
    const text = 'BUY SUNHOUSE PAN TODAY'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Buy Sunhouse Pan Today')
  })

  it('preserves known uppercase abbreviations while normalizing excessive capitalization', () => {
    const text = 'BEST USB LED TV DEALS'
    expect(sanitizeGoogleAdsAdText(text, 30)).toBe('Best USB LED TV Deals')
  })

  it('sanitizes rsa path values', () => {
    expect(sanitizeGoogleAdsPath('Best ~ Deals', 15)).toBe('Best-Deals')
  })

  it('sanitizes rsa path values with fullwidth semicolon', () => {
    expect(sanitizeGoogleAdsPath('Deals；Today', 15)).toBe('Deals-Today')
  })

  it('sanitizes rsa path values with parenthesis symbols', () => {
    expect(sanitizeGoogleAdsPath('Deals(2026)', 15)).toBe('Deals-2026')
  })

  it('normalizes excessive capitalization in rsa path values', () => {
    expect(sanitizeGoogleAdsPath('BEST DEALS TODAY', 20)).toBe('Best-Deals-Today')
  })

  it('preserves uppercase abbreviations when normalizing rsa path values', () => {
    expect(sanitizeGoogleAdsPath('BEST USB LED TV DEALS', 30)).toBe('Best-USB-LED-TV-Deals')
  })

  it('sanitizes final url suffix with prohibited symbols', () => {
    expect(sanitizeGoogleAdsFinalUrlSuffix('utm=abc；def')).toBe('utm=abcdef')
  })

  it('sanitizes final url suffix with parenthesis symbols', () => {
    expect(sanitizeGoogleAdsFinalUrlSuffix('utm_campaign=(spring)')).toBe('utm_campaign=spring')
  })

  it('truncates text that is still too long after sanitization', () => {
    const text = '가'.repeat(100)
    const sanitized = sanitizeGoogleAdsAdText(text, 90)
    expect(getGoogleAdsTextEffectiveLength(sanitized)).toBeLessThanOrEqual(90)
  })

  it('does not reject DKI strings that are over maxLen in raw length but under in effective length', () => {
    const text = '{KeyWord:Sportsroyals} Official' // effective=21
    expect(() => sanitizeGoogleAdsAdText(text, 30)).not.toThrow()
  })
})
