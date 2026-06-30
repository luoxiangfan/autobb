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

const refreshFns = vi.hoisted(() => ({
  refreshUrlSwapSitelinkTargetsFromGoogleAds: vi.fn(),
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

vi.mock('@/lib/url-swap/refresh-sitelink-targets-from-ads', () => ({
  refreshUrlSwapSitelinkTargetsFromGoogleAds: refreshFns.refreshUrlSwapSitelinkTargetsFromGoogleAds,
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
  const baseTarget = {
    id: 'target-1',
    task_id: 'task-1',
    offer_id: 10,
    user_id: 1,
    sort_index: 0,
    affiliate_link: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
    google_ads_account_id: 1,
    google_customer_id: '123',
    google_campaign_id: '456',
    asset_resource_name: 'customers/123/assets/1',
    asset_id: '1',
    link_text: 'Kids Edition',
    current_final_url_suffix: null,
    status: 'active' as const,
    consecutive_failures: 0,
    last_success_at: null,
    last_error: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    const targets = [
      {
        ...baseTarget,
        current_final_url: 'https://www.amazon.com/dp/B0D316ZFP5',
      },
    ]
    refreshFns.refreshUrlSwapSitelinkTargetsFromGoogleAds.mockImplementation(async () => {
      targets[0] = {
        ...targets[0],
        current_final_url: 'https://www.amazon.com/dp/B0B6B51RXC',
      }
      return { refreshed: 1, errors: [] }
    })
    sitelinkFns.getUrlSwapSitelinkTargets.mockImplementation(async () => targets)
    sitelinkFns.loadOfferStoreProductLinksForUrlSwap.mockResolvedValue({
      pageType: 'store',
      storeProductLinks: [
        'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
        'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
      ],
    })
    offerFns.getOfferById.mockResolvedValue({ target_country: 'US' })
    resolveFns.resolveStoreProductLinkFinalUrls.mockResolvedValue([
      {
        affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
        finalUrl: 'https://www.amazon.com/dp/B0D316ZFP5',
      },
      {
        affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        finalUrl: 'https://www.amazon.com/dp/B0B6B51RXC',
      },
    ])
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('fixes stale current_final_url via yeahpromos track match', async () => {
    const result = await reconcileUrlSwapSitelinkAffiliateLinks({
      taskId: 'task-1',
      offerId: 10,
      userId: 1,
    })

    expect(refreshFns.refreshUrlSwapSitelinkTargetsFromGoogleAds).toHaveBeenCalled()
    expect(result.targets[0].current_final_url).toBe('https://www.amazon.com/dp/B0B6B51RXC')
    expect(result.targets[0].affiliate_link).toContain('938d05453d92bf1c')
  })
})

describe('enrichUrlSwapSitelinkTargetsAffiliateLinks', () => {
  it('returns corrected affiliate_link and final url in memory without DB writes', () => {
    const storeProductLinks = ['https://pboost.me/V2aE0bkta', 'https://pboost.me/r2aECf1tv']
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
      storeProductLinks,
      resolvedLinks
    )

    expect(enriched[0].affiliate_link).toBe('https://pboost.me/r2aECf1tv')
    expect(enriched[0].current_final_url).toBe('https://www.amazon.com/dp/B0CZ9GF4VY')
  })
})

describe('resolveAffiliateLinkForSitelinkTarget', () => {
  it('prefers yeahpromos track match over stale sort_index mapping', () => {
    const resolvedLinks = [
      {
        affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
        finalUrl: 'https://www.amazon.com/dp/B0D316ZFP5',
      },
      {
        affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        finalUrl: 'https://www.amazon.com/dp/B0B6B51RXC',
      },
    ]

    expect(
      resolveAffiliateLinkForSitelinkTarget(
        {
          current_final_url: 'https://www.amazon.com/dp/B0D316ZFP5',
          sort_index: 0,
          affiliate_link: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        },
        [
          'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
          'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        ],
        resolvedLinks
      )
    ).toContain('938d05453d92bf1c')
  })
})
