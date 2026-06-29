import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitelinkFns = vi.hoisted(() => ({
  getUrlSwapSitelinkTargets: vi.fn(),
  loadOfferStoreProductLinksForUrlSwap: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  getOfferById: vi.fn(),
}))

const resolveFns = vi.hoisted(() => ({
  resolveStoreProductLinkFinalUrls: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/url-swap/url-swap-sitelink-targets', () => ({
  getUrlSwapSitelinkTargets: sitelinkFns.getUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap: sitelinkFns.loadOfferStoreProductLinksForUrlSwap,
}))

vi.mock('@/lib/url-swap/url-swap-offer-lookup', () => ({
  getOfferById: offerFns.getOfferById,
}))

vi.mock('@/lib/url-swap/resolve-store-product-link-finals', () => ({
  resolveStoreProductLinkFinalUrls: resolveFns.resolveStoreProductLinkFinalUrls,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

import {
  enrichUrlSwapSitelinkTargetsAffiliateLinks,
  reconcileUrlSwapSitelinkAffiliateLinks,
  resolveAffiliateLinkForSitelinkTarget,
} from '@/lib/url-swap/reconcile-sitelink-affiliate-links'

describe('reconcileUrlSwapSitelinkAffiliateLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sitelinkFns.getUrlSwapSitelinkTargets.mockResolvedValue([
      {
        id: 'target-1',
        task_id: 'task-1',
        offer_id: 10,
        user_id: 1,
        sort_index: 0,
        affiliate_link: 'https://pboost.me/V2aE0bkta',
        google_ads_account_id: 1,
        google_customer_id: '123',
        google_campaign_id: '456',
        asset_resource_name: 'customers/123/assets/1',
        asset_id: '1',
        link_text: 'Kids Edition 30in',
        current_final_url: 'https://www.amazon.com/dp/B0CZ9GF4VY',
        current_final_url_suffix: null,
        status: 'active',
        consecutive_failures: 0,
        last_success_at: null,
        last_error: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ])
    sitelinkFns.loadOfferStoreProductLinksForUrlSwap.mockResolvedValue({
      pageType: 'store',
      storeProductLinks: ['https://pboost.me/V2aE0bkta', 'https://pboost.me/r2aECf1tv'],
    })
    offerFns.getOfferById.mockResolvedValue({ target_country: 'US' })
    resolveFns.resolveStoreProductLinkFinalUrls.mockResolvedValue([
      {
        affiliateLink: 'https://pboost.me/V2aE0bkta',
        finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
      },
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
    ])
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('updates affiliate_link and sort_index when landing page matches another store link', async () => {
    const result = await reconcileUrlSwapSitelinkAffiliateLinks({
      taskId: 'task-1',
      offerId: 10,
      userId: 1,
    })

    expect(result.updated).toBe(1)
    expect(result.targets[0].affiliate_link).toBe('https://pboost.me/r2aECf1tv')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE url_swap_sitelink_targets'),
      ['https://pboost.me/r2aECf1tv', expect.any(String), 'target-1']
    )
  })
})

describe('enrichUrlSwapSitelinkTargetsAffiliateLinks', () => {
  it('returns corrected affiliate_link in memory without DB writes', () => {
    const resolvedLinks = [
      {
        affiliateLink: 'https://pboost.me/V2aE0bkta',
        finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
      },
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
    ]

    const enriched = enrichUrlSwapSitelinkTargetsAffiliateLinks(
      [
        {
          id: 'target-1',
          affiliate_link: 'https://pboost.me/V2aE0bkta',
          current_final_url: 'https://www.amazon.com/dp/B0CZ9GF4VY',
        } as any,
      ],
      resolvedLinks
    )

    expect(enriched[0].affiliate_link).toBe('https://pboost.me/r2aECf1tv')
  })
})

describe('resolveAffiliateLinkForSitelinkTarget', () => {
  it('prefers landing-page match over stale sort_index mapping', () => {
    const resolvedLinks = [
      {
        affiliateLink: 'https://pboost.me/V2aE0bkta',
        finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
      },
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
    ]

    expect(
      resolveAffiliateLinkForSitelinkTarget(
        {
          current_final_url: 'https://www.amazon.com/dp/B0CZ9GF4VY',
          sort_index: 0,
          affiliate_link: 'https://pboost.me/V2aE0bkta',
        },
        ['https://pboost.me/V2aE0bkta', 'https://pboost.me/r2aECf1tv'],
        resolvedLinks
      )
    ).toBe('https://pboost.me/r2aECf1tv')
  })
})
