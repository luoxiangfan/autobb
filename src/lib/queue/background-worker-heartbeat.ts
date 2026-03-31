import { getRedisClient } from '@/lib/redis-client'
import { REDIS_PREFIX_CONFIG } from '@/lib/config'

const HEARTBEAT_TTL_SECONDS = (() => {
  const n = parseInt(process.env.BACKGROUND_WORKER_HEARTBEAT_TTL || '15', 10)
  return Number.isFinite(n) && n > 0 ? n : 15
})()

const HEARTBEAT_KEY =
  process.env.BACKGROUND_WORKER_HEARTBEAT_KEY ||
  `${REDIS_PREFIX_CONFIG.queueBackground}worker:heartbeat`

export type BackgroundWorkerHeartbeatPayload = {
  instanceId?: string
  pid?: number
  ts: string
  env: string
}

export async function setBackgroundWorkerHeartbeat(payload: BackgroundWorkerHeartbeatPayload): Promise<boolean> {
  const client = getRedisClient()
  if (!client) return false

  try {
    await client.set(HEARTBEAT_KEY, JSON.stringify(payload), 'EX', HEARTBEAT_TTL_SECONDS)
    return true
  } catch {
    return false
  }
}

export async function isBackgroundWorkerAlive(): Promise<boolean> {
  const client = getRedisClient()
  if (!client) return false

  try {
    const value = await client.get(HEARTBEAT_KEY)
    return Boolean(value)
  } catch {
    return false
  }
}

export function getBackgroundWorkerHeartbeatKey(): string {
  return HEARTBEAT_KEY
}

export function getBackgroundWorkerHeartbeatTtlSeconds(): number {
  return HEARTBEAT_TTL_SECONDS
}
