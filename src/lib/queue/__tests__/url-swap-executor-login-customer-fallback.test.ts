import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/url-resolver-enhanced', () => ({
  resolveAffiliateLink: vi.fn(),
}))

vi.mock('@/lib/offer-utils', () => ({
  initializeProxyPool: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(),
  getUserAuthType: vi.fn(),
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateCampaignFinalUrlSuffix: vi.fn(),
}))

vi.mock('@/lib/url-swap', () => ({
  updateTaskAfterManualAdvance: vi.fn(),
  updateTaskAfterSwap: vi.fn(),
  recordSwapHistory: vi.fn(),
  setTaskError: vi.fn(),
  getUrlSwapTaskTargets: vi.fn(),
  markUrlSwapTargetSuccess: vi.fn(),
  markUrlSwapTargetFailure: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { resolveAffiliateLink } from '@/lib/url-resolver-enhanced'
import { initializeProxyPool } from '@/lib/offer-utils'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { updateCampaignFinalUrlSuffix } from '@/lib/google-ads-api'
import {
  getUrlSwapTaskTargets,
  markUrlSwapTargetFailure,
  markUrlSwapTargetSuccess,
  updateTaskAfterSwap,
} from '@/lib/url-swap'
import { executeUrlSwapTask } from '@/lib/queue/executors/url-swap-executor'

describe('executeUrlSwapTask login_customer_id fallback', () => {
  const exec = vi.fn()
  const queryOne = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    exec.mockReset()
    queryOne.mockReset()

    vi.mocked(getDatabase).mockReturnValue({
      type: 'sqlite',
      exec,
      queryOne,
      query: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn(),
    } as any)
  })

  it('retries with fallback login_customer_id when primary candidate has account access error', async () => {
    queryOne
      .mockResolvedValueOnce({
        status: 'enabled',
        is_deleted: 0,
        swap_mode: 'auto',
        manual_affiliate_links: '[]',
        manual_suffix_cursor: 0,
        current_final_url: 'https://example.com/final',
        current_final_url_suffix: 'old=1',
        google_customer_id: '2222222222',
        google_campaign_id: '3333333333',
      })
      .mockResolvedValueOnce(undefined)

    vi.mocked(initializeProxyPool).mockResolvedValueOnce(undefined as any)
    vi.mocked(resolveAffiliateLink).mockResolvedValueOnce({
      finalUrl: 'https://example.com/final',
      finalUrlSuffix: 'new=2',
    } as any)

    vi.mocked(getUrlSwapTaskTargets).mockResolvedValueOnce([{
      id: 'target-1',
      task_id: 'task-1',
      offer_id: 100,
      google_ads_account_id: 9,
      google_customer_id: '2222222222',
      google_campaign_id: '3333333333',
      status: 'active',
      consecutive_failures: 0,
      last_success_at: null,
      last_error: null,
      created_at: '',
      updated_at: '',
    }])

    vi.mocked(getGoogleAdsCredentials).mockResolvedValueOnce({
      id: 1,
      user_id: 1,
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
      developer_token: 'developer-token',
      login_customer_id: '1111111111',
      is_active: 1,
      created_at: '',
      updated_at: '',
    } as any)
    vi.mocked(getUserAuthType).mockResolvedValueOnce({ authType: 'oauth' })

    vi.mocked(updateCampaignFinalUrlSuffix)
      .mockRejectedValueOnce(new Error("User doesn't have permission to access customer. Note: If you're accessing a client customer, the manager's customer id must be set in the 'login-customer-id' header."))
      .mockResolvedValueOnce(undefined as any)

    const result = await executeUrlSwapTask({
      id: 'queue-task-1',
      type: 'url-swap',
      userId: 1,
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
      data: {
        taskId: 'task-1',
        offerId: 100,
        affiliateLink: 'https://example.com/affiliate',
        targetCountry: 'US',
        googleCustomerId: '2222222222',
        googleCampaignId: '3333333333',
        currentFinalUrl: 'https://example.com/final',
        currentFinalUrlSuffix: 'old=1',
      },
    } as any)

    expect(result).toEqual({ success: true, changed: true })

    expect(updateCampaignFinalUrlSuffix).toHaveBeenCalledTimes(2)
    expect(vi.mocked(updateCampaignFinalUrlSuffix).mock.calls[0]?.[0]).toMatchObject({
      loginCustomerId: '1111111111',
    })
    expect(vi.mocked(updateCampaignFinalUrlSuffix).mock.calls[1]?.[0]).toMatchObject({
      loginCustomerId: '2222222222',
    })

    expect(markUrlSwapTargetSuccess).toHaveBeenCalledTimes(1)
    expect(markUrlSwapTargetFailure).not.toHaveBeenCalled()
    expect(updateTaskAfterSwap).toHaveBeenCalledTimes(1)
  })
})
