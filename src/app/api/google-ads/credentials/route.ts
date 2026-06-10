import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, findUserById } from '@/lib/auth'
import { saveGoogleAdsCredentials, deleteGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads-auth-assignment'
import { updateApiAccessLevel } from '@/lib/google-ads-access-level-detector'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContext,
  googleAdsAuthContextDualStackError,
  googleAdsAuthReadyFailureHttpStatus,
  googleAdsAuthReadyFailurePayload,
  hasConfiguredGoogleAdsAuthFromContext,
  resolveConfiguredGoogleAdsAuthType,
  resolveGoogleAdsAuthReadyFailure,
  resolveGoogleAdsCredentialStatusFields,
  resolveGoogleAdsCredentialStatusFieldsFromMetadata,
  resolveGoogleAdsDisplayAuthType,
  resolveGoogleAdsCredentialStatusSummary,
  getGoogleAdsAuthContextMetadata,
  oauthCredentialFieldsPresentFromContext,
  oauthRefreshConfiguredFromContext,
  serviceAccountConfiguredFromContext,
} from '@/lib/google-ads-auth-context'
import {
  isGoogleAdsSettingsAuthConflictError,
  isGoogleAdsSettingsValidationError,
  resolveGoogleAdsCredentialFieldsForReadOnlyApi,
  upsertGoogleAdsOAuthConfigFromSettings,
} from '@/lib/google-ads-settings-store'

/**
 * POST /api/google-ads/credentials
 * 保存 Google Ads OAuth 凭证。
 *
 * @deprecated 优先使用 PUT /api/settings 保存 OAuth 字段；refresh_token 由 OAuth 回调写入。
 * 无 refresh_token 时仅 upsert 配置字段；含 refresh_token 时写入完整凭证行。
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at,
    } = body

    const hasRefreshToken = Boolean(String(refresh_token ?? '').trim())

    if (!hasRefreshToken) {
      if (!client_id || !client_secret || !developer_token) {
        return NextResponse.json(
          {
            error:
              '缺少必需参数。无 refresh_token 时需 client_id、client_secret、developer_token；完整授权请使用 PUT /api/settings 与 OAuth 回调。',
          },
          { status: 400 }
        )
      }

      try {
        await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
      } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      try {
        await upsertGoogleAdsOAuthConfigFromSettings(userId, {
          client_id,
          client_secret,
          developer_token,
          ...(login_customer_id ? { login_customer_id } : {}),
        })
      } catch (error: unknown) {
        if (isGoogleAdsSettingsAuthConflictError(error)) {
          return NextResponse.json({ error: error.message }, { status: 409 })
        }
        if (isGoogleAdsSettingsValidationError(error)) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }

      return NextResponse.json({
        success: true,
        message: 'Google Ads OAuth 配置字段已保存（请完成 OAuth 授权以获取 refresh_token）',
        data: {
          hasCredentials: false,
        },
      })
    }

    if (!client_id || !client_secret || !developer_token) {
      return NextResponse.json({ error: '缺少必需参数' }, { status: 400 })
    }

    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    const credentials = await saveGoogleAdsCredentials(authResult.user.userId, {
      client_id,
      client_secret,
      refresh_token,
      developer_token,
      login_customer_id,
      access_token,
      access_token_expires_at,
    })

    console.log(`✅ Google Ads凭证已保存`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已保存',
      data: {
        id: credentials.id,
        hasCredentials: true,
      },
    })
  } catch (error: any) {
    console.error('保存Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '保存Google Ads凭证失败',
        message: error.message || '未知错误',
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
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const metadataCtx = await getGoogleAdsAuthContextMetadata(userId)
    const assignment = metadataCtx.assignment
    const authConfigWarning = googleAdsAuthContextDualStackError(metadataCtx)
    const displayAuthType = resolveGoogleAdsDisplayAuthType(metadataCtx)

    if (!hasConfiguredGoogleAdsAuthFromContext(metadataCtx)) {
      const summary = resolveGoogleAdsCredentialStatusSummary(metadataCtx)
      return NextResponse.json({
        success: true,
        data: {
          hasCredentials: false,
          dualStack: metadataCtx.dualStack,
          hasRefreshToken: summary.hasRefreshToken,
          hasOAuthFields: oauthCredentialFieldsPresentFromContext(metadataCtx),
          hasServiceAccount: summary.hasServiceAccount,
          ...(summary.serviceAccountId ? { serviceAccountId: summary.serviceAccountId } : {}),
          ...(summary.serviceAccountName ? { serviceAccountName: summary.serviceAccountName } : {}),
          ...(displayAuthType != null ? { authType: displayAuthType } : {}),
          assignmentMode: assignment?.assignmentMode ?? 'own',
          canModify: metadataCtx.canModify,
          isShared: metadataCtx.isShared,
          authConfigWarning,
        },
      })
    }

    const ctx = metadataCtx.canModify ? await getGoogleAdsAuthContext(userId) : metadataCtx
    const statusFields = metadataCtx.canModify
      ? resolveGoogleAdsCredentialStatusFields(ctx)
      : resolveGoogleAdsCredentialStatusFieldsFromMetadata(metadataCtx)
    const exposedCredentialFields = resolveGoogleAdsCredentialFieldsForReadOnlyApi({
      canModify: ctx.canModify,
      clientId: statusFields.clientId,
      developerToken: statusFields.developerToken,
      clientSecret: ctx.canModify ? ctx.oauthCredentials?.client_secret : null,
      clientSecretConfiguredOverride: ctx.canModify
        ? undefined
        : oauthRefreshConfiguredFromContext(metadataCtx),
      developerTokenConfiguredOverride: ctx.canModify
        ? undefined
        : serviceAccountConfiguredFromContext(metadataCtx) ||
          Boolean(String(statusFields.developerToken || '').trim()) ||
          oauthRefreshConfiguredFromContext(metadataCtx),
    })

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
        dualStack: metadataCtx.dualStack,
        clientId: exposedCredentialFields.clientId,
        developerToken: exposedCredentialFields.developerToken,
        ...(exposedCredentialFields.clientIdConfigured ? { clientIdConfigured: true } : {}),
        ...(exposedCredentialFields.developerTokenConfigured
          ? { developerTokenConfigured: true }
          : {}),
        ...(exposedCredentialFields.clientSecretConfigured ? { clientSecretConfigured: true } : {}),
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

    const { formatPythonAdsServiceUnavailableError } = await import('@/lib/python-ads-client')
    const serviceUnavailable = formatPythonAdsServiceUnavailableError(error)
    if (serviceUnavailable) {
      return NextResponse.json(
        {
          error: 'Python Ads 服务不可用',
          code: 'PYTHON_ADS_SERVICE_UNAVAILABLE',
          message: serviceUnavailable,
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      {
        error: '获取Google Ads凭证失败',
        message: error.message || '未知错误',
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
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    try {
      await assertUserCanModifyGoogleAdsAuth(userId, userId, authResult.user.role)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    // 1) 停用/清空 OAuth 凭证（google_ads_credentials）
    await deleteGoogleAdsCredentials(userId)

    console.log(`🗑️  已删除Google Ads凭证`)
    console.log(`   用户: ${authResult.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已删除',
    })
  } catch (error: any) {
    console.error('删除Google Ads凭证失败:', error)

    return NextResponse.json(
      {
        error: '删除Google Ads凭证失败',
        message: error.message || '未知错误',
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
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
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
    const authFailure = resolveGoogleAdsAuthReadyFailure(authContext)
    if (authFailure) {
      return NextResponse.json(googleAdsAuthReadyFailurePayload(authFailure), {
        status: googleAdsAuthReadyFailureHttpStatus(authFailure.reason),
      })
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
      data: { apiAccessLevel },
    })
  } catch (error: any) {
    console.error('更新API访问级别失败:', error)

    return NextResponse.json(
      {
        error: '更新API访问级别失败',
        message: error.message || '未知错误',
      },
      { status: 500 }
    )
  }
}
