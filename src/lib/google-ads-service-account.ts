import { getDatabase } from './db'
import { decrypt } from './crypto'
import { getGoogleAdsClient } from './google-ads-api'

/** SQLite 存 TEXT，Postgres 为 INTEGER；与 user_id 列比较时统一参数形态 */
function userIdParamForServiceAccountRow(dbType: string, userId: number): string | number {
  return dbType === 'postgres' ? userId : String(userId)
}

/**
 * 当前用户可用的服务账号：优先用户自有记录，其次全租户默认（user_id IS NULL，由管理员配置）
 */
function activeServiceAccountScopeSql(isActiveCondition: string): string {
  return `(user_id IS NULL OR user_id = ?) AND ${isActiveCondition}`
}

function preferUserOwnedServiceAccountOrderBy(): string {
  return 'CASE WHEN user_id IS NULL THEN 1 ELSE 0 END'
}

/**
 * 解析当前用户生效的服务账号 id（含全租户默认）
 */
export async function findActiveServiceAccountIdForUser(userId: number): Promise<string | undefined> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const uid = userIdParamForServiceAccountRow(db.type, userId)
  const row = await db.queryOne(
    `
    SELECT id
    FROM google_ads_service_accounts
    WHERE ${activeServiceAccountScopeSql(isActiveCondition)}
    ORDER BY ${preferUserOwnedServiceAccountOrderBy()}, created_at DESC
    LIMIT 1
  `,
    [uid]
  ) as { id: string } | undefined

  return row?.id
}

/**
 * 获取服务账号配置（从数据库）
 * 支持全租户默认（user_id IS NULL）与用户自有记录；指定 id 时须属于该用户或租户默认。
 */
export async function getServiceAccountConfig(userId: number, serviceAccountId?: string) {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const uid = userIdParamForServiceAccountRow(db.type, userId)

  let query: string
  const params: unknown[] = []

  if (serviceAccountId) {
    query = `
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id
    FROM google_ads_service_accounts
    WHERE id = ? AND ${isActiveCondition}
      AND (user_id IS NULL OR user_id = ?)
  `
    params.push(serviceAccountId, uid)
  } else {
    query = `
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id
    FROM google_ads_service_accounts
    WHERE ${activeServiceAccountScopeSql(isActiveCondition)}
    ORDER BY ${preferUserOwnedServiceAccountOrderBy()}, created_at DESC
    LIMIT 1
  `
    params.push(uid)
  }

  const account = await db.queryOne(query, params) as any

  if (!account) return null

  return {
    id: account.id,
    name: account.name,
    mccCustomerId: account.mcc_customer_id,
    developerToken: account.developer_token,
    serviceAccountEmail: account.service_account_email,
    privateKey: decrypt(account.private_key),
    projectId: account.project_id,
  }
}

/**
 * 列出与当前用户相关的服务账号：全租户默认 + 用户历史自有记录（若有）
 */
export async function listServiceAccounts(userId: number) {
  const db = await getDatabase()
  const uid = userIdParamForServiceAccountRow(db.type, userId)
  const accounts = await db.query(
    `
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at, user_id
    FROM google_ads_service_accounts
    WHERE user_id IS NULL OR user_id = ?
    ORDER BY CASE WHEN user_id IS NULL THEN 0 ELSE 1 END, created_at DESC
  `,
    [uid]
  )

  return accounts
}

export function parseServiceAccountJson(jsonContent: string) {
  const data = JSON.parse(jsonContent)

  if (!data.client_email || !data.private_key) {
    throw new Error('Invalid service account JSON: missing client_email or private_key')
  }

  return {
    clientEmail: data.client_email,
    privateKey: data.private_key,
    projectId: data.project_id
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
}): Promise<any> {
  const { authConfig, credentials } = config

  if (authConfig.authType === 'service_account') {
    const serviceAccount = await getServiceAccountConfig(authConfig.userId, authConfig.serviceAccountId)
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
      }
    }
  } else {
    if (!credentials) {
      throw new Error('OAuth 认证需要提供 credentials 参数')
    }

    const { getGoogleAdsCredentials } = await import('./google-ads-oauth')
    const oauthCredentials = await getGoogleAdsCredentials(authConfig.userId)

    if (!oauthCredentials?.refresh_token) {
      throw new Error('OAuth refresh token not found')
    }

    const client = getGoogleAdsClient(credentials)
    return client.Customer({
      customer_id: config.customerId,
      refresh_token: oauthCredentials.refresh_token,
      login_customer_id: oauthCredentials.login_customer_id,
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
}): Promise<string> {
  const { authConfig, oauthCredentials } = config

  if (authConfig.authType === 'service_account') {
    const serviceAccount = await getServiceAccountConfig(authConfig.userId, authConfig.serviceAccountId)
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }
    return serviceAccount.mccCustomerId
  } else {
    return oauthCredentials?.login_customer_id || ''
  }
}
