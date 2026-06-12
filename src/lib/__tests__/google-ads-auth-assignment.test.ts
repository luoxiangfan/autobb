import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isGoogleAdsAuthShared,
  listGoogleAdsSharedDependentUserIds,
} from '@/lib/google-ads/auth/assignment'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

describe('@/lib/google-ads/auth/assignment', () => {
  it('treats shared_admin as shared', () => {
    expect(
      isGoogleAdsAuthShared({
        userId: 2,
        assignmentMode: 'shared_admin',
        sharedAdminUserId: 1,
        authType: 'oauth',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      })
    ).toBe(true)
  })

  it('treats own mode as not shared', () => {
    expect(
      isGoogleAdsAuthShared({
        userId: 2,
        assignmentMode: 'own',
        sharedAdminUserId: null,
        authType: 'oauth',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      })
    ).toBe(false)
  })

  it('treats missing assignment as not shared', () => {
    expect(isGoogleAdsAuthShared(null)).toBe(false)
  })

  describe('listGoogleAdsSharedDependentUserIds', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns dependent user ids for shared admin owner', async () => {
      dbFns.query.mockResolvedValue([{ user_id: 2 }, { user_id: 7 }])

      await expect(listGoogleAdsSharedDependentUserIds(1)).resolves.toEqual([2, 7])
      expect(dbFns.query).toHaveBeenCalledWith(expect.stringContaining('shared_admin_user_id'), [1])
    })
  })
})
