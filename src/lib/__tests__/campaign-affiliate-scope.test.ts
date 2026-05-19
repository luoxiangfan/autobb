import { describe, it, expect } from 'vitest'
import {
  campaignAffiliateAlignedFilterSql,
  isCampaignAffiliateAlignedRow,
} from '@/lib/campaign-affiliate-scope'

describe('campaign-affiliate-scope', () => {
  it('campaignAffiliateAlignedFilterSql matches affiliate-platforms occupying + offer filters', () => {
    const sql = campaignAffiliateAlignedFilterSql('sqlite', 'c', 'o')
    expect(sql).toContain('o.is_deleted = 0')
    expect(sql).toContain("creation_status != 'failed'")
    expect(sql).toContain("!= 'REMOVED'")
  })

  it('isCampaignAffiliateAlignedRow excludes failed, removed, and deleted offer', () => {
    expect(
      isCampaignAffiliateAlignedRow({
        is_deleted: 0,
        creation_status: 'synced',
        status: 'ENABLED',
        offer_is_deleted: 0,
      })
    ).toBe(true)
    expect(
      isCampaignAffiliateAlignedRow({
        is_deleted: 1,
        creation_status: 'failed',
        status: 'REMOVED',
        offer_is_deleted: 0,
      })
    ).toBe(false)
    expect(
      isCampaignAffiliateAlignedRow({
        is_deleted: 0,
        creation_status: 'synced',
        status: 'PAUSED',
        offer_is_deleted: 1,
      })
    ).toBe(false)
  })
})
