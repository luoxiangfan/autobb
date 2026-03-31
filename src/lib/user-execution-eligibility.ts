import { getDatabase, type DatabaseType } from '@/lib/db'
import { boolCondition, toBool } from '@/lib/db-helpers'

export const USER_EXECUTION_SUSPENDED_ERROR_CODE = 'USER_EXECUTION_SUSPENDED' as const

export type UserExecutionBlockReason =
  | 'user_not_found'
  | 'inactive'
  | 'package_expired'
  | 'eligibility_check_failed'

export type UserExecutionEligibility = {
  userId: number
  eligible: boolean
  reason?: UserExecutionBlockReason
}

const ELIGIBILITY_CACHE_TTL_MS = 1000
const DB_ERROR_FALLBACK_CACHE_TTL_MS = 300
const DAY_MS = 24 * 60 * 60 * 1000

type EligibilityCacheEntry = {
  expiresAt: number
  value: UserExecutionEligibility
}

const eligibilityCache = new Map<number, EligibilityCacheEntry>()

function normalizeAlias(alias?: string): string {
  const raw = String(alias || '').trim()
  if (!raw) return ''
  return raw.endsWith('.') ? raw : `${raw}.`
}

export function buildUserExecutionEligibleSql(params: {
  dbType: DatabaseType
  userAlias?: string
  nowExpr?: string
}): string {
  const userRef = normalizeAlias(params.userAlias)
  const activeExpr = boolCondition(`${userRef}is_active`, true, params.dbType)
  const nowExpr = params.nowExpr || (params.dbType === 'postgres' ? 'NOW()' : "datetime('now')")
  const packageExpiresAtExpr = `${userRef}package_expires_at`
  const packageExpr = params.dbType === 'postgres'
    ? `(${packageExpiresAtExpr} IS NULL OR NULLIF(BTRIM(${packageExpiresAtExpr}), '')::timestamptz >= ${nowExpr})`
    : `(${packageExpiresAtExpr} IS NULL OR datetime(${packageExpiresAtExpr}) >= ${nowExpr})`

  return `${activeExpr} AND ${packageExpr}`
}

export function hasPackageExpired(
  packageExpiresAt: string | null | undefined,
  now: Date = new Date(),
  opts?: { invalidAsExpired?: boolean }
): boolean {
  if (!packageExpiresAt) return false
  const parsed = new Date(packageExpiresAt)
  if (!Number.isFinite(parsed.getTime())) {
    return opts?.invalidAsExpired ?? true
  }
  return parsed.getTime() < now.getTime()
}

export function isExpiredOverDays(
  packageExpiresAt: string | null | undefined,
  days: number,
  now: Date = new Date()
): boolean {
  if (!packageExpiresAt) return false
  const parsed = new Date(packageExpiresAt)
  if (!Number.isFinite(parsed.getTime())) return false
  return now.getTime() - parsed.getTime() > Math.max(0, days) * DAY_MS
}

function resolveUserEligibility(params: {
  userId: number
  userRow?: { is_active: any; package_expires_at: string | null }
  now: Date
}): UserExecutionEligibility {
  const { userId, userRow, now } = params
  if (!userRow) {
    return { userId, eligible: false, reason: 'user_not_found' }
  }

  if (!toBool(userRow.is_active)) {
    return { userId, eligible: false, reason: 'inactive' }
  }

  if (hasPackageExpired(userRow.package_expires_at, now, { invalidAsExpired: true })) {
    return { userId, eligible: false, reason: 'package_expired' }
  }

  return { userId, eligible: true }
}

export async function getUserExecutionEligibility(
  userId: number,
  opts?: { now?: Date; bypassCache?: boolean }
): Promise<UserExecutionEligibility> {
  const normalizedUserId = Number(userId)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return { userId: normalizedUserId, eligible: true }
  }

  const now = opts?.now || new Date()
  const nowMs = now.getTime()
  const bypassCache = opts?.bypassCache === true

  if (!bypassCache) {
    const cached = eligibilityCache.get(normalizedUserId)
    if (cached && cached.expiresAt > nowMs) {
      return cached.value
    }
  }

  try {
    const db = getDatabase()
    const userRow = await db.queryOne<{ is_active: any; package_expires_at: string | null }>(
      'SELECT is_active, package_expires_at FROM users WHERE id = ?',
      [normalizedUserId]
    )

    const value = resolveUserEligibility({
      userId: normalizedUserId,
      userRow,
      now,
    })

    eligibilityCache.set(normalizedUserId, {
      expiresAt: nowMs + ELIGIBILITY_CACHE_TTL_MS,
      value,
    })

    return value
  } catch (error: any) {
    // 严格止血策略：资格检查失败时默认阻断执行，避免禁用用户在异常窗口继续消耗资源
    const fallback = {
      userId: normalizedUserId,
      eligible: false,
      reason: 'eligibility_check_failed',
    } satisfies UserExecutionEligibility
    eligibilityCache.set(normalizedUserId, {
      expiresAt: nowMs + DB_ERROR_FALLBACK_CACHE_TTL_MS,
      value: fallback,
    })

    console.error(
      `[user-execution-eligibility] check failed, block execution: userId=${normalizedUserId}, error=${error?.message || error}`
    )
    return fallback
  }
}

export function createUserExecutionSuspendedError(params: {
  userId: number
  reason: UserExecutionBlockReason
  source?: string
}): Error {
  const source = params.source ? ` (${params.source})` : ''
  const error = new Error(`User execution suspended${source}: userId=${params.userId}, reason=${params.reason}`)
  ;(error as any).code = USER_EXECUTION_SUSPENDED_ERROR_CODE
  ;(error as any).reason = params.reason
  ;(error as any).userId = params.userId
  return error
}

export async function assertUserExecutionAllowed(
  userId: number,
  opts?: { source?: string; bypassCache?: boolean }
): Promise<void> {
  const eligibility = await getUserExecutionEligibility(userId, { bypassCache: opts?.bypassCache })
  if (eligibility.eligible) return

  throw createUserExecutionSuspendedError({
    userId: eligibility.userId,
    reason: eligibility.reason || 'inactive',
    source: opts?.source,
  })
}

export function isUserExecutionSuspendedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as any).code === USER_EXECUTION_SUSPENDED_ERROR_CODE)
}

export function clearUserExecutionEligibilityCache(userId?: number): void {
  if (typeof userId === 'number' && Number.isFinite(userId) && userId > 0) {
    eligibilityCache.delete(userId)
    return
  }
  eligibilityCache.clear()
}
