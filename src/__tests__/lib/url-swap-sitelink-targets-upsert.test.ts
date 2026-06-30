import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    exec: mockExec,
  })),
}))

import { upsertUrlSwapSitelinkTarget } from '@/lib/url-swap/url-swap-sitelink-targets'

const baseInput = {
  taskId: 'task-1',
  offerId: 10,
  userId: 1,
  sortIndex: 0,
  affiliateLink: 'https://yeahpromos.com/?track=abc',
  googleAdsAccountId: 5,
  googleCustomerId: '123',
  googleCampaignId: '23958165312',
  assetResourceName: 'customers/123/assets/111',
  assetId: '111',
  linkText: 'Product A',
  currentFinalUrl: 'https://amazon.com/dp/B001',
  currentFinalUrlSuffix: null,
  status: 'active' as const,
}

describe('upsertUrlSwapSitelinkTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExec.mockResolvedValue({ changes: 1 })
  })

  it('clears rows conflicting on sort_index or asset_resource_name before insert', async () => {
    await upsertUrlSwapSitelinkTarget(baseInput)

    expect(mockExec).toHaveBeenCalledTimes(2)
    expect(mockExec.mock.calls[0][0]).toContain('DELETE FROM url_swap_sitelink_targets')
    expect(mockExec.mock.calls[0][0]).toContain('sort_index = ? OR asset_resource_name = ?')
    expect(mockExec.mock.calls[0][1]).toEqual([
      baseInput.taskId,
      baseInput.sortIndex,
      baseInput.assetResourceName,
    ])
    expect(mockExec.mock.calls[1][0]).toContain('INSERT INTO url_swap_sitelink_targets')
    expect(mockExec.mock.calls[1][0]).not.toContain('ON CONFLICT')
  })
})
