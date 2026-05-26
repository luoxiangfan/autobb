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
