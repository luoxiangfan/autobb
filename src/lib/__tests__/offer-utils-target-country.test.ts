import { describe, expect, it } from 'vitest'
import { normalizeOfferTargetCountry } from '@/lib/offers'

describe('normalizeOfferTargetCountry', () => {
  it('returns empty string for blank input (no silent US)', () => {
    expect(normalizeOfferTargetCountry('  ')).toBe('')
    expect(normalizeOfferTargetCountry('')).toBe('')
  })

  it('normalizes UK to GB', () => {
    expect(normalizeOfferTargetCountry('UK')).toBe('GB')
  })

  it('keeps valid ISO codes', () => {
    expect(normalizeOfferTargetCountry('DE')).toBe('DE')
  })
})
