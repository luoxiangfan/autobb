import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueGoogleAdsCampaignRemoteActions } from '@/lib/google-ads-campaign-remote-actions'

const oauthFns = vi.hoisted(() => ({
  getUserAuthType: vi.fn(async () => ({ authType: 'oauth' as const, serviceAccountId: undefined })),
  getGoogleAdsCredentials: vi.fn(async () => ({ refresh_token: 'rt', login_customer_id: 'mcc-1' })),
}))

const apiFns = vi.hoisted(() => ({
  removeGoogleAdsCampaign: vi.fn(async () => {}),
  updateGoogleAdsCampaignStatus: vi.fn(async () => {}),
}))

vi.mock('@/lib/google-ads-oauth', () => oauthFns)
vi.mock('@/lib/google-ads-api', () => apiFns)

describe('queueGoogleAdsCampaignRemoteActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not queue when account is missing customer_id', () => {
    const result = queueGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: null,
        parent_mcc_id: null,
        is_active: 1,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: true,
      logPrefix: 'test',
    })

    expect(result).toEqual({ queued: false, planned: 1, action: 'REMOVE' })
    expect(apiFns.removeGoogleAdsCampaign).not.toHaveBeenCalled()
  })

  it('queues REMOVE when account and campaigns are valid', async () => {
    const result = queueGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        is_active: 1,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }, { google_campaign_id: '1002' }],
      shouldRemove: true,
      logPrefix: 'test',
    })

    expect(result).toEqual({ queued: true, planned: 2, action: 'REMOVE' })
    await vi.waitFor(() => {
      expect(apiFns.removeGoogleAdsCampaign).toHaveBeenCalledTimes(2)
    })
  })
})
