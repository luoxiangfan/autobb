import { getDatabase } from './db'
import { boolCondition } from './db-helpers'
import { decrypt } from './crypto'
import { getGoogleAdsClient } from './google-ads-api'
import {
  resolveGoogleAdsCredentialOwnerId,
  type GoogleAdsCredentialOwnerResolutionInput,
} from './google-ads-auth-assignment'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'

/**
 * 获取指定用户自身的服务账号配置（不解析共享分配）
 */
export async function getOwnServiceAccountConfigForBackup(userId: number) {
  return getServiceAccountConfigRaw(userId)
}

async function getServiceAccountConfigRaw(userId: number, serviceAccountId?: string) {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  let query = `
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id,
           api_access_level, created_at, updated_at
    FROM google_ads_service_accounts
    WHERE user_id = ? AND ${isActiveCondition}
  `
  const params: any[] = [userId]

  if (serviceAccountId) {
    query += ' AND id = ?'
    params.push(serviceAccountId)
  } else {
    query += ' ORDER BY created_at DESC LIMIT 1'
  }

  const account = (await db.queryOne(query, params)) as any

  if (!account) return null

  return {
    id: account.id,
    name: account.name,
    mccCustomerId: account.mcc_customer_id,
    developerToken: account.developer_token,
    serviceAccountEmail: account.service_account_email,
    privateKey: decrypt(account.private_key),
    projectId: account.project_id,
    apiAccessLevel: account.api_access_level
      ? String(account.api_access_level).toLowerCase()
      : undefined,
    createdAt: account.created_at as string | undefined,
    updatedAt: account.updated_at as string | undefined,
  }
}

/**
 * 获取服务账号配置（解析管理员共享配置）
 */
export async function getServiceAccountConfig(
  userId: number,
  serviceAccountId?: string,
  resolved?: GoogleAdsCredentialOwnerResolutionInput
) {
  const { ownerUserId, assignment } = resolved ?? (await resolveGoogleAdsCredentialOwnerId(userId))

  if (assignment?.assignmentMode === 'shared_admin' && assignment.authType === 'oauth') {
    return null
  }

  return getServiceAccountConfigRaw(ownerUserId, serviceAccountId)
}

/** metadata-only：不读取/解密 private_key、developer_token */
async function getServiceAccountConfigMetadataRaw(userId: number, serviceAccountId?: string) {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  let query = `
    SELECT id, name, mcc_customer_id, service_account_email, project_id,
           api_access_level, created_at, updated_at
    FROM google_ads_service_accounts
    WHERE user_id = ? AND ${isActiveCondition}
  `
  const params: Array<string | number> = [userId]

  if (serviceAccountId) {
    query += ' AND id = ?'
    params.push(serviceAccountId)
  } else {
    query += ' ORDER BY created_at DESC LIMIT 1'
  }

  const account = (await db.queryOne(query, params)) as
    | {
        id: string
        name: string
        mcc_customer_id: string
        service_account_email: string
        project_id: string | null
        api_access_level: string | null
        created_at: string
        updated_at: string
      }
    | undefined

  if (!account) {
    return null
  }

  return {
    id: account.id,
    name: account.name,
    mccCustomerId: account.mcc_customer_id,
    developerToken: null as unknown as string,
    serviceAccountEmail: account.service_account_email,
    privateKey: null as unknown as string,
    projectId: account.project_id ?? undefined,
    apiAccessLevel: account.api_access_level
      ? String(account.api_access_level).toLowerCase()
      : undefined,
    createdAt: account.created_at,
    updatedAt: account.updated_at,
  }
}

/**
 * metadata-only 服务账号配置（解析共享管理员）
 */
export async function getServiceAccountConfigMetadata(
  userId: number,
  serviceAccountId?: string,
  resolved?: GoogleAdsCredentialOwnerResolutionInput
) {
  const { ownerUserId, assignment } = resolved ?? (await resolveGoogleAdsCredentialOwnerId(userId))

  if (assignment?.assignmentMode === 'shared_admin' && assignment.authType === 'oauth') {
    return null
  }

  return getServiceAccountConfigMetadataRaw(ownerUserId, serviceAccountId)
}

/**
 * 列出用户的所有服务账号配置
 */
export async function listServiceAccounts(userId: number) {
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(userId)
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const accounts = await db.query(
    `
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at
    FROM google_ads_service_accounts
    WHERE user_id = ? AND ${isActiveCondition}
    ORDER BY created_at DESC
  `,
    [ownerUserId]
  )

  return accounts
}

export type ReplaceGoogleAdsServiceAccountParams = {
  name: string
  mccCustomerId: string
  developerToken: string
  serviceAccountEmail: string
  encryptedPrivateKey: string
  projectId: string | null
}

/** 替换用户的服务账号（仅保留 1 个）并失效 auth-context 缓存 */
export async function replaceGoogleAdsServiceAccountForUser(
  userId: number,
  params: ReplaceGoogleAdsServiceAccountParams
): Promise<string> {
  const db = await getDatabase()
  const { nowFunc } = await import('./db-helpers')
  const nowSql = nowFunc(db.type)
  const id = crypto.randomUUID()

  await db.exec(`DELETE FROM google_ads_service_accounts WHERE user_id = ?`, [userId])
  await db.exec(
    `INSERT INTO google_ads_service_accounts (
      id, user_id, name, mcc_customer_id, developer_token,
      service_account_email, private_key, project_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowSql}, ${nowSql})`,
    [
      id,
      userId,
      params.name,
      params.mccCustomerId,
      params.developerToken,
      params.serviceAccountEmail,
      params.encryptedPrivateKey,
      params.projectId,
    ]
  )

  const { invalidateGoogleAdsAuthContextForCredentialUser } =
    await import('./google-ads-auth-context')
  await invalidateGoogleAdsAuthContextForCredentialUser(userId)
  return id
}

/** 按 id 删除用户的服务账号并失效 auth-context 缓存 */
export async function deleteGoogleAdsServiceAccountForUser(
  userId: number,
  serviceAccountId: string
): Promise<void> {
  const db = await getDatabase()
  await db.exec(`DELETE FROM google_ads_service_accounts WHERE id = ? AND user_id = ?`, [
    serviceAccountId,
    userId,
  ])

  const { invalidateGoogleAdsAuthContextForCredentialUser } =
    await import('./google-ads-auth-context')
  await invalidateGoogleAdsAuthContextForCredentialUser(userId)
}

/** 删除用户全部服务账号并失效 auth-context 缓存 */
export async function deleteAllGoogleAdsServiceAccountsForUser(userId: number): Promise<void> {
  const db = await getDatabase()
  await db.exec(`DELETE FROM google_ads_service_accounts WHERE user_id = ?`, [userId])

  const { invalidateGoogleAdsAuthContextForCredentialUser } =
    await import('./google-ads-auth-context')
  await invalidateGoogleAdsAuthContextForCredentialUser(userId)
}

export function parseServiceAccountJson(jsonContent: string) {
  const data = JSON.parse(jsonContent)

  if (!data.client_email || !data.private_key) {
    throw new Error('Invalid service account JSON: missing client_email or private_key')
  }

  return {
    clientEmail: data.client_email,
    privateKey: data.private_key,
    projectId: data.project_id,
  }
}

/**
 * 认证类型
 */
export type AuthType = 'oauth' | 'service_account'

/**
 * 统一认证配置
 */
export interface UnifiedAuthConfig {
  authType: AuthType
  userId: number
  serviceAccountId?: string
}

/** 双栈等无效配置时抛错；OAuth 路径可复用返回的 context 避免重复加载。 */
async function loadGoogleAdsAuthContextForUnifiedClient(userId: number) {
  const { assertGoogleAdsAuthReadyForApi } = await import('./google-ads-auth-context')
  return assertGoogleAdsAuthReadyForApi(userId)
}

async function resolveAuthContextForUnifiedClient(
  userId: number,
  authContext?: GoogleAdsAuthContext
): Promise<GoogleAdsAuthContext> {
  if (authContext) {
    const { googleAdsAuthContextDualStackError } = await import('./google-ads-auth-context')
    const dualStackError = googleAdsAuthContextDualStackError(authContext)
    if (dualStackError) {
      throw new Error(dualStackError)
    }
    return authContext
  }
  return loadGoogleAdsAuthContextForUnifiedClient(userId)
}

/**
 * 获取统一的 Google Ads 客户端
 * 根据认证类型自动选择 OAuth 或服务账号认证
 *
 * @returns 兼容两种认证模式的 Google Ads 客户端
 *   - OAuth 模式: 返回 google-ads-api 的 Customer 实例
 *   - 服务账号模式: 返回 Python 代理对象
 */
export async function getUnifiedGoogleAdsClient(config: {
  customerId: string
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
  }
  authConfig: UnifiedAuthConfig
  /** 路由层已解析时传入，避免重复加载 auth-context */
  oauthRefreshToken?: string
  oauthLoginCustomerId?: string
  /** 调用方已 assert 时传入，避免重复加载 auth-context */
  authContext?: GoogleAdsAuthContext
}): Promise<any> {
  const { authConfig, credentials } = config
  const authCtx = await resolveAuthContextForUnifiedClient(authConfig.userId, config.authContext)

  if (authConfig.authType === 'service_account') {
    const serviceAccount = await getServiceAccountConfig(
      authConfig.userId,
      authConfig.serviceAccountId
    )
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }

    // 返回 Python 服务代理对象
    return {
      _isPythonProxy: true,
      _serviceAccount: serviceAccount,
      _userId: authConfig.userId,
      _serviceAccountId: authConfig.serviceAccountId,
      _customerId: config.customerId,

      async query(query: string) {
        const { executeGAQLQueryPython } = await import('./python-ads-client')
        return executeGAQLQueryPython({
          userId: authConfig.userId,
          serviceAccountId: authConfig.serviceAccountId,
          customerId: config.customerId,
          query,
        })
      },
    }
  } else {
    if (!credentials) {
      throw new Error('OAuth 认证需要提供 credentials 参数')
    }

    let refreshToken =
      config.oauthRefreshToken?.trim() || authCtx.oauthCredentials?.refresh_token || ''
    let loginCustomerId =
      config.oauthLoginCustomerId?.trim() || authCtx.oauthCredentials?.login_customer_id || ''

    if (!refreshToken) {
      throw new Error('OAuth refresh token not found')
    }

    const client = getGoogleAdsClient(credentials)
    return client.Customer({
      customer_id: config.customerId,
      refresh_token: refreshToken,
      login_customer_id: loginCustomerId,
    })
  }
}

/**
 * 获取登录客户ID（MCC账户ID）
 */
export async function getLoginCustomerId(config: {
  authConfig: UnifiedAuthConfig
  oauthCredentials?: {
    login_customer_id: string
  }
  authContext?: GoogleAdsAuthContext
}): Promise<string> {
  const { authConfig, oauthCredentials } = config
  const authCtx = await resolveAuthContextForUnifiedClient(authConfig.userId, config.authContext)

  if (authConfig.authType === 'service_account') {
    const serviceAccount = await getServiceAccountConfig(
      authConfig.userId,
      authConfig.serviceAccountId
    )
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }
    return serviceAccount.mccCustomerId
  }

  const fromParam = oauthCredentials?.login_customer_id?.trim()
  if (fromParam) {
    return fromParam
  }

  return authCtx.oauthCredentials?.login_customer_id?.trim() || ''
}
