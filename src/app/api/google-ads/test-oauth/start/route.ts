import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl, formatAndValidateLoginCustomerId } from '@/lib/google-ads-oauth'
import { createGoogleAdsOAuthState } from '@/lib/google-ads-oauth-state'
import { getGoogleAdsTestOAuthConfigFields } from '@/lib/google-ads-settings-store'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

/**
 * GET /api/google-ads/test-oauth/start
 * 启动 Google Ads “测试权限MCC” OAuth 授权流程（与现有 OAuth 用户授权隔离）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    const testConfig = await getGoogleAdsTestOAuthConfigFields(userId)

    const loginCustomerIdRaw = testConfig.test_login_customer_id
    const clientId = testConfig.test_client_id
    const clientSecret = testConfig.test_client_secret
    const developerToken = testConfig.test_developer_token

    if (!loginCustomerIdRaw || !clientId || !clientSecret || !developerToken) {
      return NextResponse.json(
        {
          error:
            '请先在设置页面填写并保存测试配置（测试MCC ID、测试Client ID/Secret、测试Developer Token）',
        },
        { status: 400 }
      )
    }

    // 格式校验：10位数字 MCC ID
    const loginCustomerId = formatAndValidateLoginCustomerId(
      loginCustomerIdRaw,
      'test_login_customer_id'
    )

    const state = createGoogleAdsOAuthState({
      user_id: userId,
      timestamp: Date.now(),
      purpose: 'google_ads_test',
    })

    const redirectUri = `${getBaseUrl()}/api/google-ads/test-oauth/callback`
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri,
        login_customer_id: loginCustomerId,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动测试OAuth流程失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}
