import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  assertGoogleAdsAuthReadyForApi: vi.fn(),
}))

const apiFns = vi.hoisted(() => ({
  getGoogleAdsClient: vi.fn(),
}))

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
})
