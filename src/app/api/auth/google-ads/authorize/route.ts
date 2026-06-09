import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { generateOAuthUrl } from '@/lib/google-ads-oauth'
import { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads-oauth-redirect'
import { createGoogleAdsOAuthState } from '@/lib/google-ads-oauth-state'
import { getUserOnlySetting } from '@/lib/settings'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads-auth-assignment'

/**
 * GET /api/auth/google-ads/authorize?customerId=xxx
 * 遗留 OAuth 入口：与 /api/google-ads/oauth/start 对齐，统一走主回调。
 */
export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '无法修改 Google Ads 认证配置'
      return NextResponse.redirect(
        `${getBaseUrl()}/settings?error=${encodeURIComponent(message)}&category=google_ads`
      )
    }

    const clientId = (await getUserOnlySetting('google_ads', 'client_id', userId))?.value || ''
    if (!clientId) {
      return NextResponse.redirect(
        `${getBaseUrl()}/settings?error=missing_google_ads_config&category=google_ads`
      )
    }

    const state = createGoogleAdsOAuthState({
      user_id: userId,
      timestamp: Date.now(),
      purpose: 'google_ads',
    })

    const redirectUri = getGoogleAdsOAuthRedirectUri()
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    return NextResponse.redirect(authUrl)
  } catch (error: unknown) {
    console.error('Google Ads OAuth authorize error:', error)

    return NextResponse.redirect(
      `${getBaseUrl()}/settings?error=${encodeURIComponent(
        error instanceof Error ? error.message : 'oauth_failed'
      )}&category=google_ads`
    )
  }
}
