import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeGoogleAdsCampaignRemoteActions,
  queueGoogleAdsCampaignRemoteActions,
} from '@/lib/google-ads-campaign-remote-actions'

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: vi.fn(async () => ({ authType: 'oauth' as const })),
  getGoogleAdsCredentials: vi.fn(async () => ({ refresh_token: 'rt' })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  removeGoogleAdsCampaign: vi.fn(async () => {}),
  updateGoogleAdsCampaignStatus: vi.fn(async () => {}),
}))

describe('queueGoogleAdsCampaignRemoteActions eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes remote REMOVE for inactive account when skipAccountEligibilityCheck=true', async () => {
    const result = await executeGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        is_active: 0,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: true,
      logPrefix: 'delete-account',
      skipAccountEligibilityCheck: true,
    })

    expect(result.executed).toBe(true)
    expect(result.planned).toBe(1)
    expect(result.action).toBe('REMOVE')
  })

  it('queues remote REMOVE for inactive account when skipAccountEligibilityCheck=true', () => {
    const result = queueGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        is_active: 0,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: true,
      logPrefix: 'delete-account',
      skipAccountEligibilityCheck: true,
    })

    expect(result).toEqual({ queued: true, planned: 1, action: 'REMOVE' })
  })

  it('does not queue for inactive account by default', () => {
    const result = queueGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        is_active: 0,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: false,
      logPrefix: 'unlink',
    })

    expect(result.queued).toBe(false)
  })
})
