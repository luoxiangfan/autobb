import { describe, expect, it } from 'vitest'
import { normalizeCallouts } from '../ad-creative'

describe('normalizeCallouts', () => {
  it('normalizes mixed callout shapes into trimmed strings', () => {
    const input = [
      { text: '  Free Shipping  ' },
      { type: 'Trust', text: '  100% Positive Reviews ' },
      { value: 'Limited Time Offer' },
      { name: 'Fast Delivery' },
      '  Hassle-Free Returns  ',
      null,
      '',
      { text: '' },
    ]

    expect(normalizeCallouts(input)).toEqual([
      'Free Shipping',
      '100% Positive Reviews',
      'Limited Time Offer',
      'Fast Delivery',
      'Hassle-Free Returns',
    ])
  })

  it('enforces max length 25 per callout', () => {
    const long = 'a'.repeat(100)
    expect(normalizeCallouts([{ text: long }])).toEqual(['a'.repeat(25)])
  })

  it('returns undefined for non-array input', () => {
    expect(normalizeCallouts(null)).toBeUndefined()
    expect(normalizeCallouts({ text: 'x' })).toBeUndefined()
    expect(normalizeCallouts('x')).toBeUndefined()
  })
})

