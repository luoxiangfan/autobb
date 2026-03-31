import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { createGoogleAdsAccount, findGoogleAdsAccountByCustomerId } from '@/lib/google-ads-accounts'

// 强制动态渲染（OAuth回调必须动态处理）
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google-ads/callback
 * Google Ads OAuth回调处理
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

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`
      )
    }

    // 获取用户的 Google Ads 凭证
    const credentials = await getGoogleAdsCredentialsFromDB(parseInt(userId, 10))

    // 交换authorization code获取tokens
    const tokens = await exchangeCodeForTokens(code, {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret
    })

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=missing_refresh_token`
      )
    }

    // 解析state参数（如果包含customer_id）
    let customerId: string | null = null
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
        customerId = stateData.customerId
      } catch (e) {
        // state解析失败，忽略
      }
    }

    // 如果没有customer_id，需要用户手动输入
    if (!customerId) {
      // 将tokens临时存储在session或cookie中，让用户输入customer_id
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/google-ads/complete-setup?tokens=${encodeURIComponent(
          JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
          })
        )}`
      )
    }

    // 计算token过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 🔧 修复(2026-01-07): 改进去重逻辑，避免多次OAuth回调创建重复账户
    // 检查账号是否已存在（包括已删除的账户）
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()

    const existingAccount = await db.queryOne(`
      SELECT id, is_deleted FROM google_ads_accounts
      WHERE user_id = ? AND customer_id = ?
    `, [parseInt(userId, 10), customerId]) as { id: number; is_deleted: boolean } | undefined

    if (existingAccount) {
      // 账户已存在，更新tokens
      const { updateGoogleAdsAccount } = await import('@/lib/google-ads-accounts')

      // 如果是已删除的账户，恢复它
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
        // 正常更新tokens
        await updateGoogleAdsAccount(existingAccount.id, parseInt(userId, 10), {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
        })
      }
    } else {
      // 账户不存在，创建新账号
      await createGoogleAdsAccount({
        userId: parseInt(userId, 10),
        customerId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
      })
    }

    // 重定向到设置页面，显示成功消息
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?success=google_ads_connected`
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
