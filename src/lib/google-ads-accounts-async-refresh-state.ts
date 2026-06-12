import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { datetimeMinusHours, datetimeMinusMinutes } from '@/lib/db-helpers'
import { getRedisClient } from '@/lib/redis-client'

/** 异步账号刷新状态 TTL（与 Redis key 过期、running  freshness 一致） */
const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS = 10 * 60 * 1000

/** 已完成刷新在 Redis 中的短 TTL（running 互斥已结束） */
const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_COMPLETED_TTL_SEC = 60

/** 失败状态保留更久，供 UI 展示 refreshError */
const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_FAILED_TTL_SEC = 600

/** 长 sync 期间续期锁的间隔（须小于 TTL） */
const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_HEARTBEAT_MS = 3 * 60 * 1000

/** DB 历史行保留时长 */
const GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_ROW_RETENTION_MS = 24 * 60 * 60 * 1000

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

let lastRowCleanupAtMs = 0
const ROW_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

function buildRedisKey(syncKey: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:accounts-async-refresh:${syncKey}`
}

function redisTtlSeconds(): number {
  return Math.ceil(GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS / 1000)
}

function redisTtlSecondsForState(state: GoogleAdsAccountAsyncRefreshState): number {
  if (state.status === 'completed') {
    return GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_COMPLETED_TTL_SEC
  }
  if (state.status === 'failed') {
    return GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_FAILED_TTL_SEC
  }
  return redisTtlSeconds()
}

function toDbTimestamp(ms: number): string {
  return new Date(ms).toISOString()
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
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : undefined,
    }
  } catch {
    return null
  }
}

function isRunningStateFresh(
  state: GoogleAdsAccountAsyncRefreshState,
  nowMs = Date.now()
): boolean {
  if (state.status !== 'running') return false
  return nowMs - state.updatedAtMs <= GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS
}

export function buildGoogleAdsAccountSyncKey(params: GoogleAdsAccountSyncKeyParams): string {
  return `${params.userId}:${params.authType}:${params.serviceAccountId || ''}`
}

async function readStateFromRedis(
  syncKey: string
): Promise<GoogleAdsAccountAsyncRefreshState | null> {
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
    await client.set(
      buildRedisKey(syncKey),
      serializeState(state),
      'EX',
      redisTtlSecondsForState(state)
    )
  } catch {
    // Redis 不可用时由 DB 兜底
  }
}

async function releaseGoogleAdsAccountAsyncRefreshLock(syncKey: string): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.del(buildRedisKey(syncKey))
  } catch {
    // ignore
  }
}

async function readStateFromDb(syncKey: string): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  const db = await getDatabase()
  const row = (await db.queryOne(
    `
      SELECT status, started_at, updated_at, error_message
      FROM google_ads_accounts_async_refresh_state
      WHERE sync_key = ?
    `,
    [syncKey]
  )) as
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
  const startedAt = toDbTimestamp(state.startedAtMs)
  const updatedAt = toDbTimestamp(state.updatedAtMs)
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
    Math.ceil(GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS / 60_000)
  )
  const nowMs = Date.now()
  const startedAt = toDbTimestamp(nowMs)
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
    [syncKey, params.userId, params.authType, params.serviceAccountId || null, startedAt, updatedAt]
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

/** @internal test-only */
export function resetGoogleAdsAccountAsyncRefreshCleanupThrottleForTests(): void {
  lastRowCleanupAtMs = 0
}

/** 删除超过保留期的历史行（节流，避免每次请求都扫表） */
export async function cleanupStaleGoogleAdsAccountAsyncRefreshRows(): Promise<void> {
  const nowMs = Date.now()
  if (nowMs - lastRowCleanupAtMs < ROW_CLEANUP_INTERVAL_MS) {
    return
  }
  lastRowCleanupAtMs = nowMs

  const db = await getDatabase()
  const retentionHours = Math.ceil(GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_ROW_RETENTION_MS / 3_600_000)
  const cutoff = datetimeMinusHours(retentionHours)

  try {
    await db.exec(
      `
        DELETE FROM google_ads_accounts_async_refresh_state
        WHERE updated_at < ${cutoff}
      `
    )
  } catch {
    // 表未迁移等场景下静默跳过
  }
}

export async function getGoogleAdsAccountAsyncRefreshState(
  syncKey: string
): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  void cleanupStaleGoogleAdsAccountAsyncRefreshRows()

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

export async function renewGoogleAdsAccountAsyncRefreshLock(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams,
  startedAtMs: number
): Promise<void> {
  const nowMs = Date.now()
  const state: GoogleAdsAccountAsyncRefreshState = {
    status: 'running',
    startedAtMs,
    updatedAtMs: nowMs,
  }

  await writeStateToRedis(syncKey, state)
  await writeStateToDb(syncKey, params, state)
}

/**
 * 长 sync 期间定期续期 Redis TTL 与 DB updated_at，避免 10 分钟 TTL 导致重复 sync。
 * 返回 stop 函数，须在 sync 结束（成功/失败）时调用。
 */
export function startGoogleAdsAccountAsyncRefreshHeartbeat(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams,
  startedAtMs: number
): () => void {
  const timer = setInterval(() => {
    void renewGoogleAdsAccountAsyncRefreshLock(syncKey, params, startedAtMs)
  }, GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_HEARTBEAT_MS)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  return () => clearInterval(timer)
}

export type GoogleAdsAccountAsyncRefreshStartResult =
  | { started: true; startedAtMs: number }
  | { started: false }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForGoogleAdsAccountAsyncRefreshToSettle(
  syncKey: string,
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<GoogleAdsAccountAsyncRefreshState | null> {
  const timeoutMs = options?.timeoutMs ?? GOOGLE_ADS_ACCOUNT_ASYNC_REFRESH_TTL_MS
  const pollMs = options?.pollMs ?? 1000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const state = await getGoogleAdsAccountAsyncRefreshState(syncKey)
    if (!isGoogleAdsAccountRefreshInProgress(state)) {
      return state
    }
    await sleep(pollMs)
  }

  return getGoogleAdsAccountAsyncRefreshState(syncKey)
}

export async function tryStartGoogleAdsAccountAsyncRefresh(
  syncKey: string,
  params: GoogleAdsAccountSyncKeyParams
): Promise<GoogleAdsAccountAsyncRefreshStartResult> {
  void cleanupStaleGoogleAdsAccountAsyncRefreshRows()

  const existing = await getGoogleAdsAccountAsyncRefreshState(syncKey)
  if (existing && isRunningStateFresh(existing)) {
    return { started: false }
  }

  const acquiredInRedis = await tryAcquireLockInRedis(syncKey)
  if (acquiredInRedis) {
    const nowMs = Date.now()
    const runningState: GoogleAdsAccountAsyncRefreshState = {
      status: 'running',
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
    }
    try {
      await writeStateToDb(syncKey, params, runningState)
      return { started: true, startedAtMs: nowMs }
    } catch {
      await releaseGoogleAdsAccountAsyncRefreshLock(syncKey)
    }
  } else if (getRedisClient()) {
    const afterRedisRace = await getGoogleAdsAccountAsyncRefreshState(syncKey)
    if (afterRedisRace && isRunningStateFresh(afterRedisRace)) {
      return { started: false }
    }
  }

  const acquiredInDb = await tryAcquireLockInDb(syncKey, params).catch(() => false)
  if (acquiredInDb) {
    const nowMs = Date.now()
    await writeStateToRedis(syncKey, {
      status: 'running',
      startedAtMs: nowMs,
      updatedAtMs: nowMs,
    })
    return { started: true, startedAtMs: nowMs }
  }
  return { started: false }
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
