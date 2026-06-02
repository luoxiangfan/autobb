import { describe, expect, it } from 'vitest'
import { resolveGoogleAdsCampaignSyncLogOutcome } from '@/lib/google-ads-campaign-sync'

describe('resolveGoogleAdsCampaignSyncLogOutcome', () => {
  it('marks no-MCC skip as partial with warning message', () => {
    const outcome = resolveGoogleAdsCampaignSyncLogOutcome({
      syncedCount: 0,
      createdOffersCount: 0,
      updatedOffersCount: 0,
      skippedOffersCount: 0,
      errors: [],
      warnings: ['未分配 MCC，无法同步 Google Ads 广告系列'],
    })

    expect(outcome.status).toBe('partial')
    expect(outcome.errorMessage).toContain('未分配 MCC')
  })

  it('keeps success when warnings exist but campaigns synced', () => {
    const outcome = resolveGoogleAdsCampaignSyncLogOutcome({
      syncedCount: 2,
      createdOffersCount: 0,
      updatedOffersCount: 0,
      skippedOffersCount: 0,
      errors: [],
      warnings: ['账户 123: 已跳过'],
    })

    expect(outcome.status).toBe('success')
    expect(outcome.errorMessage).toBe('账户 123: 已跳过')
  })

  it('returns partial when campaign errors exist', () => {
    const outcome = resolveGoogleAdsCampaignSyncLogOutcome({
      syncedCount: 1,
      createdOffersCount: 0,
      updatedOffersCount: 0,
      skippedOffersCount: 0,
      errors: [{ campaignId: '1', campaignName: 'C1', error: 'denied' }],
      warnings: [],
    })

    expect(outcome.status).toBe('partial')
    expect(outcome.errorMessage).toContain('denied')
  })
})
