import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { generateOAuthUrl } from '@/lib/google-ads-oauth'

/**
 * 用户端：启动 OAuth 授权流程
 * 
 * 使用管理员配置的共享 OAuth 配置启动授权
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    const db = getDatabase()

    // 获取用户的 OAuth 绑定
    const binding = await db.queryOne(`
      SELECT 
        b.id as binding_id,
        b.oauth_config_id,
        c.client_id,
        c.client_secret,
        c.login_customer_id
      FROM google_ads_user_oauth_bindings b
      INNER JOIN google_ads_shared_oauth_configs c ON b.oauth_config_id = c.id
      WHERE b.user_id = ? AND b.is_active = 1 AND c.is_active = 1
      LIMIT 1
    `, [userId])

    if (!binding) {
      return NextResponse.json({ 
        error: '没有找到可用的 OAuth 配置，请联系管理员分配配置',
        code: 'NO_OAUTH_CONFIG'
      }, { status: 400 })
    }

    const bindingId = (binding as any).binding_id
    const clientId = (binding as any).client_id
    const clientSecret = decrypt((binding as any).client_secret)
    const loginCustomerId = (binding as any).login_customer_id

    // 验证必要配置
    if (!clientId || !clientSecret || !loginCustomerId) {
      return NextResponse.json({ 
        error: 'OAuth 配置不完整，请联系管理员检查配置',
        code: 'INCOMPLETE_CONFIG'
      }, { status: 500 })
    }

    // 生成 state 用于验证回调
    const state = Buffer.from(
      JSON.stringify({
        user_id: userId,
        binding_id: bindingId,
        timestamp: Date.now()
      })
    ).toString('base64url')

    // 构建 redirect URI
    const redirectUri = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const callbackUrl = `${redirectUri}/api/google-ads/oauth/callback`

    // 生成授权 URL
    const authUrl = generateOAuthUrl(clientId, callbackUrl, state)

    console.log(`[User OAuth Start] 用户 ${userId} 启动 OAuth 授权`)
    console.log(`   Binding ID: ${bindingId}`)
    console.log(`   Client ID: ${clientId.substring(0, 20)}...`)
    console.log(`   Login Customer ID: ${loginCustomerId}`)

    return NextResponse.json({
      success: true,
      data: {
        auth_url: authUrl,
        redirect_uri: callbackUrl,
        binding_id: bindingId
      }
    })

  } catch (error: any) {
    console.error('[User OAuth Start] Error:', error)
    return NextResponse.json({ 
      error: '启动 OAuth 授权失败',
      message: error.message || '未知错误'
    }, { status: 500 })
  }
}
