import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl, formatAndValidateLoginCustomerId } from '@/lib/google-ads-oauth'
import { getUserOnlySetting } from '@/lib/settings'

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
      return NextResponse.json(
        { error: '请先在设置页面填写并保存测试配置（测试MCC ID、测试Client ID/Secret、测试Developer Token）' },
        { status: 400 }
      )
    }

    // 格式校验：10位数字 MCC ID
    const loginCustomerId = formatAndValidateLoginCustomerId(loginCustomerIdRaw, 'test_login_customer_id')

    const state = Buffer.from(JSON.stringify({
      user_id: userId,
      timestamp: Date.now(),
      purpose: 'google_ads_test'
    })).toString('base64url')

    const redirectUri = `${getBaseUrl()}/api/google-ads/test-oauth/callback`
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri,
        login_customer_id: loginCustomerId,
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动测试OAuth流程失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}

