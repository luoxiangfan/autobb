import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { exchangeCodeForTokens, formatAndValidateLoginCustomerId } from '@/lib/google-ads-oauth'
import { getUserOnlySetting } from '@/lib/settings'
import { saveGoogleAdsTestCredentials } from '@/lib/google-ads-test-credentials'
import { verifyGoogleAdsOAuthState } from '@/lib/google-ads-oauth-state'

export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function createRedirectUrl(path: string): URL {
  return new URL(path, getBaseUrl())
}

function redirectToLoginPreservingOAuthCallback(request: NextRequest): NextResponse {
  const loginUrl = createRedirectUrl('/login')
  loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(loginUrl)
}

/**
 * GET /api/google-ads/test-oauth/callback
 * Google Ads “测试权限MCC” OAuth 回调处理（与现有 OAuth 用户授权隔离）
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return NextResponse.redirect(
        createRedirectUrl(
          `/settings?category=google_ads&test_oauth_error=${encodeURIComponent(error)}`
        )
      )
    }

    if (!code) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=missing_code')
      )
    }

    if (!state) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=missing_state')
      )
    }

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const looseState = verifyGoogleAdsOAuthState(state, { expectedPurpose: 'google_ads_test' })
      if (looseState.ok) {
        return redirectToLoginPreservingOAuthCallback(request)
      }
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=unauthorized')
      )
    }

    const stateVerified = verifyGoogleAdsOAuthState(state, {
      expectedPurpose: 'google_ads_test',
      expectedUserId: authResult.user.userId,
    })
    if (!stateVerified.ok) {
      return NextResponse.redirect(
        createRedirectUrl(`/settings?category=google_ads&test_oauth_error=${stateVerified.error}`)
      )
    }

    const userId = stateVerified.payload.user_id

    const [mccSetting, clientIdSetting, clientSecretSetting, developerTokenSetting] =
      await Promise.all([
        getUserOnlySetting('google_ads', 'test_login_customer_id', userId),
        getUserOnlySetting('google_ads', 'test_client_id', userId),
        getUserOnlySetting('google_ads', 'test_client_secret', userId),
        getUserOnlySetting('google_ads', 'test_developer_token', userId),
      ])

    const loginCustomerIdRaw = mccSetting?.value || ''
    const clientId = clientIdSetting?.value || ''
    const clientSecret = clientSecretSetting?.value || ''
    const developerToken = developerTokenSetting?.value || ''

    if (!loginCustomerIdRaw || !clientId || !clientSecret || !developerToken) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=missing_test_config')
      )
    }

    const loginCustomerId = formatAndValidateLoginCustomerId(
      loginCustomerIdRaw,
      'test_login_customer_id'
    )
    const redirectUri = `${getBaseUrl()}/api/google-ads/test-oauth/callback`

    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await saveGoogleAdsTestCredentials(userId, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      developer_token: developerToken,
      login_customer_id: loginCustomerId,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
    })

    return NextResponse.redirect(
      createRedirectUrl('/settings?category=google_ads&test_oauth_success=true')
    )
  } catch (error: any) {
    return NextResponse.redirect(
      createRedirectUrl(
        `/settings?category=google_ads&test_oauth_error=${encodeURIComponent(error.message || 'unknown_error')}`
      )
    )
  }
}
