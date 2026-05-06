import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { generateOAuthUrl } from '@/lib/google-ads-oauth'
import { getSetting } from '@/lib/settings'

/**
 * GET /api/google-ads/oauth/start
 * 启动Google Ads OAuth授权流程
 *
 * OAuth 应用凭证（client_id / client_secret / developer_token / login_customer_id）支持
 * 全租户默认（system_settings 全局）+ 用户级覆盖；refresh_token 仍按用户各自授权写入。
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId

    console.log(`🔐 [OAuth Start] 用户ID: ${userId}`)

    const looksLikeOAuthClientSecret = (value: string) => /^GOCSPX[-_]?/i.test(value.trim())
    const summarizeSetting = (setting: any) => {
      if (!setting) return null
      const rawValue = typeof setting.value === 'string' ? setting.value : ''
      const prefix = rawValue ? rawValue.slice(0, 6) : ''
      return {
        category: setting.category,
        key: setting.key,
        dataType: setting.dataType,
        isSensitive: setting.isSensitive,
        isRequired: setting.isRequired,
        value:
          setting.isSensitive
            ? (rawValue ? `***redacted*** (len=${rawValue.length}, prefix=${prefix})` : '')
            : rawValue,
      }
    }

    const loginCustomerIdSetting = await getSetting('google_ads', 'login_customer_id', userId)
    console.log(`🔐 [OAuth Start] login_customer_id 查询结果:`, summarizeSetting(loginCustomerIdSetting))

    const userLoginCustomerId = loginCustomerIdSetting?.value || ''
    if (!userLoginCustomerId) {
      console.log(`🔐 [OAuth Start] 用户 ${userId} 未配置 login_customer_id`)
      return NextResponse.json(
        { error: '请先在设置页面配置 Login Customer ID (MCC账户ID)，这是使用 Google Ads API 的必填项' },
        { status: 400 }
      )
    }

    const userClientIdSetting = await getSetting('google_ads', 'client_id', userId)
    const userClientSecretSetting = await getSetting('google_ads', 'client_secret', userId)
    const userDeveloperTokenSetting = await getSetting('google_ads', 'developer_token', userId)

    console.log(`🔐 [OAuth Start] client_id 查询结果:`, summarizeSetting(userClientIdSetting))
    console.log(`🔐 [OAuth Start] client_secret 查询结果:`, summarizeSetting(userClientSecretSetting))
    console.log(`🔐 [OAuth Start] developer_token 查询结果:`, summarizeSetting(userDeveloperTokenSetting))

    const userClientId = userClientIdSetting?.value || ''
    const userClientSecret = userClientSecretSetting?.value || ''
    const userDeveloperToken = userDeveloperTokenSetting?.value || ''

    if (!userClientId || !userClientSecret || !userDeveloperToken) {
      return NextResponse.json(
        {
          error:
            '缺少 Google Ads OAuth 应用配置（Client ID、Client Secret、Developer Token）。请联系管理员配置全租户默认值，或在设置中填写。',
        },
        { status: 400 }
      )
    }

    // 🧯 防误填：developer_token 被错误填写为 client_secret（常见前缀 GOCSPX-）
    if (userDeveloperToken.trim() === userClientSecret.trim() || looksLikeOAuthClientSecret(userDeveloperToken)) {
      return NextResponse.json(
        {
          error:
            'Developer Token 配置看起来不正确（疑似误填为 OAuth Client Secret）。请在设置页面填写 Google Ads API Center 提供的 Developer Token 后重试。',
          code: 'DEVELOPER_TOKEN_INVALID',
        },
        { status: 400 }
      )
    }

    const clientId = userClientId
    console.log(`🔐 用户 ${userId} 使用自己的OAuth配置`)

    // 生成state用于验证回调
    const state = Buffer.from(
      JSON.stringify({
        user_id: userId,
        timestamp: Date.now()
      })
    ).toString('base64url')

    // 构建redirect URI
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/google-ads/oauth/callback`

    // 生成授权URL
    const authUrl = generateOAuthUrl(clientId, redirectUri, state)

    console.log(`🔐 启动Google Ads OAuth流程`)
    console.log(`   用户: ${authResult.user.email} (ID: ${userId})`)
    console.log(`   Client ID: ${clientId.substring(0, 20)}...`)
    console.log(`   Login Customer ID: ${userLoginCustomerId}`)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: redirectUri
      }
    })

  } catch (error: any) {
    console.error('启动OAuth流程失败:', error)

    return NextResponse.json(
      {
        error: '启动OAuth流程失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
