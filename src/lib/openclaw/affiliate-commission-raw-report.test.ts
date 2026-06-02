import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  dbQueryMock: vi.fn(),
  dbQueryOneMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: hoisted.getDatabaseMock,
}))

import {
  getAffiliateCommissionBrandDetail,
  getAffiliateCommissionDateDetail,
  getAffiliateCommissionReport,
  isSupportedAffiliateCommissionSource,
  normalizeReportDate,
  resolveAffiliateCommissionPlatformFilter,
  resolveTargetUserIds,
  filterAffiliatesWithRawCommissionSupport,
} from './affiliate-commission-raw-report'

describe('affiliate-commission-raw-report', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    hoisted.dbQueryMock.mockReset()
    hoisted.dbQueryOneMock.mockReset()
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
    expect(isSupportedAffiliateCommissionSource('partnerboost', 'transaction')).toBe(false)
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
        brandKey: 'partnerboost:B0BGPF71Q6:example brand',
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
})
