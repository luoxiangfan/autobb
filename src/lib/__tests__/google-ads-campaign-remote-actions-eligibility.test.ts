import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeGoogleAdsCampaignRemoteActions,
  queueGoogleAdsCampaignRemoteActions,
} from '@/lib/google-ads-campaign-remote-actions'

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  resolveGoogleAdsApiAuthForAccount: authContextFns.resolveGoogleAdsApiAuthForAccount,
}))

vi.mock('@/lib/google-ads-api', () => ({
  removeGoogleAdsCampaign: vi.fn(async () => {}),
  updateGoogleAdsCampaignStatus: vi.fn(async () => {}),
}))

describe('queueGoogleAdsCampaignRemoteActions eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { auth: { authType: 'oauth' } },
      apiAuth: {
        authType: 'oauth',
        refreshToken: 'rt',
        serviceAccountId: undefined,
      },
    })
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
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, undefined)
  })

  it('uses linked account service_account_id when resolving auth', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValueOnce({
      ok: true,
      ctx: { auth: { authType: 'service_account' } },
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-linked',
      },
    })

    await executeGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        service_account_id: 'sa-linked',
        is_active: 1,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: true,
      logPrefix: 'delete-account',
      skipAccountEligibilityCheck: true,
    })

    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, 'sa-linked')
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

  it('returns CREDENTIALS_MISSING when service_account is not configured', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValueOnce({
      ok: false,
      reason: 'service_account_missing',
    })

    const result = await executeGoogleAdsCampaignRemoteActions({
      userId: 1,
      adsAccount: {
        id: 9,
        customer_id: '1234567890',
        parent_mcc_id: null,
        is_active: 1,
        is_deleted: 0,
      },
      campaigns: [{ google_campaign_id: '1001' }],
      shouldRemove: true,
      logPrefix: 'delete-account',
      skipAccountEligibilityCheck: true,
    })

    expect(result.executed).toBe(false)
    expect(result.skipReason).toBe('CREDENTIALS_MISSING')
    expect(result.failures[0]?.reason).toContain('服务账号')
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
