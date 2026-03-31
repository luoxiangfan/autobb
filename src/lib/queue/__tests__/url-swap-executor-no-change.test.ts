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
import { updateCampaignFinalUrlSuffix } from '@/lib/google-ads-api'
import { getUrlSwapTaskTargets, recordSwapHistory, setTaskError } from '@/lib/url-swap'
import { executeUrlSwapTask } from '@/lib/queue/executors/url-swap-executor'

describe('executeUrlSwapTask (auto)', () => {
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

  it('URL未变化时应计为成功，不应增加 failed_swaps', async () => {
    queryOne.mockResolvedValueOnce({
      status: 'enabled',
      is_deleted: 0,
      swap_mode: 'auto',
      manual_affiliate_links: '[]',
      manual_suffix_cursor: 0,
      current_final_url: 'https://example.com/final',
      current_final_url_suffix: 'x=1',
      google_customer_id: '123-456-7890',
      google_campaign_id: '987654321',
    })

    vi.mocked(initializeProxyPool).mockResolvedValueOnce(undefined as any)
    vi.mocked(getUrlSwapTaskTargets).mockResolvedValueOnce([])
    vi.mocked(resolveAffiliateLink).mockResolvedValueOnce({
      finalUrl: 'https://example.com/final',
      finalUrlSuffix: 'x=1',
    } as any)

    exec.mockResolvedValueOnce({ changes: 1 })

    const result = await executeUrlSwapTask({
      id: 'queue-task-1',
      type: 'url-swap',
      userId: 1,
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
      data: {
        taskId: 'task-1',
        offerId: 1,
        affiliateLink: 'https://example.com/affiliate',
        targetCountry: 'US',
        googleCustomerId: '123-456-7890',
        googleCampaignId: '987654321',
        currentFinalUrl: 'https://example.com/final',
        currentFinalUrlSuffix: 'x=1',
      },
    } as any)

    expect(result).toEqual({ success: true, changed: false })

    expect(updateCampaignFinalUrlSuffix).not.toHaveBeenCalled()
    expect(recordSwapHistory).not.toHaveBeenCalled()
    expect(setTaskError).not.toHaveBeenCalled()

    expect(exec).toHaveBeenCalledTimes(1)
    const [sql] = exec.mock.calls[0]
    expect(sql).toContain('success_swaps = success_swaps + 1')
    expect(sql).not.toContain('failed_swaps = failed_swaps + 1')
  })

  it('任务已禁用时应跳过执行', async () => {
    queryOne.mockResolvedValueOnce({
      status: 'disabled',
      is_deleted: 0,
      swap_mode: 'auto',
      manual_affiliate_links: '[]',
      manual_suffix_cursor: 0,
      current_final_url: 'https://example.com/final',
      current_final_url_suffix: 'x=1',
      google_customer_id: '123-456-7890',
      google_campaign_id: '987654321',
    })

    const result = await executeUrlSwapTask({
      id: 'queue-task-2',
      type: 'url-swap',
      userId: 1,
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
      data: {
        taskId: 'task-2',
        offerId: 1,
        affiliateLink: 'https://example.com/affiliate',
        targetCountry: 'US',
        googleCustomerId: '123-456-7890',
        googleCampaignId: '987654321',
        currentFinalUrl: 'https://example.com/final',
        currentFinalUrlSuffix: 'x=1',
      },
    } as any)

    expect(result).toEqual({ success: false, changed: false })
    expect(resolveAffiliateLink).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(recordSwapHistory).not.toHaveBeenCalled()
    expect(setTaskError).not.toHaveBeenCalled()
  })

  it('任务已删除时应跳过执行', async () => {
    queryOne.mockResolvedValueOnce({
      status: 'enabled',
      is_deleted: 1,
      swap_mode: 'auto',
      manual_affiliate_links: '[]',
      manual_suffix_cursor: 0,
      current_final_url: 'https://example.com/final',
      current_final_url_suffix: 'x=1',
      google_customer_id: '123-456-7890',
      google_campaign_id: '987654321',
    })

    const result = await executeUrlSwapTask({
      id: 'queue-task-3',
      type: 'url-swap',
      userId: 1,
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
      data: {
        taskId: 'task-3',
        offerId: 1,
        affiliateLink: 'https://example.com/affiliate',
        targetCountry: 'US',
        googleCustomerId: '123-456-7890',
        googleCampaignId: '987654321',
        currentFinalUrl: 'https://example.com/final',
        currentFinalUrlSuffix: 'x=1',
      },
    } as any)

    expect(result).toEqual({ success: false, changed: false })
    expect(resolveAffiliateLink).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(recordSwapHistory).not.toHaveBeenCalled()
    expect(setTaskError).not.toHaveBeenCalled()
  })
})
