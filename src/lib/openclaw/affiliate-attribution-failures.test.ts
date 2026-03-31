import { describe, expect, it } from 'vitest'
import {
  buildAffiliateUnattributedFailureFilter,
  resolveAffiliateAttributionFailureReasonCode,
} from '@/lib/openclaw/affiliate-attribution-failures'

describe('affiliate attribution failures', () => {
  it('uses pending reason for recoverable misses within grace window', () => {
    const reasonCode = resolveAffiliateAttributionFailureReasonCode({
      baseReasonCode: 'product_mapping_miss',
      reportDate: '2026-02-28',
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
    })

    expect(reasonCode).toBe('pending_product_mapping_miss')
  })

  it('uses final reason after grace window expires', () => {
    const reasonCode = resolveAffiliateAttributionFailureReasonCode({
      baseReasonCode: 'offer_mapping_miss',
      reportDate: '2026-02-20',
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
    })

    expect(reasonCode).toBe('offer_mapping_miss')
  })

  it('builds shared unattributed filter with pending cutoff', () => {
    const filter = buildAffiliateUnattributedFailureFilter({
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
    })

    expect(filter.pendingCutoffDate).toBe('2026-02-22')
    expect(filter.sql).toContain("COALESCE(reason_code, '') <> ?")
    expect(filter.sql).toContain("COALESCE(reason_code, '') NOT IN (?, ?)")
    expect(filter.values).toEqual([
      'campaign_mapping_miss',
      'pending_product_mapping_miss',
      'pending_offer_mapping_miss',
      '2026-02-22',
    ])
  })

  it('can include pending misses within grace for backend parity views', () => {
    const filter = buildAffiliateUnattributedFailureFilter({
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
      includePendingWithinGrace: true,
    })

    expect(filter.pendingCutoffDate).toBe('2026-02-22')
    expect(filter.sql).toContain("COALESCE(reason_code, '') <> ?")
    expect(filter.sql).not.toContain('NOT IN')
    expect(filter.values).toEqual([
      'campaign_mapping_miss',
    ])
  })

  it('can include all failures including campaign_mapping_miss', () => {
    const filter = buildAffiliateUnattributedFailureFilter({
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
      includePendingWithinGrace: true,
      includeAllFailures: true,
    })

    expect(filter.pendingCutoffDate).toBe('2026-02-22')
    expect(filter.sql).toBe('1 = 1')
    expect(filter.values).toEqual([])
  })

  it('can include all failures except pending when includeAllFailures is true but includePendingWithinGrace is false', () => {
    const filter = buildAffiliateUnattributedFailureFilter({
      currentDate: '2026-02-28',
      pendingGraceDays: 7,
      includePendingWithinGrace: false,
      includeAllFailures: true,
    })

    expect(filter.pendingCutoffDate).toBe('2026-02-22')
    expect(filter.sql).toContain("COALESCE(reason_code, '') NOT IN")
    expect(filter.sql).not.toContain("COALESCE(reason_code, '') <> ?")
    expect(filter.values).toEqual([
      'pending_product_mapping_miss',
      'pending_offer_mapping_miss',
      '2026-02-22',
    ])
  })
})
