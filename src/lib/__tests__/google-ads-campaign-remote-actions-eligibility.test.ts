import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeGoogleAdsCampaignRemoteActions,
  queueGoogleAdsCampaignRemoteActions,
} from '@/lib/google-ads-campaign-remote-actions'

const accountsAuthFns = vi.hoisted(() => ({
  prepareGoogleAdsApiCallForLinkedAccount: vi.fn(),
}))

vi.mock('@/lib/google-ads-accounts-auth', () => ({
  prepareGoogleAdsApiCallForLinkedAccount: accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount,
}))

vi.mock('@/lib/google-ads-api', () => ({
  removeGoogleAdsCampaign: vi.fn(async () => {}),
  updateGoogleAdsCampaignStatus: vi.fn(async () => {}),
}))

describe('queueGoogleAdsCampaignRemoteActions eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValue({
      ok: true,
      authContext: { auth: { authType: 'oauth' } },
      apiAuth: {
        authType: 'oauth',
        refreshToken: 'rt',
        serviceAccountId: undefined,
        oauthLoginCustomerId: '5010618892',
      },
      refreshToken: 'rt',
      oauthCredentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        developer_token: 'developer-token',
      },
      oauthLoginCustomerId: '5010618892',
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
    expect(accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount).toHaveBeenCalledWith(1, undefined)
  })

  it('uses linked account service_account_id when resolving auth', async () => {
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValueOnce({
      ok: true,
      authContext: { auth: { authType: 'service_account' } },
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-linked',
      },
      refreshToken: '',
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

    expect(accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount).toHaveBeenCalledWith(1, 'sa-linked')
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
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValueOnce({
      ok: false,
      message: '未找到服务账号配置',
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
