import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
}))

import { updateGoogleAdsCampaignStatus } from '@/lib/google-ads-api'
import { pauseOrphanGoogleAdsCampaignAfterPublishFailure } from '@/lib/campaign-publish-orphan-cleanup'

describe('pauseOrphanGoogleAdsCampaignAfterPublishFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pauses remote campaign via rollback context', async () => {
    const runWithLoginCustomerFallbackAndHeartbeat = vi.fn(
      async (_stage: string, operation: (loginCustomerId: string | undefined) => Promise<void>) => {
        await operation('111')
      }
    )

    await pauseOrphanGoogleAdsCampaignAfterPublishFailure(
      {
        customerId: '123',
        refreshToken: 'rt',
        accountId: 9,
        userId: 1,
        authType: 'oauth',
        runWithLoginCustomerFallbackAndHeartbeat,
      },
      '456'
    )

    expect(runWithLoginCustomerFallbackAndHeartbeat).toHaveBeenCalledWith(
      '发布失败暂停远端Campaign',
      expect.any(Function)
    )
    expect(updateGoogleAdsCampaignStatus).toHaveBeenCalledWith({
      customerId: '123',
      refreshToken: 'rt',
      campaignId: '456',
      status: 'PAUSED',
      accountId: 9,
      userId: 1,
      loginCustomerId: '111',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
  })

  it('does not throw when pause fails', async () => {
    const runWithLoginCustomerFallbackAndHeartbeat = vi.fn(async () => {
      throw new Error('quota exceeded')
    })

    await expect(
      pauseOrphanGoogleAdsCampaignAfterPublishFailure(
        {
          customerId: '123',
          refreshToken: 'rt',
          accountId: 9,
          userId: 1,
          authType: 'oauth',
          runWithLoginCustomerFallbackAndHeartbeat,
        },
        '456'
      )
    ).resolves.toBeUndefined()

    expect(updateGoogleAdsCampaignStatus).not.toHaveBeenCalled()
  })
})
