import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const customerFactory = vi.fn()
const queryOne = vi.fn()
const getUserOnlySetting = vi.fn()
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

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne,
  })),
}))

vi.mock('@/lib/settings', () => ({
  getUserOnlySetting,
}))

vi.mock('@/lib/google-ads-accounts', () => ({
  updateGoogleAdsAccount,
}))

describe('getCustomerWithCredentials login_customer_id fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    queryOne.mockResolvedValue({
      client_id: 'client-id',
      client_secret: 'client-secret',
      developer_token: 'developer-token',
      login_customer_id: '5010618892',
    })

    getUserOnlySetting.mockResolvedValue({ value: 'false' })

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    })))
  })

  it('omits login_customer_id when caller passes explicit undefined', async () => {
    const { getCustomerWithCredentials } = await import('@/lib/google-ads-api')

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
    const { getCustomerWithCredentials } = await import('@/lib/google-ads-api')

    await getCustomerWithCredentials({
      customerId: '3178223819',
      refreshToken: 'refresh-token',
      userId: 1,
    })

    const customerParams = customerFactory.mock.calls[0]?.[0] as Record<string, unknown>
    expect(customerParams).toBeTruthy()
    expect(customerParams.login_customer_id).toBe('5010618892')
  })
})
