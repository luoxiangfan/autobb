import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  query: vi.fn(),
}))

const dbState = vi.hoisted(() => ({
  type: 'sqlite' as 'sqlite' | 'postgres',
}))

const urlSwapFns = vi.hoisted(() => ({
  markUrlSwapTargetsRemovedByCampaignId: vi.fn(async () => {}),
}))

vi.mock('../db', () => ({
  getDatabase: vi.fn(async () => ({
    type: dbState.type,
    exec: dbFns.exec,
    query: dbFns.query,
  })),
}))

vi.mock('../url-swap', () => ({
  markUrlSwapTargetsRemovedByCampaignId: urlSwapFns.markUrlSwapTargetsRemovedByCampaignId,
}))

const {
  buildCampaignTransitionPatch,
  normalizeCampaignTransitionPatch,
  applyCampaignTransition,
  applyCampaignTransitionByGoogleCampaignIds,
} = await import('../campaign-state-machine')

describe('campaign-state-machine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.type = 'sqlite'
    dbFns.exec.mockResolvedValue({ changes: 1 })
    dbFns.query.mockResolvedValue([])
  })

  it('normalizes OFFLINE action to removed-only semantics', () => {
    const patch = normalizeCampaignTransitionPatch(buildCampaignTransitionPatch('OFFLINE'))

    expect(patch.status).toBe('REMOVED')
    expect(patch.removedReason).toBe('offline')
  })

  it('normalizes publish failure into removed + failed state', () => {
    const patch = normalizeCampaignTransitionPatch(
      buildCampaignTransitionPatch('PUBLISH_FAILED', { errorMessage: 'api failed' })
    )

    expect(patch.status).toBe('REMOVED')
    expect(patch.creationStatus).toBe('failed')
    expect(patch.creationError).toBe('api failed')
    expect(patch.removedReason).toBe('publish_failed')
  })

  it('applies OFFLINE transition by id and marks url-swap targets removed', async () => {
    const result = await applyCampaignTransition({
      userId: 7,
      campaignId: 101,
      action: 'OFFLINE',
    })

    expect(result.updatedCount).toBe(1)
    expect(result.matchedCampaignIds).toEqual([101])
    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(urlSwapFns.markUrlSwapTargetsRemovedByCampaignId).toHaveBeenCalledWith(101, 7)
  })

  it('applies pause transition by google campaign ids without marking removed', async () => {
    dbFns.query.mockResolvedValueOnce([{ id: 11 }, { id: 12 }])

    const result = await applyCampaignTransitionByGoogleCampaignIds({
      userId: 9,
      googleAdsAccountId: 88,
      googleCampaignIds: ['1001', '1002'],
      action: 'CIRCUIT_BREAK_PAUSE',
    })

    expect(result.updatedCount).toBe(1)
    expect(result.matchedCampaignIds).toEqual([11, 12])
    expect(dbFns.query).toHaveBeenCalledTimes(1)
    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(urlSwapFns.markUrlSwapTargetsRemovedByCampaignId).not.toHaveBeenCalled()
  })

  it('uses text-safe published_at COALESCE for postgres publish success', async () => {
    dbState.type = 'postgres'

    await applyCampaignTransition({
      userId: 3,
      campaignId: 222,
      action: 'PUBLISH_SUCCEEDED',
    })

    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    const [sql] = dbFns.exec.mock.calls[0]
    expect(sql).toContain("published_at = COALESCE(NULLIF(published_at::text, '')::timestamptz, NOW())")
  })
})
