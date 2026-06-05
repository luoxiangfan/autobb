import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis-client'
import {
  stripGoogleAdsAuthContextForCache,
  normalizeCachedAuthContextPayload,
} from './google-ads-auth-context-cache'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'

/** 与进程内 authContextCache TTL 对齐（写路径有 generation 失效，可适当拉长减轻 DB 压力） */
export const GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC = 30

/** 进程内 auth-context 缓存 TTL（毫秒），须与 Redis EX 一致 */
export const GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS =
  GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC * 1000

/** 跨实例 inflight 锁 TTL（加载应在数秒内完成） */
export const GOOGLE_ADS_AUTH_CONTEXT_INFLIGHT_LOCK_TTL_SEC = 8

/** 等待其它实例写入 Redis 缓存的最长时间 */
export const GOOGLE_ADS_AUTH_CONTEXT_PEER_WAIT_MS = 7_000

/** 二次 peer 等待（锁重试后） */
export const GOOGLE_ADS_AUTH_CONTEXT_PEER_RETRY_WAIT_MS = 2_000

const PEER_POLL_INTERVAL_MS = 50

export type GoogleAdsAuthContextRedisPayload = {
  generation: number
  ctx: GoogleAdsAuthContext
}

function cacheKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:auth-context:${userId}`
}

function inflightKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:auth-context:inflight:${userId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRedisAuthContextPayload(
  raw: string,
  minGeneration: number
): GoogleAdsAuthContext | null {
  const parsed = JSON.parse(raw) as unknown
  if (parsed && typeof parsed === 'object' && 'ctx' in parsed && 'generation' in parsed) {
    const payload = parsed as GoogleAdsAuthContextRedisPayload
    if (
      typeof payload.generation !== 'number' ||
      payload.generation < minGeneration ||
      !payload.ctx
    ) {
      return null
    }
    return normalizeCachedAuthContextPayload(payload.ctx)
  }

  // 旧格式（无 generation）：仅在 minGeneration=0 时接受，读后立即 strip
  if (minGeneration > 0) {
    return null
  }
  return normalizeCachedAuthContextPayload(parsed as GoogleAdsAuthContext)
}

export async function readGoogleAdsAuthContextFromRedis(
  userId: number,
  options?: { minGeneration?: number }
): Promise<GoogleAdsAuthContext | null> {
  const client = getRedisClient()
  if (!client) return null
  const minGeneration = options?.minGeneration ?? 0

  try {
    const raw = await client.get(cacheKey(userId))
    if (!raw) return null
    return parseRedisAuthContextPayload(raw, minGeneration)
  } catch {
    return null
  }
}

export async function writeGoogleAdsAuthContextToRedis(
  userId: number,
  ctx: GoogleAdsAuthContext,
  generation: number
): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  const payload: GoogleAdsAuthContextRedisPayload = {
    generation,
    ctx: stripGoogleAdsAuthContextForCache(ctx),
  }

  try {
    await client.set(
      cacheKey(userId),
      JSON.stringify(payload),
      'EX',
      GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC
    )
  } catch {
    // Redis 不可用时由进程内缓存兜底
  }
}

export async function tryAcquireGoogleAdsAuthContextInflightLock(userId: number): Promise<boolean> {
  const client = getRedisClient()
  if (!client) return true

  try {
    const result = await client.set(
      inflightKey(userId),
      '1',
      'EX',
      GOOGLE_ADS_AUTH_CONTEXT_INFLIGHT_LOCK_TTL_SEC,
      'NX'
    )
    return result === 'OK'
  } catch {
    return true
  }
}

export async function releaseGoogleAdsAuthContextInflightLock(userId: number): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.del(inflightKey(userId))
  } catch {
    // ignore
  }
}

export async function waitForPeerGoogleAdsAuthContext(
  userId: number,
  options?: { minGeneration?: number; maxWaitMs?: number }
): Promise<GoogleAdsAuthContext | null> {
  const minGeneration = options?.minGeneration ?? 0
  const maxWaitMs = options?.maxWaitMs ?? GOOGLE_ADS_AUTH_CONTEXT_PEER_WAIT_MS
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const ctx = await readGoogleAdsAuthContextFromRedis(userId, { minGeneration })
    if (ctx) return ctx
    await sleep(PEER_POLL_INTERVAL_MS)
  }
  return null
}

export async function invalidateGoogleAdsAuthContextRedis(userId: number): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.del(cacheKey(userId), inflightKey(userId))
  } catch {
    // ignore
  }
}
