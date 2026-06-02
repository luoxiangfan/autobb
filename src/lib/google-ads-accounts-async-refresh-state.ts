import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { datetimeMinusMinutes } from '@/lib/db-helpers'
import { getRedisClient } from '@/lib/redis-client'

/** 异步账号刷新状态 TTL（与 Redis key 过期一致） */
export const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS = 10 * 60 * 1000

export type GoogleAdsAccountAsyncRefreshStatus = 'running' | 'completed' | 'failed'

export type GoogleAdsAccountAsyncRefreshState = {
  status: GoogleAdsAccountAsyncRefreshStatus
  startedAtMs: number
  updatedAtMs: number
  errorMessage?: string
}

export type GoogleAdsAccountSyncKeyParams = {
  userId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string | null
}

function buildRedisKey(syncKey: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:accounts-async-refresh:${syncKey}`
}

function redisTtlSeconds(): number {
  return Math.ceil(GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS / 1000)
}

function parseTimestampToMs(value: unknown): number {
  if (value == null) return NaN
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
    return Date.parse(text.replace(' ', 'T') + 'Z')
  }
  return Date.parse(text)
}

function serializeState(state: GoogleAdsAccountAsyncRefreshState): string {
  return JSON.stringify(state)
}

function deserializeState(raw: string): GoogleAdsAccountAsyncRefreshState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleAdsAccountAsyncRefreshState>
    if (
      parsed.status !== 'running' &&
      parsed.status !== 'completed' &&
      parsed.status !== 'failed'
    ) {
      return null
    }
    const startedAtMs = Number(parsed.startedAtMs)
    const updatedAtMs = Number(parsed.updatedAtMs)
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(updatedAtMs)) {
      return null
    }
    return {
      status: parsed.status,
      startedAtMs,
      updatedAtMs,
      errorMessage:
        typeof parsed.errorMessage === 'string' ? parsed.errorMessage : undefined,
    }
  } catch {
    return null
  }
}

function isRunningStateFresh(state: GoogleAdsAccountAsyncRefreshState, nowMs = Date.now()): boolean {
  if (state.status !== 'running') return false
  return nowMs - state.updatedAtMs <= GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS
}

export function buildGoogleAdsAccountSyncKey(params: GoogleAdsAccountSyncKeyParams): string {
  return `${params.userId}:${params.authType}:${params.serviceAccountId || ''}`
}

async function readStateFromRedis(syncKey: string): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  const client = getRedisClient()
  if (!client) return null

  try {
    const raw = await client.get(buildRedisKey(syncKey))
    if (!raw) return null
    return deserializeState(raw)
  } catch {
    return null
  }
}

async function writeStateToRedis(
  syncKey: string,
  state: GoogleAdsAccountAsyncRefreshState
): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.set(buildRedisKey(syncKey), serializeState(state), 'EX', redisTtlSeconds())
  } catch {
    // Redis 不可用时由 DB 兜底
  }
}

async function readStateFromDb(syncKey: string): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  const db = await getDatabase()
  const row = await db.queryOne(
    `
      SELECT status, started_at, updated_at, error_message
      FROM google_ads_accounts_async_refresh_state
      WHERE sync_key = ?
    `,
    [syncKey]
  ) as
    | {
        status: GoogleAdsAccountAsyncRefreshStatus
        started_at: string
        updated_at: string
        error_message: string | null
      }
    | undefined

  if (!row) return null

  const state: GoogleAdsAccountAsyncRefreshState = {
    status: row.status,
    startedAtMs: parseTimestampToMs(row.started_at),
    updatedAtMs: parseTimestampToMs(row.updated_at),
    errorMessage: row.error_message || undefined,
  }

  if (state.status === 'running' && !isRunningStateFresh(state)) {
    return null
  }

  return state
}

async function writeStateToDb(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams,
  state: GoogleAdsAccountAsyncRefreshState
): Promise<void> {
  const db = await getDatabase()
  const startedAt = new Date(state.startedAtMs).toISOString()
  const updatedAt = new Date(state.updatedAtMs).toISOString()
  const errorMessage = state.errorMessage ?? null

  await db.exec(
    `
      INSERT INTO google_ads_accounts_async_refresh_state (
        sync_key,
        user_id,
        auth_type,
        service_account_id,
        status,
        started_at,
        updated_at,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sync_key) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        error_message = excluded.error_message
    `,
    [
      syncKey,
      params.userId,
      params.authType,
      params.serviceAccountId || null,
      state.status,
      startedAt,
      updatedAt,
      errorMessage,
    ]
  )
}

async function tryAcquireLockInDb(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams
): Promise<boolean> {
  const db = await getDatabase()
  const staleBefore = datetimeMinusMinutes(
    Math.ceil(GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS / 60_000),
    db.type
  )
  const startedAt = new Date().toISOString()
  const updatedAt = startedAt

  const result = await db.exec(
    `
      INSERT INTO google_ads_accounts_async_refresh_state (
        sync_key,
        user_id,
        auth_type,
        service_account_id,
        status,
        started_at,
        updated_at,
        error_message
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, NULL)
      ON CONFLICT(sync_key) DO UPDATE SET
        status = 'running',
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        error_message = NULL
      WHERE google_ads_accounts_async_refresh_state.status <> 'running'
         OR google_ads_accounts_async_refresh_state.updated_at < ${staleBefore}
    `,
    [
      syncKey,
      params.userId,
      params.authType,
      params.serviceAccountId || null,
      startedAt,
      updatedAt,
    ]
  )

  return (result?.changes ?? 0) > 0
}

async function tryAcquireLockInRedis(syncKey: string): Promise<boolean> {
  const client = getRedisClient()
  if (!client) return false

  const nowMs = Date.now()
  const state: GoogleAdsAccountAsyncRefreshState = {
    status: 'running',
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
  }

  try {
    const result = await client.set(
      buildRedisKey(syncKey),
      serializeState(state),
      'EX',
      redisTtlSeconds(),
      'NX'
    )
    return result === 'OK'
  } catch {
    return false
  }
}

export async function getGoogleAdsAccountAsyncRefreshState(
  syncKey: string
): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  const fromRedis = await readStateFromRedis(syncKey)
  if (fromRedis) {
    if (fromRedis.status === 'running' && !isRunningStateFresh(fromRedis)) {
      return null
    }
    return fromRedis
  }

  const fromDb = await readStateFromDb(syncKey)
  if (fromDb) {
    void writeStateToRedis(syncKey, fromDb)
  }
  return fromDb
}

export async function tryStartGoogleAdsAccountAsyncRefresh(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams
): Promise<boolean> {
  const existing = await getGoogleAdsAccountAsyncRefreshState(syncKey)
  if (existing && isRunningStateFresh(existing)) {
    return false
  }

  const acquiredInRedis = await tryAcquireLockInRedis(syncKey)
  if (acquiredInRedis) {
    const nowMs = Date.now()
    void writeStateToDb(syncKey, params, {
      status: 'running',
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
    })
    return true
  }

  if (getRedisClient()) {
    const afterRedisRace = await getGoogleAdsAccountAsyncRefreshState(syncKey)
    if (afterRedisRace && isRunningStateFresh(afterRedisRace)) {
      return false
    }
  }

  const acquiredInDb = await tryAcquireLockInDb(syncKey, params)
  if (acquiredInDb) {
    const nowMs = Date.now()
    await writeStateToRedis(syncKey, {
      status: 'running',
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
    })
  }
  return acquiredInDb
}

export async function completeGoogleAdsAccountAsyncRefresh(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams,
  outcome: { status: 'completed' } | { status: 'failed'; errorMessage: string }
): Promise<void> {
  const previous = await getGoogleAdsAccountAsyncRefreshState(syncKey)
  const nowMs = Date.now()
  const state: GoogleAdsAccountAsyncRefreshState = {
    status: outcome.status,
    startedAtMs: previous?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    errorMessage: outcome.status === 'failed' ? outcome.errorMessage : undefined,
  }

  await writeStateToRedis(syncKey, state)
  await writeStateToDb(syncKey, params, state)
}

export function isGoogleAdsAccountRefreshInProgress(
  state: GoogleAdsAccountAsyncRefreshState | null | undefined
): boolean {
  return Boolean(state && isRunningStateFresh(state))
}
