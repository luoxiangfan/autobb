import { GoogleAdsApi, Customer, enums } from 'google-ads-api'
import { updateGoogleAdsAccount } from './google-ads-accounts'
import { withRetry } from './retry'
import { gadsApiCache, generateGadsApiCacheKey } from './cache'
import { getUserOnlySetting } from './settings'
import { isGoogleAdsAccountAccessError } from './google-ads-login-customer'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { getDatabase } from './db'
import { boolCondition } from './db-helpers'
import { installGoogleAdsWarningFilter } from './google-ads-warning-filter'
import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsFinalUrlSuffix,
  sanitizeGoogleAdsPath
} from './google-ads-ad-text'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { getGoogleAdsGeoTargetId } from './language-country-codes'

installGoogleAdsWarningFilter()

function serializeGoogleAdsError(error: unknown): string {
  const primaryMessage = String((error as any)?.message || '').trim()
  const googleAdsErrors = Array.isArray((error as any)?.errors)
    ? (error as any).errors
    : []
  const googleAdsDetail = googleAdsErrors
    .map((item: any) => String(item?.message || '').trim())
    .filter(Boolean)
    .join(' | ')

  if (primaryMessage && googleAdsDetail && !primaryMessage.includes(googleAdsDetail)) {
    return `${primaryMessage} | ${googleAdsDetail}`.slice(0, 4000)
  }
  if (primaryMessage) {
    return primaryMessage.slice(0, 4000)
  }
  if (googleAdsDetail) {
    return googleAdsDetail.slice(0, 4000)
  }

  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== '{}') {
      return serialized.slice(0, 4000)
    }
  } catch {
    // ignore JSON serialization failure and fall back to string coercion
  }

  return String(error || 'Unknown Google Ads error').slice(0, 4000)
}

/**
 * 🔧 新增(2025-01-05): OAuth API 调用追踪包装器
 * 用于在 OAuth 模式下追踪 Google Ads API 调用
 */
async function trackOAuthApiCall<T>(
  userId: number,
  customerId: string,
  operationType: ApiOperationType,
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  try {
    const result = await fn()
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })
    return result
  } catch (error: any) {
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: serializeGoogleAdsError(error),
    })
    throw error
  }
}

/**
 * 清理关键词，移除Google Ads不支持的特殊字符
 * 允许多语言字符：字母/数字(Unicode)、空格、下划线(_)、连字符(-)及少量常见标点
 */
export function sanitizeKeyword(keyword: string): string {
  const input = String(keyword ?? '')
  const cleaned = input
    .replace(/[\p{C}]/gu, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s_.&'+-]/gu, '')

  const normalized = cleaned.replace(/\s+/g, ' ').trim()
  return normalized.replace(/^[-_]+|[-_]+$/g, '').trim()
}

const GOOGLE_ADS_KEYWORD_MAX_WORDS = 10
const GOOGLE_ADS_KEYWORD_MAX_LENGTH = 80

/**
 * 标准化关键词并应用Google Ads关键词限制
 * - 最多10个单词
 * - 最多80个字符
 */
export function sanitizeKeywordForGoogleAds(keyword: string): {
  text: string
  wasSanitized: boolean
  truncatedByWordLimit: boolean
  truncatedByCharLimit: boolean
  originalWordCount: number
} {
  const originalInput = String(keyword ?? '')
  const sanitized = sanitizeKeyword(originalInput)

  if (!sanitized) {
    return {
      text: '',
      wasSanitized: originalInput.trim().length > 0,
      truncatedByWordLimit: false,
      truncatedByCharLimit: false,
      originalWordCount: 0,
    }
  }

  const words = sanitized.split(/\s+/).filter(Boolean)
  const originalWordCount = words.length
  let limitedText = sanitized
  let truncatedByWordLimit = false
  let truncatedByCharLimit = false

  if (words.length > GOOGLE_ADS_KEYWORD_MAX_WORDS) {
    limitedText = words.slice(0, GOOGLE_ADS_KEYWORD_MAX_WORDS).join(' ')
    truncatedByWordLimit = true
  }

  if (limitedText.length > GOOGLE_ADS_KEYWORD_MAX_LENGTH) {
    const sliced = limitedText.slice(0, GOOGLE_ADS_KEYWORD_MAX_LENGTH)
    const truncatedAtWordBoundary = sliced.replace(/\s+\S*$/, '').trim()
    limitedText = (truncatedAtWordBoundary || sliced).trim()
    truncatedByCharLimit = true
  }

  limitedText = limitedText.replace(/\s+/g, ' ').trim()

  return {
    text: limitedText,
    wasSanitized: limitedText !== originalInput.trim(),
    truncatedByWordLimit,
    truncatedByCharLimit,
    originalWordCount,
  }
}

/**
 * 从数据库获取用户的Google Ads凭证
 *
 * 🆕 新增(2025-12-22): 统一的凭证获取函数,确保所有API调用都从数据库读取
 *
 * @param userId - 用户ID
 * @returns Google Ads凭证对象
 * @throws Error 如果配置缺失
 */
export async function getGoogleAdsCredentialsFromDB(userId: number): Promise<{
  client_id: string
  client_secret: string
  developer_token: string
  login_customer_id: string
  useServiceAccount: boolean
}> {
  const clean = (value: unknown): string => String(value ?? '').trim()

  // 优先从 google_ads_credentials 读取（当前生产环境实际存储位置）
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const oauthCredentials = await db.queryOne(
    `
      SELECT client_id, client_secret, developer_token, login_customer_id
      FROM google_ads_credentials
      WHERE user_id = ? AND ${isActiveCondition}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [userId]
  ) as
    | {
        client_id: string | null
        client_secret: string | null
        developer_token: string | null
        login_customer_id: string | null
      }
    | undefined

  const hasDbClientId = typeof oauthCredentials?.client_id === 'string' && oauthCredentials.client_id.length > 0
  const hasDbClientSecret = typeof oauthCredentials?.client_secret === 'string' && oauthCredentials.client_secret.length > 0
  const hasDbDeveloperToken = typeof oauthCredentials?.developer_token === 'string' && oauthCredentials.developer_token.length > 0
  const hasDbLoginCustomerId = typeof oauthCredentials?.login_customer_id === 'string' && oauthCredentials.login_customer_id.length > 0

  const [
    clientIdSetting,
    clientSecretSetting,
    developerTokenSetting,
    loginCustomerIdSetting,
    useServiceAccountSetting,
  ] = await Promise.all([
    hasDbClientId ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'client_id', userId),
    hasDbClientSecret ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'client_secret', userId),
    hasDbDeveloperToken ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'developer_token', userId),
    hasDbLoginCustomerId ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'login_customer_id', userId),
    getUserOnlySetting('google_ads', 'use_service_account', userId),
  ])

  const useServiceAccount = String(useServiceAccountSetting?.value ?? '').toLowerCase() === 'true'

  // 🔧 修复(2026-01-15): 去除凭证前后空白，避免无效 token
  const clientId = clean(oauthCredentials?.client_id || clientIdSetting?.value)
  const clientSecret = clean(oauthCredentials?.client_secret || clientSecretSetting?.value)
  const developerToken = clean(oauthCredentials?.developer_token || developerTokenSetting?.value)
  const loginCustomerId = clean(oauthCredentials?.login_customer_id || loginCustomerIdSetting?.value)

  // 🔧 修复(2025-12-25): 服务账号模式不需要login_customer_id
  if (!clientId || !clientSecret || !developerToken) {
    throw new Error(`用户(ID=${userId})未配置完整的 Google Ads 凭证。请在设置页面配置所有必需参数。`)
  }

  if (!useServiceAccount && !loginCustomerId) {
    throw new Error(`用户(ID=${userId})未配置 login_customer_id。OAuth模式需要此参数。`)
  }

  return {
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
    login_customer_id: loginCustomerId,
    useServiceAccount,
  }
}

/**
 * 获取Google Ads API客户端实例
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,强制要求传入credentials
 * 所有配置必须从数据库读取,支持用户级隔离
 *
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export function getGoogleAdsClient(credentials: {
  client_id: string
  client_secret: string
  developer_token: string
}): GoogleAdsApi {
  if (!credentials) {
    throw new Error('Google Ads API 配置缺失：必须从数据库提供 credentials 参数,不再支持环境变量')
  }

  // 每次都创建新的客户端实例,支持多用户隔离
  return new GoogleAdsApi({
    client_id: String(credentials.client_id ?? '').trim(),
    client_secret: String(credentials.client_secret ?? '').trim(),
    developer_token: String(credentials.developer_token ?? '').trim(),
  })
}

/**
 * 生成OAuth授权URL
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,从参数获取clientId
 *
 * @param clientId - 用户的Google Ads Client ID(从数据库读取)
 * @param state - OAuth state参数
 * @throws Error 如果未提供clientId
 */
export function getOAuthUrl(clientId: string, state?: string): string {
  if (!clientId) {
    throw new Error('缺少 Client ID 配置,必须从数据库提供')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
  })

  if (state) {
    params.append('state', state)
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * 交换authorization code获取tokens
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,从参数获取credentials
 *
 * @param code - OAuth authorization code
 * @param credentials - 用户的Google Ads凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export async function exchangeCodeForTokens(
  code: string,
  credentials: {
    client_id: string
    client_secret: string
  }
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('缺少OAuth配置,必须从数据库提供 client_id 和 client_secret')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OAuth token exchange failed: ${error}`)
  }

  const tokens = await response.json()
  return tokens
}

/**
 * 刷新access token
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,credentials参数改为必需
 *
 * @param refreshToken - Refresh token
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export async function refreshAccessToken(
  refreshToken: string,
  credentials: {
    client_id: string
    client_secret: string
  }
): Promise<{
  access_token: string
  expires_in: number
}> {
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('缺少OAuth配置,必须从数据库提供 client_id 和 client_secret')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${error}`)
  }

  const tokens = await response.json()
  return tokens
}

/**
 * 获取Google Ads Customer实例
 * 自动处理token刷新，支持OAuth和服务账号两种认证方式
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,强制要求传入credentials和loginCustomerId
 * 🆕 新增(2025-12-23): 支持服务账号认证
 *
 * @param customerId - Customer ID
 * @param refreshToken - Refresh token (OAuth模式)
 * @param loginCustomerId - 必需的MCC账户ID(从数据库读取)
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @param accountId - 可选的账户ID用于更新token
 * @param userId - 可选的用户ID用于更新token
 * @param authType - 认证类型: 'oauth' | 'service_account'
 * @param serviceAccountConfig - 服务账号配置(服务账号模式必需)
 * @throws Error 如果未提供必需参数
 */
export async function getCustomer(
  customerId: string,
  refreshToken: string,
  loginCustomerId: string | null,
  credentials: {
    client_id: string
    client_secret: string
    developer_token: string
  },
  userId: number,
  accountId?: number,
  authType?: 'oauth' | 'service_account',
  serviceAccountConfig?: {
    clientEmail: string
    privateKey: string
    mccCustomerId: string
  }
): Promise<Customer> {
  if (!credentials) {
    throw new Error('缺少Google Ads凭证,必须从数据库提供 credentials 参数')
  }

  // login_customer_id:
  // - 通过MCC访问子账户时，通常需要设置为MCC customer_id
  // - 直接访问账户(非通过管理账户)时，根据Google Ads API文档可省略
  // 此处允许传入 null 来显式省略 login_customer_id（用于自动降级策略）
  if (loginCustomerId === undefined) {
    throw new Error('缺少 Login Customer ID(MCC账户ID)。如需省略，请显式传入 null。')
  }

  const client = getGoogleAdsClient(credentials)

  // OAuth认证模式（原有逻辑）
  try {
    // 尝试使用refresh token获取新的access token（带重试）
    const tokens = await withRetry(
      () => refreshAccessToken(refreshToken, {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret
      }),
      {
        maxRetries: 2,
        initialDelay: 500,
        shouldRetry: (error) => {
          const message = error?.message || String(error)
          // invalid_grant / invalid_client 属于不可自愈错误，不需要重试
          if (message.includes('invalid_grant') || message.includes('invalid_client')) return false
          return true
        },
        operationName: 'Refresh Google Ads Token'
      }
    )

    // 更新数据库中的token
    if (accountId && userId) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      updateGoogleAdsAccount(accountId, userId, {
        accessToken: tokens.access_token,
        tokenExpiresAt: expiresAt,
      })
    }

    // 创建customer实例
    const customerParams: any = {
      customer_id: customerId,
      refresh_token: refreshToken,
    }
    if (loginCustomerId) {
      customerParams.login_customer_id = loginCustomerId
    }

    const customer = client.Customer(customerParams)

    return customer
  } catch (error: any) {
    throw new Error(`获取Google Ads Customer失败: ${error.message}`)
  }
}

/**
 * 辅助函数：从数据库获取凭证并创建Customer实例
 * 简化调用者代码，避免每次都手动获取credentials
 * 支持OAuth和服务账号两种认证方式
 *
 * 🔧 修复(2025-12-24): 服务账号模式下不需要 client_id/client_secret
 */
export async function getCustomerWithCredentials(params: {
  customerId: string
  refreshToken?: string  // OAuth模式需要
  accountId?: number
  userId: number
  loginCustomerId?: string | null
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
  }
  // 服务账号认证参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Customer> {
  if (!params.userId) {
    throw new Error('userId is required to fetch Google Ads credentials')
  }

  const authType = params.authType || 'oauth'

  if (authType === 'service_account') {
    // 服务账号认证模式：使用 @htdangkhoa/google-ads，不需要 client_id/client_secret
    const { getUnifiedGoogleAdsClient } = await import('./google-ads-service-account')

    return getUnifiedGoogleAdsClient({
      customerId: params.customerId,
      // 服务账号模式下不需要 credentials（使用 JWT 认证）
      authConfig: {
        authType: 'service_account',
        userId: params.userId,
        serviceAccountId: params.serviceAccountId
      }
    })
  } else {
    // OAuth认证模式
    if (!params.refreshToken) {
      throw new Error('refreshToken is required for OAuth authentication')
    }

    // 从数据库获取凭证
    const creds = await getGoogleAdsCredentialsFromDB(params.userId)

    // 显式传入 loginCustomerId（包括 undefined）时，不再回退到凭证，确保支持“省略header”降级路径。
    const hasExplicitLoginCustomerId = Object.prototype.hasOwnProperty.call(params, 'loginCustomerId')
    const loginCustomerId = hasExplicitLoginCustomerId
      ? (params.loginCustomerId ?? null)
      : creds.login_customer_id

    return getCustomer(
      params.customerId,
      params.refreshToken,
      loginCustomerId,
      {
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        developer_token: creds.developer_token,
      },
      params.userId,
      params.accountId
    )
  }
}

/**
 * 国家代码到Geo Target Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/geotargets
 */
function getGeoTargetConstantId(countryCode: string): number | null {
  const geoTargetIdString = getGoogleAdsGeoTargetId(countryCode)
  const geoTargetId = parseInt(geoTargetIdString, 10)
  return Number.isFinite(geoTargetId) ? geoTargetId : null
}

/**
 * 语言代码/名称到Language Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/codes-formats
 *
 * 支持两种输入格式：
 * 1. 语言代码：'en', 'zh', 'es' 等
 * 2. 语言名称：'English', 'Chinese', 'Spanish' 等
 */
function getLanguageConstantId(input: string): number | null {
  // 语言代码到Constant ID的映射
  const languageCodeMap: Record<string, number> = {
    'en': 1000,      // English
    'zh': 1017,      // Chinese (Simplified)
    'zh-cn': 1017,   // Chinese (Simplified)
    'zh-tw': 1018,   // Chinese (Traditional)
    'ja': 1005,      // Japanese
    'de': 1001,      // German
    'fr': 1002,      // French
    'es': 1003,      // Spanish
    'it': 1004,      // Italian
    'ko': 1012,      // Korean
    'ru': 1031,      // Russian
    'pt': 1014,      // Portuguese
    'ar': 1019,      // Arabic
    'hi': 1023,      // Hindi
  }

  // 语言名称到语言代码的映射
  const languageNameMap: Record<string, string> = {
    'english': 'en',
    'chinese (simplified)': 'zh-cn',
    'chinese (traditional)': 'zh-tw',
    'chinese': 'zh',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'japanese': 'ja',
    'korean': 'ko',
    'portuguese': 'pt',
    'italian': 'it',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
  }

  const normalized = input.toLowerCase().trim()

  // 先尝试直接匹配语言代码
  if (languageCodeMap[normalized]) {
    return languageCodeMap[normalized]
  }

  // 再尝试匹配语言名称
  const code = languageNameMap[normalized]
  if (code && languageCodeMap[code]) {
    return languageCodeMap[code]
  }

  return null
}

/**
 * 创建Google Ads广告系列
 */
function isDuplicateCampaignNameError(error: any): boolean {
  const errors = error?.errors
  if (!Array.isArray(errors)) return false
  return errors.some((e: any) => {
    const code = e?.error_code?.campaign_error
    return code === 'DUPLICATE_CAMPAIGN_NAME' || code === 12
  })
}

function escapeGaqlStringLiteral(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function normalizeCampaignDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined

  const ymd = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymd) return ymd[1]

  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`

  return normalized
}

// 兼容 Google Ads API v23：Campaign.start_date/end_date 已迁移为 *_date_time
function normalizeCampaignDateFields(rows: any[]): any[] {
  return rows.map((row: any) => {
    const campaign = row?.campaign
    if (!campaign || typeof campaign !== 'object') {
      return row
    }

    const startDate = normalizeCampaignDateValue(campaign.start_date_time)
      ?? normalizeCampaignDateValue(campaign.start_date)
    const endDate = normalizeCampaignDateValue(campaign.end_date_time)
      ?? normalizeCampaignDateValue(campaign.end_date)

    return {
      ...row,
      campaign: {
        ...campaign,
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
      },
    }
  })
}

async function findExistingCampaignByName(params: {
  customerId: string
  refreshToken: string
  campaignName: string
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  customer?: Customer
}): Promise<{ campaignId: string; resourceName: string } | null> {
  const nameLiteral = escapeGaqlStringLiteral(params.campaignName)
  const query = `
    SELECT
      campaign.id,
      campaign.resource_name,
      campaign.name,
      campaign.status
    FROM campaign
    WHERE campaign.name = '${nameLiteral}'
      AND campaign.status != 'REMOVED'
    LIMIT 1
  `

  const authType = params.authType || 'oauth'
  let results: any[]

  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('./python-ads-client')
    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })
    results = response.results || []
  } else {
    const customer = params.customer || await getCustomerWithCredentials({
      customerId: params.customerId,
      refreshToken: params.refreshToken,
      userId: params.userId,
      loginCustomerId: params.loginCustomerId,
      authType: params.authType,
      serviceAccountId: params.serviceAccountId,
    })
    results = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.SEARCH,
      '/api/google-ads/query',
      () => customer.query(query)
    )
  }

  const row = results[0]
  const campaignId = row?.campaign?.id ? String(row.campaign.id) : ''
  const resourceName = row?.campaign?.resourceName
    ? String(row.campaign.resourceName)
    : (row?.campaign?.resource_name ? String(row.campaign.resource_name) : '')
  if (!campaignId || !resourceName) return null
  return { campaignId, resourceName }
}

export async function createGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  status: 'ENABLED' | 'PAUSED'
  biddingStrategy?: string
  cpcBidCeilingMicros?: number
  targetCountry?: string
  targetLanguage?: string
  finalUrlSuffix?: string
  startDate?: string
  endDate?: string
  accountId?: number
  userId: number  // 改为必填
  loginCustomerId?: string  // 🔥 经理账号ID（用于访问客户账号）
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ campaignId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'
  const sanitizedFinalUrlSuffix = params.finalUrlSuffix && params.finalUrlSuffix.trim() !== ''
    ? sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
    : ''

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    // ♻️ 幂等：如果同名Campaign已存在（常见于任务重试），直接复用避免报错/产生孤儿预算
    try {
      const existing = await findExistingCampaignByName({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        campaignName: params.campaignName,
        userId: params.userId,
        loginCustomerId: params.loginCustomerId,
        authType,
        serviceAccountId: params.serviceAccountId,
      })
      if (existing) {
        console.log(`♻️ 复用已存在的Campaign: ${params.campaignName} (ID=${existing.campaignId})`)
        return existing
      }
    } catch (lookupError: any) {
      console.warn(`⚠️ Campaign存在性检查失败，将继续尝试创建: ${lookupError?.message || lookupError}`)
    }

    const {
      createCampaignBudgetPython,
      createCampaignPython,
    } = await import('./python-ads-client')

    // 1. 创建预算
    const budgetResourceName = await createCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      name: `${params.campaignName} Budget ${Date.now()}`,
      amountMicros: params.budgetAmount * 1000000,
      deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
    })

    // 2. 创建广告系列
    let campaignResourceName: string
    try {
      campaignResourceName = await createCampaignPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        name: params.campaignName,
        budgetResourceName,
        status: 'PAUSED',
        biddingStrategyType: 'TARGET_SPEND',
        cpcBidCeilingMicros: params.cpcBidCeilingMicros || 170000,
        targetCountry: params.targetCountry,
        targetLanguage: params.targetLanguage,
        startDate: params.startDate,
        endDate: params.endDate,
        finalUrlSuffix: sanitizedFinalUrlSuffix,
      })
    } catch (error: any) {
      if (isDuplicateCampaignNameError(error)) {
        const existing = await findExistingCampaignByName({
          customerId: params.customerId,
          refreshToken: params.refreshToken,
          campaignName: params.campaignName,
          userId: params.userId,
          loginCustomerId: params.loginCustomerId,
          authType,
          serviceAccountId: params.serviceAccountId,
        })
        if (existing) {
          console.log(`♻️ Campaign名称重复，复用已存在的Campaign: ${params.campaignName} (ID=${existing.campaignId})`)
          return existing
        }
      }
      throw error
    }

    const campaignId = campaignResourceName.split('/').pop() || ''
    return { campaignId, resourceName: campaignResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  // ♻️ 幂等：如果同名Campaign已存在（常见于任务重试），直接复用避免报错/产生孤儿预算
  try {
    const existing = await findExistingCampaignByName({
      customerId: params.customerId,
      refreshToken: params.refreshToken,
      campaignName: params.campaignName,
      userId: params.userId,
      loginCustomerId: params.loginCustomerId,
      authType,
      serviceAccountId: params.serviceAccountId,
      customer,
    })
    if (existing) {
      console.log(`♻️ 复用已存在的Campaign: ${params.campaignName} (ID=${existing.campaignId})`)
      return existing
    }
  } catch (lookupError: any) {
    console.warn(`⚠️ Campaign存在性检查失败，将继续尝试创建: ${lookupError?.message || lookupError}`)
  }

  // 1. 创建预算（添加时间戳避免重复名称）
  const budgetResourceName = await createCampaignBudget(customer, {
    name: `${params.campaignName} Budget ${Date.now()}`,
    amount: params.budgetAmount,
    deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
    userId: params.userId,
    customerId: params.customerId,
  })

  // 2. 创建广告系列（遵循Google Ads API官方最佳实践）
  const campaign: any = {
    name: params.campaignName,
    // 官方推荐：创建时使用PAUSED状态，添加完定位和广告后再启用
    status: enums.CampaignStatus.PAUSED,
    advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
    // 🚀 修复(2025-12-18): 移除SEARCH_STANDARD子类型
    // SEARCH_STANDARD不是有效的枚举值，标准搜索广告不需要设置子类型
    // advertising_channel_sub_type会默认为标准搜索广告
    campaign_budget: budgetResourceName,
    network_settings: {
      target_google_search: true,
      target_search_network: true,
      // 禁用Display Expansion（只投放搜索网络）
      target_content_network: false,
      target_partner_search_network: false,
    },
  }

  // 🔧 修复(2025-12-30): 移除不兼容的字段
  // - final_url_expansion_opt_out: 仅支持Performance Max和AI Max Search，普通Search Campaign不支持
  // - goal_config_settings: Campaign对象中不存在此字段，应使用ConversionGoalCampaignConfig资源
  // 转化目标将使用账号级别的默认配置

  // 设置出价策略 - Maximize Clicks (TARGET_SPEND)
  // 根据业务规范：Bidding Strategy = Maximize Clicks，CPC Bid = 0.17 USD
  // 注意：Maximize Clicks在API中的枚举值是TARGET_SPEND
  campaign.bidding_strategy_type = enums.BiddingStrategyType.TARGET_SPEND
  campaign.target_spend = {
    cpc_bid_ceiling_micros: params.cpcBidCeilingMicros || 170000  // 默认0.17 USD
  }

  // 必填字段：EU政治广告状态声明
  // 大多数Campaign不包含政治广告，设置为DOES_NOT_CONTAIN
  campaign.contains_eu_political_advertising = enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING

  // 地理位置选项设置：PRESENCE = 所在地（只定位实际位于该地理位置的用户）
  // PRESENCE_OR_INTEREST = 所在地或兴趣（定位在该地或对该地感兴趣的用户）
  // 参考：https://developers.google.com/google-ads/api/reference/rpc/latest/PositiveGeoTargetTypeEnum.PositiveGeoTargetType
  campaign.geo_target_type_setting = {
    positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE
  }

  // 添加Final URL Suffix（始终设置，即使为空）
  // Final URL Suffix用于在所有广告的最终URL后附加跟踪参数
  // 从推广链接重定向访问后提取的Final URL suffix
  // 即使为空也设置字段，确保在Google Ads界面中显示配置状态
  campaign.final_url_suffix = sanitizedFinalUrlSuffix

  if (campaign.final_url_suffix) {
    console.log('✅ Campaign Final URL Suffix配置:', campaign.final_url_suffix)
  } else {
    console.log('ℹ️ Campaign Final URL Suffix未设置（空字符串）')
  }

  // 3. 添加日期设置
  if (params.startDate) {
    const startDateObj = new Date(params.startDate)
    ;(campaign as any).start_date = startDateObj.toISOString().split('T')[0].replace(/-/g, '')
  }

  if (params.endDate) {
    const endDateObj = new Date(params.endDate)
    ;(campaign as any).end_date = endDateObj.toISOString().split('T')[0].replace(/-/g, '')
  }

  // 🚀 优化(2025-12-18): 简化日志输出，减少噪音
  // DEBUG: 完整的Campaign对象（仅在开发环境打印）
  if (process.env.NODE_ENV === 'development') {
    console.log('📋 Campaign配置:', {
      name: campaign.name,
      strategy: campaign.bidding_strategy_type,
      budget: campaign.target_spend,
      country: params.targetCountry
    })
  }

  let response
  try {
    response = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/create',
      () => withRetry(
        () => customer.campaigns.create([campaign]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Create Campaign: ${params.campaignName}`
        }
      )
    )
  } catch (error: any) {
    if (isDuplicateCampaignNameError(error)) {
      const existing = await findExistingCampaignByName({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        campaignName: params.campaignName,
        userId: params.userId,
        loginCustomerId: params.loginCustomerId,
        authType,
        serviceAccountId: params.serviceAccountId,
        customer,
      })
      if (existing) {
        console.log(`♻️ Campaign名称重复，复用已存在的Campaign: ${params.campaignName} (ID=${existing.campaignId})`)
        return existing
      }
    }

    // 打印详细的错误信息，特别是location字段
    console.error('🐛 Campaign创建失败 - 详细错误信息:')
    console.error('📋 错误对象:', JSON.stringify(error, null, 2))

    if (error.errors && Array.isArray(error.errors)) {
      console.error('📋 错误详情:')
      error.errors.forEach((err: any, index: number) => {
        console.error(`  错误 ${index + 1}:`)
        console.error(`    - message: ${err.message}`)
        console.error(`    - error_code: ${JSON.stringify(err.error_code)}`)

        // location字段可能包含缺失字段的信息
        if (err.location) {
          console.error(`    - location:`, JSON.stringify(err.location, null, 2))
        }
      })
    }

    throw error
  }

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建广告系列失败：无响应')
  }

  const result = response.results[0]
  const campaignId = result.resource_name?.split('/').pop() || ''
  const campaignResourceName = result.resource_name || ''

  console.log(`✅ Campaign创建成功! ID: ${campaignId}, Resource: ${campaignResourceName}`)

  // 4. 添加地理位置和语言定位条件（必需）
  // 参考: https://developers.google.com/google-ads/api/docs/campaigns/search-campaigns/getting-started
  const criteriaOperations: any[] = []

  // 添加地理位置定位
  if (params.targetCountry) {
    const geoTargetConstantId = getGeoTargetConstantId(params.targetCountry)
    if (geoTargetConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        location: {
          geo_target_constant: `geoTargetConstants/${geoTargetConstantId}`
        }
      })
      console.log(`📍 添加地理位置定位: ${params.targetCountry} (${geoTargetConstantId})`)
    }
  }

  // 添加语言定位
  if (params.targetLanguage) {
    const languageConstantId = getLanguageConstantId(params.targetLanguage)
    if (languageConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        language: {
          language_constant: `languageConstants/${languageConstantId}`
        }
      })
      console.log(`🌐 添加语言定位: ${params.targetLanguage} (${languageConstantId})`)
    } else {
      console.warn(`⚠️ 警告: 未找到语言 "${params.targetLanguage}" 对应的常量ID，语言定位可能被跳过`)
    }
  } else {
    console.warn(`⚠️ 警告: 未提供targetLanguage参数，将使用默认语言设置`)
  }

  // 批量创建定位条件
  if (criteriaOperations.length > 0) {
    try {
      await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.MUTATE,
        '/api/google-ads/campaign-criteria/create',
        () => withRetry(
          () => customer.campaignCriteria.create(criteriaOperations),
          {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Create Campaign Criteria for ${params.campaignName}`
          }
        )
      )
      console.log(`✅ 成功添加${criteriaOperations.length}个定位条件`)
    } catch (error: any) {
      console.error('❌ 添加定位条件失败:', error.message)
      // 如果定位条件创建失败，暂停已创建的Campaign以保持安全（避免删除触发风控）
      try {
        await trackOAuthApiCall(
          params.userId,
          params.customerId,
          ApiOperationType.MUTATE,
          '/api/google-ads/campaign/update',
          () => customer.campaigns.update([{
            resource_name: campaignResourceName,
            status: enums.CampaignStatus.PAUSED,
          }])
        )
        console.log(`⏸️ 已暂停Campaign ${campaignId}（因定位条件创建失败）`)
      } catch (rollbackError) {
        console.error('⚠️ Campaign暂停失败:', rollbackError)
      }
      throw new Error(`Campaign定位条件创建失败: ${error.message}`)
    }
  } else {
    console.warn('⚠️ 未提供地理位置或语言定位，Campaign可能无法正常投放')
  }

  // 清除Campaigns列表缓存（创建新Campaign后）
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaigns列表缓存: ${params.customerId}`)

  return {
    campaignId,
    resourceName: campaignResourceName,
  }
}

/**
 * 创建广告系列预算
 */
async function createCampaignBudget(
  customer: Customer,
  params: {
    name: string
    amount: number
    deliveryMethod: 'STANDARD' | 'ACCELERATED'
    userId: number
    customerId: string
  }
): Promise<string> {
  const budget = {
    name: params.name,
    amount_micros: params.amount * 1000000, // 转换为micros (1 USD = 1,000,000 micros)
    delivery_method:
      params.deliveryMethod === 'STANDARD'
        ? enums.BudgetDeliveryMethod.STANDARD
        : enums.BudgetDeliveryMethod.ACCELERATED,
    explicitly_shared: false,
  }

  const response = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/campaign-budget/create',
    () => withRetry(
      () => customer.campaignBudgets.create([budget]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        // login_customer_id 权限错误应立即切换候选，不应在同一候选上指数退避重试。
        shouldRetry: (error) => !isGoogleAdsAccountAccessError(error),
        operationName: `Create Budget: ${params.name}`
      }
    )
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建预算失败')
  }

  return response.results[0].resource_name || ''
}

/**
 * 更新Google Ads广告系列状态
 */
export async function updateGoogleAdsCampaignStatus(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  accountId?: number
  userId: number
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  const requestedStatus = params.status
  const effectiveStatus = requestedStatus === 'REMOVED' ? 'PAUSED' : requestedStatus
  if (requestedStatus === 'REMOVED') {
    console.warn(`⚠️ 已禁用Google Ads删除操作，改为暂停: campaign ${params.campaignId}`)
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { updateCampaignStatusPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignStatusPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      status: effectiveStatus as 'ENABLED' | 'PAUSED' | 'REMOVED',
    })
  } else {
    const customer = await getCustomerWithCredentials({
      ...params,
      authType: params.authType,
      serviceAccountId: params.serviceAccountId,
    })

    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () => withRetry(
        () => customer.campaigns.update([{
          resource_name: resourceName,
          status: enums.CampaignStatus[effectiveStatus],
        }]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Update Campaign Status: ${params.campaignId} -> ${effectiveStatus}`
        }
      )
    )
  }

  // 清除相关缓存（更新状态后）
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign缓存: ${params.campaignId}`)
}

/**
 * 更新 Google Ads 关键词状态（Ad Group Criterion）
 */
export async function updateGoogleAdsKeywordStatus(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywordId: string
  status: 'ENABLED' | 'PAUSED'
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  const authType = params.authType || 'oauth'
  if (authType === 'service_account') {
    throw new Error('服务账号模式暂不支持关键词状态更新，请先使用OAuth账号执行')
  }

  const customer = await getCustomerWithCredentials({
    customerId: params.customerId,
    refreshToken: params.refreshToken,
    accountId: params.accountId,
    userId: params.userId,
    loginCustomerId: params.loginCustomerId,
    authType,
    serviceAccountId: params.serviceAccountId,
  })

  const resourceName = `customers/${params.customerId}/adGroupCriteria/${params.adGroupId}~${params.keywordId}`

  await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/keyword/update-status',
    () => withRetry(
      () => customer.adGroupCriteria.update([{
        resource_name: resourceName,
        status: enums.AdGroupCriterionStatus[params.status],
      }]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        operationName: `Update Keyword Status: ${params.keywordId} -> ${params.status}`,
      }
    )
  )
}

/**
 * 删除Google Ads广告系列
 */
export async function removeGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  customer?: Customer
}): Promise<void> {
  const authType = params.authType || 'oauth'
  const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

  if (authType === 'service_account') {
    const { removeCampaignPython } = await import('./python-ads-client')
    await removeCampaignPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
    })
  } else {
    const customer = params.customer ?? await getCustomerWithCredentials({
      customerId: params.customerId,
      refreshToken: params.refreshToken,
      accountId: params.accountId,
      userId: params.userId,
      loginCustomerId: params.loginCustomerId,
      authType,
      serviceAccountId: params.serviceAccountId,
    })

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/remove',
      () => withRetry(
        () => customer.campaigns.remove([resourceName]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Remove Campaign: ${params.campaignId}`
        }
      )
    )
  }

  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)
  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign缓存: ${params.campaignId}`)
}

/**
 * 更新Google Ads广告系列预算
 */
export async function updateGoogleAdsCampaignBudget(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { updateCampaignBudgetPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      budgetAmountMicros: params.budgetAmount * 1000000,
    })
  } else {
    const customer = await getCustomerWithCredentials(params)

    // 1. 创建新的预算
    const budgetResourceName = await createCampaignBudget(customer, {
      name: `Budget ${params.campaignId} - ${Date.now()}`,
      amount: params.budgetAmount,
      deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
      userId: params.userId,
      customerId: params.customerId,
    })

    // 2. 更新Campaign指向新预算
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () => withRetry(
        () => customer.campaigns.update([{
          resource_name: resourceName,
          campaign_budget: budgetResourceName,
        }]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Update Campaign Budget: ${params.campaignId} -> ${params.budgetAmount}`
        }
      )
    )
  }

  // 清除相关缓存
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign预算缓存: ${params.campaignId}`)
}

/**
 * 获取Google Ads广告系列详情
 */
export async function getGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  accountId?: number
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<any> {
  const cacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })

  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      console.log(`✅ 使用缓存的Campaign数据: ${params.campaignId}`)
      return cached
    }
  }

  const authType = params.authType || 'oauth'
  let results: any[]

  if (authType === 'service_account') {
    // Google Ads API v23 起：Campaign.start_date/end_date => start_date_time/end_date_time
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${params.campaignId}
    `

    const { executeGAQLQueryPython } = await import('./python-ads-client')
    const result = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })
    results = normalizeCampaignDateFields(result.results || [])
  } else {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${params.campaignId}
    `

    const customer = await getCustomerWithCredentials(params)
    results = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.SEARCH,
      '/api/google-ads/query',
      () => customer.query(query)
    )
  }

  const result = results[0] || null

  if (result) {
    gadsApiCache.set(cacheKey, result)
    console.log(`💾 已缓存Campaign数据: ${params.campaignId}`)
  }

  return result
}

/**
 * 列出Google Ads账号下的所有广告系列
 */
export async function listGoogleAdsCampaigns(params: {
  customerId: string
  refreshToken: string
  accountId?: number
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<any[]> {
  // 生成缓存键
  const cacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  // 检查缓存（除非显式跳过）
  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      console.log(`✅ 使用缓存的Campaigns列表: ${params.customerId}`)
      return cached
    }
  }

  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('./python-ads-client')
    const { getServiceAccountConfig } = await import('./google-ads-service-account')
    const saConfig = await getServiceAccountConfig(params.userId, params.serviceAccountId)

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `

    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query
    })

    const results = normalizeCampaignDateFields(response.results || [])

    // 缓存结果（30分钟TTL）
    gadsApiCache.set(cacheKey, results)
    console.log(`💾 已缓存Campaigns列表: ${params.customerId} (${results.length}个)`)

    return results
  }

  // OAuth模式
  const customer = await getCustomerWithCredentials({
    ...params,
    authType: params.authType,
    serviceAccountId: params.serviceAccountId,
  })

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name
  `

  const results = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.SEARCH,
    '/api/google-ads/query',
    () => customer.query(query)
  )

  // 缓存结果（30分钟TTL）
  gadsApiCache.set(cacheKey, results)
  console.log(`💾 已缓存Campaigns列表: ${params.customerId} (${results.length}个)`)

  return results
}

/**
 * 创建Google Ads Ad Group
 */
export async function createGoogleAdsAdGroup(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  adGroupName: string
  cpcBidMicros?: number
  status: 'ENABLED' | 'PAUSED'
  accountId?: number
  userId: number
  loginCustomerId?: string  // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ adGroupId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createAdGroupPython } = await import('./python-ads-client')

    const campaignResourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const adGroupResourceName = await createAdGroupPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName,
      name: params.adGroupName,
      status: params.status,
      cpcBidMicros: params.cpcBidMicros,
    })

    const adGroupId = adGroupResourceName.split('/').pop() || ''
    return { adGroupId, resourceName: adGroupResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  const adGroup = {
    name: params.adGroupName,
    campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
    status: enums.AdGroupStatus[params.status],
    type: enums.AdGroupType.SEARCH_STANDARD,
  }

  // 如果提供了CPC出价，设置手动CPC
  if (params.cpcBidMicros) {
    ;(adGroup as any).cpc_bid_micros = params.cpcBidMicros
  }

  const response = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/ad-group/create',
    () => customer.adGroups.create([adGroup])
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建Ad Group失败：无响应')
  }

  const result = response.results[0]
  const adGroupId = result.resource_name?.split('/').pop() || ''

  return {
    adGroupId,
    resourceName: result.resource_name || '',
  }
}

/**
 * 批量创建Google Ads Keywords
 */
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT'  // ← 新增：负向词的匹配类型
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string  // 🔧 添加MCC权限参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  const authType = params.authType || 'oauth'

  const logKeywordNormalization = (
    originalText: string,
    normalized: ReturnType<typeof sanitizeKeywordForGoogleAds>
  ): void => {
    if (normalized.text === originalText) return
    const reasons: string[] = []
    if (normalized.truncatedByWordLimit) reasons.push(`words>${GOOGLE_ADS_KEYWORD_MAX_WORDS}`)
    if (normalized.truncatedByCharLimit) reasons.push(`chars>${GOOGLE_ADS_KEYWORD_MAX_LENGTH}`)

    const reasonSuffix = reasons.length > 0 ? ` (${reasons.join(', ')})` : ''
    console.log(`[Keyword] Normalized: "${originalText}" -> "${normalized.text}"${reasonSuffix}`)
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createKeywordsPython } = await import('./python-ads-client')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const keywordInputs = params.keywords
      .map((kw, originalIndex) => {
        const normalized = sanitizeKeywordForGoogleAds(kw.keywordText)
        logKeywordNormalization(kw.keywordText, normalized)
        if (!normalized.text) {
          console.warn(`[Keyword] Dropped empty keyword after sanitization: "${kw.keywordText}"`)
          return null
        }
        return { kw, originalIndex, normalizedText: normalized.text }
      })
      .filter((x): x is { kw: (typeof params.keywords)[number]; originalIndex: number; normalizedText: string } => Boolean(x))

    if (keywordInputs.length === 0) {
      return []
    }

    const resourceNames = await createKeywordsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      keywords: keywordInputs.map(({ kw, normalizedText }) => ({
        text: normalizedText,
        matchType: kw.matchType,
        status: kw.status,
        finalUrl: kw.finalUrl,
        isNegative: kw.isNegative,
        negativeKeywordMatchType: kw.negativeKeywordMatchType,
      })),
    })

    return resourceNames.map((resourceName, index) => ({
      keywordId: resourceName.split('/').pop() || '',
      resourceName,
      keywordText: params.keywords[keywordInputs[index].originalIndex].keywordText,
    }))
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []

  // 分批处理（每批最多100个）
  const batchSize = 100
  for (let i = 0; i < params.keywords.length; i += batchSize) {
    const batch = params.keywords.slice(i, i + batchSize)

    const keywordOperationsWithMeta = batch
      .map(kw => {
        const effectiveMatchType = kw.isNegative
          ? (kw.negativeKeywordMatchType || 'EXACT')
          : kw.matchType

        const normalized = sanitizeKeywordForGoogleAds(kw.keywordText)
        logKeywordNormalization(kw.keywordText, normalized)
        if (!normalized.text) {
          console.warn(`[Keyword] Dropped empty keyword after sanitization: "${kw.keywordText}"`)
          return null
        }

        const operation: any = {
          ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
          keyword: {
            text: normalized.text,
            match_type: enums.KeywordMatchType[effectiveMatchType],
          },
        }

        if (kw.isNegative) {
          operation.negative = true
        } else {
          operation.status = enums.AdGroupCriterionStatus[kw.status]
          if (kw.finalUrl) {
            operation.final_urls = [kw.finalUrl]
          }
        }

        return { operation, keywordText: kw.keywordText }
      })
      .filter((x): x is { operation: any; keywordText: string } => Boolean(x))

    if (keywordOperationsWithMeta.length === 0) {
      continue
    }

    const response = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/keywords/create',
      () => customer.adGroupCriteria.create(keywordOperationsWithMeta.map(x => x.operation))
    )

    if (response && response.results && response.results.length > 0) {
      response.results.forEach((result, index) => {
        const keywordId = result.resource_name?.split('/').pop() || ''
        results.push({
          keywordId,
          resourceName: result.resource_name || '',
          keywordText: keywordOperationsWithMeta[index]?.keywordText || '',
        })
      })
    }
  }

  return results
}

const RESPONSIVE_AD_VARIANT_HINTS = ['Now', 'Today', 'Deals', 'Official', 'Shop'] as const

function normalizeResponsiveAssetKey(text: string, maxLength: number): string {
  return sanitizeGoogleAdsAdText(String(text ?? ''), maxLength).trim().toLowerCase()
}

function buildUniqueResponsiveAssetVariant(params: {
  baseText: string
  maxLength: number
  usedKeys: Set<string>
  index: number
}): string | null {
  const { baseText, maxLength, usedKeys, index } = params
  const normalizedBase = sanitizeGoogleAdsAdText(baseText, maxLength).trim()
  if (!normalizedBase) return null

  const candidateSuffixes = [
    ...RESPONSIVE_AD_VARIANT_HINTS.map((hint) => ` ${hint}`),
    ` ${index + 1}`,
  ]

  for (let i = 2; i <= 30; i++) {
    candidateSuffixes.push(` ${i}`)
  }

  for (const suffix of candidateSuffixes) {
    const maxBaseLength = Math.max(1, maxLength - suffix.length)
    const trimmedBase = normalizedBase.length > maxBaseLength
      ? normalizedBase.slice(0, maxBaseLength).trim()
      : normalizedBase

    if (!trimmedBase) continue

    const candidate = sanitizeGoogleAdsAdText(`${trimmedBase}${suffix}`, maxLength).trim()
    const candidateKey = normalizeResponsiveAssetKey(candidate, maxLength)
    if (!candidateKey || usedKeys.has(candidateKey)) continue

    usedKeys.add(candidateKey)
    return candidate
  }

  return null
}

export function ensureUniqueResponsiveSearchAdAssets(
  texts: string[],
  maxLength: number,
  assetLabel: string
): string[] {
  const usedKeys = new Set<string>()

  return texts.map((text, index) => {
    const cleaned = sanitizeGoogleAdsAdText(String(text ?? ''), maxLength).trim()
    const key = normalizeResponsiveAssetKey(cleaned, maxLength)
    if (!key) return cleaned

    if (!usedKeys.has(key)) {
      usedKeys.add(key)
      return cleaned
    }

    const replacement = buildUniqueResponsiveAssetVariant({
      baseText: cleaned,
      maxLength,
      usedKeys,
      index,
    })

    if (!replacement) {
      throw new Error(`${assetLabel}${index + 1}与已有资产重复，且无法自动生成唯一变体，请调整创意后重试`)
    }

    console.warn(`[RSA] ${assetLabel}${index + 1}与已有资产重复，自动改写为: "${replacement}"`)
    return replacement
  })
}

/**
 * 创建Google Ads Responsive Search Ad
 */
export async function createGoogleAdsResponsiveSearchAd(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  headlines: string[] // Max 15 headlines
  descriptions: string[] // Max 4 descriptions
  finalUrls: string[]
  finalUrlSuffix?: string  // 查询参数后缀（用于tracking）
  path1?: string
  path2?: string
  accountId?: number
  userId: number
  loginCustomerId?: string  // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ adId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'

  const sanitizedHeadlines = params.headlines.map(h => sanitizeGoogleAdsAdText(h, 30))
  const sanitizedDescriptions = params.descriptions.map(d => sanitizeGoogleAdsAdText(d, 90))
  const uniqueHeadlines = ensureUniqueResponsiveSearchAdAssets(sanitizedHeadlines, 30, '标题')
  const uniqueDescriptions = ensureUniqueResponsiveSearchAdAssets(sanitizedDescriptions, 90, '描述')
  const sanitizedPath1 = params.path1 ? sanitizeGoogleAdsPath(params.path1, 15) : undefined
  const sanitizedPath2 = params.path2 ? sanitizeGoogleAdsPath(params.path2, 15) : undefined
  const sanitizedFinalUrlSuffix = params.finalUrlSuffix
    ? sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
    : undefined

  const emptyHeadlineIndex = uniqueHeadlines.findIndex(h => !h.trim())
  if (emptyHeadlineIndex >= 0) {
    throw new Error(`标题${emptyHeadlineIndex + 1}清洗后为空（可能仅包含不允许的符号），请修改后重试`)
  }
  const emptyDescriptionIndex = uniqueDescriptions.findIndex(d => !d.trim())
  if (emptyDescriptionIndex >= 0) {
    throw new Error(`描述${emptyDescriptionIndex + 1}清洗后为空（可能仅包含不允许的符号），请修改后重试`)
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createResponsiveSearchAdPython } = await import('./python-ads-client')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const adResourceName = await createResponsiveSearchAdPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      headlines: uniqueHeadlines,
      descriptions: uniqueDescriptions,
      finalUrls: params.finalUrls,
      finalUrlSuffix: sanitizedFinalUrlSuffix,
      path1: sanitizedPath1,
      path2: sanitizedPath2,
    })

    const adId = adResourceName.split('/').pop() || ''
    return { adId, resourceName: adResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  // Validate headlines (必须正好15个)
  // 根据业务规范：Headlines必须配置15个，如果从广告创意中获得的标题数量不足，则报错
  if (params.headlines.length !== 15) {
    throw new Error(`Headlines必须正好15个，当前提供了${params.headlines.length}个。如果从广告创意中获得的标题数量不足，请报错。`)
  }

  // Validate descriptions (必须正好4个)
  // 根据业务规范：Descriptions必须配置4个，如果从广告创意中获得的描述数量不足，则报错
  if (params.descriptions.length !== 4) {
    throw new Error(`Descriptions必须正好4个，当前提供了${params.descriptions.length}个。如果从广告创意中获得的描述数量不足，请报错。`)
  }

  // Validate headline length (max 30 characters each)
  uniqueHeadlines.forEach((headline, index) => {
    const effectiveLength = getGoogleAdsTextEffectiveLength(headline)
    if (effectiveLength > 30) {
      throw new Error(`标题${index + 1}超过30字符限制: "${headline}" (effective=${effectiveLength}, raw=${headline.length})`)
    }
  })

  // Validate description length (max 90 characters each)
  uniqueDescriptions.forEach((desc, index) => {
    const effectiveLength = getGoogleAdsTextEffectiveLength(desc)
    if (effectiveLength > 90) {
      throw new Error(`描述${index + 1}超过90字符限制: "${desc}" (effective=${effectiveLength}, raw=${desc.length})`)
    }
  })

  // Create ad structure
  const ad: any = {
    ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
    status: enums.AdGroupAdStatus.ENABLED,
    ad: {
      final_urls: params.finalUrls,
      responsive_search_ad: {
        headlines: uniqueHeadlines.map(text => ({ text })),
        descriptions: uniqueDescriptions.map(text => ({ text })),
      },
    },
  }

  // Add Final URL Suffix if provided (for tracking parameters)
  if (sanitizedFinalUrlSuffix) {
    ad.ad.final_url_suffix = sanitizedFinalUrlSuffix
  }

  // Add display path fields if provided
  if (sanitizedPath1) {
    ad.ad.responsive_search_ad.path1 = sanitizedPath1
  }
  if (sanitizedPath2) {
    ad.ad.responsive_search_ad.path2 = sanitizedPath2
  }

  const response = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/responsive-search-ad/create',
    () => customer.adGroupAds.create([ad])
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建Responsive Search Ad失败：无响应')
  }

  const result = response.results[0]
  const adId = result.resource_name?.split('/').pop() || ''

  return {
    adId,
    resourceName: result.resource_name || '',
  }
}

// ==================== Performance Reporting ====================

/**
 * 获取Campaign表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Google Ads Campaign ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID（用于token刷新）
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000), // Convert to micros
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Campaign表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad Group表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adGroupId - Google Ads Ad Group ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdGroupPerformance(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group
    WHERE ad_group.id = ${params.adGroupId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Ad Group表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adId - Google Ads Ad ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdPerformance(params: {
  customerId: string
  refreshToken: string
  adId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group_ad
    WHERE ad_group_ad.ad.id = ${params.adId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Ad表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 批量获取多个Campaign的表现数据（汇总）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignIds - Google Ads Campaign IDs数组
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Campaign ID到表现数据的映射
 */
export async function getBatchCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignIds: string[]
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Record<string, Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>>> {
  const campaignIdList = params.campaignIds.join(',')

  const query = `
    SELECT
      campaign.id,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id IN (${campaignIdList})
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY campaign.id, segments.date DESC
  `

  try {
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    // Group by campaign ID
    const performanceByCampaign: Record<string, any[]> = {}

    response.forEach((row: any) => {
      const campaignId = row.campaign?.id?.toString() || ''

      if (!performanceByCampaign[campaignId]) {
        performanceByCampaign[campaignId] = []
      }

      performanceByCampaign[campaignId].push({
        date: row.segments?.date || '',
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        conversions: row.metrics?.conversions || 0,
        cost_micros: row.metrics?.cost_micros || 0,
        ctr: row.metrics?.ctr || 0,
        cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
        conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
      })
    })

    return performanceByCampaign
  } catch (error: any) {
    console.error('批量获取Campaign表现数据失败:', error)
    throw new Error(`批量获取表现数据失败: ${error.message}`)
  }
}

/**
 * 创建Callout扩展（现在称为Callout Assets）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Campaign ID to attach callouts to
 * @param params.callouts - Array of callout texts (max 25 characters each)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Array of created asset IDs
 */
export async function createGoogleAdsCalloutExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  callouts: string[]
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ assetIds: string[] }> {
  try {
    const normalizedCallouts = Array.from(new Set(
      params.callouts
        .filter((text): text is string => typeof text === 'string')
        .map((text) => sanitizeGoogleAdsAdText(text, 25))
        .map((text) => text.trim())
        .filter((text) => text.length > 0)
    ))

    if (normalizedCallouts.length === 0) {
      throw new Error('没有有效的Callout文本，无法创建Callout扩展')
    }

    // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
    if (params.authType === 'service_account') {
      const { createCalloutExtensionsPython } = await import('./python-ads-client')
      const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
      const assetResourceNames = await createCalloutExtensionsPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        campaignResourceName: resourceName,
        calloutTexts: normalizedCallouts,
      })
      return { assetIds: assetResourceNames.map(rn => rn.split('/').pop() || '') }
    }

    const customer = await getCustomerWithCredentials(params)

    const assetIds: string[] = []
    const assetResourceNames: string[] = []

    // Step 1: Create Callout Assets
    const assetOperations = normalizedCallouts.map(calloutText => ({
      callout_asset: {
        // normalizedCallouts 已经过 sanitizeGoogleAdsAdText(..., 25) 处理
        callout_text: calloutText
      }
    }))

    console.log(`📢 创建${normalizedCallouts.length}个Callout Assets...`)
    const assetResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/assets/create',
      () => customer.assets.create(assetOperations)
    )

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const resourceName = result.resource_name || result.resourceName
        if (!resourceName) {
          console.warn('⚠️ Callout Asset结果缺少resource_name，已跳过:', JSON.stringify(result))
          return
        }
        assetResourceNames.push(resourceName)
        const assetId = resourceName.split('/').pop() || ''
        if (assetId) assetIds.push(assetId)
      })
      console.log(`✅ Callout Assets创建成功: ${assetIds.length}个`)
    }

    if (assetResourceNames.length === 0) {
      throw new Error('Callout Assets创建结果为空，无法继续关联到Campaign')
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetResourceNames.map(resourceName => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: resourceName,
      field_type: enums.AssetFieldType.CALLOUT
    }))

    console.log(`🔗 关联Callout Assets到Campaign ${params.campaignId}...`)
    const linkResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/campaign-assets/create',
      () => customer.campaignAssets.create(campaignAssetOperations, { partial_failure: true })
    )
    const partialFailure =
      linkResponse?.partial_failure_error ||
      (linkResponse as { partialFailureError?: unknown } | undefined)?.partialFailureError
    if (partialFailure) {
      console.warn('⚠️ Callout Assets部分关联失败:', JSON.stringify(partialFailure, null, 2))
    }
    console.log(`✅ Callout Assets关联成功`)

    return { assetIds }
  } catch (error: any) {
    const errorMessage =
      error?.errors?.[0]?.message ||
      error?.error?.message ||
      error?.message ||
      (typeof error === 'string' ? error : 'Unknown error')
    let errorDetails = ''
    try {
      errorDetails = JSON.stringify(error, null, 2)
    } catch {
      errorDetails = String(error)
    }
    console.error('❌ 创建Callout扩展失败:', errorMessage)
    console.error('❌ 错误详情:', errorDetails)
    throw new Error(`创建Callout扩展失败: ${errorMessage}`)
  }
}

/**
 * 创建Sitelink扩展（现在称为Sitelink Assets）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Campaign ID to attach sitelinks to
 * @param params.sitelinks - Array of sitelink objects
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Array of created asset IDs
 */
export async function createGoogleAdsSitelinkExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  sitelinks: Array<{
    text: string
    url: string
    description1?: string
    description2?: string
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ assetIds: string[] }> {
  const sanitizedSitelinks = params.sitelinks.map((sitelink) => {
    const sanitizedText = sanitizeGoogleAdsAdText(sitelink.text, 25).trim()
    const desc1Raw = sitelink.description1 ? sanitizeGoogleAdsAdText(sitelink.description1, 35).trim() : ''
    const desc2Raw = sitelink.description2 ? sanitizeGoogleAdsAdText(sitelink.description2, 35).trim() : ''

    let description1: string | undefined = desc1Raw
    let description2: string | undefined = desc2Raw
    if (description1) {
      if (!description2) description2 = description1
    } else {
      description1 = undefined
      description2 = undefined
    }

    return {
      ...sitelink,
      text: sanitizedText,
      description1,
      description2
    }
  })

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { createSitelinkExtensionsPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const assetResourceNames = await createSitelinkExtensionsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      sitelinks: sanitizedSitelinks.map(sl => ({
        linkText: sl.text,
        finalUrl: sl.url,
        description1: sl.description1,
        description2: sl.description2,
      })),
    })
    return { assetIds: assetResourceNames.map(rn => rn.split('/').pop() || '') }
  }

  const customer = await getCustomerWithCredentials(params)

  const assetIds: string[] = []

  try {
    // Step 1: Create Sitelink Assets
    const assetOperations = sanitizedSitelinks.map(sitelink => {
      console.log(`🔍 处理Sitelink: text="${sitelink.text}", url="${sitelink.url}", desc1="${sitelink.description1}"`)

      const sitelinkAsset: any = {
        // sanitizedSitelinks 已经过 sanitizeGoogleAdsAdText(..., 25) 处理
        link_text: sitelink.text
      }

      // description1 和 description2 必须要么都存在，要么都不存在
      if (sitelink.description1 && sitelink.description1.trim()) {
        const desc1 = sitelink.description1
        const desc2 = sitelink.description2 || sitelink.description1
        sitelinkAsset.description1 = desc1
        sitelinkAsset.description2 = desc2
      }

      // 关键修复：final_urls必须在Asset层级，不是sitelink_asset内部
      const assetObj = {
        sitelink_asset: sitelinkAsset,
        final_urls: [sitelink.url] // final_urls在Asset层级
      }

      console.log(`✅ 生成的Asset:`, JSON.stringify(assetObj, null, 2))

      return assetObj
    })

    console.log(`🔗 创建${params.sitelinks.length}个Sitelink Assets...`)
    console.log(`📋 Sitelink数据:`, JSON.stringify(assetOperations, null, 2))
    const assetResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/assets/create',
      () => customer.assets.create(assetOperations)
    )

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const assetId = result.resource_name?.split('/').pop() || ''
        assetIds.push(assetId)
      })
      console.log(`✅ Sitelink Assets创建成功: ${assetIds.length}个`)
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetIds.map(assetId => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: `customers/${params.customerId}/assets/${assetId}`,
      field_type: enums.AssetFieldType.SITELINK
    }))

    console.log(`🔗 关联Sitelink Assets到Campaign ${params.campaignId}...`)
    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/campaign-assets/create',
      () => customer.campaignAssets.create(campaignAssetOperations)
    )
    console.log(`✅ Sitelink Assets关联成功`)

    return { assetIds }
  } catch (error: any) {
    const errorMessage =
      error?.errors?.[0]?.message ||
      error?.error?.message ||
      error?.message ||
      (typeof error === 'string' ? error : 'Unknown error')
    let errorDetails = ''
    try {
      errorDetails = JSON.stringify(error, null, 2)
    } catch {
      errorDetails = String(error)
    }
    console.error('❌ 创建Sitelink扩展失败:', errorMessage)
    console.error('❌ 错误详情:', errorDetails)
    throw new Error(`创建Sitelink扩展失败: ${errorMessage}`)
  }
}


// ==================== Conversion Goal Functions Removed ====================
//
// 🔧 移除说明 (2025-12-26):
// - MarketingObjective类型及其相关函数已移除
// - setCampaignMarketingObjective: 设置Campaign营销目标（不稳定，已尝试8+次修复）
// - ensureAccountConversionGoal: 确保账号转化目标配置（同样的问题）
// - 相关辅助函数: createConversionAction, setCustomerConversionGoal, queryConversionActions
//
// 原因: Google Ads会自动推断营销目标（基于转化操作），无需手动设置
// 这些功能的失败不会阻断广告发布流程，移除以简化代码
//
// 历史记录:
// - 2025-12-19: 首次添加setCampaignMarketingObjective
// - 2025-12-20: 多次修复，自动创建转化操作
// - 2025-12-25: 关键修复，添加CustomerConversionGoal设置
// - 2025-12-26: 决定移除（方案A），经过8+次修复仍不稳定

// ==================== Headline Optimization ====================

/**
 * 确保标题中包含热门关键词
 *
 * 🔧 新增(2025-12-20): 解决Google Ads广告效力"未在标题中包含热门关键词"问题
 *
 * Google Ads 会检测广告标题是否包含投放的关键词，如果标题中没有关键词，
 * 广告效力评分会降低。此函数确保 Top N 热门关键词至少出现在标题中。
 *
 * @param headlines - 原始标题数组（15个）
 * @param keywords - 关键词数组（按优先级排序）
 * @param brandName - 品牌名称
 * @param maxKeywordsToEnsure - 需要确保覆盖的关键词数量（默认3个）
 * @returns 优化后的标题数组
 */
export function ensureKeywordsInHeadlines(
  headlines: string[],
  keywords: string[],
  brandName: string,
  maxKeywordsToEnsure: number = 3
): string[] {
  if (!headlines || headlines.length === 0) {
    console.log(`[HeadlineOptimizer] ⚠️ 没有标题可优化`)
    return headlines
  }

  if (!keywords || keywords.length === 0) {
    console.log(`[HeadlineOptimizer] ⚠️ 没有关键词可用于优化`)
    return headlines
  }

  const result = [...headlines]
  const normalizeCoverageKey = (value: string): string =>
    normalizeGoogleAdsKeyword(value).replace(/\s+/g, '')
  const normalizeHeadlineAssetKey = (value: string): string =>
    sanitizeGoogleAdsAdText(String(value ?? ''), 30).trim().toLowerCase()

  const headlineCoverage = result.map((headline) => {
    const normalized = normalizeGoogleAdsKeyword(headline)
    const compact = normalized.replace(/\s+/g, '')
    const tokenSet = new Set(normalized.split(/\s+/).filter(Boolean))
    return { compact, tokenSet }
  })

  // 获取需要确保覆盖的 Top N 关键词
  const topKeywordsRaw = keywords
    .slice(0, maxKeywordsToEnsure)
    .map(k => typeof k === 'string' ? k : (k as any).text || (k as any).keyword || '')
    .map(k => sanitizeKeyword(String(k ?? '')).replace(/\s+/g, ' ').trim())
    .filter(k => k.length > 0)

  // 去重（规范化后去掉分隔符），避免把 "soundcore" 和 "sound core" 当成两个关键词
  const topKeywords: string[] = []
  const seenTopKeywords = new Set<string>()
  for (const keyword of topKeywordsRaw) {
    const key = normalizeCoverageKey(keyword)
    if (!key || seenTopKeywords.has(key)) continue
    seenTopKeywords.add(key)
    topKeywords.push(keyword)
  }

  console.log(`[HeadlineOptimizer] 🔍 检查 Top ${topKeywords.length} 关键词覆盖情况`)
  console.log(`[HeadlineOptimizer]    关键词: ${topKeywords.join(', ')}`)

  // 找出未被标题覆盖的关键词
  const uncoveredKeywords: string[] = []
  topKeywords.forEach(kw => {
    const normalizedKeyword = normalizeGoogleAdsKeyword(kw)
    const keywordCompact = normalizeCoverageKey(kw)
    const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
    const isCovered = headlineCoverage.some((headline) => {
      if (keywordCompact && headline.compact.includes(keywordCompact)) return true
      if (keywordTokens.length === 0) return false
      return keywordTokens.every(token => headline.tokenSet.has(token))
    })
    if (!isCovered) {
      uncoveredKeywords.push(kw)
      console.log(`[HeadlineOptimizer]    ❌ 未覆盖: "${kw}"`)
    } else {
      console.log(`[HeadlineOptimizer]    ✅ 已覆盖: "${kw}"`)
    }
  })

  if (uncoveredKeywords.length === 0) {
    console.log(`[HeadlineOptimizer] ✅ 所有热门关键词已被标题覆盖，无需优化`)
    return result
  }

  console.log(`[HeadlineOptimizer] 🔧 需要为 ${uncoveredKeywords.length} 个关键词生成新标题`)

  // 去重未覆盖关键词（按Google Ads规范化键），避免近似词重复替换
  const uniqueUncoveredKeywords = Array.from(
    uncoveredKeywords.reduce((map, keyword) => {
      const key = normalizeCoverageKey(keyword)
      if (!key || map.has(key)) return map
      map.set(key, keyword)
      return map
    }, new Map<string, string>()).values()
  )
  console.log(`[HeadlineOptimizer] 去重后需要为 ${uniqueUncoveredKeywords.length} 个唯一关键词生成新标题`)

  // 生成包含关键词的新标题模板
  const generateKeywordHeadline = (keyword: string, brand: string): string => {
    const brandText = sanitizeKeyword(String(brand ?? '')).replace(/\s+/g, ' ').trim()
    const brandKey = normalizeCoverageKey(brandText)
    const rawKeywordText = sanitizeKeyword(String(keyword ?? '')).replace(/\s+/g, ' ').trim()
    if (!rawKeywordText) {
      return brandText.length <= 30 ? brandText.trim() : brandText.substring(0, 30).trim()
    }

    const keywordKey = normalizeCoverageKey(rawKeywordText)
    const toHeadlineToken = (token: string): string => {
      if (!token) return token
      if (/^[A-Z0-9]{2,6}$/.test(token)) return token
      if (/^[a-z]+$/.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1)
      }
      if (/^[A-Za-z][A-Za-z0-9-]*$/.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
      }
      return token
    }

    const keywordForHeadline = (() => {
      // 空格/分隔符变体与品牌等价时，统一回品牌标准写法（如 sound core -> Soundcore）
      if (brandKey && keywordKey === brandKey) return brandText || rawKeywordText

      const tokens = rawKeywordText.split(/\s+/).filter(Boolean)
      const seenTokens = new Set<string>()
      const normalizedTokens: string[] = []
      for (const token of tokens) {
        const tokenKey = normalizeCoverageKey(token)
        if (!tokenKey || seenTokens.has(tokenKey)) continue
        seenTokens.add(tokenKey)
        if (brandKey && tokenKey === brandKey) {
          normalizedTokens.push(brandText || token)
        } else {
          normalizedTokens.push(toHeadlineToken(token))
        }
      }
      if (normalizedTokens.length === 0) return rawKeywordText
      return normalizedTokens.join(' ')
    })()

    const keywordContainsBrand = Boolean(brandKey && normalizeCoverageKey(keywordForHeadline).includes(brandKey))

    // 多种模板，确保多样性
    // 注意：避免使用 "-" 和 "|" 等可能触发 Google Ads SYMBOLS 政策的符号
    const templates = keywordContainsBrand
      ? [
          `Shop ${keywordForHeadline} Now`,
          `Get ${keywordForHeadline} Today`,
          `${keywordForHeadline} Deals`,
          keywordForHeadline,
        ]
      : [
          `${brandText} ${keywordForHeadline}`,
          `Shop ${keywordForHeadline} Now`,
          `Best ${keywordForHeadline} Deals`,
          `${keywordForHeadline} by ${brandText}`,
          `Get ${keywordForHeadline} Today`,
        ]

    // 选择一个不超过30字符的模板
    for (const template of templates) {
      if (template.length <= 30) {
        return template
      }
    }

    // 如果所有模板都太长，直接使用关键词
    return keywordForHeadline.length <= 30
      ? keywordForHeadline
      : keywordForHeadline.substring(0, 30).trim()
  }

  // 替换最后几个标题为包含未覆盖关键词的版本
  uniqueUncoveredKeywords.forEach((kw, i) => {
    // 从倒数第二个开始替换（保留最后一个作为CTA）
    const replaceIndex = result.length - 2 - i
    if (replaceIndex >= 0 && replaceIndex < result.length) {
      const oldHeadline = result[replaceIndex]
      const newHeadline = generateKeywordHeadline(kw, brandName)
      const normalizedNewHeadlineKey = normalizeHeadlineAssetKey(newHeadline)

      // 检查生成的标题是否与已有标题重复
      const isDuplicate = result.some((h, idx) =>
        idx !== replaceIndex && normalizeHeadlineAssetKey(h) === normalizedNewHeadlineKey
      )

      if (!isDuplicate) {
        result[replaceIndex] = newHeadline
        console.log(`[HeadlineOptimizer]    替换标题[${replaceIndex}]: "${oldHeadline}" → "${newHeadline}"`)
      } else {
        console.log(`[HeadlineOptimizer]    跳过标题[${replaceIndex}]：新标题"${newHeadline}"与已有标题重复`)
      }
    }
  })

  console.log(`[HeadlineOptimizer] ✅ 标题优化完成，替换了 ${uniqueUncoveredKeywords.length} 个标题`)

  return result
}

/**
 * 更新Google Ads广告系列的Final URL Suffix
 *
 * 🆕 新增(2025-01-03): 用于换链接任务系统自动更新Campaign的追踪参数
 *
 * @param params 更新参数
 * @param params.customerId Google Ads Customer ID
 * @param params.refreshToken OAuth刷新令牌
 * @param params.campaignId Campaign ID
 * @param params.finalUrlSuffix 新的Final URL Suffix
 * @param params.userId 用户ID
 * @param params.loginCustomerId Login Customer ID（OAuth模式）
 * @param params.authType 认证类型（oauth或service_account）
 * @param params.serviceAccountId 服务账号ID（服务账号模式）
 */
export async function updateCampaignFinalUrlSuffix(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  finalUrlSuffix: string
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  const sanitizedFinalUrlSuffix = sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
  // 🔧 修复(2025-01-03): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { updateCampaignFinalUrlSuffixPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignFinalUrlSuffixPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      finalUrlSuffix: sanitizedFinalUrlSuffix,
    })
  } else {
    const customer = await getCustomerWithCredentials({
      ...params,
      authType: params.authType,
      serviceAccountId: params.serviceAccountId,
    })

    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () => withRetry(
        () => customer.campaigns.update([{
          resource_name: resourceName,
          final_url_suffix: sanitizedFinalUrlSuffix,
        }]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Update Campaign Final URL Suffix: ${params.campaignId}`
        }
      )
    )
  }

  // 清除相关缓存
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign缓存（Final URL Suffix更新）: ${params.campaignId}`)
}

// ==================== Re-exports ====================

// 重新导出 enums 和 GoogleAdsApi 供其他模块使用，统一入口
export { enums, GoogleAdsApi } from 'google-ads-api'
