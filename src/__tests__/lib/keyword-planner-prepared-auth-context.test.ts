import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultOAuthApiCredentialsFields,
  defaultOAuthAuthContext,
  defaultPreparedGoogleAdsApiCallForLinkedAccount,
} from '@/__tests__/lib/helpers/campaign-route-auth-context-mock'

const loginCustomerFns = vi.hoisted(() => ({
  getLoginCustomerId: vi.fn(async () => '9988776655'),
}))

vi.mock('@/lib/google-ads/service-account/service-account', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/google-ads/service-account/service-account')>()
  return {
    ...actual,
    getLoginCustomerId: loginCustomerFns.getLoginCustomerId,
  }
})

vi.mock('@/lib/google-ads/api/api', () => ({
  getCustomerWithCredentials: vi.fn(),
}))

vi.mock('@/lib/google-ads/oauth/login-customer', () => ({
  runWithLoginCustomerFallbackForAccount: vi.fn(
    async ({ callback }: { callback: (id: string) => unknown }) => callback('9988776655')
  ),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: vi.fn(async () => ({ parent_mcc_id: null })),
  })),
}))

vi.mock('@/lib/google-ads/api/tracker', () => ({
  trackApiUsage: vi.fn(),
  ApiOperationType: { KEYWORD_PLANNER: 'keyword_planner' },
}))

import { buildKeywordPlannerSessionFromPrepared } from '@/lib/google-ads/accounts/auth/index'
import { getKeywordIdeas } from '@/lib/google-ads/keyword/planner'

describe('Keyword Planner authContext reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loginCustomerFns.getLoginCustomerId.mockResolvedValue('9988776655')
  })

  it('buildKeywordPlannerSessionFromPrepared includes authContext on preparedOAuth', () => {
    const session = buildKeywordPlannerSessionFromPrepared({
      ...defaultPreparedGoogleAdsApiCallForLinkedAccount,
      authContext: defaultOAuthAuthContext,
    })

    expect(session.preparedOAuth?.authContext).toBe(defaultOAuthAuthContext)
  })

  it('getKeywordIdeas passes prepared authContext to getLoginCustomerId', async () => {
    const { getCustomerWithCredentials } = await import('@/lib/google-ads/api/api')
    vi.mocked(getCustomerWithCredentials).mockResolvedValue({
      keywordPlanIdeas: {
        generateKeywordIdeas: vi.fn(async () => []),
      },
    } as any)

    await getKeywordIdeas({
      customerId: '1234567890',
      userId: 7,
      targetCountry: 'US',
      targetLanguage: 'en',
      seedKeywords: ['test'],
      preparedOAuth: {
        refreshToken: 'rt',
        credentials: defaultOAuthApiCredentialsFields,
        oauthLoginCustomerId: '9988776655',
        authContext: defaultOAuthAuthContext,
      },
    })

    expect(loginCustomerFns.getLoginCustomerId).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext: defaultOAuthAuthContext,
      })
    )

    expect(vi.mocked(getCustomerWithCredentials).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        authContext: defaultOAuthAuthContext,
      })
    )
  })
})
