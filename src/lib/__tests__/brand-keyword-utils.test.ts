import { describe, expect, it } from 'vitest'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from '../keywords/server'

describe('brand-keyword-utils', () => {
  it('treats spaced tokens as equivalent to concatenated brand', () => {
    const pure = getPureBrandKeywords('Ankersolix')
    expect(containsPureBrand('anker solix', pure)).toBe(true)
    expect(containsPureBrand('anker solix c300', pure)).toBe(true)
  })

  it('does not accept unrelated spaced tokens', () => {
    const pure = getPureBrandKeywords('Ankersolix')
    expect(containsPureBrand('anker solar', pure)).toBe(false)
  })

  it('keeps existing concatenated brand matching', () => {
    const pure = getPureBrandKeywords('Anker Solix')
    expect(containsPureBrand('ankersolix', pure)).toBe(true)
  })

  it('supports brand-name and pure-brand-list overloads for isPureBrandKeyword', () => {
    expect(isPureBrandKeyword('eufy', 'Eufy')).toBe(true)
    expect(isPureBrandKeyword('eufy camera', 'Eufy')).toBe(false)

    const pure = getPureBrandKeywords('Eufy')
    expect(isPureBrandKeyword('eufy', pure)).toBe(true)
    expect(isPureBrandKeyword('eufy camera', pure)).toBe(false)
  })
})
