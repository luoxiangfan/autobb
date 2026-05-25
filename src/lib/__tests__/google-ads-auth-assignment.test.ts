import { describe, expect, it } from 'vitest'
import { isGoogleAdsAuthShared } from '@/lib/google-ads-auth-assignment'

describe('google-ads-auth-assignment', () => {
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
})
