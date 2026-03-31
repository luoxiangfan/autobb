import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
  getUserAuthType: vi.fn(),
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

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
  getUserAuthType: oauthFns.getUserAuthType,
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
      if (sql.includes('FROM google_ads_service_accounts')) {
        return null
      }
      return null
    })

    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
      login_customer_id: '7888509345',
    })

    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: undefined,
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

    const result = await queryActiveCampaigns(3034, 775, 62)

    expect(result.total.enabled).toBe(1)
    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenCalledTimes(2)
    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customerId: '6073761127',
        loginCustomerId: '3958592249',
      })
    )
    expect(apiFns.listGoogleAdsCampaigns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customerId: '6073761127',
        loginCustomerId: '7888509345',
      })
    )
  })
})

