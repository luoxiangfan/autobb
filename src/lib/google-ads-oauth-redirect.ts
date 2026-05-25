const GOOGLE_ADS_OAUTH_REDIRECT_PATH = '/api/google-ads/oauth/callback'

export function getGoogleAdsOAuthRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${GOOGLE_ADS_OAUTH_REDIRECT_PATH}`
}
