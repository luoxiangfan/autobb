import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  dbQueryMock: vi.fn(),
  dbQueryOneMock: vi.fn(),
  factsCoverMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: hoisted.getDatabaseMock,
}))

vi.mock('@/lib/openclaw/affiliate-commission-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/openclaw/affiliate-commission-facts')>()
  return {
    ...actual,
    affiliateCommissionFactsCoverRawRange: hoisted.factsCoverMock,
  }
})

import {
  resolveAffiliateCommissionPlatformFilter,
  filterAffiliatesWithRawCommissionSupport,
} from './affiliate-commission-platform'
import {
  getAffiliateCommissionBrandDetail,
  getAffiliateCommissionDateDetail,
  getAffiliateCommissionReport,
  isSupportedAffiliateCommissionSource,
  normalizeReportDate,
  offerUrlsContainAsin,
  resolvePartnerboostDisplayBrand,
  resolveTargetUserIds,
} from './affiliate-commission-raw-report'
import { clearAffiliateCommissionLineItemsMemoryCache } from './affiliate-commission-report-cache'

describe('affiliate-commission-raw-report', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearAffiliateCommissionLineItemsMemoryCache()
    hoisted.dbQueryMock.mockReset()
    hoisted.dbQueryOneMock.mockReset()
    hoisted.factsCoverMock.mockReset()
    hoisted.factsCoverMock.mockResolvedValue(false)
    hoisted.getDatabaseMock.mockResolvedValue({
      type: 'sqlite',
      query: hoisted.dbQueryMock,
      queryOne: hoisted.dbQueryOneMock,
    })
  })

  it('normalizes postgres date values to YYYY-MM-DD strings', () => {
    expect(normalizeReportDate(new Date('2026-05-11T00:00:00.000Z'))).toBe('2026-05-11')
    expect(normalizeReportDate('2026-05-11')).toBe('2026-05-11')
  })

  it('sorts date summaries when report_date is a Date object', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: new Date('2026-05-10T00:00:00.000Z'),
      max_date: new Date('2026-05-11T00:00:00.000Z'),
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: new Date('2026-05-10T00:00:00.000Z'),
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 5 }],
            },
          }),
        },
        {
          user_id: 1,
          report_date: new Date('2026-05-11T00:00:00.000Z'),
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 7.5 }],
            },
          }),
        },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      showUserScope: false,
    })

    expect(report.dateSummaries).toEqual([
      { reportDate: '2026-05-11', totalCommission: 7.5 },
      { reportDate: '2026-05-10', totalCommission: 5 },
    ])
  })

  it('recognizes supported affiliate commission sources', () => {
    expect(isSupportedAffiliateCommissionSource('yeahpromos', 'getorder')).toBe(true)
    expect(isSupportedAffiliateCommissionSource('partnerboost', 'amazon_report')).toBe(true)
    expect(isSupportedAffiliateCommissionSource('partnerboost', 'transaction')).toBe(true)
  })

  it('aggregates yeahpromos rows by advert_id and partnerboost rows by asin+brand', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([
        { id: 1, username: 'alice' },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            code: '100000',
            data: {
              Data: [
                {
                  advert_id: 369334,
                  advert_name: 'Squatty Potty',
                  sale_comm: 17.9925,
                },
                {
                  advert_id: 369334,
                  advert_name: 'Squatty Potty',
                  sale_comm: 0,
                },
              ],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [
                {
                  asin: 'B0BGPF71Q6',
                  estCommission: 16.99,
                },
                {
                  asin: 'B0BGPF71Q6',
                  estCommission: 3.01,
                },
              ],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0BGPF71Q6', brand: 'Example Brand' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'all',
      viewMode: 'brand',
      showUserScope: false,
    })

    expect(report.totalCommission).toBe(37.99)
    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:example brand',
        brandName: 'Example Brand',
        platform: 'partnerboost',
        totalCommission: 20,
      },
      {
        brandKey: 'yeahpromos:advert:369334',
        brandName: 'Squatty Potty',
        platform: 'yeahpromos',
        totalCommission: 17.99,
      },
    ])
    expect(report.dateSummaries).toEqual([
      {
        reportDate: '2026-05-11',
        totalCommission: 37.99,
      },
    ])
  })

  it('scopes brand keys and user labels for admin multi-user view', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([
        { id: 2, username: 'bob' },
        { id: 3, username: 'carol' },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 2,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 5 }],
            },
          }),
        },
        {
          user_id: 3,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 8 }],
            },
          }),
        },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [2, 3],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      showUserScope: true,
    })

    expect(report.totalCommission).toBe(13)
    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'user:2:yeahpromos:advert:100',
        brandName: 'Brand A',
        platform: 'yeahpromos',
        totalCommission: 5,
        userId: 2,
        username: 'bob',
      },
      {
        brandKey: 'user:3:yeahpromos:advert:100',
        brandName: 'Brand A',
        platform: 'yeahpromos',
        totalCommission: 8,
        userId: 3,
        username: 'carol',
      },
    ])
  })

  it('returns brand detail grouped by date', async () => {
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-10',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 5 }],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 7.5 }],
            },
          }),
        },
      ])

    const detail = await getAffiliateCommissionBrandDetail({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      brandKey: 'yeahpromos:advert:100',
      showUserScope: false,
    })

    expect(detail).toEqual([
      { reportDate: '2026-05-11', commission: 7.5 },
      { reportDate: '2026-05-10', commission: 5 },
    ])
  })

  it('returns date detail grouped by brand', async () => {
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 5 }],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0TEST1234', estCommission: 8 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0TEST1234', brand: 'Brand B' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const detail = await getAffiliateCommissionDateDetail({
      userIds: [1],
      reportDate: '2026-05-11',
      showUserScope: false,
    })

    expect(detail).toEqual([
      {
        brandKey: 'partnerboost:B0TEST1234:brand b',
        brandName: 'Brand B',
        platform: 'partnerboost',
        commission: 8,
      },
      {
        brandKey: 'yeahpromos:advert:100',
        brandName: 'Brand A',
        platform: 'yeahpromos',
        commission: 5,
      },
    ])
  })

  it('ignores requested user ids for non-admin users', async () => {
    const userIds = await resolveTargetUserIds({
      isAdmin: false,
      currentUserId: 42,
      requestedUserIds: [2, 3, 99],
    })

    expect(userIds).toEqual([42])
    expect(hoisted.dbQueryMock).not.toHaveBeenCalled()
  })

  it('defaults admin target users to active non-admin users', async () => {
    hoisted.dbQueryMock.mockResolvedValueOnce([
      { id: 2, username: 'bob' },
      { id: 3, username: 'carol' },
    ])

    const userIds = await resolveTargetUserIds({
      isAdmin: true,
      currentUserId: 1,
      requestedUserIds: [],
    })

    expect(userIds).toEqual([2, 3])
  })

  it('validates requested admin user ids without loading all users', async () => {
    hoisted.dbQueryMock.mockResolvedValueOnce([
      { id: 2 },
      { id: 3 },
    ])

    const userIds = await resolveTargetUserIds({
      isAdmin: true,
      currentUserId: 1,
      requestedUserIds: [2, 3, 99],
    })

    expect(userIds).toEqual([2, 3])
    expect(hoisted.dbQueryMock).toHaveBeenCalledTimes(1)
    expect(String(hoisted.dbQueryMock.mock.calls[0][0])).toContain('WHERE id IN')
  })

  it('skips partnerboost brand lookups when platform is yeahpromos', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Brand A', sale_comm: 5 }],
            },
          }),
        },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'yeahpromos',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'yeahpromos:advert:100',
        brandName: 'Brand A',
        platform: 'yeahpromos',
        totalCommission: 5,
      },
    ])
    expect(hoisted.dbQueryMock).toHaveBeenCalledTimes(2)
  })

  it('maps affiliate display names to raw commission platform filters', () => {
    expect(resolveAffiliateCommissionPlatformFilter('all')).toBe('all')
    expect(resolveAffiliateCommissionPlatformFilter('YeahPromos')).toBe('yeahpromos')
    expect(resolveAffiliateCommissionPlatformFilter('PartnerBoost')).toBe('partnerboost')
    expect(resolveAffiliateCommissionPlatformFilter('CJ')).toBe('all')
  })

  it('keeps only affiliates with raw commission support', () => {
    expect(filterAffiliatesWithRawCommissionSupport([
      { name: 'YeahPromos', count: 3 },
      { name: 'CJ', count: 1 },
      { name: 'PartnerBoost', count: 2 },
    ])).toEqual([
      { name: 'YeahPromos', count: 3 },
      { name: 'PartnerBoost', count: 2 },
    ])
  })

  it('resolves composite partnerboost product brands using offer brand', () => {
    expect(resolvePartnerboostDisplayBrand({
      productBrand: 'LEVOIT/COSOR/Etekcity_CA',
      offerBrand: 'LEVOIT',
    })).toBe('LEVOIT')

    expect(resolvePartnerboostDisplayBrand({
      productBrand: 'LEVOIT/COSOR/Etekcity_IT',
      offerBrand: 'COSOR',
    })).toBe('COSOR')

    expect(resolvePartnerboostDisplayBrand({
      productBrand: 'LEVOIT/COSOR/Etekcity_CA',
      offerBrand: null,
    })).toBe('LEVOIT/COSOR/Etekcity')

    expect(resolvePartnerboostDisplayBrand({
      productBrand: 'LEVOIT/COSOR/Etekcity_IT',
      offerBrand: null,
    })).toBe('LEVOIT/COSOR/Etekcity')
  })

  it('detects ASIN presence in offer url or final_url', () => {
    expect(offerUrlsContainAsin(
      'https://www.amazon.com/dp/B0BGPF71Q6',
      null,
      'B0BGPF71Q6'
    )).toBe(true)
    expect(offerUrlsContainAsin(
      null,
      'https://example.com/product?asin=B0TEST1234',
      'B0TEST1234'
    )).toBe(true)
    expect(offerUrlsContainAsin(
      'https://example.com/other-product',
      'https://example.com/final/B0OTHER123',
      'B0BGPF71Q6'
    )).toBe(false)
  })

  it('falls back to offer brand when affiliate product brand is missing', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0OFFER001', estCommission: 12.5 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          brand: 'Offer Brand',
          url: 'https://www.amazon.com/dp/B0OFFER001',
          final_url: null,
        },
      ])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:offer brand',
        brandName: 'Offer Brand',
        platform: 'partnerboost',
        totalCommission: 12.5,
      },
    ])
  })

  it('splits composite partnerboost merchant names by offer brand in report', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [
                { asin: 'B0LEVOIT01', estCommission: 10 },
                { asin: 'B0COSOR0001', estCommission: 5 },
              ],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0LEVOIT01', brand: 'LEVOIT/COSOR/Etekcity_CA' },
        { user_id: 1, asin: 'B0COSOR0001', brand: 'LEVOIT/COSOR/Etekcity_IT' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          brand: 'LEVOIT',
          url: 'https://www.amazon.com/dp/B0LEVOIT01',
          final_url: null,
        },
        {
          user_id: 1,
          brand: 'COSOR',
          url: 'https://www.amazon.com/dp/B0COSOR0001',
          final_url: null,
        },
      ])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:levoit',
        brandName: 'LEVOIT',
        platform: 'partnerboost',
        totalCommission: 10,
      },
      {
        brandKey: 'partnerboost:brand:cosor',
        brandName: 'COSOR',
        platform: 'partnerboost',
        totalCommission: 5,
      },
    ])
  })

  it('keeps composite merchant rows scoped to the user who owns the commission data', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([
        { id: 1, username: 'alice' },
        { id: 2, username: 'bob' },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0LEVOIT01', estCommission: 10 }],
            },
          }),
        },
        {
          user_id: 2,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0OTHER001', estCommission: 7 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0LEVOIT01', brand: 'LEVOIT/COSOR/Etekcity_CA' },
        { user_id: 2, asin: 'B0OTHER001', brand: 'LEVOIT/COSOR/Etekcity_IT' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          brand: 'LEVOIT',
          url: 'https://www.amazon.com/dp/B0LEVOIT01',
          final_url: null,
        },
      ])
      .mockResolvedValueOnce([])

    const allUsersReport = await getAffiliateCommissionReport({
      userIds: [1, 2],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: true,
    })

    expect(allUsersReport.brandSummaries).toEqual([
      {
        brandKey: 'user:1:partnerboost:brand:levoit',
        brandName: 'LEVOIT',
        platform: 'partnerboost',
        totalCommission: 10,
        userId: 1,
        username: 'alice',
      },
      {
        brandKey: 'user:2:partnerboost:brand:levoit/cosor/etekcity',
        brandName: 'LEVOIT/COSOR/Etekcity',
        platform: 'partnerboost',
        totalCommission: 7,
        userId: 2,
        username: 'bob',
      },
    ])

    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0LEVOIT01', estCommission: 10 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0LEVOIT01', brand: 'LEVOIT/COSOR/Etekcity_CA' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          brand: 'LEVOIT',
          url: 'https://www.amazon.com/dp/B0LEVOIT01',
          final_url: null,
        },
      ])
      .mockResolvedValueOnce([])

    const singleUserReport = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: true,
    })

    expect(singleUserReport.brandSummaries).toEqual([
      {
        brandKey: 'user:1:partnerboost:brand:levoit',
        brandName: 'LEVOIT',
        platform: 'partnerboost',
        totalCommission: 10,
        userId: 1,
        username: 'alice',
      },
    ])
  })

  it('merges partnerboost rows by brand name for the same user', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [
                { asin: 'B0ASIN0001', estCommission: 6 },
                { asin: 'B0ASIN0002', estCommission: 4 },
              ],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0ASIN0001', brand: 'Shared Brand' },
        { user_id: 1, asin: 'B0ASIN0002', brand: 'Shared Brand' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:shared brand',
        brandName: 'Shared Brand',
        platform: 'partnerboost',
        totalCommission: 10,
      },
    ])
  })

  it('returns merged partnerboost brand detail across multiple asins', async () => {
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-10',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0ASIN0001', estCommission: 6 }],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0ASIN0002', estCommission: 4 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0ASIN0001', brand: 'Shared Brand' },
        { user_id: 1, asin: 'B0ASIN0002', brand: 'Shared Brand' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const detail = await getAffiliateCommissionBrandDetail({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      brandKey: 'partnerboost:brand:shared brand',
      showUserScope: false,
    })

    expect(detail).toEqual([
      { reportDate: '2026-05-11', commission: 4 },
      { reportDate: '2026-05-10', commission: 6 },
    ])
  })

  it('uses ASIN label when neither product nor offer brand is available', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0UNKNOWN1', estCommission: 4.2 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:asin b0unknown1',
        brandName: 'ASIN B0UNKNOWN1',
        platform: 'partnerboost',
        totalCommission: 4.2,
      },
    ])
  })

  it('falls back to global affiliate product pool when user products are missing', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 2, username: 'bob' }])
      .mockResolvedValueOnce([
        {
          user_id: 2,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0GLOBAL01', estCommission: 9.5 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { asin: 'B0GLOBAL01', brand: 'Global Pool Brand' },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [2],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:global pool brand',
        brandName: 'Global Pool Brand',
        platform: 'partnerboost',
        totalCommission: 9.5,
      },
    ])
  })

  it('uses merchant_name from raw payload when db lookups miss', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{
                asin: 'B0RAWBRAND',
                estCommission: 3.3,
                merchant_name: 'Payload Brand_CA',
              }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:payload brand',
        brandName: 'Payload Brand',
        platform: 'partnerboost',
        totalCommission: 3.3,
      },
    ])
  })

  it('uses partnerboost transaction payloads for report totals when available', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'transaction',
          response_payload: JSON.stringify({
            data: {
              list: [
                { sale_comm: 20, asin: 'B0BGPF71Q6', order_id: 'order-1' },
              ],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'partnerboost',
          source_api: 'amazon_report',
          response_payload: JSON.stringify({
            data: {
              list: [{ asin: 'B0BGPF71Q6', estCommission: 5 }],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, asin: 'B0BGPF71Q6', brand: 'Example Brand' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'partnerboost',
      showUserScope: false,
    })

    expect(report.totalCommission).toBe(20)
    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'partnerboost:brand:example brand',
        brandName: 'Example Brand',
        platform: 'partnerboost',
        totalCommission: 20,
      },
    ])
  })

  it('parses YeahPromos commission from alternate field names', async () => {
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-11',
      max_date: '2026-05-11',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-11',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              rows: [
                { advert_id: 100, advert_name: 'Brand A', commission_amount: 9.5 },
                { advert_id: 101, advert_name: 'Brand B', sale_comm: 4 },
              ],
            },
          }),
        },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'yeahpromos',
      showUserScope: false,
    })

    expect(report.totalCommission).toBe(13.5)
    expect(report.brandSummaries).toEqual([
      {
        brandKey: 'yeahpromos:advert:100',
        brandName: 'Brand A',
        platform: 'yeahpromos',
        totalCommission: 9.5,
      },
      {
        brandKey: 'yeahpromos:advert:101',
        brandName: 'Brand B',
        platform: 'yeahpromos',
        totalCommission: 4,
      },
    ])
  })

  it('falls back to raw parse when line facts only cover part of the date range', async () => {
    hoisted.factsCoverMock.mockResolvedValue(false)
    hoisted.dbQueryOneMock.mockResolvedValueOnce({
      min_date: '2026-05-01',
      max_date: '2026-05-31',
    })
    hoisted.dbQueryMock
      .mockResolvedValueOnce([{ id: 1, username: 'alice' }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          report_date: '2026-05-01',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 100, advert_name: 'Early Brand', sale_comm: 6 }],
            },
          }),
        },
        {
          user_id: 1,
          report_date: '2026-05-10',
          platform: 'yeahpromos',
          source_api: 'getorder',
          response_payload: JSON.stringify({
            data: {
              Data: [{ advert_id: 200, advert_name: 'Late Brand', sale_comm: 4 }],
            },
          }),
        },
      ])

    const report = await getAffiliateCommissionReport({
      userIds: [1],
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'yeahpromos',
      showUserScope: false,
    })

    expect(hoisted.factsCoverMock).toHaveBeenCalled()
    expect(report.totalCommission).toBe(10)
    expect(report.dateSummaries).toEqual([
      { reportDate: '2026-05-10', totalCommission: 4 },
      { reportDate: '2026-05-01', totalCommission: 6 },
    ])
  })
})
