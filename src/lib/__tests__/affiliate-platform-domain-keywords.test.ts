import { describe, it, expect } from 'vitest'
import {
  affiliateLinkMatchesPlatform,
  resolveAffiliatePlatformForLink,
} from '@/lib/affiliate-platform-domain-keywords'

describe('affiliate-platform-domain-keywords', () => {
  it('affiliateLinkMatchesPlatform uses domain keywords', () => {
    expect(
      affiliateLinkMatchesPlatform('https://yeahpromos.com/offer', 'YeahPromos')
    ).toBe(true)
    expect(
      affiliateLinkMatchesPlatform('https://yeahpromos.com/offer', 'PartnerBoost')
    ).toBe(false)
  })

  it('resolveAffiliatePlatformForLink returns first sorted match', () => {
    expect(
      resolveAffiliatePlatformForLink('https://pboost.me/x', ['YeahPromos', 'PartnerBoost'])
    ).toBe('PartnerBoost')
    expect(resolveAffiliatePlatformForLink('', ['YeahPromos'])).toBeNull()
  })
})
