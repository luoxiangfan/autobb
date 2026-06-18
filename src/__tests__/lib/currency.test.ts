import { describe, expect, it } from 'vitest'
import { normalizeCurrencyCode, USD_BASE_CURRENCY } from '@/lib/common/server'

describe('currency helpers', () => {
  it('exposes USD as the base currency constant', () => {
    expect(USD_BASE_CURRENCY).toBe('USD')
  })

  it('normalizes currency codes to uppercase trimmed strings', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR')
    expect(normalizeCurrencyCode('gbp')).toBe('GBP')
    expect(normalizeCurrencyCode(null)).toBe('')
    expect(normalizeCurrencyCode(undefined)).toBe('')
  })
})
