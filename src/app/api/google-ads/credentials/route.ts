import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, findUserById } from '@/lib/auth'
import { deleteGoogleAdsCredentials } from '@/lib/google-ads/oauth/oauth'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import { updateApiAccessLevel } from '@/lib/google-ads/settings/access-level-detector'
import {
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
} from '@/lib/google-ads/auth/context'
import { resolveGoogleAdsCredentialFieldsForReadOnlyApi } from '@/lib/google-ads/settings/settings-store'
import {
  logGoogleAdsCredentialsError,
  logGoogleAdsCredentialsInfo,
} from '@/lib/google-ads/auth/route-logger'

const GOOGLE_ADS_CREDENTIALS_POST_DEPRECATED_MESSAGE =
  'POST /api/google-ads/credentials 已移除。请使用 PUT /api/settings（category=google_ads）保存 OAuth 配置字段，并通过「启动 OAuth 授权」完成 refresh_token 写入。'

/**
 * POST /api/google-ads/credentials
 *
 * @deprecated 已返回 410。请使用 PUT /api/settings 保存 OAuth 字段；refresh_token 由 OAuth 回调写入。
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: GOOGLE_ADS_CREDENTIALS_POST_DEPRECATED_MESSAGE,
      code: 'ENDPOINT_DEPRECATED',
      message: GOOGLE_ADS_CREDENTIALS_POST_DEPRECATED_MESSAGE,
      replacement: {
        method: 'PUT',
        path: '/api/settings',
        notes:
          '保存 google_ads 分类下的 OAuth 字段；refresh_token 由 /api/google-ads/oauth/start 与回调写入',
      },
    },
    {
      status: 410,
      headers: {
        Deprecation: 'true',
        Link: '</api/settings>; rel="successor-version"',
      },
    }
  )
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
    logGoogleAdsCredentialsError('get_credentials_failed', error)

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

    logGoogleAdsCredentialsInfo('credentials_deleted', { userId })

    return NextResponse.json({
      success: true,
      message: 'Google Ads凭证已删除',
    })
  } catch (error: any) {
    logGoogleAdsCredentialsError('delete_credentials_failed', error)

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
 * 更新 Google Ads API 访问级别。
 * 设置页仅展示自动检测结果；本接口供验证流程、内部脚本或后续管理功能调用。
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

    const authType = resolveConfiguredGoogleAdsAuthType(authContext)
    logGoogleAdsCredentialsInfo('api_access_level_updated', { userId, apiAccessLevel, authType })

    return NextResponse.json({
      success: true,
      message: 'API访问级别已更新',
      data: { apiAccessLevel },
    })
  } catch (error: any) {
    logGoogleAdsCredentialsError('update_api_access_level_failed', error)

    return NextResponse.json(
      {
        error: '更新API访问级别失败',
        message: error.message || '未知错误',
      },
      { status: 500 }
    )
  }
}
