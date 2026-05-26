import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, findUserById } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  adminHasConfiguredAuth,
  assertOwnCredentialsDifferFromAdmin,
  deleteGoogleAdsAuthAssignment,
  getGoogleAdsAuthAssignment,
  isGoogleAdsAuthShared,
  upsertGoogleAdsAuthAssignment,
  type GoogleAdsAuthAssignmentMode,
  type GoogleAdsAuthType,
} from '@/lib/google-ads-auth-assignment'
import {
  deleteGoogleAdsCredentials,
  getGoogleAdsCredentialsRaw,
  saveGoogleAdsCredentials,
  getUserAuthType,
} from '@/lib/google-ads-oauth'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'
import { encrypt } from '@/lib/crypto'
import { boolCondition } from '@/lib/db-helpers'
import { assertNoConflictingGoogleAdsAuth } from '@/lib/google-ads-auth-context'

async function requireAdmin(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user || auth.user.role !== 'admin') {
    return null
  }
  return auth.user
}

async function buildAuthStatus(userId: number) {
  const assignment = await getGoogleAdsAuthAssignment(userId)
  const auth = await getUserAuthType(userId)
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)

  let hasOAuth = false
  let hasServiceAccount = false
  let sharedAdminUsername: string | null = null
  let sharedAdminEmail: string | null = null

  const oauth = await getGoogleAdsCredentialsRaw(
    assignment?.assignmentMode === 'shared_admin' && assignment.sharedAdminUserId
      ? assignment.sharedAdminUserId
      : userId
  )
  hasOAuth = Boolean(oauth?.refresh_token)

  const serviceAccountOwnerId =
    assignment?.assignmentMode === 'shared_admin' && assignment.sharedAdminUserId
      ? assignment.sharedAdminUserId
      : userId

  const serviceAccount = await db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM google_ads_service_accounts
     WHERE user_id = ? AND ${isActiveCondition}
     ORDER BY created_at DESC LIMIT 1`,
    [serviceAccountOwnerId]
  )
  hasServiceAccount = Boolean(serviceAccount)

  if (assignment?.sharedAdminUserId) {
    const adminUser = await findUserById(assignment.sharedAdminUserId)
    sharedAdminUsername = adminUser?.username ?? null
    sharedAdminEmail = adminUser?.email ?? null
  }

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
          authType: auth.authType,
          sharedAdminUserId: null,
          sharedAdminUsername: null,
          sharedAdminEmail: null,
          configuredBy: null,
          updatedAt: null,
        },
    authType: auth.authType,
    hasOAuth,
    hasServiceAccount,
    serviceAccountId: serviceAccount?.id ?? null,
    serviceAccountName: serviceAccount?.name ?? null,
    canModify: !isGoogleAdsAuthShared(assignment),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
        { error: '数据库缺少 google_ads_auth_assignments 表，请执行 migration 250（npm run db:migrate）' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: message || '加载认证配置失败' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    return NextResponse.json({ error: 'assignmentMode 必须是 own 或 shared_admin' }, { status: 400 })
  }

  if (!authType || !['oauth', 'service_account'].includes(authType)) {
    return NextResponse.json({ error: 'authType 必须是 oauth 或 service_account' }, { status: 400 })
  }

  try {
    if (assignmentMode === 'shared_admin') {
      const adminHasAuth = await adminHasConfiguredAuth(admin.userId, authType)
      if (!adminHasAuth) {
        return NextResponse.json(
          { error: `管理员尚未配置 ${authType === 'oauth' ? 'OAuth' : '服务账号'} 认证，无法共享` },
          { status: 400 }
        )
      }

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

    // own mode - must provide new credentials
    if (authType === 'oauth') {
      const oauth = body.oauth
      if (!oauth?.client_id || !oauth?.client_secret || !oauth?.developer_token || !oauth?.login_customer_id) {
        return NextResponse.json({ error: '单独配置 OAuth 时必须填写完整凭证信息' }, { status: 400 })
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

      const db = getDatabase()
      const id = crypto.randomUUID()
      const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
      const encryptedPrivateKey = encrypt(privateKey)

      await db.exec(`DELETE FROM google_ads_service_accounts WHERE user_id = ?`, [userId])
      await db.exec(
        `INSERT INTO google_ads_service_accounts (
          id, user_id, name, mcc_customer_id, developer_token,
          service_account_email, private_key, project_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})`,
        [id, userId, sa.name, sa.mccCustomerId, sa.developerToken, clientEmail, encryptedPrivateKey, projectId]
      )
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  }

  const userId = parseInt(params.id, 10)
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: '无效的用户 ID' }, { status: 400 })
  }

  const assignment = await getGoogleAdsAuthAssignment(userId)
  if (!assignment) {
    return NextResponse.json({ error: '该用户没有认证分配记录' }, { status: 404 })
  }

  try {
    if (assignment.assignmentMode === 'own') {
      if (assignment.authType === 'oauth') {
        await deleteGoogleAdsCredentials(userId)
      } else {
        const db = getDatabase()
        await db.exec(`DELETE FROM google_ads_service_accounts WHERE user_id = ?`, [userId])
      }
    }

    await deleteGoogleAdsAuthAssignment(userId)

    return NextResponse.json({
      success: true,
      message: '已清除用户的 Google Ads 认证分配',
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '删除失败' }, { status: 500 })
  }
}
