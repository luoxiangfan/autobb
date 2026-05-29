import { getDatabase } from './db'
import { boolCondition } from './db-helpers'
import {
  resolveGoogleAdsCredentialOwnerId,
  type GoogleAdsCredentialOwnerResolutionInput,
} from './google-ads-auth-assignment'

/**
 * 获取用户的 Google Ads 授权方式（产品上 OAuth / 服务账号二选一，切换前须删除另一种配置）。
 *
 * 检测顺序：有有效 OAuth refresh_token 则视为 oauth，否则若有活跃服务账号则视为 service_account。
 * 若 DB 中残留两种凭证（未按设置页删除），会优先判定为 oauth；业务代码应依赖设置页与 assignment，勿实现双栈回退。
 * 支持管理员共享认证配置。
 */
export async function getUserAuthType(
  userId: number,
  resolved?: GoogleAdsCredentialOwnerResolutionInput
): Promise<{
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
}> {
  const db = await getDatabase()
  const { ownerUserId, assignment } =
    resolved ?? (await resolveGoogleAdsCredentialOwnerId(userId))
  const isActiveCondition = boolCondition('is_active', true, db.type)

  if (assignment?.assignmentMode === 'shared_admin') {
    if (assignment.authType === 'service_account') {
      const serviceAccount = await db.queryOne(
        `SELECT id FROM google_ads_service_accounts
         WHERE user_id = ? AND ${isActiveCondition}
         ORDER BY created_at DESC LIMIT 1`,
        [ownerUserId]
      ) as { id: string } | undefined

      if (serviceAccount) {
        return { authType: 'service_account', serviceAccountId: serviceAccount.id }
      }
      return { authType: 'service_account' }
    }

    const credentials = await db.queryOne(
      `SELECT refresh_token FROM google_ads_credentials WHERE user_id = ? AND ${isActiveCondition}`,
      [ownerUserId]
    ) as { refresh_token: string | null } | undefined

    if (credentials?.refresh_token) {
      return { authType: 'oauth' }
    }
    return { authType: 'oauth' }
  }

  const credentials = await db.queryOne(
    `SELECT refresh_token FROM google_ads_credentials WHERE user_id = ? AND ${isActiveCondition}`,
    [ownerUserId]
  ) as { refresh_token: string | null } | undefined

  if (credentials?.refresh_token) {
    return { authType: 'oauth' }
  }

  const serviceAccount = await db.queryOne(
    `SELECT id FROM google_ads_service_accounts
     WHERE user_id = ? AND ${isActiveCondition}
     ORDER BY created_at DESC LIMIT 1`,
    [ownerUserId]
  ) as { id: string } | undefined

  if (serviceAccount) {
    return { authType: 'service_account', serviceAccountId: serviceAccount.id }
  }

  if (assignment?.authType === 'service_account') {
    return { authType: 'service_account' }
  }

  return { authType: 'oauth' }
}

/**
 * 格式化并验证 Google Ads 客户 ID
 * 移除空格和横杠，确保是10位数字字符串
 * @throws Error 如果格式无效
 */
export function formatAndValidateLoginCustomerId(id: string, fieldName: string = 'login_customer_id'): string {
  // 移除空格和横杠
  const formatted = id.replace(/[\s-]/g, '')
  // 验证必须是10位数字
  if (!formatted || !/^\d{10}$/.test(formatted)) {
    throw new Error(`${fieldName} 必须是10位数字（格式：1234567890），当前值: '${id}'`)
  }
  return formatted
}

/**
 * Google Ads OAuth凭证接口
 * 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须配置自己的完整凭证
 */
export interface GoogleAdsCredentials {
  id: number
  user_id: number
  client_id: string         // 必填 - 独立账号模式，每用户独立配置
  client_secret: string     // 必填 - 独立账号模式，每用户独立配置
  refresh_token: string
  access_token?: string
  developer_token: string   // 必填 - 独立账号模式，每用户独立配置
  login_customer_id: string // 必填 - MCC账户ID
  access_token_expires_at?: string
  is_active: number
  last_verified_at?: string
  created_at: string
  updated_at: string
}

/**
 * 保存或更新Google Ads凭证
 * 🔧 修复(2025-12-12): 独立账号模式 - 所有凭证字段必填
 * 🔧 修复(2025-12-26): 验证 login_customer_id 格式
 */
export async function saveGoogleAdsCredentials(
  userId: number,
  credentials: {
    client_id: string          // 必填 - 独立账号模式
    client_secret: string      // 必填 - 独立账号模式
    refresh_token: string
    developer_token: string    // 必填 - 独立账号模式
    login_customer_id: string  // 必填 - MCC账户ID
    access_token?: string
    access_token_expires_at?: string
  }
): Promise<GoogleAdsCredentials> {
  const db = await getDatabase()

  // 🔧 修复(2026-01-15): 清理凭证中的前后空格/换行
  // 避免出现 "The developer token is not valid." 这类由多余空白字符触发的错误
  const cleanedCredentials = {
    client_id: String(credentials.client_id ?? '').trim(),
    client_secret: String(credentials.client_secret ?? '').trim(),
    refresh_token: String(credentials.refresh_token ?? '').trim(),
    developer_token: String(credentials.developer_token ?? '').trim(),
    login_customer_id: String(credentials.login_customer_id ?? '').trim(),
    access_token: credentials.access_token ? String(credentials.access_token).trim() : undefined,
    access_token_expires_at: credentials.access_token_expires_at,
  }

  // 🔧 修复(2025-12-26): 验证并格式化 login_customer_id
  const formattedLoginCustomerId = formatAndValidateLoginCustomerId(cleanedCredentials.login_customer_id, 'login_customer_id')

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 🔧 PostgreSQL兼容性：is_active 在 PostgreSQL 是 BOOLEAN，在 SQLite 是 INTEGER
  const isActiveValue = db.type === 'postgres' ? true : 1

  // 检查是否已存在
  const existing = await db.queryOne<GoogleAdsCredentials>(`
    SELECT * FROM google_ads_credentials WHERE user_id = ?
  `, [userId])

  if (existing) {
    // 更新现有记录
    await db.exec(`
      UPDATE google_ads_credentials
      SET client_id = ?,
          client_secret = ?,
          refresh_token = ?,
          developer_token = ?,
          login_customer_id = ?,
          access_token = ?,
          access_token_expires_at = ?,
          is_active = ?,
          last_verified_at = ${nowFunc},
          updated_at = ${nowFunc}
      WHERE user_id = ?
    `, [
      cleanedCredentials.client_id,
      cleanedCredentials.client_secret,
      cleanedCredentials.refresh_token,         // 🔧 修复：正确的参数顺序
      cleanedCredentials.developer_token,       // 🔧 修复：正确的参数顺序
      formattedLoginCustomerId,          // 🔧 修复：正确的参数顺序
      cleanedCredentials.access_token || null,
      cleanedCredentials.access_token_expires_at || null,
      isActiveValue,
      userId
    ])
  } else {
    // 插入新记录
    await db.exec(`
      INSERT INTO google_ads_credentials (
        user_id, client_id, client_secret, refresh_token,
        developer_token, login_customer_id, access_token, access_token_expires_at,
        last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})
    `, [
      userId,
      cleanedCredentials.client_id,
      cleanedCredentials.client_secret,
      cleanedCredentials.refresh_token,
      cleanedCredentials.developer_token,
      formattedLoginCustomerId,  // 使用格式化后的值
      cleanedCredentials.access_token || null,
      cleanedCredentials.access_token_expires_at || null
    ])
  }

  const updated = await getGoogleAdsCredentials(userId)
  if (!updated) {
    throw new Error('保存Google Ads凭证失败')
  }

  return updated
}

/**
 * 获取指定用户自身的 Google Ads OAuth 凭证（不解析共享分配）
 */
export async function getGoogleAdsCredentialsRaw(userId: number): Promise<GoogleAdsCredentials | null> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  const credentials = await db.queryOne<GoogleAdsCredentials>(`
    SELECT * FROM google_ads_credentials
    WHERE user_id = ? AND ${isActiveCondition}
  `, [userId])

  return credentials || null
}

/**
 * 获取用户的Google Ads凭证（解析管理员共享配置）
 */
export async function getGoogleAdsCredentials(
  userId: number,
  resolved?: GoogleAdsCredentialOwnerResolutionInput
): Promise<GoogleAdsCredentials | null> {
  const { ownerUserId, assignment } =
    resolved ?? (await resolveGoogleAdsCredentialOwnerId(userId))

  if (assignment?.assignmentMode === 'shared_admin' && assignment.authType === 'service_account') {
    return null
  }

  return getGoogleAdsCredentialsRaw(ownerUserId)
}

/**
 * 删除Google Ads凭证
 */
export async function deleteGoogleAdsCredentials(userId: number): Promise<void> {
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 🔧 PostgreSQL兼容性：is_active 在 PostgreSQL 是 BOOLEAN，在 SQLite 是 INTEGER
  const isActiveValue = db.type === 'postgres' ? false : 0

  await db.exec(`
    UPDATE google_ads_credentials
    SET is_active = ?,
        client_id = '',
        client_secret = '',
        developer_token = '',
        login_customer_id = NULL,
        refresh_token = '',
        access_token = NULL,
        access_token_expires_at = NULL,
        last_verified_at = NULL,
        updated_at = ${nowFunc}
    WHERE user_id = ?
  `, [isActiveValue, userId])
}

/**
 * 刷新Access Token
 */
export async function refreshAccessToken(userId: number): Promise<{
  access_token: string
  expires_at: string
}> {
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(userId)
  const credentials = await getGoogleAdsCredentialsRaw(ownerUserId)
  if (!credentials) {
    throw new Error('Google Ads凭证不存在')
  }

  // 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须有自己的完整凭证
  // 不再回退到平台共享配置或管理员配置
  const clientId = credentials.client_id
  const clientSecret = credentials.client_secret
  const refreshToken = credentials.refresh_token

  if (!clientId || !clientSecret) {
    throw new Error('缺少 Client ID 或 Client Secret，请在设置中完成 Google Ads API 配置')
  }

  if (!refreshToken) {
    throw new Error('缺少 Refresh Token，请完成 OAuth 授权')
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`刷新Access Token失败: ${error}`)
  }

  const data = await tokenResponse.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // 更新数据库
  const db = await getDatabase()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  await db.exec(`
    UPDATE google_ads_credentials
    SET access_token = ?,
        access_token_expires_at = ?,
        updated_at = ${nowFunc}
    WHERE user_id = ?
  `, [data.access_token, expiresAt, ownerUserId])

  return {
    access_token: data.access_token,
    expires_at: expiresAt,
  }
}

/**
 * 获取有效的Access Token（如果过期则自动刷新）
 */
export async function getValidAccessToken(userId: number): Promise<string> {
  const credentials = await getGoogleAdsCredentials(userId)
  if (!credentials) {
    throw new Error('Google Ads凭证不存在')
  }

  // 检查是否需要刷新
  if (!credentials.access_token || !credentials.access_token_expires_at) {
    const refreshed = await refreshAccessToken(userId)
    return refreshed.access_token
  }

  const expiresAt = new Date(credentials.access_token_expires_at)
  const now = new Date()

  // 提前5分钟刷新
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(userId)
    return refreshed.access_token
  }

  return credentials.access_token
}

/**
 * 验证 Google Ads 凭证是否有效（OAuth / 服务账号二选一，经 auth-context 解析）。
 */
export async function verifyGoogleAdsCredentials(userId: number): Promise<{
  valid: boolean
  customer_id?: string
  error?: string
  authType?: 'oauth' | 'service_account'
}> {
  try {
    const {
      getGoogleAdsAuthContext,
      googleAdsApiAuthValidationErrorMessage,
      resolveGoogleAdsApiAuthForAccount,
      GOOGLE_ADS_DUAL_STACK_WARNING,
    } = await import('./google-ads-auth-context')

    const resolved = await resolveGoogleAdsApiAuthForAccount(userId, null)
    if (!resolved.ok) {
      const ctx = await getGoogleAdsAuthContext(userId)
      return {
        valid: false,
        error: ctx.dualStack
          ? GOOGLE_ADS_DUAL_STACK_WARNING
          : googleAdsApiAuthValidationErrorMessage(resolved.reason),
        authType: undefined,
      }
    }

    const { ctx, apiAuth } = resolved
    const db = await getDatabase()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    if (apiAuth.authType === 'service_account') {
      const serviceAccount = ctx.serviceAccountConfig
      if (!serviceAccount?.id) {
        return { valid: false, error: '未找到服务账号配置', authType: 'service_account' }
      }

      console.log(`[Verify] 服务账号: ${serviceAccount.name ?? serviceAccount.id}`)

      const { listAccessibleCustomersPython } = await import('./python-ads-client')

      try {
        const resourceNames = await listAccessibleCustomersPython({
          userId,
          serviceAccountId: String(serviceAccount.id),
        })

        if (!resourceNames || resourceNames.length === 0) {
          return { valid: false, error: '无可访问的账户', authType: 'service_account' }
        }

        const firstCustomerId = resourceNames[0].split('/').pop() || ''

        await db
          .exec(
            `UPDATE google_ads_service_accounts SET updated_at = ${nowFunc} WHERE id = ?`,
            [serviceAccount.id]
          )
          .catch(() => {})

        return {
          valid: true,
          customer_id: firstCustomerId,
          authType: 'service_account',
        }
      } catch (error: any) {
        console.error('[Verify] 服务账号验证失败:', error)
        return {
          valid: false,
          error: error.message || '服务账号验证失败',
          authType: 'service_account',
        }
      }
    }

    const credentials = ctx.oauthCredentials
    if (!credentials?.refresh_token) {
      return { valid: false, error: '缺少Refresh Token，请完成 OAuth 授权', authType: 'oauth' }
    }

    if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
      return {
        valid: false,
        error: '凭证配置不完整，请在设置中完成 Google Ads API 配置',
        authType: 'oauth',
      }
    }

    const { getGoogleAdsClient } = await import('./google-ads-api')
    const client = getGoogleAdsClient({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    })

    const response = await client.listAccessibleCustomers(credentials.refresh_token)
    const resourceNames = response.resource_names || []

    if (!resourceNames || resourceNames.length === 0) {
      return { valid: false, error: '无可访问的账户', authType: 'oauth' }
    }

    const firstCustomerId = resourceNames[0].split('/').pop() || ''

    await db.exec(
      `UPDATE google_ads_credentials
       SET last_verified_at = ${nowFunc}, updated_at = ${nowFunc}
       WHERE user_id = ?`,
      [ctx.ownerUserId]
    )

    return {
      valid: true,
      customer_id: firstCustomerId,
      authType: 'oauth',
    }
  } catch (error: any) {
    console.error('验证Google Ads凭证失败:', error)
    return {
      valid: false,
      error: error.message || '未知错误',
    }
  }
}

/**
 * 生成OAuth授权URL
 */
export function generateOAuthUrl(
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const scopes = 'https://www.googleapis.com/auth/adwords'

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent', // 强制显示同意屏幕以获取refresh_token
  })

  if (state) {
    params.append('state', state)
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * 使用授权码交换tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`交换tokens失败: ${error}`)
  }

  const data = await tokenResponse.json()

  if (!data.refresh_token) {
    throw new Error('未获取到refresh_token，请确保使用了access_type=offline和prompt=consent')
  }

  return data
}
