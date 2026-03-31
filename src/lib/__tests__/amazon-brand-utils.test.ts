import { describe, it, expect } from 'vitest'
import { extractAmazonBrandFromByline } from '@/lib/amazon-brand-utils'

describe('extractAmazonBrandFromByline', () => {
  it('extracts brand from German byline text with Store suffix', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen Sie den Comfyer-Store',
      bylineHref: null,
    })).toBe('Comfyer')
  })

  it('extracts brand from German byline text with Shop suffix', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen Sie den Comfyer-Shop',
      bylineHref: null,
    })).toBe('Comfyer')
  })

  it('extracts brand from href when byline text is only locale boilerplate', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen',
      bylineHref: '/stores/Comfyer/page/123',
    })).toBe('Comfyer')
  })

  it('prefers visible byline text over storefront slug when both are present', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Visit the Honeywell Store',
      bylineHref: '/stores/HoneywellAirComfort/page/123',
    })).toBe('Honeywell')
  })

  it('splits camel-case storefront slug when href fallback is needed', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Visit the Store',
      bylineHref: '/stores/HoneywellAirComfort/page/123',
    })).toBe('Honeywell Air Comfort')
  })

  it('returns null when only boilerplate is available', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Besuchen',
      bylineHref: null,
    })).toBeNull()
  })

  it('strips French Consulter boilerplate and keeps the real brand', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Consulter le Store Reolink',
      bylineHref: '/stores/Reolink/page/123',
    })).toBe('Reolink')
  })

  it('falls back to storefront href for French boilerplate-only byline', () => {
    expect(extractAmazonBrandFromByline({
      bylineText: 'Consulter le',
      bylineHref: '/stores/Reolink/page/123',
    })).toBe('Reolink')
  })
})
