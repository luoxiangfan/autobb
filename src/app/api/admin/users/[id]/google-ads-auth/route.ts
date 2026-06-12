import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, findUserById } from '@/lib/auth'
import {
  adminHasConfiguredAuth,
  assertOwnCredentialsDifferFromAdmin,
  deleteGoogleAdsAuthAssignment,
  getGoogleAdsAuthAssignment,
  upsertGoogleAdsAuthAssignment,
  type GoogleAdsAuthAssignmentMode,
  type GoogleAdsAuthType,
} from '@/lib/google-ads/auth/assignment'
import { deleteGoogleAdsCredentials, saveGoogleAdsCredentials } from '@/lib/google-ads/oauth/oauth'
import {
  deleteAllGoogleAdsServiceAccountsForUser,
  parseServiceAccountJson,
  replaceGoogleAdsServiceAccountForUser,
} from '@/lib/google-ads/service-account/service-account'
import { encrypt } from '@/lib/crypto'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContextMetadata,
  googleAdsAuthContextDualStackError,
  googleAdsAuthReadyFailurePayload,
  hasConfiguredGoogleAdsAuthFromContext,
  oauthCredentialFieldsPresentFromContext,
  resolveGoogleAdsCredentialStatusSummary,
  resolveGoogleAdsDisplayAuthType,
} from '@/lib/google-ads/auth/context'

async function requireAdmin(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user || auth.user.role !== 'admin') {
    return null
  }
  return auth.user
}

/** 清除用户自有凭证（双栈时 OAuth + SA 均删；含半成品 OAuth 行） */
async function clearOwnGoogleAdsCredentialsForUser(userId: number): Promise<'cleared' | 'none'> {
  const ctx = await getGoogleAdsAuthContextMetadata(userId)
  const summary = resolveGoogleAdsCredentialStatusSummary(ctx)
  const hasOAuthFields = oauthCredentialFieldsPresentFromContext(ctx)
  const hasServiceAccount = summary.hasServiceAccount

  if (!hasOAuthFields && !hasServiceAccount) {
    return 'none'
  }

  if (ctx.dualStack || hasOAuthFields) {
    await deleteGoogleAdsCredentials(userId)
  }
  if (ctx.dualStack || hasServiceAccount) {
    await deleteAllGoogleAdsServiceAccountsForUser(userId)
  }

  return 'cleared'
}

async function buildAuthStatus(userId: number) {
  const ctx = await getGoogleAdsAuthContextMetadata(userId)
  const assignment = ctx.assignment
  const summary = resolveGoogleAdsCredentialStatusSummary(ctx)

  let sharedAdminUsername: string | null = null
  let sharedAdminEmail: string | null = null
  if (assignment?.sharedAdminUserId) {
    const adminUser = await findUserById(assignment.sharedAdminUserId)
    sharedAdminUsername = adminUser?.username ?? null
    sharedAdminEmail = adminUser?.email ?? null
  }

  const configured = hasConfiguredGoogleAdsAuthFromContext(ctx)
  const displayAuthType = resolveGoogleAdsDisplayAuthType(ctx)

  return {
    assignment: assignment
      ? {
          assignmentMode: assignment.assignmentMode,
          authType: assignment.authType,
          sharedAdminUserId: assignment.sharedAdminUserId,
          sharedAdminUsername,
          sharedAdminEmail,
          configuredBy: assignment.configuredBy,
          updatedAt: assignment.updatedAt,
        }
      : {
          assignmentMode: 'own' as GoogleAdsAuthAssignmentMode,
          authType: displayAuthType ?? ctx.auth.authType,
          sharedAdminUserId: null,
          sharedAdminUsername: null,
          sharedAdminEmail: null,
          configuredBy: null,
          updatedAt: null,
        },
    authType: displayAuthType,
    hasOAuth: oauthCredentialFieldsPresentFromContext(ctx),
    hasRefreshToken: summary.hasRefreshToken,
    hasServiceAccount: summary.hasServiceAccount,
    serviceAccountId: summary.serviceAccountId,
    serviceAccountName: summary.serviceAccountName,
    hasConfigured: configured,
    canModify: ctx.canModify,
    dualStack: ctx.dualStack,
    authConfigWarning: googleAdsAuthContextDualStackError(ctx),
  }
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const userId = parseInt(params.id, 10)
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  const targetUser = await findUserById(userId)
  if (!targetUser) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }

  try {
    const status = await buildAuthStatus(userId)
    return NextResponse.json({ success: true, data: status })
  } catch (error: any) {
    console.error('[admin/google-ads-auth] GET failed:', error)
    const message = String(error?.message || '')
    if (message.includes('google_ads_auth_assignments') || message.includes('no such table')) {
      return NextResponse.json(
        {
          error:
            '数据库缺少 google_ads_auth_assignments 表，请执行 migration 250（npm run db:migrate）',
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: message || '加载认证配置失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const userId = parseInt(params.id, 10)
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  if (userId === admin.userId) {
    return NextResponse.json({ error: '不能通过此接口修改管理员自身的认证分配' }, { status: 400 })
  }

  const targetUser = await findUserById(userId)
  if (!targetUser) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }

  const body = await request.json()
  const assignmentMode = body.assignmentMode as GoogleAdsAuthAssignmentMode
  const authType = body.authType as GoogleAdsAuthType

  if (!assignmentMode || !['own', 'shared_admin'].includes(assignmentMode)) {
    return NextResponse.json(
      { error: 'assignmentMode 必须是 own 或 shared_admin' },
      { status: 400 }
    )
  }

  if (!authType || !['oauth', 'service_account'].includes(authType)) {
    return NextResponse.json({ error: 'authType 必须是 oauth 或 service_account' }, { status: 400 })
  }

  try {
    if (assignmentMode === 'shared_admin') {
      const adminHasAuth = await adminHasConfiguredAuth(admin.userId, authType)
      if (!adminHasAuth) {
        return NextResponse.json(
          {
            error: `管理员尚未配置 ${authType === 'oauth' ? 'OAuth' : '服务账号'} 认证，无法共享（请确认管理员已完成授权且无双栈冲突）`,
          },
          { status: 400 }
        )
      }

      // 先清子用户 orphan 凭证，再共享（避免本地双栈阻挡 assignment）
      await clearOwnGoogleAdsCredentialsForUser(userId)

      await upsertGoogleAdsAuthAssignment({
        userId,
        assignmentMode: 'shared_admin',
        authType,
        sharedAdminUserId: admin.userId,
        configuredBy: admin.userId,
      })

      return NextResponse.json({
        success: true,
        message: '已设置为共享管理员认证配置',
        data: await buildAuthStatus(userId),
      })
    }

    const targetCtx = await getGoogleAdsAuthContextMetadata(userId)
    const dualStackError = googleAdsAuthContextDualStackError(targetCtx)
    if (dualStackError) {
      return NextResponse.json(
        {
          ...googleAdsAuthReadyFailurePayload({
            reason: 'dual_stack',
            message: dualStackError,
          }),
        },
        { status: 409 }
      )
    }

    // own mode - must provide new credentials
    if (authType === 'oauth') {
      const oauth = body.oauth
      if (
        !oauth?.client_id ||
        !oauth?.client_secret ||
        !oauth?.developer_token ||
        !oauth?.login_customer_id
      ) {
        return NextResponse.json(
          { error: '单独配置 OAuth 时必须填写完整凭证信息' },
          { status: 400 }
        )
      }

      await assertOwnCredentialsDifferFromAdmin({
        targetUserId: userId,
        adminUserId: admin.userId,
        authType: 'oauth',
        oauth: {
          client_id: oauth.client_id,
          client_secret: oauth.client_secret,
          developer_token: oauth.developer_token,
          login_customer_id: oauth.login_customer_id,
          refresh_token: oauth.refresh_token,
        },
      })

      if (!oauth.refresh_token) {
        return NextResponse.json(
          { error: '单独配置 OAuth 需要 refresh_token，请完成 OAuth 授权后保存' },
          { status: 400 }
        )
      }

      try {
        await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
      } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      await saveGoogleAdsCredentials(userId, {
        client_id: oauth.client_id,
        client_secret: oauth.client_secret,
        refresh_token: oauth.refresh_token,
        developer_token: oauth.developer_token,
        login_customer_id: oauth.login_customer_id,
        access_token: oauth.access_token,
        access_token_expires_at: oauth.access_token_expires_at,
      })
    } else {
      const sa = body.serviceAccount
      if (!sa?.name || !sa?.mccCustomerId || !sa?.developerToken || !sa?.serviceAccountJson) {
        return NextResponse.json({ error: '单独配置服务账号时必须填写完整信息' }, { status: 400 })
      }

      const { clientEmail, privateKey, projectId } = parseServiceAccountJson(sa.serviceAccountJson)

      await assertOwnCredentialsDifferFromAdmin({
        targetUserId: userId,
        adminUserId: admin.userId,
        authType: 'service_account',
        serviceAccount: {
          mccCustomerId: sa.mccCustomerId,
          developerToken: sa.developerToken,
          serviceAccountEmail: clientEmail,
        },
      })

      try {
        await assertNoConflictingGoogleAdsAuth(userId, 'service_account')
      } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      const encryptedPrivateKey = encrypt(privateKey)

      await replaceGoogleAdsServiceAccountForUser(userId, {
        name: sa.name,
        mccCustomerId: sa.mccCustomerId,
        developerToken: sa.developerToken,
        serviceAccountEmail: clientEmail,
        encryptedPrivateKey,
        projectId: projectId ?? null,
      })
    }

    await upsertGoogleAdsAuthAssignment({
      userId,
      assignmentMode: 'own',
      authType,
      sharedAdminUserId: null,
      configuredBy: admin.userId,
    })

    return NextResponse.json({
      success: true,
      message: '已保存用户独立认证配置',
      data: await buildAuthStatus(userId),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '保存失败' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const userId = parseInt(params.id, 10)
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  const assignment = await getGoogleAdsAuthAssignment(userId)

  try {
    if (assignment) {
      // own / shared_admin 均清除子用户 userId 上的自有凭证（共享时 ctx 可能指向管理员凭证）
      await clearOwnGoogleAdsCredentialsForUser(userId)

      await deleteGoogleAdsAuthAssignment(userId)

      return NextResponse.json({
        success: true,
        message: '已清除用户的 Google Ads 认证分配',
      })
    }

    const cleared = await clearOwnGoogleAdsCredentialsForUser(userId)
    if (cleared === 'none') {
      return NextResponse.json({ error: '该用户没有 Google Ads 认证配置' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: '已清除用户的 Google Ads 认证配置',
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '删除失败' }, { status: 500 })
  }
}
