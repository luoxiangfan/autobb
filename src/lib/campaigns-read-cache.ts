import crypto from 'crypto'
import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

const PERFORMANCE_TTL_SECONDS = 20
const TRENDS_TTL_SECONDS = 20
const INDEX_TTL_SECONDS = 24 * 60 * 60
const MAX_INVALIDATE_SCAN_ROUNDS = 20

type CampaignReadCacheKind = 'performance' | 'trends'

export type CampaignPerformanceCachePayload = {
  startDate: string
  endDate: string
  currency: string | null
  limit: number | null
  offset: number | null
  search: string
  status: string
  showDeleted: boolean | null
  sortBy: string
  sortOrder: 'asc' | 'desc' | null
  ids: number[]
}

export type CampaignTrendsCachePayload = {
  startDate: string
  endDate: string
  currency: string | null
}

function buildHash(payload: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')
}

function getCampaignReadKey(userId: number, kind: CampaignReadCacheKind, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}campaigns:user:${userId}:${kind}:${hash}`
}

function getCampaignReadPattern(userId: number, kind: CampaignReadCacheKind): string {
  return `${REDIS_PREFIX_CONFIG.cache}campaigns:user:${userId}:${kind}:*`
}

function getCampaignReadIndexKey(userId: number, kind: CampaignReadCacheKind): string {
  return `${REDIS_PREFIX_CONFIG.cache}campaigns:user:${userId}:${kind}:index`
}

async function getCachedCampaignRead<T>(
  userId: number,
  kind: CampaignReadCacheKind,
  hash: string
): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const raw = await redis.get(getCampaignReadKey(userId, kind, hash))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function setCachedCampaignRead(
  userId: number,
  kind: CampaignReadCacheKind,
  hash: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const redis = getRedisClient()
    const cacheKey = getCampaignReadKey(userId, kind, hash)
    const indexKey = getCampaignReadIndexKey(userId, kind)
    const payload = JSON.stringify(value)

    await redis
      .multi()
      .setex(cacheKey, ttlSeconds, payload)
      .sadd(indexKey, cacheKey)
      .expire(indexKey, INDEX_TTL_SECONDS)
      .exec()
  } catch {
    // ignore cache write failure
  }
}

export function buildCampaignPerformanceCacheHash(payload: CampaignPerformanceCachePayload): string {
  return buildHash(payload)
}

export function buildCampaignTrendsCacheHash(payload: CampaignTrendsCachePayload): string {
  return buildHash(payload)
}

export async function getCachedCampaignPerformance<T>(userId: number, hash: string): Promise<T | null> {
  return await getCachedCampaignRead<T>(userId, 'performance', hash)
}

export async function setCachedCampaignPerformance(userId: number, hash: string, value: unknown): Promise<void> {
  await setCachedCampaignRead(userId, 'performance', hash, value, PERFORMANCE_TTL_SECONDS)
}

export async function getCachedCampaignTrends<T>(userId: number, hash: string): Promise<T | null> {
  return await getCachedCampaignRead<T>(userId, 'trends', hash)
}

export async function setCachedCampaignTrends(userId: number, hash: string, value: unknown): Promise<void> {
  await setCachedCampaignRead(userId, 'trends', hash, value, TRENDS_TTL_SECONDS)
}

export async function invalidateCampaignReadCache(userId: number): Promise<void> {
  try {
    const redis = getRedisClient()
    const targets: Array<{ kind: CampaignReadCacheKind }> = [
      { kind: 'performance' },
      { kind: 'trends' },
    ]

    for (const target of targets) {
      const indexKey = getCampaignReadIndexKey(userId, target.kind)
      const indexedKeys = await redis.smembers(indexKey)
      if (indexedKeys.length > 0) {
        await redis.del(...indexedKeys)
      }
      await redis.del(indexKey)

      let cursor = '0'
      let rounds = 0

      do {
        const result = await redis.scan(
          cursor,
          'MATCH',
          getCampaignReadPattern(userId, target.kind),
          'COUNT',
          100
        )
        cursor = String(result?.[0] ?? '0')
        const keys = Array.isArray(result?.[1]) ? result[1] : []
        if (keys.length > 0) {
          await redis.del(...keys)
        }
        rounds += 1
      } while (cursor !== '0' && rounds < MAX_INVALIDATE_SCAN_ROUNDS)
    }
  } catch {
    // ignore cache invalidation failure
  }
}
