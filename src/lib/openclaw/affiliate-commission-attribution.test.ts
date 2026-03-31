import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { persistAffiliateCommissionAttributions } from '@/lib/openclaw/affiliate-commission-attribution'

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

describe('persistAffiliateCommissionAttributions simplified attribution', () => {
  const query = vi.fn()
  const queryOne = vi.fn()
  const exec = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()

    query.mockReset()
    queryOne.mockReset()
    exec.mockReset()

    vi.mocked(getDatabase).mockReturnValue({
      type: 'sqlite',
      query,
      queryOne,
      exec,
      transaction: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
      close: vi.fn(),
    } as any)
  })

  it('returns existing summary for historical date when lock is enabled and fully attributed', async () => {
    queryOne.mockResolvedValueOnce({
      written_rows: 2,
      attributed_commission: 7.5,
      attributed_offers: 1,
      attributed_campaigns: 1,
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 7,
      reportDate: '2000-01-01',
      entries: [
        {
          platform: 'partnerboost',
          reportDate: '2000-01-01',
          commission: 7.5,
        },
      ],
      replaceExisting: true,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: '2000-01-01',
      totalCommission: 7.5,
      attributedCommission: 7.5,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 2,
    })

    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(exec).not.toHaveBeenCalled()
  })

  it('bypasses historical lock when existing attribution is partial and fetched total is higher', async () => {
    queryOne.mockResolvedValueOnce({
      written_rows: 1,
      attributed_commission: 7.5,
      attributed_offers: 1,
      attributed_campaigns: 1,
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 7,
      reportDate: '2000-01-01',
      entries: [
        {
          platform: 'partnerboost',
          reportDate: '2000-01-01',
          commission: 10,
        },
      ],
      replaceExisting: false,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: '2000-01-01',
      totalCommission: 10,
      attributedCommission: 0,
      unattributedCommission: 10,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })
  })

  it('does not apply historical lock on current date', async () => {
    const today = formatLocalYmd(new Date())

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 12.34,
        },
      ],
      replaceExisting: false,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 12.34,
      attributedCommission: 0,
      unattributedCommission: 12.34,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    expect(queryOne).not.toHaveBeenCalled()
  })

  it('splits explicit ASIN commission by rolling cost share', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) {
        return []
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) {
        return []
      }
      if (sql.includes('FROM offers')) {
        return [
          { id: 2001, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0C7GYLKPM', final_url: null, affiliate_link: null },
          { id: 2002, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0C7GYLKPM', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3001, offer_id: 2001, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 30, clicks: 2 },
          { campaign_id: 3002, offer_id: 2002, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 10, clicks: 20 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 12,
          sourceAsin: 'B0C7GYLKPM',
          raw: { id: 'evt-asin-cost-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 12,
      attributedCommission: 12,
      unattributedCommission: 0,
      attributedOffers: 2,
      attributedCampaigns: 2,
      writtenRows: 2,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(2)
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(9)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(3)
  })

  it('falls back to rolling clicks when ASIN candidates have zero cost', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 2101, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0CLICKS01', final_url: null, affiliate_link: null },
          { id: 2102, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0CLICKS01', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3101, offer_id: 2101, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 0, clicks: 9 },
          { campaign_id: 3102, offer_id: 2102, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 0, clicks: 3 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 12,
          sourceAsin: 'B0CLICKS01',
          raw: { id: 'evt-asin-clicks-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result.attributedCommission).toBe(12)
    expect(result.unattributedCommission).toBe(0)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(9)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(3)
  })

  it('equal-splits unmatched ASIN commission within the same brand', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 2201, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0KNOWN001', final_url: null, affiliate_link: null },
          { id: 2202, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0KNOWN002', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3201, offer_id: 2201, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 40, clicks: 10 },
          { campaign_id: 3202, offer_id: 2202, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 5, clicks: 2 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 10,
          sourceAsin: 'B0UNKNOWN99',
          raw: { id: 'evt-brand-split-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 10,
      attributedCommission: 10,
      unattributedCommission: 0,
      attributedOffers: 2,
      attributedCampaigns: 2,
      writtenRows: 2,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(5)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(5)
  })

  it('keeps previously attributed events frozen', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) {
        return [
          { event_id: 'yeahpromos|evt-frozen-1', offer_id: 2301, campaign_id: 3301, commission_amount: 6.66 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) {
        return []
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 6.66,
          sourceAsin: 'B0FROZEN01',
          raw: { id: 'evt-frozen-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 6.66,
      attributedCommission: 6.66,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 0,
    })

    expect(exec).not.toHaveBeenCalled()
  })

  it('marks commission unattributed when neither ASIN nor brand can map to campaigns', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) return []
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) return []
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 8.88,
          sourceAsin: 'B0NOHIT001',
          raw: { id: 'evt-unattributed-1' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 8.88,
      attributedCommission: 0,
      unattributedCommission: 8.88,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(1)
    expect((failureInsertCalls[0]?.[1] as any[])[10]).toBe('campaign_mapping_miss')
  })

  it('uses brand from affiliate_products for fallback attribution when no offer link exists', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 4001, brand: 'Waterdrop', url: 'https://www.amazon.com/dp/B0LINKED01', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        // Only B0LINKED01 has offer link, B0NOLINK01 does not
        return [{ offer_id: 4001, asin: 'B0LINKED01' }]
      }
      if (sql.includes('FROM affiliate_products') && sql.includes('brand IS NOT NULL')) {
        // B0NOLINK01 exists in affiliate_products with brand info but no offer link
        return [
          { asin: 'B0LINKED01', brand: 'Waterdrop' },
          { asin: 'B0NOLINK01', brand: 'Waterdrop' },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 5001, offer_id: 4001, brand: 'Waterdrop', created_at: `${today}T00:00:00.000Z`, cost: 100, clicks: 50 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 10,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 15.5,
          sourceAsin: 'B0NOLINK01',
          raw: { id: 'evt-nolink-1' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    // Should successfully attribute via brand fallback
    expect(result.attributedCommission).toBe(15.5)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(1)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    // Verify it's attributed to campaign 5001 (index 7: campaign_id)
    expect((attributionInsertCalls[0]?.[1] as any[])[7]).toBe(5001)
    // Verify attribution rule is brand_equal_split
    const rawPayload = JSON.parse((attributionInsertCalls[0]?.[1] as any[])[10])
    expect(rawPayload._autoads_attribution_rule).toBe('brand_equal_split')
  })

  it('normalizes brands with country suffixes for attribution matching', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 6001, brand: 'Reolink', url: 'https://www.amazon.com/dp/B0REOLINK1', final_url: null, affiliate_link: null },
          { id: 6002, brand: 'Roborock', url: 'https://www.amazon.com/dp/B0ROBOROCK1', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        // No direct ASIN links - force brand-based attribution
        return []
      }
      if (sql.includes('FROM affiliate_products') && sql.includes('brand IS NOT NULL')) {
        return [
          { asin: 'B0REOLINK2', brand: 'Reolink UK' },
          { asin: 'B0ROBOROCK2', brand: 'Roborock Amazon IT' },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 7001, offer_id: 6001, brand: 'Reolink', created_at: `${today}T00:00:00.000Z`, cost: 100, clicks: 50 },
          { campaign_id: 7002, offer_id: 6002, brand: 'Roborock', created_at: `${today}T00:00:00.000Z`, cost: 80, clicks: 40 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 11,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 25.0,
          sourceAsin: 'B0REOLINK2',
          raw: { id: 'evt-reolink-uk', brand: 'Reolink UK' },
        },
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 35.0,
          sourceAsin: 'B0ROBOROCK2',
          raw: { id: 'evt-roborock-it', brand: 'Roborock Amazon IT' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    // Should successfully attribute both commissions via brand normalization
    expect(result.attributedCommission).toBe(60.0)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(2)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(2)

    // Verify both commissions are attributed (campaign_id should not be null)
    const campaignIds = attributionInsertCalls.map(([, params]) => (params as any[])[7])
    expect(campaignIds).toContain(7001)
    expect(campaignIds).toContain(7002)
  })

  it('maps Livionex brand to Livfresh via alias', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 6003, brand: 'Livfresh', url: 'https://www.amazon.com/dp/B0LIVFRESH1', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        return []
      }
      if (sql.includes('FROM affiliate_products') && sql.includes('brand IS NOT NULL')) {
        return [
          { asin: 'B07PQYJBM3', brand: 'Livionex Dental Gel' },
          { asin: 'B07PMTDY8G', brand: 'Livionex' },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 7003, offer_id: 6003, brand: 'Livfresh', created_at: `${today}T00:00:00.000Z`, cost: 50, clicks: 25 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 12,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 11.23,
          sourceAsin: 'B07PQYJBM3',
          raw: { id: 'evt-livionex-1', advert_name: 'Livionex Dental Gel' },
        },
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 5.62,
          sourceAsin: 'B07PMTDY8G',
          raw: { id: 'evt-livionex-2', advert_name: 'Livionex Dental Gel' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    // Should successfully attribute both Livionex commissions to Livfresh
    expect(result.attributedCommission).toBe(16.85)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(1)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(2)

    // Verify both commissions are attributed to Livfresh campaign
    const campaignIds = attributionInsertCalls.map(([, params]) => (params as any[])[7])
    expect(campaignIds).toContain(7003)
    expect(campaignIds.every((id) => id === 7003)).toBe(true)
  })

  it('attributes delayed commission to removed campaigns when no online campaigns exist', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 6101, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0REMOVED1', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) {
        if (!sql.includes("c.status IN ('ENABLED', 'PAUSED', 'REMOVED')")) return []
        return [
          { campaign_id: 7101, offer_id: 6101, brand: 'Novilla', campaign_status: 'REMOVED', created_at: `${today}T00:00:00.000Z`, cost: 20, clicks: 8 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 13,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 9.9,
          sourceAsin: 'B0REMOVED1',
          raw: { id: 'evt-removed-only-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result.attributedCommission).toBe(9.9)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(1)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    expect((attributionInsertCalls[0]?.[1] as any[])[7]).toBe(7101)
  })

  it('normalizes brands with LT- prefix and Wahl variations', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 6004, brand: 'Waterdrop', url: 'https://www.amazon.com/dp/B0WATERDROP1', final_url: null, affiliate_link: null },
          { id: 6005, brand: 'Wahl Professional', url: 'https://www.amazon.com/dp/B0WAHL1', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        return []
      }
      if (sql.includes('FROM affiliate_products') && sql.includes('brand IS NOT NULL')) {
        return [
          { asin: 'B0WATERDROP2', brand: 'LT-Waterdrop' },
          { asin: 'B0WAHL2', brand: 'Wahl Clipper' },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 7004, offer_id: 6004, brand: 'Waterdrop', created_at: `${today}T00:00:00.000Z`, cost: 60, clicks: 30 },
          { campaign_id: 7005, offer_id: 6005, brand: 'Wahl Professional', created_at: `${today}T00:00:00.000Z`, cost: 40, clicks: 20 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 12,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 15.0,
          sourceAsin: 'B0WATERDROP2',
          raw: { id: 'evt-waterdrop', brand: 'LT-Waterdrop' },
        },
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 20.0,
          sourceAsin: 'B0WAHL2',
          raw: { id: 'evt-wahl', brand: 'Wahl Clipper' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    // Should successfully attribute both commissions via brand normalization
    expect(result.attributedCommission).toBe(35.0)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(2)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(2)

    // Verify both commissions are attributed to correct campaigns
    const campaignIds = attributionInsertCalls.map(([, params]) => (params as any[])[7])
    expect(campaignIds).toContain(7004)
    expect(campaignIds).toContain(7005)
  })
})
