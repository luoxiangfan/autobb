import { getDatabase } from '@/lib/db'
import {
  collectUserFeishuBindingAccounts,
  parseFeishuAccountUserId,
} from '@/lib/openclaw/feishu-accounts'

type FeishuAuthMode = 'strict' | 'compat'
type FeishuAuthSettings = {
  authMode: FeishuAuthMode
  requireTenantKey: boolean
  strictAutoBind: boolean
}
type FeishuAccountConfigForBinding = {
  allowFrom?: string[]
  authMode?: string
  requireTenantKey?: boolean
  strictAutoBind?: boolean
}

export type OpenclawBindingResolutionReason =
  | 'invalid_input'
  | 'strict_no_account_match'
  | 'strict_allowlist_without_tenant'
  | 'strict_require_tenant_key'
  | 'strict_account_without_tenant'
  | 'strict_tenant_binding_match'
  | 'strict_tenant_binding_conflict'
  | 'strict_auto_bind_disabled'
  | 'strict_auto_bind_success'
  | 'strict_auto_bind_failed'
  | 'account_id_resolved'
  | 'feishu_allowlist_no_tenant_match'
  | 'feishu_allowlist_tenant_fallback_match'
  | 'tenant_binding_match'
  | 'tenant_binding_no_match'
  | 'channel_binding_match'
  | 'channel_binding_no_match'

export type OpenclawBindingResolution = {
  userId: number | null
  reason: OpenclawBindingResolutionReason
  channel: string
  senderId: string
  accountId?: string
  tenantKeyProvided: boolean
  authMode?: FeishuAuthMode
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function resolveFeishuAuthMode(): FeishuAuthMode {
  const normalized = (process.env.OPENCLAW_FEISHU_AUTH_MODE || '').trim().toLowerCase()
  return normalized === 'compat' ? 'compat' : 'strict'
}

function resolveFeishuAuthSettingsFromOptions(params: {
  accountConfig?: FeishuAccountConfigForBinding | null
}): FeishuAuthSettings {
  const configModeRaw = String(params.accountConfig?.authMode || '').trim().toLowerCase()
  const authMode = configModeRaw === 'compat'
    ? 'compat'
    : configModeRaw === 'strict'
      ? 'strict'
      : resolveFeishuAuthMode()

  const requireTenantKey = typeof params.accountConfig?.requireTenantKey === 'boolean'
    ? params.accountConfig.requireTenantKey
    : resolveFeishuRequireTenantKey()

  const strictAutoBind = typeof params.accountConfig?.strictAutoBind === 'boolean'
    ? params.accountConfig.strictAutoBind
    : resolveFeishuStrictAutoBind()

  return { authMode, requireTenantKey, strictAutoBind }
}

async function collectFeishuAccountsSafe(): Promise<Record<string, FeishuAccountConfigForBinding> | null> {
  try {
    return await collectUserFeishuBindingAccounts()
  } catch (error) {
    console.warn('[openclaw] failed to collect feishu accounts for binding fallback:', error)
    return null
  }
}

async function resolveFeishuAuthSettingsForAccount(accountId?: string | null): Promise<{
  settings: FeishuAuthSettings
  accounts: Record<string, FeishuAccountConfigForBinding> | null
}> {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) {
    return {
      settings: resolveFeishuAuthSettingsFromOptions({ accountConfig: null }),
      accounts: null,
    }
  }

  const accounts = await collectFeishuAccountsSafe()
  if (!accounts) {
    return {
      settings: resolveFeishuAuthSettingsFromOptions({ accountConfig: null }),
      accounts: null,
    }
  }

  const accountConfig = accounts[normalizedAccountId] || null
  return {
    settings: resolveFeishuAuthSettingsFromOptions({ accountConfig }),
    accounts,
  }
}

function resolveFeishuRequireTenantKey(): boolean {
  return parseBooleanEnv(process.env.OPENCLAW_FEISHU_REQUIRE_TENANT_KEY, true)
}

function resolveFeishuStrictAutoBind(): boolean {
  return parseBooleanEnv(process.env.OPENCLAW_FEISHU_STRICT_AUTO_BIND, true)
}

function normalizeFeishuId(value?: string | null): string {
  return String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()
}

function isUniqueViolationError(error: unknown): boolean {
  const details = error as { code?: string; message?: string } | null
  if (!details) return false

  if (details.code === '23505') return true
  if (typeof details.code === 'string' && details.code.startsWith('SQLITE_CONSTRAINT')) return true

  const message = String(details.message || '')
  return /duplicate key value violates unique constraint/i.test(message)
    || /UNIQUE constraint failed/i.test(message)
}

function isFeishuSenderAllowlisted(senderId: string, allowFrom?: string[]): boolean {
  if (!Array.isArray(allowFrom) || allowFrom.length === 0) return false
  const normalizedSenderId = normalizeFeishuId(senderId)
  if (!normalizedSenderId) return false
  return allowFrom.some((entry) => normalizeFeishuId(entry) === normalizedSenderId)
}

async function findFeishuTenantBinding(params: {
  tenantKey: string
  senderId: string
}): Promise<number | null> {
  const db = await getDatabase()
  const scoped = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND tenant_key = ?
       AND status = 'active'
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.tenantKey, params.senderId, params.senderId]
  )
  return scoped?.user_id ?? null
}

async function ensureStrictFeishuBinding(params: {
  userId: number
  tenantKey: string
  senderId: string
}): Promise<boolean> {
  const db = await getDatabase()
  const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const existing = await db.queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id
     FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND tenant_key = ?
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.tenantKey, params.senderId, params.senderId]
  )

  if (existing && existing.user_id !== params.userId) {
    return false
  }

  if (existing) {
    await db.exec(
      `UPDATE openclaw_user_bindings
       SET tenant_key = ?,
           open_id = ?,
           union_id = ?,
           status = 'active',
           updated_at = ${nowSql}
       WHERE id = ?`,
      [params.tenantKey, params.senderId, params.senderId, existing.id]
    )
    return true
  }

  try {
    await db.exec(
      `INSERT INTO openclaw_user_bindings (user_id, channel, tenant_key, open_id, union_id, status)
       VALUES (?, 'feishu', ?, ?, ?, 'active')`,
      [params.userId, params.tenantKey, params.senderId, params.senderId]
    )
    return true
  } catch (error) {
    if (!isUniqueViolationError(error)) {
      throw error
    }
  }

  const scopedAfterConflict = await db.queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id
     FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND tenant_key = ?
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.tenantKey, params.senderId, params.senderId]
  )

  if (scopedAfterConflict) {
    return scopedAfterConflict.user_id === params.userId
  }

  // Compatibility fallback: legacy schema may still enforce UNIQUE(channel, open_id).
  const legacyGlobal = await db.queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id
     FROM openclaw_user_bindings
     WHERE channel = 'feishu'
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [params.senderId, params.senderId]
  )

  if (!legacyGlobal) {
    return false
  }

  if (legacyGlobal.user_id !== params.userId) {
    return false
  }

  await db.exec(
    `UPDATE openclaw_user_bindings
     SET status = 'active',
         updated_at = ${nowSql}
     WHERE id = ?`,
    [legacyGlobal.id]
  )
  return true
}

async function resolveStrictFeishuUser(params: {
  accountUserId: number | null
  senderId: string
  tenantKey?: string
  requireTenantKey: boolean
  strictAutoBind: boolean
  allowFrom?: string[]
}): Promise<{ userId: number | null; reason: OpenclawBindingResolutionReason }> {
  if (!params.accountUserId) {
    return { userId: null, reason: 'strict_no_account_match' }
  }

  if (!params.tenantKey) {
    if (params.requireTenantKey) {
      return isFeishuSenderAllowlisted(params.senderId, params.allowFrom)
        ? { userId: params.accountUserId, reason: 'strict_allowlist_without_tenant' }
        : { userId: null, reason: 'strict_require_tenant_key' }
    }
    return { userId: params.accountUserId, reason: 'strict_account_without_tenant' }
  }

  const tenantBindingUserId = await findFeishuTenantBinding({
    tenantKey: params.tenantKey,
    senderId: params.senderId,
  })

  if (tenantBindingUserId) {
    if (tenantBindingUserId !== params.accountUserId) {
      return { userId: null, reason: 'strict_tenant_binding_conflict' }
    }
    return { userId: tenantBindingUserId, reason: 'strict_tenant_binding_match' }
  }

  if (!params.strictAutoBind) {
    return { userId: null, reason: 'strict_auto_bind_disabled' }
  }

  const bound = await ensureStrictFeishuBinding({
    userId: params.accountUserId,
    tenantKey: params.tenantKey,
    senderId: params.senderId,
  })

  return bound
    ? { userId: params.accountUserId, reason: 'strict_auto_bind_success' }
    : { userId: null, reason: 'strict_auto_bind_failed' }
}

async function resolveFeishuUserFromAllowlist(
  senderId: string,
  preloadedAccounts?: Record<string, FeishuAccountConfigForBinding> | null
): Promise<number | null> {
  const normalizedSenderId = normalizeFeishuId(senderId)
  if (!normalizedSenderId) return null

  const accounts = preloadedAccounts ?? await collectFeishuAccountsSafe()
  if (!accounts) {
    return null
  }

  const matchedUserIds = new Set<number>()

  for (const [accountId, accountConfig] of Object.entries(accounts)) {
    const userId = parseFeishuAccountUserId(accountId)
    if (!userId) continue

    const allowFrom = Array.isArray(accountConfig?.allowFrom)
      ? accountConfig.allowFrom
      : []
    if (allowFrom.length === 0) continue

    const isAllowed = allowFrom.some((entry) => normalizeFeishuId(entry) === normalizedSenderId)
    if (isAllowed) {
      matchedUserIds.add(userId)
    }
  }

  if (matchedUserIds.size !== 1) return null
  return Array.from(matchedUserIds)[0] ?? null
}

export async function resolveOpenclawUserFromBindingDebug(
  channel?: string | null,
  senderId?: string | null,
  options?: { accountId?: string | null; tenantKey?: string | null }
): Promise<OpenclawBindingResolution> {
  const accountId = (options?.accountId || '').trim()
  const accountUserId = parseFeishuAccountUserId(accountId)
  const normalizedChannel = (channel || '').trim()
  const normalizedSenderId = (senderId || '').trim()
  if (!normalizedChannel || !normalizedSenderId) {
    return {
      userId: null,
      reason: 'invalid_input',
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      accountId: accountId || undefined,
      tenantKeyProvided: Boolean((options?.tenantKey || '').trim()),
    }
  }

  const tenantKey = (options?.tenantKey || '').trim() || undefined
  const isFeishu = normalizedChannel.toLowerCase() === 'feishu'

  let feishuSettings: FeishuAuthSettings | null = null
  let feishuAccounts: Record<string, FeishuAccountConfigForBinding> | null = null
  if (isFeishu) {
    const resolved = await resolveFeishuAuthSettingsForAccount(accountId)
    feishuSettings = resolved.settings
    feishuAccounts = resolved.accounts
  }

  if (isFeishu && feishuSettings?.authMode === 'strict') {
    const strictAccounts = feishuAccounts ?? await collectFeishuAccountsSafe()
    const strictAccountUserId = accountUserId
      || await resolveFeishuUserFromAllowlist(normalizedSenderId, strictAccounts)
    const strictAccountAllowFrom = strictAccountUserId
      ? (Array.isArray(strictAccounts?.[`user-${strictAccountUserId}`]?.allowFrom)
        ? strictAccounts?.[`user-${strictAccountUserId}`]?.allowFrom
        : undefined)
      : undefined

    const strictResolution = await resolveStrictFeishuUser({
      accountUserId: strictAccountUserId,
      senderId: normalizedSenderId,
      tenantKey,
      requireTenantKey: feishuSettings.requireTenantKey,
      strictAutoBind: feishuSettings.strictAutoBind,
      allowFrom: strictAccountAllowFrom,
    })

    return {
      userId: strictResolution.userId,
      reason: strictResolution.reason,
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      accountId: accountId || undefined,
      tenantKeyProvided: Boolean(tenantKey),
      authMode: 'strict',
    }
  }

  if (accountUserId) {
    return {
      userId: accountUserId,
      reason: 'account_id_resolved',
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      accountId: accountId || undefined,
      tenantKeyProvided: Boolean(tenantKey),
      authMode: isFeishu ? 'compat' : undefined,
    }
  }

  if (isFeishu && !tenantKey) {
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
    return {
      userId: feishuFallback,
      reason: feishuFallback ? 'feishu_allowlist_no_tenant_match' : 'channel_binding_no_match',
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      accountId: accountId || undefined,
      tenantKeyProvided: false,
      authMode: 'compat',
    }
  }

  const db = await getDatabase()

  if (tenantKey) {
    const scoped = await db.queryOne<{ user_id: number }>(
      `SELECT user_id FROM openclaw_user_bindings
       WHERE channel = ?
         AND tenant_key = ?
         AND status = 'active'
         AND (open_id = ? OR union_id = ?)
       LIMIT 1`,
      [normalizedChannel, tenantKey, normalizedSenderId, normalizedSenderId]
    )

    if (scoped?.user_id) {
      return {
        userId: scoped.user_id,
        reason: 'tenant_binding_match',
        channel: normalizedChannel,
        senderId: normalizedSenderId,
        accountId: accountId || undefined,
        tenantKeyProvided: true,
        authMode: isFeishu ? 'compat' : undefined,
      }
    }

    if (isFeishu) {
      const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
      return {
        userId: feishuFallback,
        reason: feishuFallback ? 'feishu_allowlist_tenant_fallback_match' : 'tenant_binding_no_match',
        channel: normalizedChannel,
        senderId: normalizedSenderId,
        accountId: accountId || undefined,
        tenantKeyProvided: true,
        authMode: 'compat',
      }
    }
  }

  if (isFeishu) {
    const feishuFallback = await resolveFeishuUserFromAllowlist(normalizedSenderId, feishuAccounts)
    return {
      userId: feishuFallback,
      reason: feishuFallback ? 'feishu_allowlist_no_tenant_match' : 'channel_binding_no_match',
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      accountId: accountId || undefined,
      tenantKeyProvided: false,
      authMode: 'compat',
    }
  }

  const record = await db.queryOne<{ user_id: number }>(
    `SELECT user_id FROM openclaw_user_bindings
     WHERE channel = ?
       AND status = 'active'
       AND (open_id = ? OR union_id = ?)
     LIMIT 1`,
    [normalizedChannel, normalizedSenderId, normalizedSenderId]
  )

  return {
    userId: record?.user_id ?? null,
    reason: record?.user_id ? 'channel_binding_match' : 'channel_binding_no_match',
    channel: normalizedChannel,
    senderId: normalizedSenderId,
    accountId: accountId || undefined,
    tenantKeyProvided: Boolean(tenantKey),
  }
}

export async function resolveOpenclawUserFromBinding(
  channel?: string | null,
  senderId?: string | null,
  options?: { accountId?: string | null; tenantKey?: string | null }
): Promise<number | null> {
  const resolved = await resolveOpenclawUserFromBindingDebug(channel, senderId, options)
  return resolved.userId
}
