/**
 * Google Ads 认证分配（共享管理员 / 自有凭证 owner 解析）。
 *
 * - 按 userId 判断是否已配置：请用 `hasConfiguredGoogleAdsAuth`（委托 `google-ads-auth-context`）。
 * - 发起 Google Ads API 调用：请用 `prepareGoogleAdsApiCallForLinkedAccount` / `resolveGoogleAdsApiAuthForAccount`。
 * - 已持有 `GoogleAdsAuthContext` 时：heal/sync 前须 `googleAdsAuthContextDualStackError`。
 */
import { getDatabase } from './db'
import { boolCondition } from './db-helpers'
import type { GoogleAdsCredentials } from './google-ads-oauth'

export type GoogleAdsAuthAssignmentMode = 'own' | 'shared_admin'
export type GoogleAdsAuthType = 'oauth' | 'service_account'

export interface GoogleAdsAuthAssignment {
  userId: number
  assignmentMode: GoogleAdsAuthAssignmentMode
  sharedAdminUserId: number | null
  authType: GoogleAdsAuthType
  configuredBy: number | null
  createdAt: string
  updatedAt: string
}

export interface GoogleAdsCredentialOwnerResolution {
  ownerUserId: number
  assignment: GoogleAdsAuthAssignment | null
  isShared: boolean
}

/** Optional pre-resolved owner (avoids duplicate assignment queries in auth-context load). */
export type GoogleAdsCredentialOwnerResolutionInput = GoogleAdsCredentialOwnerResolution

type AssignmentRow = {
  user_id: number
  assignment_mode: GoogleAdsAuthAssignmentMode
  shared_admin_user_id: number | null
  auth_type: GoogleAdsAuthType
  configured_by: number | null
  created_at: string
  updated_at: string
}

function mapAssignmentRow(row: AssignmentRow): GoogleAdsAuthAssignment {
  return {
    userId: row.user_id,
    assignmentMode: row.assignment_mode,
    sharedAdminUserId: row.shared_admin_user_id,
    authType: row.auth_type,
    configuredBy: row.configured_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getGoogleAdsAuthAssignment(userId: number): Promise<GoogleAdsAuthAssignment | null> {
  const db = await getDatabase()
  const row = await db.queryOne<AssignmentRow>(
    `SELECT user_id, assignment_mode, shared_admin_user_id, auth_type, configured_by, created_at, updated_at
     FROM google_ads_auth_assignments
     WHERE user_id = ?`,
    [userId]
  )
  return row ? mapAssignmentRow(row) : null
}

export async function resolveGoogleAdsCredentialOwnerId(
  userId: number
): Promise<GoogleAdsCredentialOwnerResolution> {
  const assignment = await getGoogleAdsAuthAssignment(userId)

  if (assignment?.assignmentMode === 'shared_admin' && assignment.sharedAdminUserId) {
    return {
      ownerUserId: assignment.sharedAdminUserId,
      assignment,
      isShared: true,
    }
  }

  return {
    ownerUserId: userId,
    assignment,
    isShared: false,
  }
}

export function isGoogleAdsAuthShared(assignment: GoogleAdsAuthAssignment | null): boolean {
  return assignment?.assignmentMode === 'shared_admin'
}

export async function canUserModifyGoogleAdsAuth(
  targetUserId: number,
  actorUserId: number,
  actorRole: string
): Promise<boolean> {
  if (actorRole === 'admin') {
    return true
  }

  if (targetUserId !== actorUserId) {
    return false
  }

  const assignment = await getGoogleAdsAuthAssignment(targetUserId)
  return !isGoogleAdsAuthShared(assignment)
}

export async function assertUserCanModifyGoogleAdsAuth(
  targetUserId: number,
  actorUserId: number,
  actorRole: string
): Promise<void> {
  const allowed = await canUserModifyGoogleAdsAuth(targetUserId, actorUserId, actorRole)
  if (!allowed) {
    throw new Error('当前 Google Ads 认证配置由管理员共享，无法自行修改或删除')
  }
}

async function getRawGoogleAdsCredentials(userId: number): Promise<GoogleAdsCredentials | null> {
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const credentials = await db.queryOne<GoogleAdsCredentials>(
    `SELECT * FROM google_ads_credentials
     WHERE user_id = ? AND ${isActiveCondition}`,
    [userId]
  )
  return credentials || null
}

async function getRawActiveServiceAccount(userId: number): Promise<{
  id: string
  mcc_customer_id: string
  developer_token: string
  service_account_email: string
  api_access_level?: string | null
} | null> {
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const account = await db.queryOne<{
    id: string
    mcc_customer_id: string
    developer_token: string
    service_account_email: string
    api_access_level?: string | null
  }>(
    `SELECT id, mcc_customer_id, developer_token, service_account_email, api_access_level
     FROM google_ads_service_accounts
     WHERE user_id = ? AND ${isActiveCondition}
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )
  return account || null
}

/**
 * 解析用户的 Google Ads API 访问级别（支持管理员共享配置）
 */
export async function resolveGoogleAdsApiAccessLevel(userId: number): Promise<string | null> {
  const { ownerUserId, assignment } = await resolveGoogleAdsCredentialOwnerId(userId)

  if (assignment?.authType === 'service_account') {
    const serviceAccount = await getRawActiveServiceAccount(ownerUserId)
    return serviceAccount?.api_access_level?.toLowerCase() ?? null
  }

  const oauth = await getRawGoogleAdsCredentials(ownerUserId)
  const oauthAccessLevel = (oauth as { api_access_level?: string } | null)?.api_access_level
  if (oauthAccessLevel) {
    return String(oauthAccessLevel).toLowerCase()
  }

  // assignment 明确为 OAuth 时勿回退到服务账号级别（避免共享 OAuth 用户误展示 SA 配额）
  if (assignment?.authType === 'oauth') {
    return null
  }

  const serviceAccount = await getRawActiveServiceAccount(ownerUserId)
  return serviceAccount?.api_access_level?.toLowerCase() ?? null
}

/**
 * 是否已配置可用认证（委托 auth-context，与 FromContext / 双栈 / 共享语义一致）。
 */
export async function hasConfiguredGoogleAdsAuth(userId: number): Promise<boolean> {
  const { getGoogleAdsAuthContext, hasConfiguredGoogleAdsAuthFromContext } = await import(
    './google-ads-auth-context'
  )
  const ctx = await getGoogleAdsAuthContext(userId)
  return hasConfiguredGoogleAdsAuthFromContext(ctx)
}

export async function assertOwnCredentialsDifferFromAdmin(params: {
  targetUserId: number
  adminUserId: number
  authType: GoogleAdsAuthType
  oauth?: {
    client_id: string
    client_secret: string
    developer_token: string
    login_customer_id: string
    refresh_token?: string
  }
  serviceAccount?: {
    mccCustomerId: string
    developerToken: string
    serviceAccountEmail: string
  }
}): Promise<void> {
  const { targetUserId, adminUserId, authType } = params

  if (targetUserId === adminUserId) {
    return
  }

  if (authType === 'oauth') {
    const oauth = params.oauth
    if (!oauth) {
      throw new Error('单独配置 OAuth 时必须填写完整凭证信息')
    }

    const adminOAuth = await getRawGoogleAdsCredentials(adminUserId)
    if (!adminOAuth?.refresh_token) {
      return
    }

    const sameClientId = oauth.client_id.trim() === String(adminOAuth.client_id || '').trim()
    const sameClientSecret = oauth.client_secret.trim() === String(adminOAuth.client_secret || '').trim()
    const sameDeveloperToken = oauth.developer_token.trim() === String(adminOAuth.developer_token || '').trim()
    const sameLoginCustomerId =
      oauth.login_customer_id.replace(/[\s-]/g, '') ===
      String(adminOAuth.login_customer_id || '').replace(/[\s-]/g, '')
    const sameRefreshToken =
      oauth.refresh_token != null &&
      oauth.refresh_token.trim() === String(adminOAuth.refresh_token || '').trim()

  if (sameClientId && sameClientSecret && sameDeveloperToken && sameLoginCustomerId && sameRefreshToken) {
      throw new Error('单独配置的 OAuth 凭证不能与管理员的完全相同')
    }

    if (sameClientId && sameClientSecret && sameDeveloperToken && sameLoginCustomerId) {
      throw new Error('单独配置的 OAuth 凭证不能与管理员的完全相同')
    }

    return
  }

  const serviceAccount = params.serviceAccount
  if (!serviceAccount) {
    throw new Error('单独配置服务账号时必须填写完整凭证信息')
  }

  const adminServiceAccount = await getRawActiveServiceAccount(adminUserId)
  if (!adminServiceAccount) {
    return
  }

  const sameMcc =
    serviceAccount.mccCustomerId.replace(/[\s-]/g, '') ===
    adminServiceAccount.mcc_customer_id.replace(/[\s-]/g, '')
  const sameDeveloperToken =
    serviceAccount.developerToken.trim() === adminServiceAccount.developer_token.trim()
  const sameEmail =
    serviceAccount.serviceAccountEmail.trim().toLowerCase() ===
    adminServiceAccount.service_account_email.trim().toLowerCase()

  if (sameMcc && sameDeveloperToken && sameEmail) {
    throw new Error('单独配置的服务账号凭证不能与管理员的完全相同')
  }
}

export async function adminHasConfiguredAuth(
  adminUserId: number,
  authType: GoogleAdsAuthType
): Promise<boolean> {
  if (authType === 'oauth') {
    const oauth = await getRawGoogleAdsCredentials(adminUserId)
    return Boolean(
      oauth?.refresh_token &&
        oauth.client_id &&
        oauth.client_secret &&
        oauth.developer_token
    )
  }

  const serviceAccount = await getRawActiveServiceAccount(adminUserId)
  return Boolean(serviceAccount)
}

export async function upsertGoogleAdsAuthAssignment(params: {
  userId: number
  assignmentMode: GoogleAdsAuthAssignmentMode
  authType: GoogleAdsAuthType
  sharedAdminUserId?: number | null
  configuredBy: number
}): Promise<GoogleAdsAuthAssignment> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const existing = await getGoogleAdsAuthAssignment(params.userId)

  if (existing) {
    await db.exec(
      `UPDATE google_ads_auth_assignments
       SET assignment_mode = ?,
           shared_admin_user_id = ?,
           auth_type = ?,
           configured_by = ?,
           updated_at = ${nowFunc}
       WHERE user_id = ?`,
      [
        params.assignmentMode,
        params.sharedAdminUserId ?? null,
        params.authType,
        params.configuredBy,
        params.userId,
      ]
    )
  } else {
    await db.exec(
      `INSERT INTO google_ads_auth_assignments (
         user_id, assignment_mode, shared_admin_user_id, auth_type, configured_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})`,
      [
        params.userId,
        params.assignmentMode,
        params.sharedAdminUserId ?? null,
        params.authType,
        params.configuredBy,
      ]
    )
  }

  const updated = await getGoogleAdsAuthAssignment(params.userId)
  if (!updated) {
    throw new Error('保存 Google Ads 认证分配失败')
  }
  return updated
}

export async function deleteGoogleAdsAuthAssignment(userId: number): Promise<void> {
  const db = await getDatabase()
  await db.exec(`DELETE FROM google_ads_auth_assignments WHERE user_id = ?`, [userId])
}

const GOOGLE_ADS_SETTING_KEYS = [
  'client_id',
  'client_secret',
  'developer_token',
  'login_customer_id',
  'use_service_account',
]

/**
 * 永久删除用户时清理其 Google Ads 认证相关数据。
 * 同时移除其他用户对该用户（作为共享管理员）的认证分配。
 */
export async function purgeGoogleAdsAuthConfigForUser(userId: number): Promise<void> {
  const db = await getDatabase()

  await db.exec(
    `DELETE FROM google_ads_auth_assignments WHERE user_id = ? OR shared_admin_user_id = ?`,
    [userId, userId]
  )

  await db.exec(`DELETE FROM google_ads_credentials WHERE user_id = ?`, [userId])
  await db.exec(`DELETE FROM google_ads_service_accounts WHERE user_id = ?`, [userId])

  try {
    await db.exec(`DELETE FROM google_ads_test_credentials WHERE user_id = ?`, [userId])
  } catch {
    // 表不存在时忽略（兼容旧库或未跑对应 migration）
  }

  const placeholders = GOOGLE_ADS_SETTING_KEYS.map(() => '?').join(', ')
  await db.exec(
    `
      DELETE FROM system_settings
      WHERE user_id = ?
        AND category = 'google_ads'
        AND key IN (${placeholders})
    `,
    [userId, ...GOOGLE_ADS_SETTING_KEYS]
  )
}
