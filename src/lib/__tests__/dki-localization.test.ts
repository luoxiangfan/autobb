import { describe, expect, it } from 'vitest'
import { getLocalizedDkiOfficialSuffix, resolveDkiLanguageCode } from '../dki-localization'

describe('dki-localization', () => {
  it('resolves language code from targetLanguage first', () => {
    expect(resolveDkiLanguageCode({ targetLanguage: 'Spanish', targetCountry: 'US' })).toBe('es')
  })

  it('falls back to country mapping when targetLanguage is missing', () => {
    expect(resolveDkiLanguageCode({ targetCountry: 'DE' })).toBe('de')
  })

  it('returns localized official suffix for known language', () => {
    expect(getLocalizedDkiOfficialSuffix({ targetLanguage: 'French' })).toBe(' Officiel')
  })

  it('defaults to English suffix when language is unknown', () => {
    expect(getLocalizedDkiOfficialSuffix({ targetLanguage: 'Unknown-Lang' })).toBe(' Official')
  })
})

