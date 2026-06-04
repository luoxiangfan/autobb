import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, findUserById } from '@/lib/auth'
import { saveGoogleAdsCredentials, deleteGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getDatabase } from '@/lib/db'
import {
  assertUserCanModifyGoogleAdsAuth,
} from '@/lib/google-ads-auth-assignment'
import { updateApiAccessLevel } from '@/lib/google-ads-access-level-detector'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContext,
  GOOGLE_ADS_DUAL_STACK_WARNING,
  hasConfiguredGoogleAdsAuthFromContext,
  resolveConfiguredGoogleAdsAuthType,
  resolveGoogleAdsCredentialStatusFields,
  resolveGoogleAdsDisplayAuthType,
} from '@/lib/google-ads-auth-context'

/**
 * POST /api/google-ads/credentials
 * 保存Google Ads凭证
 */
export async function POST(request: NextRequest) {
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

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    // 解析请求参数
    const body = await request.json()
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

    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    // 保存凭证
    const credentials =     await saveGoogleAdsCredentials(authResult.user.userId, {
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

    const userId = authResult.user.userId
    const ctx = await getGoogleAdsAuthContext(userId)
    const assignment = ctx.assignment
    const statusFields = resolveGoogleAdsCredentialStatusFields(ctx)
    const authConfigWarning = ctx.dualStack ? GOOGLE_ADS_DUAL_STACK_WARNING : null
    const displayAuthType = resolveGoogleAdsDisplayAuthType(ctx)

    if (!statusFields.hasCredentials) {
      return NextResponse.json({
        success: true,
        data: {
          hasCredentials: false,
          hasRefreshToken: statusFields.hasRefreshToken,
          hasServiceAccount: statusFields.hasServiceAccount,
          ...(statusFields.serviceAccountId
            ? { serviceAccountId: statusFields.serviceAccountId }
            : {}),
          ...(statusFields.serviceAccountName
            ? { serviceAccountName: statusFields.serviceAccountName }
            : {}),
          ...(displayAuthType != null ? { authType: displayAuthType } : {}),
          assignmentMode: assignment?.assignmentMode ?? 'own',
          canModify: ctx.canModify,
          isShared: ctx.isShared,
          authConfigWarning,
        },
      })
    }

    let sharedAdminEmail: string | null = null
    let sharedAdminUsername: string | null = null
    if (ctx.isShared && assignment?.sharedAdminUserId) {
      const adminUser = await findUserById(assignment.sharedAdminUserId)
      sharedAdminEmail = adminUser?.email ?? null
      sharedAdminUsername = adminUser?.username ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        hasCredentials: true,
        clientId: statusFields.clientId,
        developerToken: statusFields.developerToken,
        loginCustomerId: statusFields.loginCustomerId,
        hasRefreshToken: statusFields.hasRefreshToken,
        hasServiceAccount: statusFields.hasServiceAccount,
        serviceAccountId: statusFields.serviceAccountId,
        serviceAccountName: statusFields.serviceAccountName,
        ...(displayAuthType != null ? { authType: displayAuthType } : {}),
        apiAccessLevel: statusFields.apiAccessLevel,
        lastVerifiedAt: statusFields.lastVerifiedAt,
        isActive: statusFields.isActive,
        createdAt: statusFields.createdAt,
        updatedAt: statusFields.updatedAt,
        assignmentMode: assignment?.assignmentMode ?? 'own',
        canModify: ctx.canModify,
        isShared: ctx.isShared,
        sharedAdminEmail,
        sharedAdminUsername,
        authConfigWarning,
      },
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
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
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
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    const body = await request.json()
    const { apiAccessLevel } = body

    // 验证参数
    if (!apiAccessLevel || !['test', 'basic', 'explorer', 'standard'].includes(apiAccessLevel)) {
      return NextResponse.json(
        { error: '无效的API访问级别，必须是 test、explorer、basic 或 standard' },
        { status: 400 }
      )
    }

    const authContext = await getGoogleAdsAuthContext(userId)
    if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
      return NextResponse.json(
        { error: '未找到有效的Google Ads凭证配置' },
        { status: 404 }
      )
    }

    await updateApiAccessLevel(
      userId,
      apiAccessLevel,
      resolveConfiguredGoogleAdsAuthType(authContext)
    )

    console.log(`✅ 已更新API访问级别: ${apiAccessLevel}`)
    console.log(`   用户: ${authResult.user.email}`)
    console.log(`   认证类型: ${resolveConfiguredGoogleAdsAuthType(authContext)}`)

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
