export function hasConfiguredGoogleAdsAuthFromContextMock(ctx: {
  auth: { authType: string }
  oauthCredentials: { refresh_token?: string } | null
  serviceAccountConfig: { id?: string } | null
}): boolean {
  if (ctx.auth.authType === 'oauth') {
    return Boolean(ctx.oauthCredentials?.refresh_token)
  }
  return Boolean(ctx.serviceAccountConfig?.id)
}

export const defaultOAuthAuthContext = {
  userId: 7,
  ownerUserId: 7,
  assignment: null,
  isShared: false,
  canModify: true,
  dualStack: false,
  auth: { authType: 'oauth' as const },
  oauthCredentials: {
    refresh_token: 'oauth-refresh-token',
    login_customer_id: '9988776655',
  },
  serviceAccountConfig: null,
}

export const defaultOAuthApiAuth = {
  authType: 'oauth' as const,
  refreshToken: 'oauth-refresh-token',
  serviceAccountId: undefined,
  serviceAccountMccId: undefined,
  oauthLoginCustomerId: '9988776655',
}

export function resetCampaignRouteAuthMocksOAuth(fns: {
  getGoogleAdsAuthContext: { mockResolvedValue: (v: unknown) => void }
  resolveGoogleAdsApiAuthFromContext: { mockResolvedValue: (v: unknown) => void }
}): void {
  fns.getGoogleAdsAuthContext.mockResolvedValue(defaultOAuthAuthContext)
  fns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue(defaultOAuthApiAuth)
}

export const defaultOAuthApiCredentialsFields = {
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'GOCSPX-test-client-secret',
  developer_token: 'abcdefghijklmnopqrstuvwxyz123456',
}

export const defaultOAuthGoogleAdsCallBundle = {
  ok: true as const,
  bundle: {
    oauthCredentials: defaultOAuthApiCredentialsFields,
    oauthLoginCustomerId: defaultOAuthApiAuth.oauthLoginCustomerId,
  },
}

export const defaultPreparedGoogleAdsAccountApiCall = {
  ok: true as const,
  apiAuth: defaultOAuthApiAuth,
  refreshToken: defaultOAuthApiAuth.refreshToken,
  oauthCredentials: defaultOAuthApiCredentialsFields,
  oauthLoginCustomerId: defaultOAuthApiAuth.oauthLoginCustomerId,
}

export const defaultPreparedGoogleAdsApiCallForLinkedAccount = {
  ...defaultPreparedGoogleAdsAccountApiCall,
  authContext: defaultOAuthAuthContext,
}

export const defaultCampaignGoogleAdsAccountRow = {
  parent_mcc_id: null as string | null,
  service_account_id: null as string | null,
}
