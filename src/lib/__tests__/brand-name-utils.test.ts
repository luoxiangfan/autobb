import { describe, expect, it } from 'vitest'
import { isLikelyInvalidBrandName } from '@/lib/brand-name-utils'

describe('isLikelyInvalidBrandName', () => {
  it('treats French storefront boilerplate as invalid', () => {
    expect(isLikelyInvalidBrandName('Consulter le')).toBe(true)
    expect(isLikelyInvalidBrandName('Consultez les')).toBe(true)
    expect(isLikelyInvalidBrandName('Visiter le')).toBe(true)
    expect(isLikelyInvalidBrandName('Consulter le magasin')).toBe(true)
  })

  it('keeps normal brand names as valid', () => {
    expect(isLikelyInvalidBrandName('Reolink')).toBe(false)
    expect(isLikelyInvalidBrandName('Honeywell')).toBe(false)
  })
})
