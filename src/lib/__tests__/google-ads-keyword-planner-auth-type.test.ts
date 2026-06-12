import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/google-ads/auth/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/auth/context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  }
})

vi.mock('@/lib/python-ads-client', () => ({
  getKeywordIdeasPython: vi.fn(),
}))

describe('getKeywordIdeas auth guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws not_configured when auth context has no credentials', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 9,
      ownerUserId: 9,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: false,
      auth: {},
      oauthCredentials: null,
      serviceAccountConfig: null,
    })

    const { getKeywordIdeas } = await import('@/lib/google-ads/keyword/planner')

    await expect(
      getKeywordIdeas({
        customerId: '1234567890',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 9,
        seedKeywords: ['test'],
      })
    ).rejects.toThrow(/认证未配置或已失效/)
  })

  it('throws dual-stack warning when auth context has dualStack', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 9,
      ownerUserId: 9,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: { id: 'sa-1' },
    })

    const { GOOGLE_ADS_DUAL_STACK_WARNING } = await import('@/lib/google-ads/auth/context')
    const { getKeywordIdeas } = await import('@/lib/google-ads/keyword/planner')

    await expect(
      getKeywordIdeas({
        customerId: '1234567890',
        targetCountry: 'US',
        targetLanguage: 'en',
        userId: 9,
        seedKeywords: ['test'],
      })
    ).rejects.toThrow(GOOGLE_ADS_DUAL_STACK_WARNING)
  })
})
