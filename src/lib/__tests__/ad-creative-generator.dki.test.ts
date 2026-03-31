import { describe, expect, it } from 'vitest'
import { buildDkiFirstHeadline } from '../ad-creative-generator'

describe('ad-creative-generator DKI', () => {
  it('does not truncate default text for valid DKI length (Google Ads counts defaultText only)', () => {
    // "Armed American Supply" = 21 chars, should fit without truncation
    expect(buildDkiFirstHeadline('Armed American Supply')).toBe('{KeyWord:Armed American Supply} Official')
  })

  it('localizes official suffix by target language', () => {
    expect(buildDkiFirstHeadline('Marca', 30, { targetLanguage: 'Spanish' })).toBe('{KeyWord:Marca} Oficial')
    expect(buildDkiFirstHeadline('ブランド', 30, { targetLanguage: 'ja' })).toBe('{KeyWord:ブランド} 公式')
    expect(buildDkiFirstHeadline('品牌', 30, { targetLanguage: 'Chinese' })).toBe('{KeyWord:品牌} 官方')
  })

  it('falls back to country-derived language when target language is missing', () => {
    expect(buildDkiFirstHeadline('Marke', 30, { targetCountry: 'DE' })).toBe('{KeyWord:Marke} Offiziell')
  })

  it('drops suffix when brand+suffix exceeds 30, but keeps full brand if <=30', () => {
    const brand = 'A'.repeat(30)
    expect(buildDkiFirstHeadline(brand)).toBe(`{KeyWord:${brand}}`)
  })

  it('drops localized suffix when it would exceed max effective length', () => {
    const brand = 'A'.repeat(24)
    expect(buildDkiFirstHeadline(brand, 30, { targetLanguage: 'Italian' })).toBe(`{KeyWord:${brand}}`)
  })

  it('truncates brand only when brand itself exceeds 30', () => {
    const brand = 'B'.repeat(40)
    expect(buildDkiFirstHeadline(brand)).toBe(`{KeyWord:${'B'.repeat(30)}}`)
  })

  it('sanitizes braces from brand to keep valid DKI token', () => {
    expect(buildDkiFirstHeadline('{Brand}', 30, { targetLanguage: 'English' })).toBe('{KeyWord:Brand} Official')
  })
})
