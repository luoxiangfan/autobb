import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultOAuthApiCredentialsFields,
  defaultOAuthAuthContext,
  defaultPreparedGoogleAdsApiCallForLinkedAccount,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'

const accountsAuthFns = vi.hoisted(() => ({
  prepareGoogleAdsApiCallForLinkedAccount: vi.fn(),
  keywordPlannerVolumeAuthFromPrepared: vi.fn(),
}))

vi.mock('@/lib/google-ads/accounts/auth/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/accounts/auth/index')>()
  return {
    ...actual,
    prepareGoogleAdsApiCallForLinkedAccount:
      accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount,
    keywordPlannerVolumeAuthFromPrepared: accountsAuthFns.keywordPlannerVolumeAuthFromPrepared,
  }
})

import { buildKeywordPlannerSessionFromPrepared } from '@/lib/google-ads/accounts/auth/index'
import { prepareKeywordPlannerSessionAuth } from '@/lib/unified-keyword-service'

describe('prepareKeywordPlannerSessionAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValue({
      ...defaultPreparedGoogleAdsApiCallForLinkedAccount,
      authContext: defaultOAuthAuthContext,
    })
    accountsAuthFns.keywordPlannerVolumeAuthFromPrepared.mockReturnValue({
      authType: 'oauth',
      serviceAccountId: undefined,
      plannerAuth: {
        existingContext: defaultOAuthAuthContext,
        healedOAuth: {
          credentials: defaultOAuthApiCredentialsFields,
          refreshToken: 'oauth-refresh-token',
        },
      },
    })
  })

  it('returns session with preparedOAuth and volumeAuth on success', async () => {
    const result = await prepareKeywordPlannerSessionAuth(7, null)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.session.preparedOAuth?.refreshToken).toBe('oauth-refresh-token')
    const built = buildKeywordPlannerSessionFromPrepared({
      ...defaultPreparedGoogleAdsApiCallForLinkedAccount,
      authContext: defaultOAuthAuthContext,
    })
    expect(built.preparedOAuth?.authContext).toBe(defaultOAuthAuthContext)
    expect(result.session.volumeAuth.authType).toBe('oauth')
    expect(accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount).toHaveBeenCalledWith(7, null)
  })

  it('returns ok:false when prepare fails (no fallback path)', async () => {
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValueOnce({
      ok: false,
      message: 'Google Ads OAuth 授权已过期',
    })

    const result = await prepareKeywordPlannerSessionAuth(7, null)

    expect(result).toEqual({
      ok: false,
      message: 'Google Ads OAuth 授权已过期',
    })
  })

  it('omits preparedOAuth for service_account authType but still returns volumeAuth', async () => {
    accountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValueOnce({
      ok: true,
      authContext: {
        ...defaultOAuthAuthContext,
        auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      },
      apiAuth: {
        authType: 'service_account' as const,
        refreshToken: '',
        serviceAccountId: 'sa-1',
      },
      refreshToken: '',
    })
    const result = await prepareKeywordPlannerSessionAuth(7, 'sa-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.session.preparedOAuth).toBeUndefined()
    expect(result.session.volumeAuth.authType).toBe('service_account')
  })
})
