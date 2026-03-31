import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, formatAndValidateLoginCustomerId } from '@/lib/google-ads-oauth'
import { getUserOnlySetting } from '@/lib/settings'
import { saveGoogleAdsTestCredentials } from '@/lib/google-ads-test-credentials'

export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function createRedirectUrl(path: string): URL {
  return new URL(path, getBaseUrl())
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
        createRedirectUrl(`/settings?category=google_ads&test_oauth_error=${encodeURIComponent(error)}`)
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

    let stateData: { user_id: number; timestamp: number; purpose?: string }
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
    } catch {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=invalid_state')
      )
    }

    if (stateData.purpose !== 'google_ads_test') {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=invalid_purpose')
      )
    }

    // 10分钟内有效
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?category=google_ads&test_oauth_error=state_expired')
      )
    }

    const userId = stateData.user_id

    const [mccSetting, clientIdSetting, clientSecretSetting, developerTokenSetting] = await Promise.all([
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

    const loginCustomerId = formatAndValidateLoginCustomerId(loginCustomerIdRaw, 'test_login_customer_id')
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
      createRedirectUrl(`/settings?category=google_ads&test_oauth_error=${encodeURIComponent(error.message || 'unknown_error')}`)
    )
  }
}

