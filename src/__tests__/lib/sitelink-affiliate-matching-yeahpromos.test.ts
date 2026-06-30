import { describe, expect, it } from 'vitest'
import {
  affiliatePromoLinksMatch,
  extractYeahpromosTrackKey,
  findStoreProductLinkIndexByAffiliateKey,
  resolveSitelinkTargetStoreMapping,
} from '@/lib/url-swap/sitelink-affiliate-matching'

describe('yeahpromos affiliate link matching', () => {
  it('matches openurl links by track id regardless of url query suffix', () => {
    expect(
      affiliatePromoLinksMatch(
        'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=https%3A%2F%2Famazon.com'
      )
    ).toBe(true)
    expect(
      extractYeahpromosTrackKey(
        'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url='
      )
    ).toBe('938d05453d92bf1c')
  })

  it('resolves mapping from affiliate_link when current_final_url is stale', () => {
    const mapping = resolveSitelinkTargetStoreMapping(
      {
        affiliate_link: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
        current_final_url: 'https://www.amazon.com/dp/B0D316ZFP5',
        sort_index: 0,
      },
      [
        'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
        'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
      ],
      [
        {
          affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=aaaa&url=',
          finalUrl: 'https://www.amazon.com/dp/B0D316ZFP5',
        },
        {
          affiliateLink: 'https://yeahpromos.com/index/index/openurl?track=938d05453d92bf1c&url=',
          finalUrl: 'https://www.amazon.com/dp/B0B6B51RXC',
        },
      ]
    )

    expect(findStoreProductLinkIndexByAffiliateKey(mapping?.affiliateLink || '', [])).toBe(-1)
    expect(mapping?.affiliateLink).toContain('938d05453d92bf1c')
    expect(mapping?.finalUrl).toBe('https://www.amazon.com/dp/B0B6B51RXC')
    expect(mapping?.sortIndex).toBe(1)
  })
})
