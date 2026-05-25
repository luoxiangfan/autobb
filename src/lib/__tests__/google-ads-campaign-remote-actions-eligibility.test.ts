import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeGoogleAdsCampaignRemoteActions,
  queueGoogleAdsCampaignRemoteActions,
} from '@/lib/google-ads-campaign-remote-actions'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext: (ctx: {
    auth: { authType: string }
    oauthCredentials: { refresh_token?: string } | null
    serviceAccountConfig: { id?: string } | null
  }) => {
    if (ctx.auth.authType === 'oauth') {
      return Boolean(ctx.oauthCredentials?.refresh_token)
    }
    return Boolean(ctx.serviceAccountConfig?.id)
  },
  resolveEffectiveServiceAccountId: (
    _linked: string | null | undefined,
    ctx: {
      auth: { authType: string; serviceAccountId?: string }
      serviceAccountConfig: { id?: string } | null
    }
  ) => {
    if (ctx.auth.authType !== 'service_account') return undefined
    return ctx.auth.serviceAccountId || ctx.serviceAccountConfig?.id
  },
}))

vi.mock('@/lib/google-ads-api', () => ({
  removeGoogleAdsCampaign: vi.fn(async () => {}),
  updateGoogleAdsCampaignStatus: vi.fn(async () => {}),
}))

describe('queueGoogleAdsCampaignRemoteActions eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: null,
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

  it('returns CREDENTIALS_MISSING when service_account has no serviceAccountId', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValueOnce({
      auth: { authType: 'service_account' },
      oauthCredentials: null,
      serviceAccountConfig: null,
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
