import { describe, expect, it } from 'vitest'
import { stripTrailingCountryCodeSuffix } from '@/lib/brand-suffix-utils'

describe('stripTrailingCountryCodeSuffix', () => {
  it('removes common trailing country code suffixes', () => {
    expect(stripTrailingCountryCodeSuffix('Reolink FR')).toBe('Reolink')
    expect(stripTrailingCountryCodeSuffix('Reolink fr')).toBe('Reolink')
    expect(stripTrailingCountryCodeSuffix('Anker US')).toBe('Anker')
  })

  it('keeps non-country suffix brands unchanged', () => {
    expect(stripTrailingCountryCodeSuffix('DJI')).toBe('DJI')
    expect(stripTrailingCountryCodeSuffix('Reolink Pro')).toBe('Reolink Pro')
    expect(stripTrailingCountryCodeSuffix('HI AI')).toBe('HI AI')
  })
})
