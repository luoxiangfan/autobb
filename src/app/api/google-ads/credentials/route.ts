import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  saveGoogleAdsCredentials,
  getGoogleAdsCredentials,
  deleteGoogleAdsCredentials,
  getUserAuthType,
} from '@/lib/google-ads-oauth'
import { getDatabase } from '@/lib/db'
import {
  canMaintainGoogleAdsConfig,
  getGoogleAdsConfigScope,
} from '@/lib/google-ads-config-policy'

/**
 * POST /api/google-ads/credentials
 * 保存Google Ads凭证
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const requestedTargetUserId =
      typeof body?.targetUserId === 'number' && Number.isFinite(body.targetUserId)
        ? body.targetUserId
        : undefined
    if (requestedTargetUserId && authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可为其他用户维护 Google Ads 配置' }, { status: 403 })
    }
    const targetUserId =
      authResult.user.role === 'admin' && requestedTargetUserId
        ? requestedTargetUserId
        : authResult.user.userId

    const canMaintain = await canMaintainGoogleAdsConfig(targetUserId, authResult.user.role)
    if (!canMaintain) {
      return NextResponse.json(
        {
          error:
            '当前账号的 Google Ads 配置由管理员统一维护，您仅可查看。若需自行维护，请联系管理员切换为“用户独立配置”。',
        },
        { status: 403 }
      )
    }

    const {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at
    } = body

    // 验证必需参数
    if (!client_id || !client_secret || !refresh_token || !developer_token) {
      return NextResponse.json(
        { error: '缺少必需参数' },
        { status: 400 }
      )
    }

    console.log(`💾 保存Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)
    console.log(`   Developer Token: ${developer_token.substring(0, 10)}...`)

    // 保存凭证
    const credentials = await saveGoogleAdsCredentials(targetUserId, {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at
    })

    console.log(`✅ Google Ads凭证已保存`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已保存',
      data: {
        id: credentials.id,
        hasCredentials: true
      }
    })

  } catch (error: any) {
    console.error('保存Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '保存Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/google-ads/credentials
 * 获取Google Ads凭证状态（包括OAuth和服务账号）
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

    const requestedTargetUserId = Number(request.nextUrl.searchParams.get('targetUserId') || '')
    const hasTargetUserId = Number.isFinite(requestedTargetUserId) && requestedTargetUserId > 0
    if (hasTargetUserId && authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可查看其他用户的 Google Ads 配置' }, { status: 403 })
    }
    const userId = hasTargetUserId ? requestedTargetUserId : authResult.user.userId

    const configScope = await getGoogleAdsConfigScope(userId)
    const canMaintainConfig = await canMaintainGoogleAdsConfig(
      userId,
      authResult.user.role
    )

    // 1. 检查 OAuth 凭证
    const credentials = await getGoogleAdsCredentials(userId)

    // 2. 检查是否有已激活的服务账号配置
    let hasServiceAccount = false
    let serviceAccountId: string | null = null
    let serviceAccountName: string | null = null
    let serviceAccountApiAccessLevel: string | null = null
    let serviceAccountUserId: number | null = null
    try {
      const db = await getDatabase()
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      const uid = db.type === 'postgres' ? userId : String(userId)
      const serviceAccount = await db.queryOne(
        `
        SELECT id, name, api_access_level, user_id FROM google_ads_service_accounts
        WHERE (user_id IS NULL OR user_id = ?) AND ${isActiveCondition}
        ORDER BY CASE WHEN user_id IS NULL THEN 1 ELSE 0 END, created_at DESC
        LIMIT 1
      `,
        [uid]
      ) as { id: string; name: string; api_access_level?: string; user_id?: number | null } | undefined

      if (serviceAccount) {
        hasServiceAccount = true
        serviceAccountId = serviceAccount.id
        serviceAccountName = serviceAccount.name
        serviceAccountApiAccessLevel = serviceAccount.api_access_level || null
        serviceAccountUserId = serviceAccount.user_id ?? null
      }
    } catch (err) {
      console.error('检查服务账号配置失败:', err)
    }

    // 如果没有 OAuth 凭证且没有服务账号，返回未配置状态
    if (!credentials && !hasServiceAccount) {
      return NextResponse.json({
        success: true,
        data: {
          hasCredentials: false,
          hasRefreshToken: false,
          hasServiceAccount: false,
          configScope,
          canMaintainConfig,
        }
      })
    }

    const auth = await getUserAuthType(userId)

    // 确定 API 访问级别（优先使用 OAuth 凭证的配置，其次使用服务账号的配置）
    let apiAccessLevel = 'explorer' // 默认值
    if (credentials) {
      // 从 google_ads_credentials 表获取
      const db = await getDatabase()
      const credRow = await db.queryOne(`
        SELECT api_access_level FROM google_ads_credentials WHERE user_id = ? LIMIT 1
      `, [userId]) as { api_access_level?: string } | undefined
      if (credRow?.api_access_level) {
        apiAccessLevel = credRow.api_access_level
      }
    } else if (serviceAccountApiAccessLevel) {
      apiAccessLevel = serviceAccountApiAccessLevel
    }

    // 返回凭证状态（不返回完整的敏感信息）
    return NextResponse.json({
      success: true,
      data: {
        hasCredentials: true,
        clientId: credentials?.client_id,
        developerToken: credentials?.developer_token,
        loginCustomerId: credentials?.login_customer_id,
        hasRefreshToken: !!credentials?.refresh_token,
        hasServiceAccount,
        serviceAccountId,
        serviceAccountName,
        serviceAccountUserId,
        authType: auth.authType,
        apiAccessLevel,
        configScope,
        canMaintainConfig,
        lastVerifiedAt: credentials?.last_verified_at,
        isActive: credentials?.is_active === 1,
        createdAt: credentials?.created_at,
        updatedAt: credentials?.updated_at
      }
    })

  } catch (error: any) {
    console.error('获取Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '获取Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/google-ads/credentials
 * 删除Google Ads凭证
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const requestedTargetUserId = Number(request.nextUrl.searchParams.get('targetUserId') || '')
    const hasTargetUserId = Number.isFinite(requestedTargetUserId) && requestedTargetUserId > 0
    if (hasTargetUserId && authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可删除其他用户的 Google Ads 配置' }, { status: 403 })
    }

    const userId = hasTargetUserId ? requestedTargetUserId : authResult.user.userId
    const canMaintain = await canMaintainGoogleAdsConfig(userId, authResult.user.role)
    if (!canMaintain) {
      return NextResponse.json(
        {
          error:
            '当前账号的 Google Ads 配置由管理员统一维护，您仅可查看。若需删除或修改，请联系管理员操作。',
        },
        { status: 403 }
      )
    }

    // 1) 停用/清空 OAuth 凭证（google_ads_credentials）
    await deleteGoogleAdsCredentials(userId)

    // 2) 同步清除 Settings 页保存的 OAuth 配置（system_settings 的用户实例）
    // 注意：必须限定 user_id = ?，避免误删全局模板记录(user_id IS NULL)
    const db = await getDatabase()
    const keysToClear = ['client_id', 'client_secret', 'developer_token', 'login_customer_id', 'use_service_account']
    const placeholders = keysToClear.map(() => '?').join(', ')
    await db.exec(
      `
        DELETE FROM system_settings
        WHERE user_id = ?
          AND category = 'google_ads'
          AND key IN (${placeholders})
      `,
      [userId, ...keysToClear]
    )

    console.log(`🗑️  已删除Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已删除'
    })

  } catch (error: any) {
    console.error('删除Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '删除Google Ads凭证失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/google-ads/credentials
 * 更新Google Ads API访问级别
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const requestedTargetUserId =
      typeof body?.targetUserId === 'number' && Number.isFinite(body.targetUserId)
        ? body.targetUserId
        : undefined
    if (requestedTargetUserId && authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可修改其他用户的 Google Ads 配置' }, { status: 403 })
    }
    const userId =
      authResult.user.role === 'admin' && requestedTargetUserId
        ? requestedTargetUserId
        : authResult.user.userId
    const canMaintain = await canMaintainGoogleAdsConfig(userId, authResult.user.role)
    if (!canMaintain) {
      return NextResponse.json(
        {
          error:
            '当前账号的 Google Ads 配置由管理员统一维护，您仅可查看。若需修改，请联系管理员操作。',
        },
        { status: 403 }
      )
    }

    const { apiAccessLevel } = body

    // 验证参数
    if (!apiAccessLevel || !['test', 'basic', 'explorer', 'standard'].includes(apiAccessLevel)) {
      return NextResponse.json(
        { error: '无效的API访问级别，必须是 test、explorer、basic 或 standard' },
        { status: 400 }
      )
    }

    const db = await getDatabase()
    const auth = await getUserAuthType(userId)

    // 根据认证类型更新对应的表
    if (auth.authType === 'oauth') {
      // 更新 OAuth 凭证的 API 访问级别
      await db.exec(`
        UPDATE google_ads_credentials
        SET api_access_level = ?
        WHERE user_id = ?
      `, [apiAccessLevel, userId])
    } else if (auth.authType === 'service_account' && auth.serviceAccountId) {
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      await db.exec(
        `
        UPDATE google_ads_service_accounts
        SET api_access_level = ?
        WHERE id = ? AND ${isActiveCondition}
      `,
        [apiAccessLevel, auth.serviceAccountId]
      )
    } else {
      return NextResponse.json(
        { error: '未找到有效的Google Ads凭证配置' },
        { status: 404 }
      )
    }

    console.log(`✅ 已更新API访问级别: ${apiAccessLevel}`)
    console.log(`   用户: ${authResult.user.email}`)
    console.log(`   认证类型: ${auth.authType}`)

    return NextResponse.json({
      success: true,
      message: 'API访问级别已更新',
      data: { apiAccessLevel }
    })

  } catch (error: any) {
    console.error('更新API访问级别失败:', error)

    return NextResponse.json(
      {
        error: '更新API访问级别失败',
        message: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
