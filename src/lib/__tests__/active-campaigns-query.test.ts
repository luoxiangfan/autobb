import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

const apiFns = vi.hoisted(() => ({
  listGoogleAdsCampaigns: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbFns.queryOne,
  })),
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
  getServiceAccountMccFromContext: (ctx: {
    serviceAccountConfig: { mccCustomerId?: string } | null
  }) => ctx.serviceAccountConfig?.mccCustomerId,
}))

vi.mock('@/lib/google-ads-api', () => ({
  listGoogleAdsCampaigns: apiFns.listGoogleAdsCampaigns,
}))

describe('queryActiveCampaigns login_customer_id fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 775,
          customer_id: '6073761127',
          parent_mcc_id: '3958592249',
        }
      }
      return null
    })

    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      auth: { authType: 'oauth' },
      oauthCredentials: {
        refresh_token: 'refresh-token',
        login_customer_id: '7888509345',
      },
      serviceAccountConfig: null,
    })
  })

  it('retries with next login_customer_id when first candidate is denied', async () => {
    apiFns.listGoogleAdsCampaigns
      .mockRejectedValueOnce({
        message: "User doesn't have permission to access customer. login-customer-id header invalid",
        errors: [{
          error_code: { authorization_error: 2 },
          message: "User doesn't have permission to access customer",
        }],
      })
      .mockResolvedValueOnce([
        {
          campaign: {
            id: 'c1',
            name: 'BrandA-US-001',
            status: 'ENABLED',
          },
          campaign_budget: {
            amount_micros: '20000000',
          },
        },
      ])

    const { queryActiveCampaigns } = await import('@/lib/active-campaigns-query')
    const result = await queryActiveCampaigns(1, 775, 42)

    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenCalledTimes(2)
    expect(result.total.enabled).toBe(1)
  })
})
