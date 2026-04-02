import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

/**
 * 用户端：获取我的 Google Ads 配置
 * 
 * 返回用户可用的配置（OAuth 或服务账号），优先返回已授权的配置
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await findUserById(userId)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const db = getDatabase()

    // 1. 检查 OAuth 绑定
    const oauthBinding = await db.queryOne(`
      SELECT 
        b.id as binding_id,
        b.oauth_config_id,
        b.refresh_token,
        b.authorized_at,
        b.needs_reauth,
        b.is_active as binding_is_active,
        c.id as config_id,
        c.name as config_name,
        c.client_id,
        c.login_customer_id,
        c.is_active as config_is_active
      FROM google_ads_user_oauth_bindings b
      INNER JOIN google_ads_shared_oauth_configs c ON b.oauth_config_id = c.id
      WHERE b.user_id = ? AND b.is_active = 1
      LIMIT 1
    `, [userId])

    // 2. 检查服务账号绑定
    const saBinding = await db.queryOne(`
      SELECT 
        b.id as binding_id,
        b.service_account_id,
        sa.id as sa_id,
        sa.name as sa_name,
        sa.mcc_customer_id,
        sa.service_account_email,
        sa.is_active as sa_is_active,
        b.is_active as binding_is_active
      FROM google_ads_user_sa_bindings b
      INNER JOIN google_ads_service_accounts sa ON b.service_account_id = sa.id
      WHERE b.user_id = ? AND b.is_active = 1 AND sa.is_shared = 1 AND sa.is_active = 1
      LIMIT 1
    `, [userId])

    // 3. 构建响应
    const result: any = {
      has_config: false,
      auth_type: null as 'oauth' | 'service_account' | null,
      oauth: null,
      service_account: null,
      needs_action: false,
      action_type: null as 'authorize' | 'reauthorize' | null
    }

    // 处理 OAuth 配置
    if (oauthBinding) {
      const config = {
        binding_id: (oauthBinding as any).binding_id,
        config_id: (oauthBinding as any).config_id,
        name: (oauthBinding as any).config_name,
        client_id: (oauthBinding as any).client_id,
        login_customer_id: (oauthBinding as any).login_customer_id,
        authorized_at: (oauthBinding as any).authorized_at,
        needs_reauth: !!((oauthBinding as any).needs_reauth),
        has_refresh_token: !!((oauthBinding as any).refresh_token)
      }

      result.oauth = config

      // 检查是否需要授权或重新授权
      if (!(oauthBinding as any).refresh_token || (oauthBinding as any).needs_reauth) {
        result.needs_action = true
        result.action_type = !(oauthBinding as any).refresh_token ? 'authorize' : 'reauthorize'
      }
    }

    // 处理服务账号配置
    if (saBinding) {
      result.service_account = {
        binding_id: (saBinding as any).binding_id,
        service_account_id: (saBinding as any).sa_id,
        name: (saBinding as any).sa_name,
        mcc_customer_id: (saBinding as any).mcc_customer_id,
        service_account_email: (saBinding as any).service_account_email
      }
    }

    // 确定最终配置状态
    if (result.service_account) {
      // 服务账号优先（无需用户授权）
      result.has_config = true
      result.auth_type = 'service_account'
      result.needs_action = false
    } else if (result.oauth && !result.needs_action) {
      // OAuth 已授权
      result.has_config = true
      result.auth_type = 'oauth'
    } else if (result.oauth && result.needs_action) {
      // OAuth 需要授权
      result.has_config = false
      result.auth_type = 'oauth'
    }

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    console.error('[My Google Ads Config GET] Error:', error)
    return NextResponse.json({ 
      error: '获取配置失败',
      message: error.message 
    }, { status: 500 })
  }
}
