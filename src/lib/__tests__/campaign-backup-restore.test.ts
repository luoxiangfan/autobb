import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: mockQuery,
    queryOne: mockQueryOne,
  })),
}))

const mockAbandonStale = vi.fn()
const mockGetConflict = vi.fn()

vi.mock('@/lib/campaign-offer-constraint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/campaign-offer-constraint')>()
  return {
    ...actual,
    abandonStalePendingCampaignsForOffer: (...args: unknown[]) =>
      mockAbandonStale(...args),
    getActiveCampaignConflictForOffer: (...args: unknown[]) =>
      mockGetConflict(...args),
  }
})

import {
  BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE,
  validateCampaignBackupsForBatchCreate,
} from '@/lib/campaign-backup-restore'

describe('validateCampaignBackupsForBatchCreate', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQueryOne.mockReset()
    mockAbandonStale.mockReset()
    mockGetConflict.mockReset()
    mockAbandonStale.mockResolvedValue(0)
    mockQueryOne.mockResolvedValue({ is_active: 1, is_deleted: 0 })
  })

  it('rejects when offer already has an active campaign', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 10,
        offer_id: 99,
        campaign_name: 'Backup A',
        campaign_config: { keywords: [] },
      },
    ])
    mockGetConflict.mockResolvedValueOnce({
      id: 501,
      campaign_name: 'Live Campaign',
      creation_status: 'published',
      status: 'PAUSED',
    })

    const result = await validateCampaignBackupsForBatchCreate([10], 7, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE)
      expect(result.error).toContain('Offer 99')
      expect(result.error).toContain('501')
    }
    expect(mockAbandonStale).toHaveBeenCalledWith(99, 7)
  })

  it('passes when no active campaign occupies the offer', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 10,
        offer_id: 99,
        campaign_name: 'Backup A',
        campaign_config: { keywords: [] },
      },
    ])
    mockGetConflict.mockResolvedValueOnce(null)

    const result = await validateCampaignBackupsForBatchCreate([10], 7, 1)
    expect(result).toEqual({ ok: true })
  })
})
