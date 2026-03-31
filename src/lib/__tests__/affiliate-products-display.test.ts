import { describe, expect, it } from 'vitest'
import { __testOnly, type AffiliateProduct } from '../affiliate-products'

function buildBaseRow(overrides: Partial<AffiliateProduct> = {}): AffiliateProduct {
  return {
    id: 1,
    user_id: 7,
    platform: 'yeahpromos',
    mid: 'M-1',
    merchant_id: null,
    asin: null,
    brand: 'Demo',
    product_name: 'Demo Product',
    product_url: 'https://example.com/p',
    promo_link: 'https://example.com/track',
    short_promo_link: null,
    allowed_countries_json: '[]',
    price_amount: 100,
    price_currency: 'USD',
    commission_rate: 15,
    commission_amount: 15,
    commission_rate_mode: 'percent',
    review_count: null,
    is_deeplink: null,
    is_confirmed_invalid: 0,
    is_blacklisted: 0,
    last_synced_at: null,
    last_seen_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('affiliate-products display mapping', () => {
  it('keeps percent mode when commission is percentage', () => {
    const row = buildBaseRow({
      commission_rate_mode: 'percent',
      commission_rate: 12,
      commission_amount: 18,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('percent')
    expect(mapped.commissionRate).toBe(12)
    expect(mapped.commissionAmount).toBe(18)
    expect(mapped.commissionCurrency).toBe('USD')
  })

  it('uses amount mode and aligns rate/amount when commission is absolute value', () => {
    const row = buildBaseRow({
      commission_rate_mode: 'amount',
      commission_rate: 20,
      commission_amount: 32.5,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('amount')
    expect(mapped.commissionRate).toBe(32.5)
    expect(mapped.commissionAmount).toBe(32.5)
    expect(mapped.commissionCurrency).toBe('USD')
  })

  it('keeps reviewCount null when structured column is empty', () => {
    const row = buildBaseRow({
      review_count: null,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.reviewCount).toBeNull()
  })

  it('infers amount mode when mode is missing but rate equals amount', () => {
    const row = buildBaseRow({
      commission_rate_mode: null,
      price_currency: null,
      commission_rate: 21.99,
      commission_amount: 21.99,
    })

    const mapped = __testOnly.mapAffiliateProductRow(row)
    expect(mapped.commissionRateMode).toBe('amount')
    expect(mapped.commissionRate).toBe(21.99)
    expect(mapped.commissionAmount).toBe(21.99)
    expect(mapped.commissionCurrency).toBeNull()
  })

  it('supports separate display serial while keeping primary key id', () => {
    const row = buildBaseRow({ id: 658284 })
    const mapped = __testOnly.mapAffiliateProductRow(row, 21)
    expect(mapped.id).toBe(658284)
    expect(mapped.serial).toBe(21)
  })
})
