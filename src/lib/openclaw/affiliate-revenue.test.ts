import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getOpenclawSettingsWithAffiliateSyncMapMock: vi.fn(),
  persistAffiliateCommissionAttributionsMock: vi.fn(),
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsWithAffiliateSyncMap: hoisted.getOpenclawSettingsWithAffiliateSyncMapMock,
  parseNumber: (value: unknown, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  },
}))

vi.mock('@/lib/openclaw/affiliate-commission-attribution', () => ({
  persistAffiliateCommissionAttributions: hoisted.persistAffiliateCommissionAttributionsMock,
}))

import { fetchAffiliateCommissionRevenue } from './affiliate-revenue'

function makeOkJsonResponse(payload: any): any {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

function makeErrorResponse(status: number, text: string): any {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  }
}

describe('fetchAffiliateCommissionRevenue partnerboost commission sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    hoisted.getOpenclawSettingsWithAffiliateSyncMapMock.mockResolvedValue({
      partnerboost_token: 'pb-token',
      partnerboost_base_url: 'https://app.partnerboost.com',
      yeahpromos_token: '',
      yeahpromos_site_id: '',
    })

    hoisted.persistAffiliateCommissionAttributionsMock.mockResolvedValue({
      reportDate: '2026-02-19',
      totalCommission: 8.94,
      attributedCommission: 8.94,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses transaction sale_comm as primary commission and enriches via report by order_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                order_id: 'C28VW-7C7IDG8UPD',
                adGroupId: 'a6e3PBLq_xxx',
                link: 'https://www.amazon.com/dp/B0CCY6VG8Z?aa_adgroupid=a6e3PBLq_xxx',
                estCommission: 0,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            total_page: 1,
            list: [
              {
                order_id: 'C28VW-7C7IDG8UPD',
                sale_comm: '3.99',
                prod_id: 'B0CCY6VG8Z',
                partnerboost_id: '8aed2d6efd41e6b9d26b0b0fd20c9591',
                status: 'Pending',
              },
            ],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/datafeed/get_amazon_report')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api.php?mod=medium&op=transaction')
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('begin_date=2026-02-20')

    expect(revenue.totalCommission).toBe(3.99)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(3.99)
    expect(entry?.sourceOrderId).toBe('C28VW-7C7IDG8UPD')
    expect(entry?.sourceAsin).toBe('B0CCY6VG8Z')
    expect(entry?.sourceLinkId).toBe('a6e3PBLq_xxx')
    expect(entry?.sourceLink).toContain('/dp/B0CCY6VG8Z')
  })

  it('uses single report adGroup as fallback when transaction row has no match and no linkId', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                order_id: 'REPORT-ONLY-1',
                adGroupId: 'pb_adg_single',
                link: 'https://www.amazon.com/dp/B0CCY6VG8Z?aa_adgroupid=pb_adg_single',
                estCommission: 0,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            total_page: 1,
            list: [
              {
                order_id: 'TX-ORDER-1',
                sale_comm: '3.99',
                prod_id: 'B0CCY6VG8Z',
              },
            ],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(revenue.totalCommission).toBe(3.99)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.sourceOrderId).toBe('TX-ORDER-1')
    expect(entry?.sourceAsin).toBe('B0CCY6VG8Z')
    expect(entry?.sourceLink).toContain('aa_adgroupid=pb_adg_single')
    expect(entry?.sourceLinkId).toBe('pb_adg_single')
  })

  it('keeps transaction product mid and backfills asin from single report fallback row', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                order_id: 'REPORT-ONLY-2',
                adGroupId: 'pb_adg_single',
                'Product ID': 'B0CCY6VG8Z',
                link: 'https://www.amazon.com/dp/B0CCY6VG8Z?aa_adgroupid=pb_adg_single',
                estCommission: 0,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            total_page: 1,
            list: [
              {
                order_id: 'TX-ORDER-2',
                sale_comm: '6.99',
                partnerboost_id: 'pb_mid_real_123',
              },
            ],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-22',
    })

    expect(revenue.totalCommission).toBe(6.99)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.sourceOrderId).toBe('TX-ORDER-2')
    expect(entry?.sourceLinkId).toBe('pb_adg_single')
    expect(entry?.sourceLink).toContain('aa_adgroupid=pb_adg_single')
    expect(entry?.sourceAsin).toBe('B0CCY6VG8Z')
    expect(entry?.sourceMid).toBe('pb_mid_real_123')
  })

  it('falls back to report-only commission when transaction API request fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                'Order ID': 'C28VV-CPBOTIS5YX',
                'Product ID': 'B0CCJGKY4M',
                'Est. Commission': '$8.94',
                adGroupId: 'pb_adg_002',
                'Referrer URL': 'https://www.amazon.com/dp/B0CCJGKY4M?aa_adgroupid=pb_adg_002',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(makeErrorResponse(500, 'upstream error'))
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
    expect(revenue.totalCommission).toBe(8.94)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(8.94)
    expect(entry?.sourceOrderId).toBe('C28VV-CPBOTIS5YX')
    expect(entry?.sourceAsin).toBe('B0CCJGKY4M')
    expect(entry?.sourceLinkId).toBe('pb_adg_002')
    expect(entry?.sourceLink).toContain('/dp/B0CCJGKY4M')
  })
})

describe('fetchAffiliateCommissionRevenue yeahpromos transaction parsing', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    hoisted.getOpenclawSettingsWithAffiliateSyncMapMock.mockResolvedValue({
      partnerboost_token: '',
      yeahpromos_token: 'yp-token',
      yeahpromos_site_id: '11767',
      yeahpromos_is_amazon: '1',
    })

    hoisted.persistAffiliateCommissionAttributionsMock.mockResolvedValue({
      reportDate: '2026-02-22',
      totalCommission: 41.775,
      attributedCommission: 0,
      unattributedCommission: 41.775,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('supports nested data.Data rows returned by YeahPromos getorder API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkJsonResponse({
        code: '100000',
        status: 'success',
        msg: '',
        data: {
          Num: 3,
          PageTotal: 1,
          PageNow: '1',
          Limit: '1000',
          Data: [
            {
              advert_id: 362632,
              id: 'row-1',
              sale_comm: 4.5,
              amount: 39.99,
              oid: '362632_2678_11767_a',
              status: 'PENDING',
              sku: 'B0FGJ3M5X4',
            },
            {
              advert_id: 362632,
              id: 'row-2',
              sale_comm: 32.775,
              amount: 189.98,
              oid: '362632_2678_11767_b',
              status: 'PENDING',
              sku: 'B0FJFL8KP4',
            },
            {
              advert_id: 362632,
              id: 'row-3',
              sale_comm: 4.5,
              amount: 39.99,
              oid: '362632_2678_11767_c',
              status: 'PENDING',
              sku: 'B0FGJ3M5X4',
            },
          ],
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-22',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestUrl = String(fetchMock.mock.calls[0]?.[0] || '')
    expect(requestUrl).toContain('/index/Getorder/getorder')
    expect(requestUrl).toContain('is_amazon=1')

    expect(revenue.totalCommission).toBe(41.78)
    expect(revenue.breakdown).toEqual([
      {
        platform: 'yeahpromos',
        totalCommission: 41.78,
        records: 3,
        currency: 'USD',
      },
    ])

    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    expect(input?.entries?.length).toBe(3)
    expect(input?.entries?.[0]?.platform).toBe('yeahpromos')
    expect(input?.entries?.[0]?.sourceOrderId).toBe('362632_2678_11767_a')
    expect(input?.entries?.[0]?.sourceAsin).toBe('B0FGJ3M5X4')
  })
})
