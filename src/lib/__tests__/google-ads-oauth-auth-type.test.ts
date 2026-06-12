import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
}))

import { getUserAuthType } from '@/lib/google-ads/oauth/oauth'

describe('getUserAuthType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      assignment: null,
      isShared: false,
    })
  })

  it('returns empty authType when own mode has no credentials or assignment preference', async () => {
    dbFns.queryOne.mockResolvedValue(undefined)

    await expect(getUserAuthType(1)).resolves.toEqual({})
  })

  it('returns oauth when refresh token exists', async () => {
    dbFns.queryOne.mockResolvedValueOnce({ refresh_token: 'rt-1' }).mockResolvedValueOnce(undefined)

    await expect(getUserAuthType(1)).resolves.toEqual({ authType: 'oauth' })
  })

  it('returns service_account with id when SA row exists', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('google_ads_credentials')) {
        return undefined
      }
      if (sql.includes('google_ads_service_accounts')) {
        return { id: 'sa-42' }
      }
      return undefined
    })

    await expect(getUserAuthType(1)).resolves.toEqual({
      authType: 'service_account',
      serviceAccountId: 'sa-42',
    })
  })

  it('returns assignment oauth preference without credentials', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      assignment: {
        userId: 1,
        assignmentMode: 'own',
        sharedAdminUserId: null,
        authType: 'oauth',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      },
      isShared: false,
    })
    dbFns.queryOne.mockResolvedValue(undefined)

    await expect(getUserAuthType(1)).resolves.toEqual({ authType: 'oauth' })
  })
})
