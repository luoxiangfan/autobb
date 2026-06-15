import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

import { resolveKeywordPlannerLinkedServiceAccountId } from '@/lib/google-ads/accounts/auth/index'
import {
  keywordPlannerIdeasAuthFromSession,
  type KeywordPlannerSessionAuthResult,
} from '@/lib/keywords'

describe('resolveKeywordPlannerLinkedServiceAccountId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers explicit linkedServiceAccountId over offerId', async () => {
    const linked = await resolveKeywordPlannerLinkedServiceAccountId({
      userId: 7,
      offerId: 10,
      linkedServiceAccountId: 'sa-explicit',
    })
    expect(linked).toBe('sa-explicit')
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('resolves from offerId when linkedServiceAccountId omitted', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INNER JOIN campaigns')) {
        return { service_account_id: 'sa-from-offer' }
      }
      return null
    })

    const linked = await resolveKeywordPlannerLinkedServiceAccountId({
      userId: 7,
      offerId: 10,
    })
    expect(linked).toBe('sa-from-offer')
  })

  it('falls back to legacy serviceAccountId when no offerId', async () => {
    const linked = await resolveKeywordPlannerLinkedServiceAccountId({
      userId: 7,
      serviceAccountId: ' sa-legacy ',
    })
    expect(linked).toBe('sa-legacy')
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })
})

describe('keywordPlannerIdeasAuthFromSession', () => {
  it('returns null when prepare failed (no caller authType fallback)', () => {
    const failed: KeywordPlannerSessionAuthResult = {
      ok: false,
      message: 'Google Ads OAuth 授权已过期',
    }
    expect(keywordPlannerIdeasAuthFromSession(failed)).toBeNull()
  })

  it('returns session auth when prepare succeeded', () => {
    const ok: KeywordPlannerSessionAuthResult = {
      ok: true,
      session: {
        volumeAuth: {
          authType: 'service_account',
          serviceAccountId: 'sa-1',
          plannerAuth: { existingContext: {} as never },
        },
      },
    }
    expect(keywordPlannerIdeasAuthFromSession(ok)).toEqual({
      authType: 'service_account',
      serviceAccountId: 'sa-1',
      preparedOAuth: undefined,
    })
  })
})
