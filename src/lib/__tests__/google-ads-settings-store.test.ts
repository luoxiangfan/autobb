import { beforeEach, describe, expect, it, vi } from 'vitest'

const assignmentFns = vi.hoisted(() => ({
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
}))

import { resolveGoogleAdsOAuthSettingsReadUserId } from '@/lib/google-ads-settings-store'

describe('resolveGoogleAdsOAuthSettingsReadUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses owner user id for shared oauth assignment', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 99,
      isShared: true,
      assignment: { authType: 'oauth' },
    })

    await expect(resolveGoogleAdsOAuthSettingsReadUserId(5)).resolves.toBe(99)
  })

  it('uses current user id for own credentials', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 5,
      isShared: false,
      assignment: null,
    })

    await expect(resolveGoogleAdsOAuthSettingsReadUserId(5)).resolves.toBe(5)
  })
})
