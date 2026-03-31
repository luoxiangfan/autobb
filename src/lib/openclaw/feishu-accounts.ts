import { decrypt } from '@/lib/crypto'
import { getDatabase } from '@/lib/db'
import type { SystemSetting } from '@/lib/settings'
import { getUserOnlySetting } from '@/lib/settings'

const FEISHU_USER_ACCOUNT_PREFIX = 'user-'
const FEISHU_USER_KEYS = [
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_app_secret_file',
  'feishu_bot_name',
  'feishu_domain',
  'feishu_dm_policy',
  'feishu_group_policy',
  'feishu_allow_from',
  'feishu_group_allow_from',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
  'feishu_accounts_json',
  'feishu_target',
]

const FEISHU_BINDING_USER_KEYS = [
  'feishu_allow_from',
  'feishu_target',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
]

type FeishuDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
type FeishuGroupPolicy = 'open' | 'allowlist' | 'disabled'
type FeishuAuthMode = 'strict' | 'compat'

export type FeishuAccountConfig = {
  appId?: string
  appSecret?: string
  appSecretFile?: string
  botName?: string
  domain?: string
  dmPolicy?: FeishuDmPolicy
  groupPolicy?: FeishuGroupPolicy
  allowFrom?: string[]
  groupAllowFrom?: string[]
  cardCallbackPath?: string
  cardVerificationToken?: string
  cardEncryptKey?: string
  cardConfirmUrl?: string
  cardConfirmAuthToken?: string
  cardConfirmTimeoutMs?: number
  authMode?: FeishuAuthMode
  requireTenantKey?: boolean
  strictAutoBind?: boolean
  enabled?: boolean
  name?: string
}

export type FeishuBindingAccountConfig = Pick<
  FeishuAccountConfig,
  'allowFrom' | 'authMode' | 'requireTenantKey' | 'strictAutoBind'
>

export function getFeishuAccountIdForUser(userId: number): string {
  return `${FEISHU_USER_ACCOUNT_PREFIX}${userId}`
}

export function parseFeishuAccountUserId(accountId?: string | null): number | null {
  if (!accountId) return null
  const normalized = accountId.trim()
  if (!normalized.startsWith(FEISHU_USER_ACCOUNT_PREFIX)) return null
  const raw = normalized.slice(FEISHU_USER_ACCOUNT_PREFIX.length)
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export async function resolveUserFeishuAccountId(userId: number): Promise<string | null> {
  const appId = await getUserOnlySetting('openclaw', 'feishu_app_id', userId)
  const appSecret = await getUserOnlySetting('openclaw', 'feishu_app_secret', userId)
  const appSecretFile = await getUserOnlySetting('openclaw', 'feishu_app_secret_file', userId)
  const hasSecret = Boolean(appSecret?.value) || Boolean(appSecretFile?.value)
  if (!appId?.value || !hasSecret) return null
  return getFeishuAccountIdForUser(userId)
}

function resolveSettingValue(setting: Pick<SystemSetting, 'value' | 'encrypted_value' | 'is_sensitive'>): string {
  const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1
  if (isSensitive && setting.encrypted_value) {
    return decrypt(setting.encrypted_value) ?? ''
  }
  return setting.value ?? ''
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function normalizeFeishuAllowFromEntries(entries: unknown[]): string[] {
  return entries
    .map((entry) => String(entry).trim())
    .map((entry) => entry.replace(/^(feishu|lark):/i, ''))
    .filter(Boolean)
}

function parseFeishuAllowFrom(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return normalizeFeishuAllowFromEntries(parsed)
  } catch {
    return []
  }
}

function normalizeFeishuDmPolicy(value?: string): FeishuDmPolicy | undefined {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'pairing' || normalized === 'allowlist' || normalized === 'open' || normalized === 'disabled') {
    return normalized
  }
  return undefined
}

function normalizeFeishuGroupPolicy(value?: string): FeishuGroupPolicy | undefined {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'open' || normalized === 'allowlist' || normalized === 'disabled') {
    return normalized
  }
  return undefined
}

function normalizeFeishuAuthMode(value?: string): FeishuAuthMode | undefined {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'strict' || normalized === 'compat') {
    return normalized
  }
  return undefined
}

function resolveFeishuIdFromTarget(value?: string): string | undefined {
  const raw = (value || '').trim()
  if (!raw) return undefined

  const normalized = raw
    .replace(/^(feishu|lark):/i, '')
    .replace(/^(user|dm|chat|group):/i, '')
    .trim()

  const lowered = normalized.toLowerCase()
  if (lowered.startsWith('ou_') || lowered.startsWith('on_')) {
    return normalized
  }
  return undefined
}

function parseUserMainAccountFromJson(value?: string): Partial<FeishuAccountConfig> {
  if (!value) return {}

  try {
    const parsed = JSON.parse(value)
    const root = asRecord(parsed)
    const main = root ? asRecord(root.main) : null
    if (!main) return {}

    const config: Partial<FeishuAccountConfig> = {}

    const appId = readString(main.appId)
    if (appId) config.appId = appId

    const appSecret = readString(main.appSecret)
    if (appSecret) config.appSecret = appSecret

    const appSecretFile = readString(main.appSecretFile)
    if (appSecretFile) config.appSecretFile = appSecretFile

    const botName = readString(main.botName)
    if (botName) config.botName = botName

    const domain = readString(main.domain)
    if (domain) config.domain = domain

    const dmPolicy = normalizeFeishuDmPolicy(readString(main.dmPolicy))
    if (dmPolicy) config.dmPolicy = dmPolicy

    const groupPolicy = normalizeFeishuGroupPolicy(readString(main.groupPolicy))
    if (groupPolicy) config.groupPolicy = groupPolicy

    if (Array.isArray(main.allowFrom)) {
      const allowFrom = normalizeFeishuAllowFromEntries(main.allowFrom)
      if (allowFrom.length > 0) config.allowFrom = allowFrom
    }

    if (Array.isArray(main.groupAllowFrom)) {
      const groupAllowFrom = normalizeFeishuAllowFromEntries(main.groupAllowFrom)
      if (groupAllowFrom.length > 0) config.groupAllowFrom = groupAllowFrom
    }

    const cardCallbackPath = readString(main.cardCallbackPath)
    if (cardCallbackPath) config.cardCallbackPath = cardCallbackPath

    const cardVerificationToken = readString(main.cardVerificationToken)
    if (cardVerificationToken) config.cardVerificationToken = cardVerificationToken

    const cardEncryptKey = readString(main.cardEncryptKey)
    if (cardEncryptKey) config.cardEncryptKey = cardEncryptKey

    const cardConfirmUrl = readString(main.cardConfirmUrl)
    if (cardConfirmUrl) config.cardConfirmUrl = cardConfirmUrl

    const cardConfirmAuthToken = readString(main.cardConfirmAuthToken)
    if (cardConfirmAuthToken) config.cardConfirmAuthToken = cardConfirmAuthToken

    const timeout = Number(main.cardConfirmTimeoutMs)
    if (Number.isFinite(timeout) && timeout > 0) {
      config.cardConfirmTimeoutMs = Math.round(timeout)
    }

    const authMode = normalizeFeishuAuthMode(readString(main.authMode))
    if (authMode) {
      config.authMode = authMode
    }

    const requireTenantKey = readBoolean(main.requireTenantKey)
    if (requireTenantKey !== undefined) {
      config.requireTenantKey = requireTenantKey
    }

    const strictAutoBind = readBoolean(main.strictAutoBind)
    if (strictAutoBind !== undefined) {
      config.strictAutoBind = strictAutoBind
    }

    const enabled = readBoolean(main.enabled)
    if (enabled !== undefined) {
      config.enabled = enabled
    }

    const name = readString(main.name)
    if (name) {
      config.name = name
    }

    return config
  } catch {
    return {}
  }
}

export async function collectUserFeishuAccounts(): Promise<Record<string, FeishuAccountConfig>> {
  const db = await getDatabase()
  const placeholders = FEISHU_USER_KEYS.map(() => '?').join(', ')
  const rows = await db.query<SystemSetting>(
    `SELECT user_id, key, value, encrypted_value, is_sensitive
     FROM system_settings
     WHERE category = ?
       AND user_id IS NOT NULL
       AND key IN (${placeholders})`,
    ['openclaw', ...FEISHU_USER_KEYS]
  )

  const byUser = new Map<number, Record<string, string>>()
  for (const row of rows) {
    if (!row.user_id) continue
    const value = resolveSettingValue(row).trim()
    if (!value) continue
    const existing = byUser.get(row.user_id) || {}
    existing[row.key] = value
    byUser.set(row.user_id, existing)
  }

  const accounts: Record<string, FeishuAccountConfig> = {}
  for (const [userId, values] of byUser.entries()) {
    const jsonMain = parseUserMainAccountFromJson(values.feishu_accounts_json)

    const appId = values.feishu_app_id?.trim() || jsonMain.appId
    const appSecret = values.feishu_app_secret?.trim() || jsonMain.appSecret
    const appSecretFile = values.feishu_app_secret_file?.trim() || jsonMain.appSecretFile
    if (!appId || (!appSecret && !appSecretFile)) continue

    const configuredAllowFrom = parseFeishuAllowFrom(values.feishu_allow_from)
    const targetFeishuId = resolveFeishuIdFromTarget(values.feishu_target)
    const mergedAllowFrom = Array.from(
      new Set([
        ...(jsonMain.allowFrom || []),
        ...configuredAllowFrom,
        ...(targetFeishuId ? [targetFeishuId] : []),
      ])
    )

    const configuredDmPolicy = normalizeFeishuDmPolicy(values.feishu_dm_policy)
    const effectiveDmPolicy: FeishuDmPolicy | undefined = mergedAllowFrom.length > 0
      ? 'allowlist'
      : configuredDmPolicy || jsonMain.dmPolicy

    const configuredGroupAllowFrom = parseFeishuAllowFrom(values.feishu_group_allow_from)
    const mergedGroupAllowFrom = Array.from(
      new Set([
        ...(jsonMain.groupAllowFrom || []),
        ...configuredGroupAllowFrom,
      ])
    )

    const configuredGroupPolicy = normalizeFeishuGroupPolicy(values.feishu_group_policy)
    const configuredAuthMode = normalizeFeishuAuthMode(values.feishu_auth_mode)
    const configuredRequireTenantKey = readBoolean(values.feishu_require_tenant_key)
    const configuredStrictAutoBind = readBoolean(values.feishu_strict_auto_bind)

    const accountId = getFeishuAccountIdForUser(userId)
    accounts[accountId] = {
      appId,
      appSecret,
      appSecretFile,
      botName: values.feishu_bot_name?.trim() || jsonMain.botName || undefined,
      domain: values.feishu_domain?.trim() || jsonMain.domain || undefined,
      dmPolicy: effectiveDmPolicy,
      groupPolicy: configuredGroupPolicy || jsonMain.groupPolicy,
      allowFrom: mergedAllowFrom.length > 0 ? mergedAllowFrom : undefined,
      groupAllowFrom: mergedGroupAllowFrom.length > 0 ? mergedGroupAllowFrom : undefined,
      cardCallbackPath: jsonMain.cardCallbackPath,
      cardVerificationToken: jsonMain.cardVerificationToken,
      cardEncryptKey: jsonMain.cardEncryptKey,
      cardConfirmUrl: jsonMain.cardConfirmUrl,
      cardConfirmAuthToken: jsonMain.cardConfirmAuthToken,
      cardConfirmTimeoutMs: jsonMain.cardConfirmTimeoutMs,
      authMode: configuredAuthMode || jsonMain.authMode,
      requireTenantKey: configuredRequireTenantKey ?? jsonMain.requireTenantKey,
      strictAutoBind: configuredStrictAutoBind ?? jsonMain.strictAutoBind,
      enabled: true,
      name: jsonMain.name || `user-${userId}`,
    }
  }

  return accounts
}

export async function collectUserFeishuBindingAccounts(): Promise<Record<string, FeishuBindingAccountConfig>> {
  const db = await getDatabase()
  const placeholders = FEISHU_BINDING_USER_KEYS.map(() => '?').join(', ')
  const rows = await db.query<SystemSetting>(
    `SELECT user_id, key, value
     FROM system_settings
     WHERE category = ?
       AND user_id IS NOT NULL
       AND key IN (${placeholders})`,
    ['openclaw', ...FEISHU_BINDING_USER_KEYS]
  )

  const byUser = new Map<number, Record<string, string>>()
  for (const row of rows) {
    if (!row.user_id) continue
    const value = String(row.value || '').trim()
    if (!value) continue
    const existing = byUser.get(row.user_id) || {}
    existing[row.key] = value
    byUser.set(row.user_id, existing)
  }

  const accounts: Record<string, FeishuBindingAccountConfig> = {}
  for (const [userId, values] of byUser.entries()) {
    const configuredAllowFrom = parseFeishuAllowFrom(values.feishu_allow_from)
    const targetFeishuId = resolveFeishuIdFromTarget(values.feishu_target)
    const mergedAllowFrom = Array.from(
      new Set([
        ...configuredAllowFrom,
        ...(targetFeishuId ? [targetFeishuId] : []),
      ])
    )

    const configuredAuthMode = normalizeFeishuAuthMode(values.feishu_auth_mode)
    const configuredRequireTenantKey = readBoolean(values.feishu_require_tenant_key)
    const configuredStrictAutoBind = readBoolean(values.feishu_strict_auto_bind)

    const accountId = getFeishuAccountIdForUser(userId)
    accounts[accountId] = {
      allowFrom: mergedAllowFrom.length > 0 ? mergedAllowFrom : undefined,
      authMode: configuredAuthMode,
      requireTenantKey: configuredRequireTenantKey,
      strictAutoBind: configuredStrictAutoBind,
    }
  }

  return accounts
}
