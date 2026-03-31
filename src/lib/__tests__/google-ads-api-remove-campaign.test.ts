import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/python-ads-client', () => ({
  removeCampaignPython: vi.fn()
}))

import * as googleAdsApi from '@/lib/google-ads-api'
import { removeCampaignPython } from '@/lib/python-ads-client'

describe('removeGoogleAdsCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses removeCampaignPython for service_account auth', async () => {
    await googleAdsApi.removeGoogleAdsCampaign({
      userId: 1,
      customerId: '123',
      campaignId: '456',
      refreshToken: '',
      authType: 'service_account',
      serviceAccountId: 'svc-1'
    })

    expect(removeCampaignPython).toHaveBeenCalledWith({
      userId: 1,
      serviceAccountId: 'svc-1',
      customerId: '123',
      campaignResourceName: 'customers/123/campaigns/456'
    })
  })

  it('uses customer.campaigns.remove for oauth auth', async () => {
    const removeMock = vi.fn(async () => [])

    await googleAdsApi.removeGoogleAdsCampaign({
      userId: 2,
      customerId: '999',
      campaignId: '888',
      refreshToken: 'rt',
      authType: 'oauth',
      loginCustomerId: '111',
      customer: {
        campaigns: {
          remove: removeMock
        }
      } as any
    })

    expect(removeMock).toHaveBeenCalledWith(['customers/999/campaigns/888'])
  })
})
