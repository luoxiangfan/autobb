import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(async () => {}),
  queryOne: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextCache: vi.fn(),
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  invalidateGoogleAdsAuthContextCache: authContextFns.invalidateGoogleAdsAuthContextCache,
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

import { upsertGoogleAdsAuthAssignment } from '@/lib/google-ads-auth-assignment'

const sharedAssignmentRow = {
  user_id: 3,
  assignment_mode: 'shared_admin' as const,
  shared_admin_user_id: 1,
  auth_type: 'oauth' as const,
  configured_by: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
}

const ownAssignmentRow = {
  user_id: 5,
  assignment_mode: 'own' as const,
  shared_admin_user_id: null,
  auth_type: 'oauth' as const,
  configured_by: 5,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
}

describe('upsertGoogleAdsAuthAssignment cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates user cache for shared_admin assignment', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(sharedAssignmentRow)

    await upsertGoogleAdsAuthAssignment({
      userId: 3,
      assignmentMode: 'shared_admin',
      authType: 'oauth',
      sharedAdminUserId: 1,
      configuredBy: 1,
    })

    expect(authContextFns.invalidateGoogleAdsAuthContextCache).toHaveBeenCalledWith(3)
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).not.toHaveBeenCalled()
  })

  it('invalidates user cache for own assignment (assignment-only changes)', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(ownAssignmentRow)

    await upsertGoogleAdsAuthAssignment({
      userId: 5,
      assignmentMode: 'own',
      authType: 'oauth',
      sharedAdminUserId: null,
      configuredBy: 5,
    })

    expect(authContextFns.invalidateGoogleAdsAuthContextCache).toHaveBeenCalledWith(5)
    expect(authContextFns.invalidateGoogleAdsAuthContextForCredentialUser).not.toHaveBeenCalled()
  })
})
