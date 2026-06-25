import { GoogleAdsApi } from 'google-ads-api'
import { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads/oauth/redirect'

/**
 * 获取Google Ads API客户端实例
 *
 * 移除环境变量依赖,强制要求传入credentials
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
 * 交换authorization code获取tokens
 *
 * 移除环境变量依赖,从参数获取credentials
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

  const redirectUri = getGoogleAdsOAuthRedirectUri()

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
 * 移除环境变量依赖,credentials参数改为必需
 *
 * @param refreshToken - Refresh token
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
/**
 * 使用 refresh_token 换取 access_token（仅用于 Customer 构造，不写 google_ads_credentials）。
 * 持久化 refresh 结果请用 `google-ads-oauth.refreshAccessToken(userId)`。
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
