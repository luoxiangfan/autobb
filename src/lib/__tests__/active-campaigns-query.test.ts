import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultOAuthAuthContext,
  defaultOAuthApiCredentialsFields,
  defaultPreparedGoogleAdsAccountApiCall,
  hasConfiguredGoogleAdsAuthFromContextMock,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  hasConfiguredGoogleAdsAuthFromContext: vi.fn(),
}))

const accountsAuthFns = vi.hoisted(() => ({
  prepareGoogleAdsAccountApiCall: vi.fn(),
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
  hasConfiguredGoogleAdsAuthFromContext: authContextFns.hasConfiguredGoogleAdsAuthFromContext,
}))

vi.mock('@/lib/google-ads-accounts-auth', () => ({
  prepareGoogleAdsAccountApiCall: accountsAuthFns.prepareGoogleAdsAccountApiCall,
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
          service_account_id: null,
        }
      }
      return null
    })

    authContextFns.getGoogleAdsAuthContext.mockResolvedValue(defaultOAuthAuthContext)
    authContextFns.hasConfiguredGoogleAdsAuthFromContext.mockImplementation(
      hasConfiguredGoogleAdsAuthFromContextMock
    )
    accountsAuthFns.prepareGoogleAdsAccountApiCall.mockResolvedValue({
      ...defaultPreparedGoogleAdsAccountApiCall,
      apiAuth: {
        ...defaultPreparedGoogleAdsAccountApiCall.apiAuth,
        refreshToken: 'refresh-token',
        oauthLoginCustomerId: '7888509345',
      },
      refreshToken: 'refresh-token',
      oauthLoginCustomerId: '7888509345',
      oauthCredentials: defaultOAuthApiCredentialsFields,
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

    expect(accountsAuthFns.prepareGoogleAdsAccountApiCall).toHaveBeenCalledWith({
      authContext: defaultOAuthAuthContext,
      linkedServiceAccountId: null,
    })
    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenCalledTimes(2)
    expect(result.total.enabled).toBe(1)
  })

  it('resolves auth with linked account service_account_id', async () => {
    const serviceAccountAuthContext = {
      userId: 42,
      ownerUserId: 42,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-linked' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-linked' },
    }

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 775,
          customer_id: '6073761127',
          parent_mcc_id: '3958592249',
          service_account_id: 'sa-linked',
        }
      }
      return null
    })

    authContextFns.getGoogleAdsAuthContext.mockResolvedValue(serviceAccountAuthContext)
    accountsAuthFns.prepareGoogleAdsAccountApiCall.mockResolvedValue({
      ok: true,
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-linked',
        serviceAccountMccId: '1112223333',
      },
      refreshToken: '',
    })

    apiFns.listGoogleAdsCampaigns.mockResolvedValueOnce([])

    const { queryActiveCampaigns } = await import('@/lib/active-campaigns-query')
    await queryActiveCampaigns(1, 775, 42)

    expect(accountsAuthFns.prepareGoogleAdsAccountApiCall).toHaveBeenCalledWith({
      authContext: serviceAccountAuthContext,
      linkedServiceAccountId: 'sa-linked',
    })
    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: 'service_account',
        serviceAccountId: 'sa-linked',
      })
    )
  })
})
