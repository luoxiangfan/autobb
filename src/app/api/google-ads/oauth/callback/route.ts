import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { exchangeCodeForTokens, saveGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getGoogleAdsOAuthConfigFields } from '@/lib/google-ads-settings-store'
import { getGoogleAdsAuthAssignment, isGoogleAdsAuthShared } from '@/lib/google-ads-auth-assignment'
import { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads-oauth-redirect'
import { assertNoConflictingGoogleAdsAuth } from '@/lib/google-ads-auth-context'
import { verifyGoogleAdsOAuthState } from '@/lib/google-ads-oauth-state'

// 强制动态渲染
export const dynamic = 'force-dynamic'

// 获取基础URL，统一使用 NEXT_PUBLIC_APP_URL
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

// 创建重定向URL的辅助函数
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
 *
 * 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须使用自己的OAuth凭证
 * - 不再支持平台共享配置，确保用户数据完全隔离
 * - login_customer_id, client_id, client_secret, developer_token 都必须由用户自己配置
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // 检查是否有错误
    if (error) {
      console.error('OAuth授权失败:', error)
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

    const looksLikeOAuthClientSecret = (value: string) => /^GOCSPX[-_]?/i.test(value.trim())
    if (
      developerToken.trim() === clientSecret.trim() ||
      looksLikeOAuthClientSecret(developerToken)
    ) {
      return redirectToGoogleAdsSettings({ error: 'developer_token_invalid' })
    }

    console.log(`🔐 OAuth回调: 用户 ${userId} 使用自己的OAuth配置`)

    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch {
      return redirectToGoogleAdsSettings({ error: 'auth_conflict' })
    }

    const redirectUri = getGoogleAdsOAuthRedirectUri()

    console.log(`📥 处理OAuth回调`)
    console.log(`   用户: ${userId}`)
    console.log(`   Login Customer ID: ${loginCustomerId}`)
    console.log(`   Authorization Code: ${code.substring(0, 10)}...`)

    // 交换authorization code获取tokens
    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri)

    console.log(`✅ OAuth成功获取tokens`)
    console.log(`   Access Token: ${tokens.access_token.substring(0, 10)}...`)
    console.log(`   Refresh Token: ${tokens.refresh_token.substring(0, 10)}...`)

    // 计算 access token 过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 保存凭证到当前用户的记录（无论使用哪套OAuth配置，refresh_token都保存到用户自己的记录）
    const savedCredentials = await saveGoogleAdsCredentials(userId, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      developer_token: developerToken,
      login_customer_id: loginCustomerId,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
    })

    console.log(`💾 已保存Google Ads凭证到数据库`)
    console.log(`   Credentials ID: ${savedCredentials.id}`)
    console.log(`   用户ID: ${userId}`)

    return redirectToGoogleAdsSettings({ oauth_success: 'true' })
  } catch (error: any) {
    console.error('OAuth回调处理失败:', error)

    return redirectToGoogleAdsSettings({ error: 'callback_failed' })
  }
}
