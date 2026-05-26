import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: vi.fn(async () => ({
    auth: { authType: 'oauth' },
    oauthCredentials: { refresh_token: 'rt', login_customer_id: '111' },
  })),
  hasConfiguredGoogleAdsAuthFromContext: vi.fn(() => true),
  resolveGoogleAdsApiAuthFromContext: vi.fn(async () => ({
    authType: 'oauth',
    refreshToken: 'rt',
    serviceAccountId: undefined,
    oauthLoginCustomerId: '111',
    serviceAccountMccId: undefined,
  })),
}))

vi.mock('@/lib/google-ads-accounts-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-accounts-auth')>()
  return {
    ...actual,
    resolveHealedOAuthCredentialsFields: vi.fn(async () => ({
      ok: true as const,
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        developer_token: 'developer-token',
      },
    })),
  }
})

vi.mock('@/lib/google-ads-login-customer', () => ({
  resolveLoginCustomerCandidates: vi.fn(() => ['111']),
  isGoogleAdsAccountAccessError: vi.fn(() => false),
}))

import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignStatus } from '@/lib/google-ads-api'
import {
  findHistoricalOrphanCampaignsForOffer,
  pauseHistoricalOrphanGoogleCampaignsForOffer,
} from '@/lib/campaign-publish-orphan-cleanup'

describe('campaign-publish-orphan-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('findHistoricalOrphanCampaignsForOffer returns orphans across all ads accounts', async () => {
    vi.mocked(getDatabase).mockResolvedValue({
      type: 'sqlite',
      query: vi.fn(async () => [
        {
          id: 1,
          campaign_id: '111',
          google_campaign_id: null,
          google_ads_account_id: 33,
        },
        {
          id: 2,
          campaign_id: '222',
          google_campaign_id: null,
          google_ads_account_id: 44,
        },
      ]),
    } as any)

    const rows = await findHistoricalOrphanCampaignsForOffer({
      offerId: 10,
      userId: 7,
      excludeCampaignId: 99,
    })

    expect(rows).toEqual([
      { id: 1, googleCampaignId: '111', googleAdsAccountId: 33 },
      { id: 2, googleCampaignId: '222', googleAdsAccountId: 44 },
    ])
  })

  it('pauseHistoricalOrphanGoogleCampaignsForOffer uses per-account credentials for old account orphans', async () => {
    const query = vi.fn(async (sql: string, binds?: unknown[]) => {
      if (sql.includes('FROM campaigns')) {
        return [
          { id: 1, campaign_id: '9001', google_campaign_id: null, google_ads_account_id: 33 },
          { id: 2, campaign_id: '9002', google_campaign_id: null, google_ads_account_id: 44 },
        ]
      }
      if (sql.includes('FROM google_ads_accounts') && binds?.[0] === 44) {
        return {
          id: 44,
          customer_id: 'old-customer',
          parent_mcc_id: null,
        }
      }
      return undefined
    })

    vi.mocked(getDatabase).mockResolvedValue({
      type: 'sqlite',
      queryOne: query,
      query,
    } as any)

    const currentRunWith = vi.fn(
      async (_stage: string, operation: (loginCustomerId: string | undefined) => Promise<void>) => {
        await operation('111')
      }
    )

    const result = await pauseHistoricalOrphanGoogleCampaignsForOffer({
      ctx: {
        customerId: 'new-customer',
        refreshToken: 'rt',
        accountId: 33,
        userId: 7,
        authType: 'oauth',
        runWithLoginCustomerFallbackAndHeartbeat: currentRunWith,
      },
      offerId: 10,
      userId: 7,
      googleAdsAccountId: 33,
      excludeCampaignId: 99,
    })

    expect(result).toEqual({ attempted: 2, paused: 2, skipped: 0, failed: 0 })
    expect(updateGoogleAdsCampaignStatus).toHaveBeenCalledTimes(2)
    expect(updateGoogleAdsCampaignStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'new-customer',
        campaignId: '9001',
        accountId: 33,
      })
    )
    expect(updateGoogleAdsCampaignStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'old-customer',
        campaignId: '9002',
        accountId: 44,
      })
    )
  })

  it('skips orphans with null google_ads_account_id instead of using current account', async () => {
    vi.mocked(getDatabase).mockResolvedValue({
      type: 'sqlite',
      query: vi.fn(async () => [
        {
          id: 1,
          campaign_id: '7777',
          google_campaign_id: null,
          google_ads_account_id: null,
        },
      ]),
    } as any)

    const runWithLoginCustomerFallbackAndHeartbeat = vi.fn()

    const result = await pauseHistoricalOrphanGoogleCampaignsForOffer({
      ctx: {
        customerId: 'new-customer',
        refreshToken: 'rt',
        accountId: 33,
        userId: 7,
        authType: 'oauth',
        runWithLoginCustomerFallbackAndHeartbeat,
      },
      offerId: 10,
      userId: 7,
      googleAdsAccountId: 33,
      excludeCampaignId: 99,
    })

    expect(result).toEqual({ attempted: 1, paused: 0, skipped: 1, failed: 0 })
    expect(runWithLoginCustomerFallbackAndHeartbeat).not.toHaveBeenCalled()
    expect(updateGoogleAdsCampaignStatus).not.toHaveBeenCalled()
  })
})
