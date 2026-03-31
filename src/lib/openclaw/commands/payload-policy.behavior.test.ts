import { describe, expect, it } from 'vitest'
import { normalizeOpenclawCommandPayload, normalizeOpenclawCommandQuery } from './payload-policy'

describe('openclaw command payload policy behavior', () => {
  it('fails closed when route has no payload policy', () => {
    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'POST',
        path: '/api/unknown/write-route',
        body: { any: true },
      })
    ).toThrow('missing route payload policy')
  })

  it('normalizes campaign create aliases to canonical payload', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/campaigns',
      body: {
        offer_id: 11,
        google_ads_account_id: 22,
        campaign_name: 'Alias Campaign',
        budget_amount: 18.5,
        budget_type: 'DAILY',
        target_cpa: 3.2,
        max_cpc: 0.9,
        start_date: '2026-02-20',
        end_date: '2026-03-20',
      },
    })

    expect(body).toEqual({
      offerId: 11,
      googleAdsAccountId: 22,
      campaignName: 'Alias Campaign',
      budgetAmount: 18.5,
      budgetType: 'DAILY',
      targetCpa: 3.2,
      maxCpc: 0.9,
      startDate: '2026-02-20',
      endDate: '2026-03-20',
    })
  })

  it('rejects unknown fields for campaign create route', () => {
    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'POST',
        path: '/api/campaigns',
        body: {
          offerId: 11,
          googleAdsAccountId: 22,
          campaignName: 'x',
          budgetAmount: 10,
          attackerField: true,
        },
      })
    ).toThrow('unsupported fields')
  })

  it('requires account id for circuit-break route', () => {
    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'POST',
        path: '/api/campaigns/circuit-break',
        body: {
          reason: 'manual',
        },
      })
    ).toThrow('at least one field is required')
  })

  it('normalizes circuit-break aliases', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/campaigns/circuit-break',
      body: {
        google_ads_account_id: 66,
        dry_run: true,
        source: 'openclaw',
      },
    })

    expect(body).toEqual({
      googleAdsAccountId: 66,
      dryRun: true,
      source: 'openclaw',
    })
  })

  it('normalizes url-swap create aliases', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/url-swap/tasks',
      body: {
        offerId: 9,
        swapIntervalMinutes: 60,
        durationDays: 7,
        swapMode: 'manual',
        manualAffiliateLinks: ['https://example.com/aff?a=1'],
      },
    })

    expect(body).toEqual({
      offer_id: 9,
      swap_interval_minutes: 60,
      duration_days: 7,
      swap_mode: 'manual',
      manual_affiliate_links: ['https://example.com/aff?a=1'],
    })
  })

  it('rejects non-empty body for url-swap enable route', () => {
    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'POST',
        path: '/api/url-swap/tasks/abc/enable',
        body: { force: true },
      })
    ).toThrow('unsupported fields')
  })

  it('normalizes click-farm task update aliases', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'PUT',
      path: '/api/click-farm/tasks/abc',
      body: {
        dailyClickCount: 123,
        startTime: '07:00',
        refererConfig: { type: 'none' },
      },
    })

    expect(body).toEqual({
      daily_click_count: 123,
      start_time: '07:00',
      referer_config: { type: 'none' },
    })
  })

  it('normalizes click-farm distribution generate aliases', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/click-farm/distribution/generate',
      body: {
        dailyClickCount: 216,
        startTime: '06:00',
        endTime: '24:00',
      },
    })

    expect(body).toEqual({
      daily_click_count: 216,
      start_time: '06:00',
      end_time: '24:00',
    })
  })

  it('treats bare numeric commission_payout as amount for offer extract', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '399',
        commission_payout: '74.81',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$399',
      commission_payout: '$74.81',
      commission_type: 'amount',
      commission_value: '74.81',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('preserves explicit currency commission amount for offer extract', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '399',
        commission_payout: '$74.81',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$399',
      commission_payout: '$74.81',
      commission_type: 'amount',
      commission_value: '74.81',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('preserves explicit currency product price and percent commission for offer extract', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$349.99',
        commission_payout: '30%',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$349.99',
      commission_payout: '30%',
      commission_type: 'percent',
      commission_value: '30',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('ignores commission_rate mismatch and follows percent-form commission_payout for offer extract', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$129.99',
        commission_payout: '16.57%',
        commission_rate: '12.75',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$129.99',
      commission_payout: '16.57%',
      commission_type: 'percent',
      commission_value: '16.57',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('ignores commission_rate mismatch and follows percent-form commission_payout for offer extract stream', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract/stream',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$299.99',
        commission_payout: '22.5%',
        commission_rate: '7.5',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$299.99',
      commission_payout: '22.5%',
      commission_type: 'percent',
      commission_value: '22.5',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('treats amount-form commission_payout as amount even when commission_rate is provided', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$299.99',
        commission_rate: '7.5',
        commission_payout: '$22.50',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$299.99',
      commission_payout: '$22.5',
      commission_type: 'amount',
      commission_value: '22.5',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('drops commission_rate and keeps percent commission_payout', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$129.99',
        commission_payout: '12.75%',
        commission_rate: '12.75',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$129.99',
      commission_payout: '12.75%',
      commission_type: 'percent',
      commission_value: '12.75',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('treats bare numeric commission_payout as amount even when commission_rate is provided', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$129.99',
        commission_rate: '12.75',
        commission_payout: '12.75',
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$129.99',
      commission_payout: '$12.75',
      commission_type: 'amount',
      commission_value: '12.75',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('treats commission_rate without percent as amount when commission_payout is missing', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$22.99',
        commission_rate: 22.5,
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$22.99',
      commission_payout: '$22.5',
      commission_type: 'amount',
      commission_value: '22.5',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('treats bare numeric commission_payout as amount when no explicit rate is provided', () => {
    const { body } = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/offers/extract',
      body: {
        affiliate_link: 'https://example.com/aff',
        target_country: 'US',
        product_price: '$22.99',
        commission_payout: 18.75,
      },
    })

    expect(body).toEqual({
      affiliate_link: 'https://example.com/aff',
      target_country: 'US',
      product_price: '$22.99',
      commission_payout: '$18.75',
      commission_type: 'amount',
      commission_value: '18.75',
      commission_currency: 'USD',
      page_type: 'product',
      skipCache: false,
      skipWarmup: false,
    })
  })

  it('requires status when patching risk alert', () => {
    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'PATCH',
        path: '/api/risk-alerts/88',
        body: {
          note: 'reviewed',
        },
      })
    ).toThrow('missing required fields')
  })

  it('allows empty risk-alert check body but rejects unknown fields', () => {
    const empty = normalizeOpenclawCommandPayload({
      method: 'POST',
      path: '/api/risk-alerts',
      body: {},
    })
    expect(empty.body).toBeUndefined()

    expect(() =>
      normalizeOpenclawCommandPayload({
        method: 'POST',
        path: '/api/risk-alerts',
        body: { force: true },
      })
    ).toThrow('unsupported fields')
  })

  it('normalizes delete-offer query aliases', () => {
    const { query } = normalizeOpenclawCommandQuery({
      method: 'DELETE',
      path: '/api/offers/123',
      query: {
        auto_unlink: true,
        remove_google_ads_campaigns: 'true',
      },
    })

    expect(query).toEqual({
      autoUnlink: true,
      removeGoogleAdsCampaigns: 'true',
    })
  })

  it('rejects unsupported query params on delete-offer route', () => {
    expect(() =>
      normalizeOpenclawCommandQuery({
        method: 'DELETE',
        path: '/api/offers/123',
        query: {
          autoUnlink: true,
          force: true,
        },
      })
    ).toThrow('unsupported params')
  })

  it('rejects non-empty query params on routes that do not accept query', () => {
    expect(() =>
      normalizeOpenclawCommandQuery({
        method: 'POST',
        path: '/api/campaigns',
        query: {
          debug: true,
        },
      })
    ).toThrow('unsupported params')
  })
})
