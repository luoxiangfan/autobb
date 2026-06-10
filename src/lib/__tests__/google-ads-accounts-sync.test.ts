import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  assertGoogleAdsAuthReadyForApi: vi.fn(),
}))

const apiFns = vi.hoisted(() => ({
  getGoogleAdsClient: vi.fn(),
}))

const pythonFns = vi.hoisted(() => ({
  listAccessibleCustomersPython: vi.fn(),
}))

vi.mock('../python-ads-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../python-ads-client')>()
  return {
    ...actual,
    listAccessibleCustomersPython: pythonFns.listAccessibleCustomersPython,
  }
})

vi.mock('../google-ads-auth-context', () => ({
  assertGoogleAdsAuthReadyForApi: authContextFns.assertGoogleAdsAuthReadyForApi,
}))

vi.mock('../google-ads-api', () => ({
  getGoogleAdsClient: apiFns.getGoogleAdsClient,
  getCustomer: vi.fn(),
}))

import { syncAccountsFromAPI } from '../google-ads-accounts-sync'

describe('syncAccountsFromAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.assertGoogleAdsAuthReadyForApi.mockResolvedValue({
      dualStack: false,
      auth: { authType: 'oauth' },
    })
  })

  it('rejects dual-stack before any Google Ads client work', async () => {
    authContextFns.assertGoogleAdsAuthReadyForApi.mockRejectedValue(
      new Error('OAuth 与服务账号不能同时配置')
    )

    await expect(
      syncAccountsFromAPI(
        42,
        { client_id: 'c', client_secret: 's', developer_token: 't', refresh_token: 'rt' },
        'oauth'
      )
    ).rejects.toThrow('OAuth 与服务账号不能同时配置')

    expect(apiFns.getGoogleAdsClient).not.toHaveBeenCalled()
  })

  it('surfaces Python Ads Service unavailable message for service account sync', async () => {
    const connectionError = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      isAxiosError: true,
    })
    pythonFns.listAccessibleCustomersPython.mockRejectedValue(connectionError)

    await expect(
      syncAccountsFromAPI(
        42,
        { client_id: 'c', client_secret: 's', developer_token: 't' },
        'service_account',
        {
          id: 'sa-1',
          serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
        }
      )
    ).rejects.toThrow(/Python Ads 服务不可用/)
  })
})
