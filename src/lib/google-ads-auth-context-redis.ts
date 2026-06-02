import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis-client'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'

/** 与进程内 authContextCache TTL 对齐 */
export const GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC = 2

/** 跨实例 inflight 锁 TTL（加载应在数秒内完成） */
export const GOOGLE_ADS_AUTH_CONTEXT_INFLIGHT_LOCK_TTL_SEC = 8

/** 等待其它实例写入 Redis 缓存的最长时间 */
export const GOOGLE_ADS_AUTH_CONTEXT_PEER_WAIT_MS = 7_000

const PEER_POLL_INTERVAL_MS = 50

function cacheKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:auth-context:${userId}`
}

function inflightKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}google-ads:auth-context:inflight:${userId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function readGoogleAdsAuthContextFromRedis(
  userId: number
): Promise<GoogleAdsAuthContext | null> {
  const client = getRedisClient()
  if (!client) return null

  try {
    const raw = await client.get(cacheKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as GoogleAdsAuthContext
  } catch {
    return null
  }
}

export async function writeGoogleAdsAuthContextToRedis(
  userId: number,
  ctx: GoogleAdsAuthContext
): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.set(
      cacheKey(userId),
      JSON.stringify(ctx),
      'EX',
      GOOGLE_ADS_AUTH_CONTEXT_REDIS_CACHE_TTL_SEC
    )
  } catch {
    // Redis 不可用时由进程内缓存兜底
  }
}

export async function tryAcquireGoogleAdsAuthContextInflightLock(
  userId: number
): Promise<boolean> {
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
  userId: number
): Promise<GoogleAdsAuthContext | null> {
  const deadline = Date.now() + GOOGLE_ADS_AUTH_CONTEXT_PEER_WAIT_MS
  while (Date.now() < deadline) {
    const ctx = await readGoogleAdsAuthContextFromRedis(userId)
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
