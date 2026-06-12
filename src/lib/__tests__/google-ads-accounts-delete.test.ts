import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteGoogleAdsAccount } from '@/lib/google-ads-accounts'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(),
}))

const markRemovedFns = vi.hoisted(() => ({
  markUrlSwapTargetsRemovedByOfferAccount: vi.fn(async () => 1),
}))

const pauseFns = vi.hoisted(() => ({
  pauseOfferTasks: vi.fn(async () => ({
    clickFarmTaskPaused: true,
    clickFarmTaskCount: 1,
    urlSwapTaskDisabled: true,
    urlSwapTaskCount: 1,
  })),
}))

const constraintFns = vi.hoisted(() => ({
  hasActiveCampaignForOffer: vi.fn(async () => false),
}))

const stateMachineFns = vi.hoisted(() => ({
  applyCampaignTransitionByIds: vi.fn(async () => ({
    updatedCount: 2,
    matchedCampaignIds: [1, 2],
  })),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
    query: dbFns.query,
    exec: dbFns.exec,
    transaction: dbFns.transaction,
  })),
}))

vi.mock('@/lib/url-swap', () => ({
  markUrlSwapTargetsRemovedByOfferAccount: markRemovedFns.markUrlSwapTargetsRemovedByOfferAccount,
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  pauseOfferTasks: pauseFns.pauseOfferTasks,
}))

vi.mock('@/lib/campaign-offer-constraint', () => ({
  hasActiveCampaignForOffer: constraintFns.hasActiveCampaignForOffer,
}))

vi.mock('@/lib/campaign-state-machine', () => ({
  applyCampaignTransitionByIds: stateMachineFns.applyCampaignTransitionByIds,
}))

describe('deleteGoogleAdsAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.transaction.mockImplementation(async (fn: () => Promise<unknown>) => fn())
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return { customer_id: '123-456-7890' }
      }
      if (sql.includes('FROM offers')) {
        return { unlinked_from_customer_ids: null }
      }
      return undefined
    })
    dbFns.query.mockResolvedValue([
      { id: 1, offer_id: 10 },
      { id: 2, offer_id: 20 },
    ])
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('soft-deletes campaigns, marks url swap targets removed, and pauses offer tasks when no active campaigns remain', async () => {
    const result = await deleteGoogleAdsAccount(9, 7)

    expect(result).toBe(true)
    expect(stateMachineFns.applyCampaignTransitionByIds).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        campaignIds: [1, 2],
        action: 'OFFER_DELETE',
        payload: { removedReason: 'account_delete' },
      })
    )
    expect(markRemovedFns.markUrlSwapTargetsRemovedByOfferAccount).toHaveBeenCalledWith(10, 9)
    expect(markRemovedFns.markUrlSwapTargetsRemovedByOfferAccount).toHaveBeenCalledWith(20, 9)
    expect(constraintFns.hasActiveCampaignForOffer).toHaveBeenCalledWith(10, 7)
    expect(constraintFns.hasActiveCampaignForOffer).toHaveBeenCalledWith(20, 7)
    expect(pauseFns.pauseOfferTasks).toHaveBeenCalledTimes(2)
    expect(pauseFns.pauseOfferTasks).toHaveBeenCalledWith(
      10,
      7,
      'account_deleted',
      '关联 Google Ads 账号已删除，自动暂停任务'
    )
  })

  it('does not pause offer tasks when the offer still has active campaigns on another account', async () => {
    constraintFns.hasActiveCampaignForOffer.mockImplementation(
      async (offerId: number) => offerId === 20
    )

    await deleteGoogleAdsAccount(9, 7)

    expect(pauseFns.pauseOfferTasks).toHaveBeenCalledTimes(1)
    expect(pauseFns.pauseOfferTasks).toHaveBeenCalledWith(
      10,
      7,
      'account_deleted',
      '关联 Google Ads 账号已删除，自动暂停任务'
    )
  })

  it('returns false when account does not exist', async () => {
    dbFns.queryOne.mockResolvedValueOnce(undefined)

    const result = await deleteGoogleAdsAccount(9, 7)

    expect(result).toBe(false)
    expect(pauseFns.pauseOfferTasks).not.toHaveBeenCalled()
  })
})
