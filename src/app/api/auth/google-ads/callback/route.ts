import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { createGoogleAdsAccount } from '@/lib/google-ads-accounts'
import { getDatabase } from '@/lib/db'
import { encrypt } from '@/lib/crypto'

// 强制动态渲染（OAuth 回调必须动态处理）
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google-ads/callback
 * Google Ads OAuth 回调处理（支持共享配置和用户自配置）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // 检查是否有错误
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(error)}`
      )
    }

    // 验证必填参数
    if (!code) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_code`
      )
    }

    // 从中间件注入的请求头中获取用户 ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`
      )
    }

    const userIdInt = parseInt(userId, 10)
    const db = await getDatabase()

    // 🆕 检查 state 中是否包含 binding_id（共享配置模式）
    let bindingId: string | null = null
    let customerId: string | null = null
    let isSharedConfig = false

    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
        bindingId = stateData.binding_id || null
        customerId = stateData.customerId || null
        isSharedConfig = !!stateData.binding_id
      } catch (e) {
        // state 解析失败，忽略
      }
    }

    // 获取 OAuth 凭证
    let credentials: any
    if (isSharedConfig && bindingId) {
      // 共享配置模式：从共享配置表获取凭证
      const bindingData = await db.queryOne(`
        SELECT c.client_id, c.client_secret, c.login_customer_id
        FROM google_ads_user_oauth_bindings b
        INNER JOIN google_ads_shared_oauth_configs c ON b.oauth_config_id = c.id
        WHERE b.id = ? AND b.user_id = ? AND b.is_active = 1
      `, [bindingId, userIdInt])

      if (!bindingData) {
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=invalid_binding`
        )
      }

      credentials = {
        client_id: (bindingData as any).client_id,
        client_secret: (bindingData as any).client_secret,
        login_customer_id: (bindingData as any).login_customer_id
      }

      // 解密 client_secret
      const { decrypt } = await import('@/lib/crypto')
      credentials.client_secret = decrypt(credentials.client_secret)

    } else {
      // 用户自配置模式：从 settings 表获取凭证
      credentials = await getGoogleAdsCredentialsFromDB(userIdInt)
    }

    if (!credentials || !credentials.client_id || !credentials.client_secret) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_credentials`
      )
    }

    // 交换 authorization code 获取 tokens
    const tokens = await exchangeCodeForTokens(code, {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret
    })

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_refresh_token`
      )
    }

    // 使用 login_customer_id 作为 customer_id（如果没有指定）
    if (!customerId) {
      customerId = credentials.login_customer_id
    }

    if (!customerId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_customer_id`
      )
    }

    // 计算 token 过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 🆕 如果是共享配置模式，更新绑定表的 refresh_token
    if (isSharedConfig && bindingId) {
      const encryptedRefreshToken = encrypt(tokens.refresh_token)
      const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
      
      await db.exec(`
        UPDATE google_ads_user_oauth_bindings 
        SET refresh_token = ?, 
            authorized_at = ${nowFunc},
            needs_reauth = 0,
            updated_at = ${nowFunc}
        WHERE id = ? AND user_id = ?
      `, [encryptedRefreshToken, bindingId, userIdInt])

      console.log(`[OAuth Callback] 共享配置用户 ${userIdInt} 授权成功，Binding ID: ${bindingId}`)

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?oauth_success=true`
      )
    }

    // 用户自配置模式：更新或创建 Google Ads 账户
    const existingAccount = await db.queryOne(`
      SELECT id, is_deleted FROM google_ads_accounts
      WHERE user_id = ? AND customer_id = ?
    `, [userIdInt, customerId]) as { id: number; is_deleted: boolean } | undefined

    if (existingAccount) {
      const { updateGoogleAdsAccount } = await import('@/lib/google-ads-accounts')

      if (existingAccount.is_deleted) {
        const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
        await db.exec(`
          UPDATE google_ads_accounts
          SET is_deleted = ${isDeletedFalse},
              deleted_at = NULL,
              access_token = ?,
              refresh_token = ?,
              token_expires_at = ?,
              updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
          WHERE id = ?
        `, [tokens.access_token, tokens.refresh_token, expiresAt, existingAccount.id])
      } else {
        await updateGoogleAdsAccount(existingAccount.id, userIdInt, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
        })
      }
    } else {
      await createGoogleAdsAccount({
        userId: userIdInt,
        customerId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
      })
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?oauth_success=true`
    )
  } catch (error: any) {
    console.error('Google Ads OAuth callback error:', error)

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(
        error.message || 'oauth_failed'
      )}`
    )
  }
}
