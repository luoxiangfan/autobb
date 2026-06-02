import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  }
})

import { getGoogleAdsConfig } from '@/lib/keyword-planner'

describe('getGoogleAdsConfig dual-stack guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when auth context has dualStack', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 5,
      ownerUserId: 5,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt', client_id: 'c', client_secret: 's', developer_token: 'd' },
      serviceAccountConfig: { id: 'sa-1' },
    })

    const config = await getGoogleAdsConfig(5)

    expect(config).toBeNull()
    expect(authContextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(5)
  })

  it('returns null when auth is not configured', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 5,
      ownerUserId: 5,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: false,
      auth: {},
      oauthCredentials: null,
      serviceAccountConfig: null,
    })

    const config = await getGoogleAdsConfig(5)

    expect(config).toBeNull()
  })

  it('skips context load when existingContext is passed without dualStack', async () => {
    const config = await getGoogleAdsConfig(
      5,
      'oauth',
      undefined,
      {
        userId: 5,
        ownerUserId: 5,
        assignment: null,
        isShared: false,
        canModify: true,
        dualStack: false,
        auth: { authType: 'oauth' },
        oauthCredentials: {
          refresh_token: 'rt',
          client_id: 'cid',
          client_secret: 'secret',
          developer_token: 'dev-token-abcdefghijklmnopqrstuvwxyz',
          login_customer_id: '1234567890',
        },
        serviceAccountConfig: null,
        apiAccessLevel: 'explorer',
      }
    )

    expect(config).not.toBeNull()
    expect(config?.authType).toBe('oauth')
    expect(authContextFns.getGoogleAdsAuthContext).not.toHaveBeenCalled()
  })
})
