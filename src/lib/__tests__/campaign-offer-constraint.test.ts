import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryOne = vi.fn()
const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: mockQueryOne,
    exec: mockExec,
  })),
}))

import {
  abandonStalePendingCampaignsForOffer,
  assertNoActiveCampaignForOffer,
  CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
  getActiveCampaignConflictForOffer,
  getStaleUpdatedAtThresholdIso,
  hasActiveCampaignForOffer,
  offerOccupyingCampaignFilterSql,
  rollbackPendingCampaignAfterEnqueueFailure,
} from '@/lib/campaign-offer-constraint'

describe('campaign-offer-constraint', () => {
  beforeEach(() => {
    mockQueryOne.mockReset()
    mockExec.mockReset()
  })

  it('returns conflict row when an active campaign exists', async () => {
    const conflict = {
      id: 42,
      campaign_name: 'C1',
      creation_status: 'pending',
      status: 'PAUSED',
    }
    mockQueryOne.mockResolvedValue(conflict)
    await expect(getActiveCampaignConflictForOffer(10, 7)).resolves.toMatchObject({ id: 42 })
    await expect(hasActiveCampaignForOffer(10, 7)).resolves.toBe(true)
  })

  it('returns false when no active campaign exists', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined)
    await expect(hasActiveCampaignForOffer(10, 7)).resolves.toBe(false)
  })

  it('does not treat failed or removed campaigns as occupying the offer', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined)
    await expect(hasActiveCampaignForOffer(10, 7)).resolves.toBe(false)

    const sql = String(mockQueryOne.mock.calls[0]?.[0] || '')
    expect(sql).toContain("creation_status != 'failed'")
    expect(sql).toContain("!= 'REMOVED'")
    expect(sql).toContain("creation_status = 'pending'")
    expect(sql).toMatch(/updated_at < '\d{4}-\d{2}-\d{2}T/)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), [10, 7])
  })

  it('uses ISO threshold for stale pending exclusion in filter SQL', () => {
    const threshold = '2020-01-01T00:00:00.000Z'
    const sql = offerOccupyingCampaignFilterSql('sqlite', 'c', threshold)
    expect(sql).toContain("updated_at < '2020-01-01T00:00:00.000Z'")
    expect(getStaleUpdatedAtThresholdIso(30)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('abandons stale pending campaigns for an offer', async () => {
    mockExec.mockResolvedValueOnce({ changes: 2 })
    await expect(abandonStalePendingCampaignsForOffer(10, 7)).resolves.toBe(2)
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("updated_at < ?"),
      expect.arrayContaining([expect.any(String), 10, 7, expect.any(String)])
    )
  })

  it('throws the canonical message when asserting on a occupied offer', async () => {
    mockExec.mockResolvedValueOnce({ changes: 0 })
    mockQueryOne.mockResolvedValueOnce({ id: 42 })
    await expect(assertNoActiveCampaignForOffer(10, 7)).rejects.toThrow(
      CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE
    )
  })

  it('soft-deletes pending campaign on enqueue rollback', async () => {
    mockExec.mockResolvedValueOnce({ changes: 1 })
    await expect(
      rollbackPendingCampaignAfterEnqueueFailure({
        campaignId: 99,
        offerId: 10,
        userId: 7,
        reason: 'queue down',
      })
    ).resolves.toBe(true)

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('creation_status = \'pending\''),
      ['queue down', 99, 7, 10]
    )
  })
})
