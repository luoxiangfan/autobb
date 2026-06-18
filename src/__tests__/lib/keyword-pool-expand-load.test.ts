import { describe, expect, it } from 'vitest'
import {
  defaultOAuthApiCredentialsFields,
  defaultOAuthAuthContext,
  defaultPreparedGoogleAdsApiCallForLinkedAccount,
} from '@/__tests__/lib/helpers/campaign-route-auth-context-mock'
import { buildKeywordPlannerSessionFromPrepared } from '@/lib/google-ads/accounts/auth/index'

describe('buildKeywordPlannerSessionFromPrepared', () => {
  it('builds OAuth session with preparedOAuth for expand + ideas reuse', () => {
    const prepared = {
      ...defaultPreparedGoogleAdsApiCallForLinkedAccount,
      authContext: defaultOAuthAuthContext,
      refreshToken: 'oauth-refresh',
      oauthCredentials: defaultOAuthApiCredentialsFields,
    }
    const session = buildKeywordPlannerSessionFromPrepared(prepared)
    expect(session.preparedOAuth?.refreshToken).toBe('oauth-refresh')
    expect(session.volumeAuth.authType).toBe('oauth')
  })

  it('omits preparedOAuth for service_account session', () => {
    const prepared = {
      ok: true as const,
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
    }
    const session = buildKeywordPlannerSessionFromPrepared(prepared)
    expect(session.preparedOAuth).toBeUndefined()
    expect(session.volumeAuth.authType).toBe('service_account')
  })
})
