import { getDatabase } from './db'
import { decrypt } from './crypto'
import { getGoogleAdsClient } from './google-ads-api'

/**
 * 获取服务账号配置（从数据库）
 */
export async function getServiceAccountConfig(userId: number, serviceAccountId?: string) {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  let query = `
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id
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
 * 列出用户的所有服务账号配置
 */
export async function listServiceAccounts(userId: number) {
  const db = await getDatabase()
  const accounts = await db.query(`
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at
    FROM google_ads_service_accounts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId])

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
