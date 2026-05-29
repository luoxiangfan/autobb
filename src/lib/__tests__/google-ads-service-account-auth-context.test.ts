import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  GOOGLE_ADS_DUAL_STACK_WARNING: 'dual-stack-warning',
}))

vi.mock('@/lib/google-ads-api', () => ({
  getGoogleAdsClient: vi.fn(() => ({
    Customer: vi.fn((opts: unknown) => ({ kind: 'oauth-customer', opts })),
  })),
}))

import { getLoginCustomerId, getUnifiedGoogleAdsClient } from '@/lib/google-ads-service-account'

describe('google-ads-service-account auth-context integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getLoginCustomerId loads login_customer_id from auth context when param is empty', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      oauthCredentials: { login_customer_id: '9988776655' },
    })

    const loginCustomerId = await getLoginCustomerId({
      authConfig: { authType: 'oauth', userId: 7 },
      oauthCredentials: { login_customer_id: '' },
    })

    expect(loginCustomerId).toBe('9988776655')
    expect(authContextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(7)
  })

  it('getUnifiedGoogleAdsClient uses auth context for oauth refresh when not passed in', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: false,
      oauthCredentials: {
        refresh_token: 'rt-from-context',
        login_customer_id: '1122334455',
      },
    })

    const customer = await getUnifiedGoogleAdsClient({
      customerId: '1234567890',
      credentials: {
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: 'secret',
        developer_token: 'dev-token',
      },
      authConfig: { authType: 'oauth', userId: 7 },
    })

    expect(authContextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(7)
    expect(customer).toEqual({
      kind: 'oauth-customer',
      opts: {
        customer_id: '1234567890',
        refresh_token: 'rt-from-context',
        login_customer_id: '1122334455',
      },
    })
  })

  it('getUnifiedGoogleAdsClient rejects dual-stack auth context for oauth', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: true,
      oauthCredentials: { refresh_token: 'rt' },
    })

    await expect(
      getUnifiedGoogleAdsClient({
        customerId: '1234567890',
        credentials: {
          client_id: 'cid',
          client_secret: 'secret',
          developer_token: 'dev',
        },
        authConfig: { authType: 'oauth', userId: 7 },
      })
    ).rejects.toThrow('dual-stack-warning')
  })
})
