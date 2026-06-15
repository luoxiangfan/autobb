import { describe, expect, it } from 'vitest'
import {
  preferAttributionLineItemsIfHigher,
  sumAffiliateCommissionLineItems,
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

describe('affiliate-commission-attribution-lines', () => {
  it('prefers attribution rows when their total exceeds raw parse total', () => {
    const rawDerived = [makeItem(10), makeItem(5)]
    const attributionDerived = [makeItem(12.5), makeItem(8.25)]

    const selected = preferAttributionLineItemsIfHigher({
      rawDerived,
      attributionDerived,
    })

    expect(selected).toBe(attributionDerived)
    expect(sumAffiliateCommissionLineItems(selected)).toBeCloseTo(20.75, 2)
  })

  it('keeps raw parse rows when attribution total is not higher', () => {
    const rawDerived = [makeItem(20)]
    const attributionDerived = [makeItem(15)]

    const selected = preferAttributionLineItemsIfHigher({
      rawDerived,
      attributionDerived,
    })

    expect(selected).toBe(rawDerived)
  })

  it('falls back to raw parse when attribution rows are empty', () => {
    const rawDerived = [makeItem(4.2)]

    const selected = preferAttributionLineItemsIfHigher({
      rawDerived,
      attributionDerived: [],
    })

    expect(selected).toBe(rawDerived)
  })
})
