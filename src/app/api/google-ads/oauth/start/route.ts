import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl } from '@/lib/google-ads/oauth/oauth'
import { looksLikeOAuthClientSecret } from '@/lib/google-ads/accounts/auth/developer-token-heal'
import { getGoogleAdsOAuthConfigFields } from '@/lib/google-ads/settings/settings-store'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import { assertNoConflictingGoogleAdsAuth } from '@/lib/google-ads/auth/context'
import { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads/oauth/redirect'
import { createGoogleAdsOAuthState } from '@/lib/google-ads/oauth/state'
import {
  logGoogleAdsOAuthDebug,
  logGoogleAdsOAuthError,
  logGoogleAdsOAuthInfo,
} from '@/lib/google-ads/auth/route-logger'

/**
 * GET /api/google-ads/oauth/start
 * 启动Google Ads OAuth授权流程
 *
 * 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须配置自己的完整OAuth凭证
 * - client_id, client_secret, developer_token 必须由用户自己配置
 * - login_customer_id 必须由用户自己配置（必填项）
 * - 不再支持平台共享配置，确保用户数据完全隔离
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    logGoogleAdsOAuthDebug('start_requested', { userId })

    const oauthConfig = await getGoogleAdsOAuthConfigFields(userId)
    const userLoginCustomerId = oauthConfig.login_customer_id
    if (!userLoginCustomerId) {
      logGoogleAdsOAuthDebug('start_missing_login_customer_id', { userId })
      return NextResponse.json(
        {
          error:
            '请先在设置页面配置 Login Customer ID (MCC账户ID)，这是使用 Google Ads API 的必填项',
        },
        { status: 400 }
      )
    }

    const userClientId = oauthConfig.client_id
    const userClientSecret = oauthConfig.client_secret
    const userDeveloperToken = oauthConfig.developer_token

    logGoogleAdsOAuthDebug('start_config_presence', {
      userId,
      hasClientId: Boolean(userClientId),
      hasClientSecret: Boolean(userClientSecret),
      hasDeveloperToken: Boolean(userDeveloperToken),
    })

    if (!userClientId || !userClientSecret || !userDeveloperToken) {
      return NextResponse.json(
        {
          error:
            '请先在设置页面完成 Google Ads API 配置（Client ID、Client Secret、Developer Token 都是必填项）',
        },
        { status: 400 }
      )
    }

    if (
      userDeveloperToken.trim() === userClientSecret.trim() ||
      looksLikeOAuthClientSecret(userDeveloperToken)
    ) {
      return NextResponse.json(
        {
          error:
            'Developer Token 配置看起来不正确（疑似误填为 OAuth Client Secret）。请在设置页面填写 Google Ads API Center 提供的 Developer Token 后重试。',
          code: 'DEVELOPER_TOKEN_INVALID',
        },
        { status: 400 }
      )
    }

    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    const state = createGoogleAdsOAuthState({
      user_id: userId,
      timestamp: Date.now(),
      purpose: 'google_ads',
    })

    const redirectUri = getGoogleAdsOAuthRedirectUri()
    const authUrl = generateOAuthUrl(userClientId, redirectUri, state)

    logGoogleAdsOAuthInfo('start_redirect_prepared', {
      userId,
      hasLoginCustomerId: true,
    })
    logGoogleAdsOAuthDebug('start_redirect_details', {
      userId,
      loginCustomerId: userLoginCustomerId,
      redirectUri,
    })

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri,
      },
    })
  } catch (error: any) {
    logGoogleAdsOAuthError('start_failed', error)

    return NextResponse.json(
      {
        error: '启动OAuth流程失败',
        message: error.message || '未知错误',
      },
      { status: 500 }
    )
  }
}
