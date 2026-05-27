import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbFns.queryOne,
  })),
}))

import {
  resolveKeywordPlannerLinkedServiceAccountId,
  resolveLinkedServiceAccountIdForKeywordPlannerContext,
} from '@/lib/google-ads-accounts-auth'

describe('resolveKeywordPlannerLinkedServiceAccountId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers offerId over deprecated serviceAccountId when linkedServiceAccountId omitted', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return { service_account_id: 'sa-from-offer' }
      }
      return null
    })

    const linked = await resolveKeywordPlannerLinkedServiceAccountId({
      userId: 42,
      offerId: 10,
      serviceAccountId: 'sa-legacy-explicit',
    })

    expect(linked).toBe('sa-from-offer')
  })

  it('matches planner context resolver when only offerId is set', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return { service_account_id: 'sa-same' }
      }
      return null
    })

    const fromPlanner = await resolveKeywordPlannerLinkedServiceAccountId({
      userId: 42,
      offerId: 10,
    })
    const fromContext = await resolveLinkedServiceAccountIdForKeywordPlannerContext({
      userId: 42,
      offerId: 10,
    })
    expect(fromPlanner).toBe('sa-same')
    expect(fromContext).toBe('sa-same')
  })
})

describe('resolveLinkedServiceAccountIdForKeywordPlannerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns linked SA from offerId via campaign join', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return { service_account_id: 'sa-offer' }
      }
      return null
    })

    const linked = await resolveLinkedServiceAccountIdForKeywordPlannerContext({
      userId: 42,
      offerId: 10,
    })

    expect(linked).toBe('sa-offer')
  })

  it('prefers googleAdsAccountId over offerId', async () => {
    dbFns.queryOne.mockResolvedValue({ service_account_id: 'sa-account-row' })

    const linked = await resolveLinkedServiceAccountIdForKeywordPlannerContext({
      userId: 42,
      offerId: 10,
      googleAdsAccountId: 775,
    })

    expect(linked).toBe('sa-account-row')
    expect(dbFns.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('FROM google_ads_accounts'),
      [775, 42]
    )
  })

  it('returns explicit linkedServiceAccountId without DB lookup', async () => {
    const linked = await resolveLinkedServiceAccountIdForKeywordPlannerContext({
      userId: 42,
      linkedServiceAccountId: 'sa-explicit',
    })

    expect(linked).toBe('sa-explicit')
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('allows explicit null linkedServiceAccountId', async () => {
    const linked = await resolveLinkedServiceAccountIdForKeywordPlannerContext({
      userId: 42,
      linkedServiceAccountId: null,
    })

    expect(linked).toBeNull()
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })
})
