import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, saveGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getUserOnlySetting } from '@/lib/settings'

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
      return NextResponse.redirect(
        createRedirectUrl(`/settings?error=${encodeURIComponent(error)}`)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=missing_code')
      )
    }

    if (!state) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=missing_state')
      )
    }

    // 验证state
    let stateData: { user_id: number; timestamp: number }
    try {
      stateData = JSON.parse(
        Buffer.from(state, 'base64url').toString()
      )
    } catch {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=invalid_state')
      )
    }

    // 检查state时间戳（10分钟内有效）
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=state_expired')
      )
    }

    const userId = stateData.user_id

    // 校验: login_customer_id 必须由用户自己配置（不使用 getSetting，避免回退到全局配置）
    const loginCustomerId = (await getUserOnlySetting('google_ads', 'login_customer_id', userId))?.value || ''
    if (!loginCustomerId) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=missing_login_customer_id&category=google_ads')
      )
    }

    // 🔧 修复(2025-12-12): 独立账号模式 - 必须使用用户自己的OAuth凭证
    const clientId = (await getUserOnlySetting('google_ads', 'client_id', userId))?.value || ''
    const clientSecret = (await getUserOnlySetting('google_ads', 'client_secret', userId))?.value || ''
    const developerToken = (await getUserOnlySetting('google_ads', 'developer_token', userId))?.value || ''

    if (!clientId || !clientSecret || !developerToken) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=missing_google_ads_config&category=google_ads')
      )
    }

    const looksLikeOAuthClientSecret = (value: string) => /^GOCSPX[-_]?/i.test(value.trim())
    if (developerToken.trim() === clientSecret.trim() || looksLikeOAuthClientSecret(developerToken)) {
      return NextResponse.redirect(
        createRedirectUrl('/settings?error=developer_token_invalid&category=google_ads')
      )
    }

    console.log(`🔐 OAuth回调: 用户 ${userId} 使用自己的OAuth配置`)

    const redirectUri = `${getBaseUrl()}/api/google-ads/oauth/callback`

    console.log(`📥 处理OAuth回调`)
    console.log(`   用户: ${userId}`)
    console.log(`   Login Customer ID: ${loginCustomerId}`)
    console.log(`   Authorization Code: ${code.substring(0, 10)}...`)

    // 交换authorization code获取tokens
    const tokens = await exchangeCodeForTokens(
      code,
      clientId,
      clientSecret,
      redirectUri
    )

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

    // 重定向回 Google Ads 账号管理页面，显示成功提示
    const successUrl = createRedirectUrl('/google-ads')
    successUrl.searchParams.set('oauth_success', 'true')

    return NextResponse.redirect(successUrl)

  } catch (error: any) {
    console.error('OAuth回调处理失败:', error)

    return NextResponse.redirect(
      createRedirectUrl(`/settings?error=${encodeURIComponent(error.message)}`)
    )
  }
}
