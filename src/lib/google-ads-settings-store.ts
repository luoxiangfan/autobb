/**
 * Google Ads OAuth 配置统一存储：OAuth 字段仅存 google_ads_credentials，不再写入 system_settings 用户实例。
 * system_settings 仅保留 user_id IS NULL 的字段元数据（及 campaign_sync 等非 OAuth 键）。
 */
import { getDatabase } from './db'
import { nowFunc as sqlNowFunc } from './db-helpers'
import {
  isGoogleAdsAuthShared,
  resolveGoogleAdsCredentialOwnerId,
} from './google-ads-auth-assignment'
import { formatAndValidateLoginCustomerId, type GoogleAdsCredentials } from './google-ads-oauth'
import { developerTokenLooksInvalid } from './google-ads-developer-token-heal'
import { getUserOnlySetting } from './settings'
import type { SettingValue } from './settings'

export const GOOGLE_ADS_OAUTH_CONFIG_KEYS = [
  'login_customer_id',
  'client_id',
  'client_secret',
  'developer_token',
] as const

export type GoogleAdsOAuthConfigKey = (typeof GOOGLE_ADS_OAUTH_CONFIG_KEYS)[number]

export const GOOGLE_ADS_CREDENTIAL_BACKED_SETTING_KEYS = [...GOOGLE_ADS_OAUTH_CONFIG_KEYS] as const

const OAUTH_KEY_TO_COLUMN: Record<GoogleAdsOAuthConfigKey, keyof GoogleAdsCredentials> = {
  login_customer_id: 'login_customer_id',
  client_id: 'client_id',
  client_secret: 'client_secret',
  developer_token: 'developer_token',
}

export type GoogleAdsOAuthSettingsSyncFields = Partial<Record<GoogleAdsOAuthConfigKey, string>>

export type SyncGoogleAdsOAuthFieldsResult = {
  synced: boolean
  /** client_id 或 client_secret 相对 DB 发生变更且仍有 refresh_token */
  oauthClientCredentialsChanged: boolean
}

export class GoogleAdsSettingsValidationError extends Error {
  readonly name = 'GoogleAdsSettingsValidationError'

  constructor(message: string) {
    super(message)
  }
}

/** OAuth 与服务账号互斥冲突（与 credentials / oauth 路由 409 语义一致） */
export class GoogleAdsSettingsAuthConflictError extends Error {
  readonly name = 'GoogleAdsSettingsAuthConflictError'

  constructor(message: string) {
    super(message)
  }
}

export function isGoogleAdsSettingsValidationError(
  error: unknown
): error is GoogleAdsSettingsValidationError {
  return error instanceof GoogleAdsSettingsValidationError
}

export function isGoogleAdsSettingsAuthConflictError(
  error: unknown
): error is GoogleAdsSettingsAuthConflictError {
  return error instanceof GoogleAdsSettingsAuthConflictError
}

export type GoogleAdsSettingsReadContext = {
  readOnly: boolean
  /** 生产 OAuth 字段读取目标 user_id（共享 OAuth 时为管理员） */
  oauthUserId: number
}

/** 一次解析：只读标记 + 生产 OAuth 凭证 user_id */
export async function resolveGoogleAdsSettingsReadContext(
  userId: number
): Promise<GoogleAdsSettingsReadContext> {
  const { ownerUserId, assignment, isShared } = await resolveGoogleAdsCredentialOwnerId(userId)
  const oauthUserId = isShared && assignment?.authType === 'oauth' ? ownerUserId : userId
  return {
    readOnly: isGoogleAdsAuthShared(assignment),
    oauthUserId,
  }
}

/** 共享 OAuth 子用户只读：Settings API 不返回明文密钥 */
export async function isGoogleAdsSettingsReadOnly(userId: number): Promise<boolean> {
  const ctx = await resolveGoogleAdsSettingsReadContext(userId)
  return ctx.readOnly
}

export function maskGoogleAdsCredentialSettingValueForReadOnly(
  key: string,
  value: string,
  isSensitive?: boolean
): string {
  if (!value) return ''
  if (isSensitive || key === 'client_secret') return ''
  if (key === 'developer_token') return ''
  if (key === 'client_id') {
    if (value.length <= 12) return '***'
    return `${value.slice(0, 8)}...${value.slice(-4)}`
  }
  return value
}

/** credentials GET：只读用户可见的 clientId / 配置标记（不暴露明文密钥） */
export function resolveGoogleAdsCredentialFieldsForReadOnlyApi(params: {
  canModify: boolean
  clientId: string | null | undefined
  developerToken: string | null | undefined
  clientSecret: string | null | undefined
  /** metadata 路径：无明文时仍标记已配置 */
  clientSecretConfiguredOverride?: boolean
  developerTokenConfiguredOverride?: boolean
}): {
  clientId: string | null | undefined
  developerToken: string | null | undefined
  clientIdConfigured?: boolean
  developerTokenConfigured?: boolean
  clientSecretConfigured?: boolean
} {
  if (params.canModify) {
    return {
      clientId: params.clientId,
      developerToken: params.developerToken,
    }
  }

  const clientIdRaw = String(params.clientId || '').trim()
  const developerTokenRaw = String(params.developerToken || '').trim()
  const clientSecretRaw = String(params.clientSecret || '').trim()

  const clientSecretConfigured = params.clientSecretConfiguredOverride ?? Boolean(clientSecretRaw)
  const developerTokenConfigured =
    params.developerTokenConfiguredOverride ?? Boolean(developerTokenRaw)

  return {
    clientId: clientIdRaw
      ? maskGoogleAdsCredentialSettingValueForReadOnly('client_id', clientIdRaw)
      : null,
    developerToken: null,
    ...(clientIdRaw ? { clientIdConfigured: true } : {}),
    ...(developerTokenConfigured ? { developerTokenConfigured: true } : {}),
    ...(clientSecretConfigured ? { clientSecretConfigured: true } : {}),
  }
}

function validateLoginCustomerIdForSettings(raw: string, fieldName?: string): string {
  try {
    return formatAndValidateLoginCustomerId(raw, fieldName)
  } catch (error) {
    if (error instanceof Error) {
      throw new GoogleAdsSettingsValidationError(error.message)
    }
    throw error
  }
}

const LEGACY_OAUTH_SETTING_KEYS = [...GOOGLE_ADS_OAUTH_CONFIG_KEYS]

function isCredentialBackedGoogleAdsSettingKey(key: string): boolean {
  return (GOOGLE_ADS_CREDENTIAL_BACKED_SETTING_KEYS as readonly string[]).includes(key)
}

export function isGoogleAdsCredentialBackedSettingKey(key: string): boolean {
  return isCredentialBackedGoogleAdsSettingKey(key)
}

/** 共享 OAuth 读管理员凭证行；其余读当前用户 */
export async function resolveGoogleAdsOAuthSettingsReadUserId(userId: number): Promise<number> {
  const ctx = await resolveGoogleAdsSettingsReadContext(userId)
  return ctx.oauthUserId
}

export function collectCredentialBackedFieldUpdates(
  updates: Array<{ category: string; key: string; value: string }>
): {
  oauthFields: GoogleAdsOAuthSettingsSyncFields
} {
  const oauthFields: GoogleAdsOAuthSettingsSyncFields = {}

  for (const update of updates) {
    if (update.category !== 'google_ads') continue
    if ((GOOGLE_ADS_OAUTH_CONFIG_KEYS as readonly string[]).includes(update.key)) {
      oauthFields[update.key as GoogleAdsOAuthConfigKey] = update.value
    }
  }

  return { oauthFields }
}

export async function getGoogleAdsCredentialBackedSettingValue(
  userId: number,
  key: string,
  options?: { isSensitive?: boolean }
): Promise<string> {
  if (!isCredentialBackedGoogleAdsSettingKey(key)) {
    return ''
  }
  const readCtx = await resolveGoogleAdsSettingsReadContext(userId)
  const fields = await getGoogleAdsOAuthConfigFields(readCtx.oauthUserId)
  const raw = fields[key as GoogleAdsOAuthConfigKey]
  if (!raw) return ''
  if (readCtx.readOnly) {
    return maskGoogleAdsCredentialSettingValueForReadOnly(key, raw, options?.isSensitive)
  }
  return raw
}

export async function upsertSingleGoogleAdsCredentialBackedSetting(
  userId: number,
  key: string,
  value: string,
  options?: { skipAuthContextInvalidate?: boolean }
): Promise<SyncGoogleAdsOAuthFieldsResult | null> {
  if ((GOOGLE_ADS_OAUTH_CONFIG_KEYS as readonly string[]).includes(key)) {
    return upsertGoogleAdsOAuthConfigFromSettings(
      userId,
      {
        [key as GoogleAdsOAuthConfigKey]: value,
      },
      options
    )
  }
  return null
}

async function getGoogleAdsCredentialRowByUserId(
  userId: number
): Promise<GoogleAdsCredentials | null> {
  const db = await getDatabase()
  return (
    (await db.queryOne<GoogleAdsCredentials>(
      `SELECT * FROM google_ads_credentials WHERE user_id = ? LIMIT 1`,
      [userId]
    )) ?? null
  )
}

/**
 * 读取指定 user_id 的 OAuth 配置字段（直读凭证表，不解析共享 owner）。
 * 共享场景请用 resolveGoogleAdsSettingsReadContext / getGoogleAdsCredentialBackedSettingValue。
 */
export async function getGoogleAdsOAuthConfigFields(
  userId: number
): Promise<Record<GoogleAdsOAuthConfigKey, string>> {
  const row = await getGoogleAdsCredentialRowByUserId(userId)
  return {
    login_customer_id: String(row?.login_customer_id || '').trim(),
    client_id: String(row?.client_id || '').trim(),
    client_secret: String(row?.client_secret || '').trim(),
    developer_token: String(row?.developer_token || '').trim(),
  }
}

export async function getGoogleAdsOAuthConfigValue(
  userId: number,
  key: GoogleAdsOAuthConfigKey
): Promise<string> {
  const fields = await getGoogleAdsOAuthConfigFields(userId)
  return fields[key]
}

export async function overlayGoogleAdsSettingsFromCredentialStore(
  settings: SettingValue[],
  userId: number
): Promise<SettingValue[]> {
  const readCtx = await resolveGoogleAdsSettingsReadContext(userId)
  const oauthFields = await getGoogleAdsOAuthConfigFields(readCtx.oauthUserId)

  return settings.map((setting) => {
    if (setting.category !== 'google_ads' || !isCredentialBackedGoogleAdsSettingKey(setting.key)) {
      return setting
    }
    const stored = oauthFields[setting.key as GoogleAdsOAuthConfigKey]
    if (!stored) {
      return setting
    }
    const value = readCtx.readOnly
      ? maskGoogleAdsCredentialSettingValueForReadOnly(setting.key, stored, setting.isSensitive)
      : stored
    return { ...setting, value }
  })
}

export type SettingsExportEntry = {
  value: string | null
  dataType: string
  isSensitive: boolean
  description?: string | null
}

function maskSensitiveExportValue(raw: string): string {
  if (raw.length > 8) {
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`
  }
  return '****'
}

/** 导出配置：从凭证表 overlay google_ads OAuth 字段（与 import 路径对齐；共享只读用户跳过） */
export async function overlayGoogleAdsOAuthFieldsForSettingsExport(
  exportData: Record<string, Record<string, SettingsExportEntry>>,
  userId: number,
  options: { includeSensitive: boolean }
): Promise<void> {
  const readCtx = await resolveGoogleAdsSettingsReadContext(userId)
  if (readCtx.readOnly) {
    return
  }

  const oauthFields = await getGoogleAdsOAuthConfigFields(userId)
  const hasAnyField = GOOGLE_ADS_OAUTH_CONFIG_KEYS.some((key) => oauthFields[key]?.trim())
  if (!hasAnyField) {
    return
  }

  if (!exportData.google_ads) {
    exportData.google_ads = {}
  }

  for (const key of GOOGLE_ADS_OAUTH_CONFIG_KEYS) {
    const raw = oauthFields[key]?.trim()
    if (!raw) {
      continue
    }

    const isSensitive = key === 'client_secret' || key === 'developer_token'
    let value: string | null = raw
    if (isSensitive && !options.includeSensitive) {
      value = maskSensitiveExportValue(raw)
    }

    exportData.google_ads[key] = {
      value,
      dataType: 'string',
      isSensitive,
      description: null,
    }
  }
}

export function partitionGoogleAdsSettingUpdates(
  updates: Array<{ category: string; key: string }>
): {
  credentialBacked: Array<{ category: string; key: string; value: string }>
  remainder: Array<{ category: string; key: string; value: string }>
} {
  const credentialBacked: Array<{ category: string; key: string; value: string }> = []
  const remainder: Array<{ category: string; key: string; value: string }> = []

  for (const update of updates as Array<{ category: string; key: string; value: string }>) {
    if (update.category === 'google_ads' && isCredentialBackedGoogleAdsSettingKey(update.key)) {
      credentialBacked.push(update)
      continue
    }
    remainder.push(update)
  }

  return { credentialBacked, remainder }
}

export async function upsertGoogleAdsOAuthConfigFromSettings(
  userId: number,
  fields: Partial<Record<GoogleAdsOAuthConfigKey, string>>,
  options?: { skipAuthContextInvalidate?: boolean; skipAuthConflictCheck?: boolean }
): Promise<SyncGoogleAdsOAuthFieldsResult> {
  const hasOAuthFieldUpdate = (GOOGLE_ADS_OAUTH_CONFIG_KEYS as readonly string[]).some((key) =>
    fields[key as GoogleAdsOAuthConfigKey]?.trim()
  )
  if (hasOAuthFieldUpdate && !options?.skipAuthConflictCheck) {
    try {
      const { assertNoConflictingGoogleAdsAuth } = await import('./google-ads-auth-context')
      await assertNoConflictingGoogleAdsAuth(userId, 'oauth')
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '当前已配置服务账号认证，无法保存 OAuth 配置'
      throw new GoogleAdsSettingsAuthConflictError(message)
    }
  }

  const existing = await getGoogleAdsCredentialRowByUserId(userId)

  let oauthClientCredentialsChanged = false
  if (fields.client_id?.trim()) {
    const next = fields.client_id.trim()
    const prev = String(existing?.client_id || '').trim()
    if (existing?.refresh_token?.trim() && next !== prev) {
      oauthClientCredentialsChanged = true
    }
  }
  if (fields.client_secret?.trim()) {
    const next = fields.client_secret.trim()
    const prev = String(existing?.client_secret || '').trim()
    if (existing?.refresh_token?.trim() && next !== prev) {
      oauthClientCredentialsChanged = true
    }
  }

  const setClauses: string[] = []
  const params: unknown[] = []

  if (fields.client_id?.trim()) {
    setClauses.push('client_id = ?')
    params.push(fields.client_id.trim())
  }
  if (fields.client_secret?.trim()) {
    setClauses.push('client_secret = ?')
    params.push(fields.client_secret.trim())
  }
  if (fields.developer_token?.trim()) {
    const developerToken = fields.developer_token.trim()
    const clientSecretForCheck =
      fields.client_secret?.trim() || String(existing?.client_secret || '').trim()
    if (developerTokenLooksInvalid(developerToken, clientSecretForCheck)) {
      throw new GoogleAdsSettingsValidationError(
        'Developer Token 配置看起来不正确（疑似误填为 OAuth Client Secret）。请在设置页面填写 Google Ads API Center 提供的 Developer Token。'
      )
    }
    setClauses.push('developer_token = ?')
    params.push(developerToken)
  }
  if (fields.login_customer_id?.trim()) {
    setClauses.push('login_customer_id = ?')
    params.push(validateLoginCustomerIdForSettings(fields.login_customer_id.trim()))
  }

  if (setClauses.length === 0) {
    return { synced: false, oauthClientCredentialsChanged: false }
  }

  const db = await getDatabase()
  const nowSql = sqlNowFunc(db.type)
  const isActiveValue = db.type === 'postgres' ? true : 1

  if (existing) {
    await db.exec(
      `UPDATE google_ads_credentials SET ${setClauses.join(', ')}, is_active = ?, updated_at = ${nowSql} WHERE user_id = ?`,
      [...params, isActiveValue, userId]
    )
  } else {
    const merged = await getGoogleAdsOAuthConfigFields(userId)
    if (fields.client_id?.trim()) merged.client_id = fields.client_id.trim()
    if (fields.client_secret?.trim()) merged.client_secret = fields.client_secret.trim()
    if (fields.developer_token?.trim()) merged.developer_token = fields.developer_token.trim()
    if (fields.login_customer_id?.trim()) {
      merged.login_customer_id = validateLoginCustomerIdForSettings(fields.login_customer_id.trim())
    }

    await db.exec(
      `INSERT INTO google_ads_credentials (
        user_id, client_id, client_secret, refresh_token,
        developer_token, login_customer_id, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql})`,
      [
        userId,
        merged.client_id,
        merged.client_secret,
        '',
        merged.developer_token,
        merged.login_customer_id || '',
        isActiveValue,
      ]
    )
  }

  if (!options?.skipAuthContextInvalidate) {
    const { invalidateGoogleAdsAuthContextForCredentialUser } =
      await import('./google-ads-auth-context')
    await invalidateGoogleAdsAuthContextForCredentialUser(userId)
  }

  return { synced: true, oauthClientCredentialsChanged }
}

/**
 * 一次性：将 system_settings 中遗留的 OAuth 用户实例迁移到凭证表并删除重复行。
 */
export async function migrateLegacyGoogleAdsSettingsStorage(): Promise<void> {
  const db = await getDatabase()
  const placeholders = LEGACY_OAUTH_SETTING_KEYS.map(() => '?').join(', ')
  const users = (await db.query(
    `
    SELECT DISTINCT user_id AS user_id
    FROM system_settings
    WHERE category = 'google_ads'
      AND user_id IS NOT NULL
      AND key IN (${placeholders})
  `,
    [...LEGACY_OAUTH_SETTING_KEYS]
  )) as Array<{ user_id: number }>

  if (users.length === 0) {
    return
  }

  console.log(`[google-ads-settings-store] 迁移 ${users.length} 个用户的 OAuth 配置到凭证表`)

  for (const { user_id: userId } of users) {
    const oauthPatch: Partial<Record<GoogleAdsOAuthConfigKey, string>> = {}

    for (const key of GOOGLE_ADS_OAUTH_CONFIG_KEYS) {
      const legacy = await getUserOnlySetting('google_ads', key, userId)
      if (legacy?.value?.trim()) {
        oauthPatch[key] = legacy.value.trim()
      }
    }

    const existingOauth = await getGoogleAdsCredentialRowByUserId(userId)
    const oauthFields = await getGoogleAdsOAuthConfigFields(userId)
    const mergedOauth: Partial<Record<GoogleAdsOAuthConfigKey, string>> = {}

    for (const key of GOOGLE_ADS_OAUTH_CONFIG_KEYS) {
      const column = OAUTH_KEY_TO_COLUMN[key]
      const fromCredential = oauthFields[key]
      const fromLegacy = oauthPatch[key]
      const existingValue = String(existingOauth?.[column] || '').trim()
      const chosen = fromCredential || existingValue || fromLegacy
      if (chosen) {
        mergedOauth[key] = chosen
      }
    }

    if (Object.keys(mergedOauth).length > 0) {
      await upsertGoogleAdsOAuthConfigFromSettings(userId, mergedOauth, {
        skipAuthContextInvalidate: true,
        skipAuthConflictCheck: true,
      })
    }
  }

  await db.exec(
    `
    DELETE FROM system_settings
    WHERE category = 'google_ads'
      AND user_id IS NOT NULL
      AND key IN (${placeholders})
  `,
    [...LEGACY_OAUTH_SETTING_KEYS]
  )
}
