import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbQueryOneMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: hoisted.dbQueryMock,
    queryOne: hoisted.dbQueryOneMock,
  })),
}))

import {
  getAffiliateCommissionAttributionUpdatedAt,
  reconcileAffiliateCommissionLineItems,
  sumAttributionCommissionTotals,
} from '@/lib/openclaw/affiliate-commission-attribution-lines'
import type { AffiliateCommissionLineItem } from '@/lib/openclaw/affiliate-commission-types'

function makeItem(commission: number): AffiliateCommissionLineItem {
  return {
    userId: 1,
    username: 'alice',
    reportDate: '2026-05-11',
    platform: 'yeahpromos',
    brandKey: 'yeahpromos:advert:100',
    brandName: 'Brand A',
    commission,
    advertId: '100',
  }
}

describe('affiliate-commission-attribution-lines reconcile', () => {
  beforeEach(() => {
    hoisted.dbQueryMock.mockReset()
    hoisted.dbQueryOneMock.mockReset()
  })

  it('sums attribution totals without loading full rows when raw total is higher', async () => {
    hoisted.dbQueryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(updated_at)') && sql.includes('affiliate_commission_attributions')) {
        return { max_updated_at: '2026-06-02T10:00:00.000Z' }
      }
      if (
        sql.includes('MAX(updated_at)') &&
        sql.includes('openclaw_affiliate_attribution_failures')
      ) {
        return { max_updated_at: null }
      }
      if (sql.includes('affiliate_commission_attributions')) {
        return { total_commission: 10 }
      }
      return { total_commission: 0 }
    })

    const rawDerived = [makeItem(20)]

    const result = await reconcileAffiliateCommissionLineItems({
      rawDerived,
      userIds: [1],
      userLabels: new Map([[1, 'alice']]),
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'all',
      showUserScope: false,
    })

    expect(result.lineItems).toBe(rawDerived)
    expect(hoisted.dbQueryMock).not.toHaveBeenCalled()
  })

  it('skips reconcile work when attribution updated_at is unchanged', async () => {
    hoisted.dbQueryOneMock
      .mockResolvedValueOnce({ max_updated_at: '2026-06-02T10:00:00.000Z' })
      .mockResolvedValueOnce({ max_updated_at: null })

    const rawDerived = [makeItem(20)]

    const result = await reconcileAffiliateCommissionLineItems({
      rawDerived,
      userIds: [1],
      userLabels: new Map([[1, 'alice']]),
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      platform: 'all',
      showUserScope: false,
      knownAttributionUpdatedAt: '2026-06-02T10:00:00.000Z',
      skipWhenAttributionUnchanged: true,
    })

    expect(result.lineItems).toBe(rawDerived)
    expect(hoisted.dbQueryOneMock).toHaveBeenCalledTimes(2)
  })

  it('returns max attribution updated_at across attribution and failure tables', async () => {
    hoisted.dbQueryOneMock
      .mockResolvedValueOnce({ max_updated_at: '2026-06-02T09:00:00.000Z' })
      .mockResolvedValueOnce({ max_updated_at: '2026-06-02T11:00:00.000Z' })

    await expect(
      getAffiliateCommissionAttributionUpdatedAt({
        userIds: [1],
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        platform: 'all',
      })
    ).resolves.toBe('2026-06-02T11:00:00.000Z')
  })

  it('combines attribution and failure commission totals', async () => {
    hoisted.dbQueryOneMock
      .mockResolvedValueOnce({ total_commission: 12.5 })
      .mockResolvedValueOnce({ total_commission: 2.5 })

    await expect(
      sumAttributionCommissionTotals({
        userIds: [1],
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        platform: 'all',
      })
    ).resolves.toEqual({
      attributionTotal: 12.5,
      failureTotal: 2.5,
      combinedTotal: 15,
    })
  })
})
