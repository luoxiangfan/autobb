import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: mockQuery,
    queryOne: mockQueryOne,
  })),
}))

const mockAbandonStaleForOffers = vi.fn()
const mockGetConflictsForOffers = vi.fn()

vi.mock('@/lib/campaign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/campaign')>()
  return {
    ...actual,
    abandonStalePendingCampaignsForOffers: (...args: unknown[]) =>
      mockAbandonStaleForOffers(...args),
    getActiveCampaignConflictsForOffers: (...args: unknown[]) => mockGetConflictsForOffers(...args),
  }
})

import {
  BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE,
  validateCampaignBackupsForBatchCreate,
} from '@/lib/campaign'

describe('validateCampaignBackupsForBatchCreate', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQueryOne.mockReset()
    mockAbandonStaleForOffers.mockReset()
    mockGetConflictsForOffers.mockReset()
    mockAbandonStaleForOffers.mockResolvedValue(0)
    mockGetConflictsForOffers.mockResolvedValue(new Map())
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
    mockGetConflictsForOffers.mockResolvedValueOnce(
      new Map([
        [
          99,
          {
            id: 501,
            campaign_name: 'Live Campaign',
            creation_status: 'published',
            status: 'PAUSED',
          },
        ],
      ])
    )

    const result = await validateCampaignBackupsForBatchCreate([10], 7, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE)
      expect(result.error).toContain('Offer 99')
      expect(result.error).toContain('501')
    }
    expect(mockAbandonStaleForOffers).toHaveBeenCalledTimes(1)
    expect(mockAbandonStaleForOffers).toHaveBeenCalledWith([99], 7)
    expect(mockGetConflictsForOffers).toHaveBeenCalledWith([99], 7)
  })

  it('rejects when some backup ids are missing', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 10,
        offer_id: 99,
        campaign_name: 'Backup A',
        campaign_config: { keywords: [] },
      },
    ])

    const result = await validateCampaignBackupsForBatchCreate([10, 11], 7, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('11')
    }
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
    const result = await validateCampaignBackupsForBatchCreate([10], 7, 1)
    expect(result).toEqual({ ok: true })
    expect(mockGetConflictsForOffers).toHaveBeenCalledWith([99], 7)
  })

  it('batch-checks all unique offers in one query round', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 10,
        offer_id: 99,
        campaign_name: 'Backup A',
        campaign_config: { keywords: [] },
      },
      {
        id: 11,
        offer_id: 100,
        campaign_name: 'Backup B',
        campaign_config: { keywords: [] },
      },
    ])

    const result = await validateCampaignBackupsForBatchCreate([10, 11], 7, 1)
    expect(result).toEqual({ ok: true })
    expect(mockAbandonStaleForOffers).toHaveBeenCalledWith(expect.arrayContaining([99, 100]), 7)
    expect(mockGetConflictsForOffers).toHaveBeenCalledWith(expect.arrayContaining([99, 100]), 7)
  })
})
