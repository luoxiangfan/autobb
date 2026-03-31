import { describe, expect, it } from 'vitest'
import { containsPureBrand, getPureBrandKeywords } from '../brand-keyword-utils'

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
})
