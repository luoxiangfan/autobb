import { describe, expect, it } from 'vitest'

import { filterNavigationLabels, isLikelyNavigationLabel } from './scrape-text-filters'

describe('scrape text filters', () => {
  it('detects account/nav labels (Boscovs example)', () => {
    expect(isLikelyNavigationLabel('About Me')).toBe(true)
    expect(isLikelyNavigationLabel('Saved Addresses')).toBe(true)
    expect(isLikelyNavigationLabel('Order History')).toBe(true)
    expect(isLikelyNavigationLabel('Log Out')).toBe(true)
  })

  it('detects generic store navigation labels', () => {
    expect(isLikelyNavigationLabel('PRODUCTS')).toBe(true)
    expect(isLikelyNavigationLabel('Support')).toBe(true)
    expect(isLikelyNavigationLabel('New Arrivals')).toBe(true)
  })

  it('keeps real selling points', () => {
    expect(isLikelyNavigationLabel("Boscov's Exclusive")).toBe(false)
    expect(isLikelyNavigationLabel('Free shipping on $99+')).toBe(false)
  })

  it('filters nav labels from feature lists', () => {
    expect(filterNavigationLabels([' About   Me ', "Boscov's Exclusive", 'Log Out'])).toEqual(["Boscov's Exclusive"])
  })
})
