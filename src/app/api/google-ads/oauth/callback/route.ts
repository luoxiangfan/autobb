import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { exchangeCodeForTokens, saveGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { looksLikeOAuthClientSecret } from '@/lib/google-ads-developer-token-heal'
import { getGoogleAdsOAuthConfigFields } from '@/lib/google-ads-settings-store'
import { getGoogleAdsAuthAssignment, isGoogleAdsAuthShared } from '@/lib/google-ads-auth-assignment'
import { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads-oauth-redirect'
import { assertNoConflictingGoogleAdsAuth } from '@/lib/google-ads-auth-context'
import { verifyGoogleAdsOAuthState } from '@/lib/google-ads-oauth-state'
import {
  logGoogleAdsOAuthDebug,
  logGoogleAdsOAuthError,
  logGoogleAdsOAuthInfo,
} from '../oauth-route-logger'

export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function createRedirectUrl(path: string): URL {
  return new URL(path, getBaseUrl())
}

function redirectToGoogleAdsSettings(params: Record<string, string>): NextResponse {
  const url = createRedirectUrl('/settings')
  url.searchParams.set('category', 'google_ads')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return NextResponse.redirect(url)
}

function redirectToLoginPreservingOAuthCallback(request: NextRequest): NextResponse {
  const loginUrl = createRedirectUrl('/login')
  loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(loginUrl)
}

/**
 * GET /api/google-ads/oauth/callback
 * Google Ads OAuth回调处理
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      logGoogleAdsOAuthError('callback_provider_error', error)
      return redirectToGoogleAdsSettings({ error })
    }

    if (!code) {
      return redirectToGoogleAdsSettings({ error: 'missing_code' })
    }

    if (!state) {
      return redirectToGoogleAdsSettings({ error: 'missing_state' })
    }

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const looseState = verifyGoogleAdsOAuthState(state, { expectedPurpose: 'google_ads' })
      if (looseState.ok) {
        return redirectToLoginPreservingOAuthCallback(request)
      }
      return redirectToGoogleAdsSettings({ error: 'unauthorized' })
    }

    const stateVerified = verifyGoogleAdsOAuthState(state, {
      expectedPurpose: 'google_ads',
      expectedUserId: authResult.user.userId,
    })
    if (!stateVerified.ok) {
      return redirectToGoogleAdsSettings({ error: stateVerified.error })
    }

    const userId = stateVerified.payload.user_id

    const assignment = await getGoogleAdsAuthAssignment(userId)
    if (isGoogleAdsAuthShared(assignment)) {
      return redirectToGoogleAdsSettings({ error: 'shared_auth_readonly' })
    }

    const oauthConfig = await getGoogleAdsOAuthConfigFields(userId)
    const loginCustomerId = oauthConfig.login_customer_id
    if (!loginCustomerId) {
      return redirectToGoogleAdsSettings({ error: 'missing_login_customer_id' })
    }

    const clientId = oauthConfig.client_id
    const clientSecret = oauthConfig.client_secret
    const developerToken = oauthConfig.developer_token

    if (!clientId || !clientSecret || !developerToken) {
      return redirectToGoogleAdsSettings({ error: 'missing_google_ads_config' })
    }

    if (
      developerToken.trim() === clientSecret.trim() ||
      looksLikeOAuthClientSecret(developerToken)
    ) {
      return redirectToGoogleAdsSettings({ error: 'developer_token_invalid' })
    }

    logGoogleAdsOAuthDebug('callback_processing', { userId })

    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch {
      return redirectToGoogleAdsSettings({ error: 'auth_conflict' })
    }

    const redirectUri = getGoogleAdsOAuthRedirectUri()
    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri)

    logGoogleAdsOAuthDebug('callback_tokens_exchanged', { userId })

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const savedCredentials = await saveGoogleAdsCredentials(userId, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      developer_token: developerToken,
      login_customer_id: loginCustomerId,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
    })

    logGoogleAdsOAuthInfo('callback_credentials_saved', {
      userId,
      credentialsId: savedCredentials.id,
    })

    return redirectToGoogleAdsSettings({ oauth_success: 'true' })
  } catch (error: any) {
    logGoogleAdsOAuthError('callback_failed', error)
    return redirectToGoogleAdsSettings({ error: 'callback_failed' })
  }
}
