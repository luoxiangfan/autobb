import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
    assertGoogleAdsAuthReadyForApi: async (userId: number) => {
      const ctx = await authContextFns.getGoogleAdsAuthContext(userId)
      const err = actual.googleAdsAuthContextDualStackError(ctx)
      if (err) {
        throw new Error(err)
      }
      return ctx
    },
  }
})

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
      dualStack: false,
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
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })

  it('getUnifiedGoogleAdsClient rejects dual-stack even when oauthRefreshToken is passed in', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: true,
      oauthCredentials: { refresh_token: 'rt', login_customer_id: '1122334455' },
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
        oauthRefreshToken: 'rt-passed-in',
      })
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })

  it('getUnifiedGoogleAdsClient rejects dual-stack for service_account', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: true,
      oauthCredentials: null,
    })

    await expect(
      getUnifiedGoogleAdsClient({
        customerId: '1234567890',
        authConfig: { authType: 'service_account', userId: 7, serviceAccountId: 'sa-1' },
      })
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })

  it('getLoginCustomerId rejects dual-stack for service_account', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({ dualStack: true })

    await expect(
      getLoginCustomerId({
        authConfig: { authType: 'service_account', userId: 7, serviceAccountId: 'sa-1' },
      })
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })
})
