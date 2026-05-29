import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const contextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    queryOne: dbMocks.queryOne,
  })),
}))

vi.mock('@/lib/db-helpers', () => ({
  boolCondition: () => 'is_active = 1',
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: contextFns.getGoogleAdsAuthContext,
  }
})

import {
  hasConfiguredGoogleAdsAuth,
  resolveGoogleAdsApiAccessLevel,
} from '@/lib/google-ads-auth-assignment'
import { hasConfiguredGoogleAdsAuthFromContext } from '@/lib/google-ads-auth-context'

function sharedSaContext() {
  return {
    userId: 2,
    ownerUserId: 1,
    isShared: true,
    canModify: false,
    dualStack: false,
    assignment: {
      userId: 2,
      assignmentMode: 'shared_admin' as const,
      sharedAdminUserId: 1,
      authType: 'service_account' as const,
      configuredBy: 1,
      createdAt: '',
      updatedAt: '',
    },
    auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
    oauthCredentials: null,
    serviceAccountConfig: { id: 'sa-1', mccCustomerId: '1234567890', developerToken: 'token' },
  }
}

describe('google-ads shared auth resolution helpers', () => {
  beforeEach(() => {
    dbMocks.queryOne.mockReset()
    contextFns.getGoogleAdsAuthContext.mockReset()
  })

  it('hasConfiguredGoogleAdsAuth returns true for shared service account user', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue(sharedSaContext())

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(true)
    expect(contextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(2)
  })

  it('hasConfiguredGoogleAdsAuthFromContext returns true for shared oauth with refresh', () => {
    expect(
      hasConfiguredGoogleAdsAuthFromContext({
        ...sharedSaContext(),
        assignment: {
          ...sharedSaContext().assignment!,
          authType: 'oauth',
        },
        auth: { authType: 'oauth' },
        oauthCredentials: { refresh_token: 'refresh-token' },
        serviceAccountConfig: null,
      } as any)
    ).toBe(true)
  })

  it('resolveGoogleAdsApiAccessLevel reads service account level from admin for shared user', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'service_account',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce({
        id: 'sa-1',
        mcc_customer_id: '1234567890',
        developer_token: 'token',
        service_account_email: 'sa@test.iam.gserviceaccount.com',
        api_access_level: 'basic',
      })

    await expect(resolveGoogleAdsApiAccessLevel(2)).resolves.toBe('basic')
  })

  it('hasConfiguredGoogleAdsAuth returns false for shared oauth when admin only has service account', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 2,
      ownerUserId: 1,
      isShared: true,
      canModify: false,
      dualStack: false,
      assignment: {
        userId: 2,
        assignmentMode: 'shared_admin',
        sharedAdminUserId: 1,
        authType: 'oauth',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      },
      auth: { authType: 'oauth' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-1' },
    })

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(false)
  })

  it('hasConfiguredGoogleAdsAuth returns false when context has dualStack', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...sharedSaContext(),
      dualStack: true,
      oauthCredentials: { refresh_token: 'rt' },
    })

    await expect(hasConfiguredGoogleAdsAuth(2)).resolves.toBe(false)
  })

  it('resolveGoogleAdsApiAccessLevel returns null for shared oauth when admin has no oauth row', async () => {
    dbMocks.queryOne
      .mockResolvedValueOnce({
        user_id: 2,
        assignment_mode: 'shared_admin',
        shared_admin_user_id: 1,
        auth_type: 'oauth',
        configured_by: 1,
        created_at: '',
        updated_at: '',
      })
      .mockResolvedValueOnce(null)

    await expect(resolveGoogleAdsApiAccessLevel(2)).resolves.toBeNull()
    expect(dbMocks.queryOne).toHaveBeenCalledTimes(2)
  })
})
