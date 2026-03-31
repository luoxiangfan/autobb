import { describe, expect, it } from 'vitest'
import {
  normalizeCampaignPublishCampaignConfig,
  normalizeCampaignPublishRequestBody,
  normalizeClickFarmTaskRequestBody,
  normalizeOfferExtractRequestBody,
} from '@/lib/autoads-request-normalizers'

describe('autoads request normalizers', () => {
  it('normalizes campaign.publish payload aliases and defaults', () => {
    const normalized = normalizeCampaignPublishRequestBody({
      offer_id: 11,
      ad_creative_id: 22,
      google_ads_account_id: 33,
      campaign_config: {
        target_country: 'US',
        target_language: 'en',
        budget_amount: 10,
        budget_type: 'DAILY',
        max_cpc_bid: 0.2,
        keywords: [{ keyword: ' sonic toothbrush ', matchType: 'phrase' }],
        negative_keywords: [' free ', 'FREE'],
      },
      force_launch: 'true',
    }) || {}

    expect(normalized).toMatchObject({
      offerId: 11,
      adCreativeId: 22,
      googleAdsAccountId: 33,
      pauseOldCampaigns: false,
      enableCampaignImmediately: false,
      enableSmartOptimization: false,
      variantCount: 3,
      forcePublish: true,
    })

    expect(normalized.offer_id).toBeUndefined()
    expect(normalized.campaign_config).toBeUndefined()

    expect(normalized.campaignConfig).toMatchObject({
      targetCountry: 'US',
      targetLanguage: 'en',
      budgetAmount: 10,
      budgetType: 'DAILY',
      maxCpcBid: 0.2,
      keywords: [{ text: 'sonic toothbrush', matchType: 'PHRASE' }],
      negativeKeywords: ['free'],
    })
  })

  it('lifts misplaced campaign.publish top-level flags from campaignConfig', () => {
    const normalized = normalizeCampaignPublishRequestBody({
      offerId: 88,
      googleAdsAccountId: 66,
      campaignConfig: {
        targetCountry: 'US',
        targetLanguage: 'en',
        budgetAmount: 12,
        budgetType: 'DAILY',
        maxCpcBid: 0.3,
        enableSmartOptimization: 'true',
        variantCount: '4',
        pauseOldCampaigns: 1,
        enableCampaignImmediately: '1',
      },
    }) || {}

    expect(normalized).toMatchObject({
      offerId: 88,
      googleAdsAccountId: 66,
      enableSmartOptimization: true,
      variantCount: 4,
      pauseOldCampaigns: true,
      enableCampaignImmediately: true,
    })

    expect(normalized.campaignConfig).toMatchObject({
      targetCountry: 'US',
      targetLanguage: 'en',
      budgetAmount: 12,
      budgetType: 'DAILY',
      maxCpcBid: 0.3,
    })

    expect(normalized.campaignConfig.enableSmartOptimization).toBeUndefined()
    expect(normalized.campaignConfig.variantCount).toBeUndefined()
    expect(normalized.campaignConfig.pauseOldCampaigns).toBeUndefined()
    expect(normalized.campaignConfig.enableCampaignImmediately).toBeUndefined()
  })

  it('normalizes campaign.publish campaignConfig fields directly', () => {
    const normalized = normalizeCampaignPublishCampaignConfig({
      final_urls: [' https://example.com '],
      negative_keywords_match_type: { free: 'PHRASE' },
    }) || {}

    expect(normalized).toMatchObject({
      finalUrls: ['https://example.com'],
      negativeKeywordMatchType: { free: 'PHRASE' },
    })
    expect(normalized.final_urls).toBeUndefined()
    expect(normalized.negative_keywords_match_type).toBeUndefined()
  })

  it('normalizes click-farm payload aliases and applies defaults', () => {
    const normalized = normalizeClickFarmTaskRequestBody({
      offerId: 31,
      startTime: ' 07:00 ',
      refererConfig: null,
    }) || {}

    expect(normalized).toMatchObject({
      offer_id: 31,
      daily_click_count: 216,
      start_time: '07:00',
      end_time: '24:00',
      duration_days: 14,
      referer_config: { type: 'none' },
    })

    expect(normalized.offerId).toBeUndefined()
    expect(normalized.startTime).toBeUndefined()
  })

  it('normalizes offer extract payload aliases and applies defaults', () => {
    const normalized = normalizeOfferExtractRequestBody({
      url: 'https://aff.example.com/track',
      brand: 'Example',
      skip_cache: '1',
    }) || {}

    expect(normalized).toMatchObject({
      affiliate_link: 'https://aff.example.com/track',
      brand_name: 'Example',
      target_country: 'US',
      page_type: 'product',
      skipCache: true,
      skipWarmup: false,
    })

    expect(normalized.url).toBeUndefined()
    expect(normalized.brand).toBeUndefined()
    expect(normalized.skip_cache).toBeUndefined()
  })

  it('keeps ambiguous bare numeric commission untouched in offer normalization', () => {
    const normalized = normalizeOfferExtractRequestBody(
      {
        affiliate_link: 'https://aff.example.com/track',
        target_country: 'US',
        product_price: '349.99',
        commission_payout: '105.00',
      },
      {
        normalizeMonetization: true,
      }
    ) || {}

    expect(normalized.product_price).toBe('$349.99')
    expect(normalized.commission_payout).toBe('105.00')
    expect(normalized.commission_type).toBeUndefined()
    expect(normalized.commission_value).toBeUndefined()
  })

  it('does not auto-convert bare numeric commission to percent in offer normalization', () => {
    const normalized = normalizeOfferExtractRequestBody(
      {
        affiliate_link: 'https://aff.example.com/track',
        target_country: 'US',
        product_price: '349.99',
        commission_payout: '30',
      },
      {
        normalizeMonetization: true,
        numericCommissionMode: 'percent',
      }
    ) || {}

    expect(normalized.product_price).toBe('$349.99')
    expect(normalized.commission_payout).toBe('30')
  })

  it('preserves explicit currency and percent commission when provided', () => {
    const normalized = normalizeOfferExtractRequestBody(
      {
        affiliate_link: 'https://aff.example.com/track',
        target_country: 'US',
        product_price: '$349.99',
        commission_payout: '30%',
      },
      {
        normalizeMonetization: true,
      }
    ) || {}

    expect(normalized.product_price).toBe('$349.99')
    expect(normalized.commission_payout).toBe('30%')
  })

  it('normalizes structured commission fields and supports camelCase aliases', () => {
    const normalized = normalizeOfferExtractRequestBody(
      {
        affiliateLink: 'https://aff.example.com/track',
        targetCountry: 'US',
        commissionType: 'amount',
        commissionValue: '22.5',
        commissionCurrency: 'usd',
      },
      {
        normalizeMonetization: true,
      }
    ) || {}

    expect(normalized.commission_type).toBe('amount')
    expect(normalized.commission_value).toBe('22.5')
    expect(normalized.commission_currency).toBe('USD')
    expect(normalized.commission_payout).toBe('$22.5')
  })
})
