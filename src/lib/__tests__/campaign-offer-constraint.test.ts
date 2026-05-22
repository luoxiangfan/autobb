import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: mockQuery,
    queryOne: mockQueryOne,
    exec: mockExec,
  })),
}))

import {
  abandonStalePendingCampaignsForOffer,
  abandonStalePendingCampaignsForOffers,
  assertNoActiveCampaignForOffer,
  CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE,
  getActiveCampaignConflictForOffer,
  getActiveCampaignConflictsForOffers,
  getStaleUpdatedAtThresholdIso,
  hasActiveCampaignForOffer,
  offerOccupyingCampaignFilterSql,
  offerOccupyingCampaignWhereClause,
  rollbackPendingCampaignAfterEnqueueFailure,
} from '@/lib/campaign-offer-constraint'

describe('campaign-offer-constraint', () => {
  beforeEach(() => {
    mockQuery.mockReset()
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

  it('offerOccupyingCampaignWhereClause uses unqualified columns (no phantom alias)', () => {
    const sql = offerOccupyingCampaignWhereClause('postgres')
    expect(sql).toContain('offer_id = ?')
    expect(sql).toContain('is_deleted = FALSE')
    expect(sql).not.toMatch(/\bc\./)
  })

  it('offerOccupyingCampaignFilterSql still qualifies columns when alias is provided', () => {
    const sql = offerOccupyingCampaignFilterSql('postgres', 'c', null)
    expect(sql).toContain('c.is_deleted = FALSE')
    expect(sql).toContain("c.creation_status != 'failed'")
  })

  it('abandons stale pending campaigns for an offer', async () => {
    mockExec.mockResolvedValueOnce({ changes: 2 })
    await expect(abandonStalePendingCampaignsForOffer(10, 7)).resolves.toBe(2)
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("updated_at < ?"),
      expect.arrayContaining([expect.any(String), 10, 7, expect.any(String)])
    )
  })

  it('abandons stale pending campaigns for multiple offers in one update', async () => {
    mockExec.mockResolvedValueOnce({ changes: 3 })
    await expect(abandonStalePendingCampaignsForOffers([10, 11, 10], 7)).resolves.toBe(3)
    const sql = String(mockExec.mock.calls[0]?.[0] || '')
    expect(sql).toContain('offer_id IN (?, ?)')
    expect(mockExec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.any(String), 7, 10, 11, expect.any(String)])
    )
  })

  it('returns occupying campaigns per offer in one query', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 42,
        offer_id: 10,
        campaign_name: 'C10',
        creation_status: 'published',
        status: 'PAUSED',
      },
      {
        id: 99,
        offer_id: 11,
        campaign_name: 'C11',
        creation_status: 'pending',
        status: 'PAUSED',
      },
      {
        id: 1,
        offer_id: 10,
        campaign_name: 'Older',
        creation_status: 'published',
        status: 'PAUSED',
      },
    ])

    const map = await getActiveCampaignConflictsForOffers([10, 11], 7)
    expect(map.size).toBe(2)
    expect(map.get(10)).toMatchObject({ id: 42, campaign_name: 'C10' })
    expect(map.get(11)).toMatchObject({ id: 99 })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = String(mockQuery.mock.calls[0]?.[0] || '')
    expect(sql).toContain('offer_id IN (?, ?)')
    expect(sql).toContain('ORDER BY offer_id ASC, updated_at DESC')
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
