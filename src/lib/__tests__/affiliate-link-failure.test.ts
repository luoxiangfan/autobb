import { describe, expect, it } from 'vitest'
import {
  detectAffiliateLinkFailure,
  detectDomainChangeAffiliateFailure,
  isAffiliateLinkExpiredMessage,
  normalizeNestedResolveErrorMessage,
} from '../affiliate-link-failure'

describe('affiliate-link-failure', () => {
  it('detects PartnerBoost invalid-link page', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'https://app.partnerboost.com/partner/invalid-link?track=abc',
    })

    expect(failure?.kind).toBe('partnerboost_invalid_link')
    expect(failure?.message).toContain('Invalid Link')
  })

  it('detects chrome-error browser page', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'chrome-error://chromewebdata/',
    })

    expect(failure?.kind).toBe('chrome_error')
    expect(failure?.message).toContain('推广链接无法访问')
  })

  it('detects amazon to partnerboost invalid-link domain change', () => {
    const failure = detectDomainChangeAffiliateFailure(
      'https://www.amazon.com/dp/B0TEST',
      'https://app.partnerboost.com/partner/invalid-link'
    )

    expect(failure?.kind).toBe('partnerboost_invalid_link')
    expect(failure?.message).toContain('PartnerBoost')
  })

  it('detects amazon to partnerboost platform landing without product page', () => {
    const failure = detectDomainChangeAffiliateFailure(
      'https://www.amazon.com/dp/B0TEST',
      'https://app.partnerboost.com/partner/amazon-offers'
    )

    expect(failure?.kind).toBe('affiliate_platform_landing')
    expect(failure?.message).toContain('未能到达商品页')
  })

  it('normalizes nested Playwright error prefixes', () => {
    expect(
      normalizeNestedResolveErrorMessage(
        'Playwright解析失败: Playwright解析失败: 页面导航后URL无效 (chrome-error://chromewebdata/)'
      )
    ).toBe('Playwright解析失败: 页面导航后URL无效 (chrome-error://chromewebdata/)')
  })

  it('detects YeahPromos dailybacks blocked page', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'https://dailybacks.com/error_blocked.html',
    })

    expect(failure?.kind).toBe('yeahpromos_link_blocked')
    expect(failure?.message).toContain('YeahPromos')
    expect(failure?.message).toContain('blocked')
  })

  it('detects YeahPromos dailybacks return wrapper pointing to blocked page', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'https://dailybacks.com/return.html?id=error_blocked.html',
    })

    expect(failure?.kind).toBe('yeahpromos_link_blocked')
    expect(failure?.message).toContain('blocked')
  })

  it('detects YeahPromos earnlygo suspended page', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'https://earnlygo.com/error_suspended.html',
    })

    expect(failure?.kind).toBe('yeahpromos_link_suspended')
    expect(failure?.message).toContain('suspended')
  })

  it('detects amazon to yeahpromos tracking error page domain change', () => {
    const failure = detectDomainChangeAffiliateFailure(
      'https://www.amazon.com/dp/B0TEST',
      'https://earnlygo.com/error_suspended.html'
    )

    expect(failure?.kind).toBe('yeahpromos_link_suspended')
    expect(failure?.message).toContain('YeahPromos')
  })

  it('detects yeahpromos blocked failure in redirect chain', () => {
    const failure = detectAffiliateLinkFailure({
      url: 'https://dailybacks.com/return.html',
      redirectChain: [
        'https://yeahpromos.com/index/index/openurl?track=12a90f3cd0f874b1&url=',
        'https://dailybacks.com/return.html?id=error_blocked.html',
        'https://dailybacks.com/error_blocked.html',
      ],
    })

    expect(failure?.kind).toBe('yeahpromos_link_blocked')
  })

  it('recognizes affiliate link expired messages', () => {
    expect(
      isAffiliateLinkExpiredMessage('推广链接已失效：PartnerBoost 返回 Invalid Link 页面')
    ).toBe(true)
    expect(isAffiliateLinkExpiredMessage('推广链接已失效：YeahPromos 推广链接已被屏蔽')).toBe(true)
    expect(
      isAffiliateLinkExpiredMessage('域名变更警告: www.amazon.com → app.partnerboost.com')
    ).toBe(false)
  })
})
