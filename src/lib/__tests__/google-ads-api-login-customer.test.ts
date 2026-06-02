import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const customerFactory = vi.fn()
const accountsAuthFns = vi.hoisted(() => ({
  resolveOAuthClientCredentialsForUser: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  assertGoogleAdsAuthReadyForApi: vi.fn(),
  getGoogleAdsAuthContext: vi.fn(),
}))
const serviceAccountFns = vi.hoisted(() => ({
  getUnifiedGoogleAdsClient: vi.fn(),
}))
const updateGoogleAdsAccount = vi.fn()

vi.mock('google-ads-api', () => {
  class FakeGoogleAdsApi {
    constructor(_credentials: any) {}

    Customer(params: any) {
      customerFactory(params)
      return {
        query: vi.fn(),
        campaigns: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
        campaignBudgets: { create: vi.fn() },
      } as any
    }
  }

  return {
    GoogleAdsApi: FakeGoogleAdsApi,
    Customer: class {},
    enums: {},
  }
})

vi.mock('@/lib/google-ads-accounts-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-accounts-auth')>()
  return {
    ...actual,
    resolveOAuthClientCredentialsForUser: accountsAuthFns.resolveOAuthClientCredentialsForUser,
  }
})

vi.mock('@/lib/google-ads-accounts', () => ({
  updateGoogleAdsAccount,
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    assertGoogleAdsAuthReadyForApi: authContextFns.assertGoogleAdsAuthReadyForApi,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  }
})

vi.mock('@/lib/google-ads-service-account', () => ({
  getUnifiedGoogleAdsClient: serviceAccountFns.getUnifiedGoogleAdsClient,
}))

describe('getCustomerWithCredentials login_customer_id fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    authContextFns.assertGoogleAdsAuthReadyForApi.mockResolvedValue({
      dualStack: false,
      auth: { authType: 'oauth' },
      oauthCredentials: { login_customer_id: '5010618892' },
    })

    accountsAuthFns.resolveOAuthClientCredentialsForUser.mockResolvedValue({
      client_id: 'client-id',
      client_secret: 'client-secret',
      developer_token: 'developer-token',
      login_customer_id: '5010618892',
    })

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    })))
  })

  let getCustomerWithCredentials: typeof import('@/lib/google-ads-api').getCustomerWithCredentials

  beforeAll(async () => {
    ;({ getCustomerWithCredentials } = await import('@/lib/google-ads-api'))
  })

  it('omits login_customer_id when caller passes explicit undefined', async () => {

    await getCustomerWithCredentials({
      customerId: '3178223819',
      refreshToken: 'refresh-token',
      userId: 1,
      loginCustomerId: undefined,
    })

    const customerParams = customerFactory.mock.calls[0]?.[0] as Record<string, unknown>
    expect(customerParams).toBeTruthy()
    expect(customerParams.customer_id).toBe('3178223819')
    expect(customerParams.refresh_token).toBe('refresh-token')
    expect('login_customer_id' in customerParams).toBe(false)
  })

  it('uses credential login_customer_id when caller omits loginCustomerId field', async () => {
    await getCustomerWithCredentials({
      customerId: '3178223819',
      refreshToken: 'refresh-token',
      userId: 1,
    })

    const customerParams = customerFactory.mock.calls[0]?.[0] as Record<string, unknown>
    expect(customerParams).toBeTruthy()
    expect(customerParams.login_customer_id).toBe('5010618892')
  })

  it('skips assert and resolveOAuth when authContext and credentials are passed', async () => {
    await getCustomerWithCredentials({
      customerId: '3178223819',
      refreshToken: 'refresh-token',
      userId: 1,
      loginCustomerId: '5010618892',
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        developer_token: 'developer-token',
      },
      authContext: {
        dualStack: false,
        auth: { authType: 'oauth' },
        oauthCredentials: { login_customer_id: '5010618892' },
      } as any,
    })

    expect(authContextFns.assertGoogleAdsAuthReadyForApi).not.toHaveBeenCalled()
    expect(authContextFns.getGoogleAdsAuthContext).not.toHaveBeenCalled()
    expect(accountsAuthFns.resolveOAuthClientCredentialsForUser).not.toHaveBeenCalled()
    expect(customerFactory).toHaveBeenCalled()
  })

  it('uses service_account path when authContext is SA and authType omitted', async () => {
    serviceAccountFns.getUnifiedGoogleAdsClient.mockResolvedValue({ _isPythonProxy: true })

    const saContext = {
      dualStack: false,
      auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-1' },
    }

    await getCustomerWithCredentials({
      customerId: '3178223819',
      userId: 1,
      serviceAccountId: 'sa-1',
      authContext: saContext as any,
    })

    expect(serviceAccountFns.getUnifiedGoogleAdsClient).toHaveBeenCalled()
    expect(customerFactory).not.toHaveBeenCalled()
  })

  it('rejects dual-stack before OAuth customer creation even with refreshToken passed', async () => {
    authContextFns.assertGoogleAdsAuthReadyForApi.mockRejectedValue(
      new Error('检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。')
    )

    await expect(
      getCustomerWithCredentials({
        customerId: '3178223819',
        refreshToken: 'refresh-token',
        userId: 1,
        credentials: {
          client_id: 'client-id',
          client_secret: 'client-secret',
          developer_token: 'developer-token',
        },
      })
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)

    expect(customerFactory).not.toHaveBeenCalled()
    expect(accountsAuthFns.resolveOAuthClientCredentialsForUser).not.toHaveBeenCalled()
  })
})
