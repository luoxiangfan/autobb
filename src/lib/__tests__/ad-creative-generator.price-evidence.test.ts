import { describe, expect, it } from 'vitest'
import { resolveCreativePriceEvidence } from '../ad-creative-generator'

describe('ad-creative-generator price evidence guard', () => {
  it('prefers authoritative offer.product_price over scraped_data price', () => {
    const result = resolveCreativePriceEvidence({
      id: 3711,
      product_price: '$369.99',
      pricing: JSON.stringify({ current: '$369.99', original: '$369.99', currency: 'USD' }),
      scraped_data: JSON.stringify({ productPrice: '$359.99' }),
    })

    expect(result.priceEvidenceBlocked).toBe(false)
    expect(result.priceSource).toBe('offer_product_price')
    expect(result.currentPrice).toBe('$369.99')
  })

  it('blocks price claims when authoritative and scraped price deviate too much', () => {
    const result = resolveCreativePriceEvidence({
      id: 3711,
      product_price: '$369.99',
      pricing: JSON.stringify({ current: '$369.99', original: '$369.99', currency: 'USD' }),
      scraped_data: JSON.stringify({ productPrice: '$37.95' }),
    })

    expect(result.priceEvidenceBlocked).toBe(true)
    expect(result.currentPrice).toBeNull()
    expect(result.originalPrice).toBeNull()
    expect(result.discount).toBeNull()
    expect(result.priceEvidenceWarning).toContain('PriceEvidenceGuard')
  })

  it('falls back to pricing.current when product_price is missing', () => {
    const result = resolveCreativePriceEvidence({
      id: 9,
      product_price: null,
      pricing: JSON.stringify({ current: '$199.00', original: '$249.00' }),
      scraped_data: JSON.stringify({ productPrice: '$209.00' }),
    })

    expect(result.priceEvidenceBlocked).toBe(false)
    expect(result.priceSource).toBe('offer_pricing_current')
    expect(result.currentPrice).toBe('$199.00')
    expect(result.originalPrice).toBe('$249.00')
  })
})
