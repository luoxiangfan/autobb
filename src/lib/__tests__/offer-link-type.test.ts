import { describe, expect, it } from 'vitest'

import {
  deriveOfferLinkTypeFromScrapedData,
  resolveOfferLinkType,
} from '../offer-link-type'

describe('offer-link-type resolution', () => {
  it('keeps explicit product page_type even when scraped data looks like store', () => {
    const resolved = resolveOfferLinkType({
      page_type: 'product',
      scraped_data: {
        pageType: 'store',
        storeName: 'Brand Store',
        products: [{ id: 1 }, { id: 2 }],
      },
    })

    expect(resolved).toBe('product')
  })

  it('keeps explicit store page_type as store', () => {
    const resolved = resolveOfferLinkType({
      page_type: 'store',
      scraped_data: {
        pageType: 'product',
      },
    })

    expect(resolved).toBe('store')
  })

  it('uses scraped explicit pageType when page_type is absent', () => {
    const resolved = resolveOfferLinkType({
      scraped_data: {
        pageType: 'store',
      },
    })

    expect(resolved).toBe('store')
  })

  it('infers store when scraped signals indicate store and page_type is absent', () => {
    const resolved = resolveOfferLinkType({
      scraped_data: {
        storeName: 'Brand Store',
        products: [{ id: 1 }, { id: 2 }],
      },
    })

    expect(resolved).toBe('store')
  })

  it('falls back to product when both explicit and derived signals are missing', () => {
    const resolved = resolveOfferLinkType({
      page_type: null,
      scraped_data: '{invalid-json',
    })

    expect(resolved).toBe('product')
  })

  it('can opt in to legacy product->store override behavior', () => {
    const resolved = resolveOfferLinkType({
      page_type: 'product',
      scraped_data: {
        pageType: 'store',
      },
    }, {
      allowProductOverrideByDerivedStore: true,
    })

    expect(resolved).toBe('store')
  })

  it('derives null when scraped signals are insufficient', () => {
    const derived = deriveOfferLinkTypeFromScrapedData({
      pageType: '',
      products: [{ id: 1 }],
    })

    expect(derived).toBeNull()
  })
})

