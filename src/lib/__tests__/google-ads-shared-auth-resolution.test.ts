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
  adminHasConfiguredAuth,
  hasConfiguredGoogleAdsAuth,
  resolveGoogleAdsApiAccessLevel,
  resolveGoogleAdsApiAccessLevelFromContext,
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
    apiAccessLevel: 'basic',
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

  it('resolveGoogleAdsApiAccessLevelFromContext reads oauth level without db', () => {
    expect(
      resolveGoogleAdsApiAccessLevelFromContext({
        userId: 2,
        assignment: null,
        auth: { authType: 'oauth' },
        oauthCredentials: { api_access_level: 'Standard' },
        serviceAccountConfig: null,
      })
    ).toBe('standard')
  })

  it('resolveGoogleAdsApiAccessLevel reads service account level from admin for shared user', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue(sharedSaContext())

    await expect(resolveGoogleAdsApiAccessLevel(2)).resolves.toBe('basic')
    expect(contextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(2)
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

  it('adminHasConfiguredAuth returns false when admin has dualStack even with oauth tokens', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 1,
      ownerUserId: 1,
      isShared: false,
      canModify: true,
      dualStack: true,
      assignment: null,
      auth: { authType: 'oauth' as const },
      oauthCredentials: {
        refresh_token: 'rt',
        client_id: 'cid',
        client_secret: 'secret',
        developer_token: 'dev-token',
      },
      serviceAccountConfig: { id: 'sa-1' },
    })

    await expect(adminHasConfiguredAuth(1, 'oauth')).resolves.toBe(false)
    await expect(adminHasConfiguredAuth(1, 'service_account')).resolves.toBe(false)
  })

  it('adminHasConfiguredAuth returns true when admin oauth is configured and not dualStack', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 1,
      ownerUserId: 1,
      isShared: false,
      canModify: true,
      dualStack: false,
      assignment: null,
      auth: { authType: 'oauth' as const },
      oauthCredentials: {
        refresh_token: 'rt',
        client_id: 'cid',
        client_secret: 'secret',
        developer_token: 'dev-token',
      },
      serviceAccountConfig: null,
    })

    await expect(adminHasConfiguredAuth(1, 'oauth')).resolves.toBe(true)
    await expect(adminHasConfiguredAuth(1, 'service_account')).resolves.toBe(false)
  })

  it('resolveGoogleAdsApiAccessLevel returns null for shared oauth when admin has no oauth row', async () => {
    contextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...sharedSaContext(),
      assignment: {
        ...sharedSaContext().assignment!,
        authType: 'oauth',
      },
      auth: { authType: 'oauth' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-1' },
      apiAccessLevel: null,
    })

    await expect(resolveGoogleAdsApiAccessLevel(2)).resolves.toBeNull()
    expect(contextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(2)
  })
})
