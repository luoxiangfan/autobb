import { REDIS_PREFIX_CONFIG } from '@/lib/common/server'
import { getRedisClient } from '@/lib/common/server'
import type { RunUrlSwapSitelinkTargetsSyncResult } from './run-sitelink-targets-sync'

const RUNNING_TTL_MS = 20 * 60 * 1000
const COMPLETED_TTL_SEC = 120
const FAILED_TTL_SEC = 600

export type UrlSwapSitelinkSyncStatus = 'running' | 'completed' | 'failed'

export type UrlSwapSitelinkSyncState = {
  status: UrlSwapSitelinkSyncStatus
  startedAtMs: number
  updatedAtMs: number
  errorMessage?: string
  result?: RunUrlSwapSitelinkTargetsSyncResult
}

export type UrlSwapSitelinkSyncStartResult =
  | { started: true; alreadyRunning: false }
  | { started: false; alreadyRunning: true }

const memoryStates = new Map<string, UrlSwapSitelinkSyncState>()

function buildSyncKey(taskId: string, userId: number): string {
  return `${userId}:${taskId}`
}

function buildRedisKey(syncKey: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}url-swap:sitelink-sync:${syncKey}`
}

function serializeState(state: UrlSwapSitelinkSyncState): string {
  return JSON.stringify(state)
}

function deserializeState(raw: string): UrlSwapSitelinkSyncState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UrlSwapSitelinkSyncState>
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
      result:
        parsed.result && typeof parsed.result === 'object'
          ? (parsed.result as RunUrlSwapSitelinkTargetsSyncResult)
          : undefined,
    }
  } catch {
    return null
  }
}

function isRunningStateFresh(state: UrlSwapSitelinkSyncState, nowMs = Date.now()): boolean {
  if (state.status !== 'running') return false
  return nowMs - state.updatedAtMs <= RUNNING_TTL_MS
}

function ttlSecondsForState(state: UrlSwapSitelinkSyncState): number {
  if (state.status === 'completed') return COMPLETED_TTL_SEC
  if (state.status === 'failed') return FAILED_TTL_SEC
  return Math.ceil(RUNNING_TTL_MS / 1000)
}

async function readState(syncKey: string): Promise<UrlSwapSitelinkSyncState | null> {
  const client = getRedisClient()
  if (client) {
    try {
      const raw = await client.get(buildRedisKey(syncKey))
      if (raw) {
        const parsed = deserializeState(raw)
        if (parsed) return parsed
      }
    } catch {
      // Redis 不可用时回退内存态
    }
  }

  return memoryStates.get(syncKey) ?? null
}

async function writeState(syncKey: string, state: UrlSwapSitelinkSyncState): Promise<void> {
  memoryStates.set(syncKey, state)

  const client = getRedisClient()
  if (!client) return

  try {
    await client.set(buildRedisKey(syncKey), serializeState(state), 'EX', ttlSecondsForState(state))
  } catch {
    // 内存态已写入，Redis 失败不阻断
  }
}

export async function getUrlSwapSitelinkSyncState(
  taskId: string,
  userId: number
): Promise<UrlSwapSitelinkSyncState | null> {
  const syncKey = buildSyncKey(taskId, userId)
  const state = await readState(syncKey)
  if (!state) return null
  if (state.status === 'running' && !isRunningStateFresh(state)) {
    return null
  }
  return state
}

export async function tryStartUrlSwapSitelinkSync(
  taskId: string,
  userId: number
): Promise<UrlSwapSitelinkSyncStartResult> {
  const syncKey = buildSyncKey(taskId, userId)
  const existing = await readState(syncKey)
  if (existing && isRunningStateFresh(existing)) {
    return { started: false, alreadyRunning: true }
  }

  const nowMs = Date.now()
  const runningState: UrlSwapSitelinkSyncState = {
    status: 'running',
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
  }

  const client = getRedisClient()
  if (client) {
    try {
      const acquired = await client.set(
        buildRedisKey(syncKey),
        serializeState(runningState),
        'EX',
        ttlSecondsForState(runningState),
        'NX'
      )
      if (acquired !== 'OK') {
        const afterRace = await readState(syncKey)
        if (afterRace && isRunningStateFresh(afterRace)) {
          return { started: false, alreadyRunning: true }
        }
      } else {
        memoryStates.set(syncKey, runningState)
        return { started: true, alreadyRunning: false }
      }
    } catch {
      // 回退内存锁
    }
  }

  if (existing && isRunningStateFresh(existing)) {
    return { started: false, alreadyRunning: true }
  }

  await writeState(syncKey, runningState)
  return { started: true, alreadyRunning: false }
}

export async function completeUrlSwapSitelinkSync(
  taskId: string,
  userId: number,
  result: RunUrlSwapSitelinkTargetsSyncResult
): Promise<void> {
  const nowMs = Date.now()
  const previous = await readState(buildSyncKey(taskId, userId))
  const state: UrlSwapSitelinkSyncState = {
    status: 'completed',
    startedAtMs: previous?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    result,
  }
  await writeState(buildSyncKey(taskId, userId), state)
}

export async function failUrlSwapSitelinkSync(
  taskId: string,
  userId: number,
  errorMessage: string
): Promise<void> {
  const nowMs = Date.now()
  const previous = await readState(buildSyncKey(taskId, userId))
  const state: UrlSwapSitelinkSyncState = {
    status: 'failed',
    startedAtMs: previous?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
    errorMessage,
  }
  await writeState(buildSyncKey(taskId, userId), state)
}

export function resetUrlSwapSitelinkSyncStateForTests(): void {
  memoryStates.clear()
}
