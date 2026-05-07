/**
 * Google Ads API 应用级凭证策略：
 * - dedicated_user：Client ID / Secret / Developer Token 由用户自行配置（默认，兼容历史数据）
 * - inherit_org：上述三项使用管理员维护的组织级配置（google_ads_shared），每用户仍使用自己的 refresh_token
 */
import { getDatabase } from './db'
import { boolCondition } from './db-helpers'
import { getSetting, getUserOnlySetting } from './settings'

export type GoogleAdsCredentialSource = 'inherit_org' | 'dedicated_user'

export const GOOGLE_ADS_SHARED_CATEGORY = 'google_ads_shared'

const APP_FIELD_KEYS = ['client_id', 'client_secret', 'developer_token'] as const

export async function getGoogleAdsCredentialSource(userId: number): Promise<GoogleAdsCredentialSource> {
  const row = await getUserOnlySetting('google_ads', 'credential_source', userId)
  const v = String(row?.value ?? '')
    .trim()
    .toLowerCase()
  if (v === 'inherit_org') return 'inherit_org'
  return 'dedicated_user'
}

export async function getOrgSharedGoogleAdsAppCredentials(): Promise<{
  client_id: string
  client_secret: string
  developer_token: string
} | null> {
  const [cid, sec, dt] = await Promise.all([
    getSetting(GOOGLE_ADS_SHARED_CATEGORY, 'client_id'),
    getSetting(GOOGLE_ADS_SHARED_CATEGORY, 'client_secret'),
    getSetting(GOOGLE_ADS_SHARED_CATEGORY, 'developer_token'),
  ])
  const client_id = String(cid?.value ?? '').trim()
  const client_secret = String(sec?.value ?? '').trim()
  const developer_token = String(dt?.value ?? '').trim()
  if (!client_id || !client_secret || !developer_token) return null
  return { client_id, client_secret, developer_token }
}

async function getDedicatedUserGoogleAdsAppCredentials(userId: number): Promise<{
  client_id: string
  client_secret: string
  developer_token: string
}> {
  const clean = (value: unknown): string => String(value ?? '').trim()

  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const oauthCredentials = await db.queryOne(
    `
      SELECT client_id, client_secret, developer_token
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
      }
    | undefined

  const hasDbClientId = typeof oauthCredentials?.client_id === 'string' && oauthCredentials.client_id.length > 0
  const hasDbClientSecret = typeof oauthCredentials?.client_secret === 'string' && oauthCredentials.client_secret.length > 0
  const hasDbDeveloperToken = typeof oauthCredentials?.developer_token === 'string' && oauthCredentials.developer_token.length > 0

  const [clientIdSetting, clientSecretSetting, developerTokenSetting] = await Promise.all([
    hasDbClientId ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'client_id', userId),
    hasDbClientSecret ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'client_secret', userId),
    hasDbDeveloperToken ? Promise.resolve(null) : getUserOnlySetting('google_ads', 'developer_token', userId),
  ])

  return {
    client_id: clean(oauthCredentials?.client_id || clientIdSetting?.value),
    client_secret: clean(oauthCredentials?.client_secret || clientSecretSetting?.value),
    developer_token: clean(oauthCredentials?.developer_token || developerTokenSetting?.value),
  }
}

export async function resolveGoogleAdsAppCredentials(userId: number): Promise<{
  credentialSource: GoogleAdsCredentialSource
  client_id: string
  client_secret: string
  developer_token: string
  /** 使用组织级应用凭证时，用户在设置页对三件套字段为只读 */
  appCredentialsReadOnly: boolean
}> {
  const credentialSource = await getGoogleAdsCredentialSource(userId)

  if (credentialSource === 'inherit_org') {
    const org = await getOrgSharedGoogleAdsAppCredentials()
    if (!org) {
      throw new Error(
        '当前账号使用「管理员统一 Google Ads API 应用配置」，但管理员尚未在后台填写组织级 Client ID / Client Secret / Developer Token。请联系管理员完成「管理后台 → Google Ads 凭证」中的组织配置。'
      )
    }
    return {
      credentialSource,
      ...org,
      appCredentialsReadOnly: true,
    }
  }

  const dedicated = await getDedicatedUserGoogleAdsAppCredentials(userId)
  if (!dedicated.client_id || !dedicated.client_secret || !dedicated.developer_token) {
    throw new Error(`用户(ID=${userId})未配置完整的 Google Ads 凭证。请在设置页面配置所有必需参数。`)
  }

  return {
    credentialSource,
    ...dedicated,
    appCredentialsReadOnly: false,
  }
}

/** 供设置 API 合并展示：失败时不抛错，返回 null */
export async function tryResolveGoogleAdsAppCredentials(userId: number): Promise<{
  credentialSource: GoogleAdsCredentialSource
  client_id: string
  client_secret: string
  developer_token: string
  appCredentialsReadOnly: boolean
} | null> {
  try {
    return await resolveGoogleAdsAppCredentials(userId)
  } catch {
    return null
  }
}

export async function buildGoogleAdsCredentialPolicyPayload(userId: number): Promise<{
  credentialSource: GoogleAdsCredentialSource
  appFieldsReadOnly: boolean
  orgSharedConfigured: boolean
}> {
  const credentialSource = await getGoogleAdsCredentialSource(userId)
  const orgSharedConfigured = (await getOrgSharedGoogleAdsAppCredentials()) !== null
  return {
    credentialSource,
    appFieldsReadOnly: credentialSource === 'inherit_org',
    orgSharedConfigured,
  }
}

export function isGoogleAdsAppFieldKey(key: string): boolean {
  return (APP_FIELD_KEYS as readonly string[]).includes(key)
}

export function isGoogleAdsCredentialSourceKey(key: string): boolean {
  return key === 'credential_source'
}
