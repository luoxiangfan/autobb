import crypto from 'crypto'
import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

const LIST_TTL_SECONDS = 300
const SUMMARY_TTL_SECONDS = 300
const SUMMARY_ROUTE_TTL_SECONDS = 45
const LIST_INDEX_TTL_SECONDS = 24 * 60 * 60
const LAST_QUERY_TTL_SECONDS = 24 * 60 * 60
const MAX_INVALIDATE_SCAN_ROUNDS = 20

function getListKey(userId: number, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:${hash}`
}

function getListPattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:*`
}

function getListIndexKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:index`
}

function getSummaryKey(userId: number, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary:${hash}`
}

function getSummaryPattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary:*`
}

function getSummaryIndexKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary:index`
}

function getSummaryRouteKey(userId: number, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary-route:${hash}`
}

function getSummaryRoutePattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary-route:*`
}

function getSummaryRouteIndexKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:summary-route:index`
}

function getLatestQueryKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:latest-query`
}

function getLegacyLatestQueryKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:last-query`
}

export type ProductListCachePayload = {
  page: number
  pageSize: number
  search: string
  mid?: string
  targetCountry: string
  landingPageType: string
  sortBy: string
  sortOrder: string
  platform: string
  status: string
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
  recommendationScoreMin: number | null
  recommendationScoreMax: number | null
  createdAtFrom: string | null
  createdAtTo: string | null
}

export function buildProductListCacheHash(payload: ProductListCachePayload): string {
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')
}

export type ProductSummaryCachePayload = {
  search: string
  mid: string
  platform: string
  targetCountry: string
  landingPageType: string
  status: string
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
  recommendationScoreMin: number | null
  recommendationScoreMax: number | null
  createdAtFrom: string | null
  createdAtTo: string | null
}

export function buildProductSummaryCacheHash(payload: ProductSummaryCachePayload): string {
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')
}

export type ProductSummaryRouteCachePayload = ProductSummaryCachePayload

export function buildProductSummaryRouteCacheHash(payload: ProductSummaryRouteCachePayload): string {
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')
}

function parseNumericBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function parseDateBound(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null

  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.toISOString().slice(0, 10) !== text) return null
  return text
}

function normalizeLandingPageType(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (
    raw === 'amazon_product'
    || raw === 'amazon_store'
    || raw === 'independent_product'
    || raw === 'independent_store'
    || raw === 'unknown'
  ) {
    return raw
  }
  return 'all'
}

function normalizeDateBounds(params: {
  from: string | null
  to: string | null
}): { from: string | null; to: string | null } {
  if (params.from && params.to && params.from > params.to) {
    return { from: params.to, to: params.from }
  }
  return params
}

function normalizeProductListCachePayload(input: unknown): ProductListCachePayload | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const obj = input as Record<string, unknown>
  const page = Number(obj.page)
  const pageSize = Number(obj.pageSize)
  const search = typeof obj.search === 'string' ? obj.search : ''
  const mid = typeof obj.mid === 'string' ? obj.mid : ''
  const sortBy = typeof obj.sortBy === 'string' ? obj.sortBy : ''
  const sortOrder = typeof obj.sortOrder === 'string' ? obj.sortOrder.toLowerCase() : ''
  const rawTargetCountry = typeof obj.targetCountry === 'string'
    ? obj.targetCountry.trim().toUpperCase()
    : ''
  const targetCountry = /^[A-Z]{2,3}$/.test(rawTargetCountry) ? rawTargetCountry : 'all'
  const landingPageType = normalizeLandingPageType(obj.landingPageType)
  const platform = typeof obj.platform === 'string' ? obj.platform : ''
  const statusRaw = typeof obj.status === 'string' ? obj.status.toLowerCase() : 'all'
  const status = statusRaw === 'active' || statusRaw === 'invalid' || statusRaw === 'sync_missing' || statusRaw === 'unknown'
    ? statusRaw
    : 'all'

  if (!Number.isFinite(page) || page < 1) {
    return null
  }
  if (!Number.isFinite(pageSize) || pageSize < 10 || pageSize > 100) {
    return null
  }
  if (!sortBy) {
    return null
  }
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    return null
  }
  if (!platform) {
    return null
  }

  const { from: createdAtFrom, to: createdAtTo } = normalizeDateBounds({
    from: parseDateBound(obj.createdAtFrom),
    to: parseDateBound(obj.createdAtTo),
  })

  return {
    page,
    pageSize,
    search,
    mid,
    sortBy,
    sortOrder,
    targetCountry,
    landingPageType,
    platform,
    status,
    reviewCountMin: parseNumericBound(obj.reviewCountMin),
    reviewCountMax: parseNumericBound(obj.reviewCountMax),
    priceAmountMin: parseNumericBound(obj.priceAmountMin),
    priceAmountMax: parseNumericBound(obj.priceAmountMax),
    commissionRateMin: parseNumericBound(obj.commissionRateMin),
    commissionRateMax: parseNumericBound(obj.commissionRateMax),
    commissionAmountMin: parseNumericBound(obj.commissionAmountMin),
    commissionAmountMax: parseNumericBound(obj.commissionAmountMax),
    recommendationScoreMin: parseNumericBound(obj.recommendationScoreMin),
    recommendationScoreMax: parseNumericBound(obj.recommendationScoreMax),
    createdAtFrom,
    createdAtTo,
  }
}

export async function getCachedProductList<T>(userId: number, hash: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const raw = await redis.get(getListKey(userId, hash))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCachedProductList(userId: number, hash: string, value: unknown): Promise<void> {
  try {
    const redis = getRedisClient()
    const listKey = getListKey(userId, hash)
    const indexKey = getListIndexKey(userId)
    const payload = JSON.stringify(value)

    await redis
      .multi()
      .setex(listKey, LIST_TTL_SECONDS, payload)
      .sadd(indexKey, listKey)
      .expire(indexKey, LIST_INDEX_TTL_SECONDS)
      .exec()
  } catch {
    // ignore cache write failure
  }
}

export async function getCachedProductSummary<T>(userId: number, hash: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const raw = await redis.get(getSummaryKey(userId, hash))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCachedProductSummary(userId: number, hash: string, value: unknown): Promise<void> {
  try {
    const redis = getRedisClient()
    const summaryKey = getSummaryKey(userId, hash)
    const summaryIndexKey = getSummaryIndexKey(userId)
    const payload = JSON.stringify(value)

    await redis
      .multi()
      .setex(summaryKey, SUMMARY_TTL_SECONDS, payload)
      .sadd(summaryIndexKey, summaryKey)
      .expire(summaryIndexKey, LIST_INDEX_TTL_SECONDS)
      .exec()
  } catch {
    // ignore cache write failure
  }
}

export async function getCachedProductSummaryRoute<T>(userId: number, hash: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const raw = await redis.get(getSummaryRouteKey(userId, hash))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCachedProductSummaryRoute(userId: number, hash: string, value: unknown): Promise<void> {
  try {
    const redis = getRedisClient()
    const summaryRouteKey = getSummaryRouteKey(userId, hash)
    const summaryRouteIndexKey = getSummaryRouteIndexKey(userId)
    const payload = JSON.stringify(value)

    await redis
      .multi()
      .setex(summaryRouteKey, SUMMARY_ROUTE_TTL_SECONDS, payload)
      .sadd(summaryRouteIndexKey, summaryRouteKey)
      .expire(summaryRouteIndexKey, LIST_INDEX_TTL_SECONDS)
      .exec()
  } catch {
    // ignore cache write failure
  }
}

export async function setLatestProductListQuery(userId: number, payload: ProductListCachePayload): Promise<void> {
  try {
    const normalized = normalizeProductListCachePayload(payload)
    if (!normalized) {
      return
    }

    const redis = getRedisClient()
    await redis.setex(getLatestQueryKey(userId), LAST_QUERY_TTL_SECONDS, JSON.stringify(normalized))
  } catch {
    // ignore cache write failure
  }
}

export async function getLatestProductListQuery(userId: number): Promise<ProductListCachePayload | null> {
  try {
    const redis = getRedisClient()
    const [raw, legacyRaw] = await Promise.all([
      redis.get(getLatestQueryKey(userId)),
      redis.get(getLegacyLatestQueryKey(userId)),
    ])
    const value = raw || legacyRaw
    if (!value) {
      return null
    }

    return normalizeProductListCachePayload(JSON.parse(value))
  } catch {
    return null
  }
}

export async function invalidateProductListCache(userId: number): Promise<void> {
  try {
    const redis = getRedisClient()
    const targets = [
      { indexKey: getListIndexKey(userId), pattern: getListPattern(userId) },
      { indexKey: getSummaryIndexKey(userId), pattern: getSummaryPattern(userId) },
      { indexKey: getSummaryRouteIndexKey(userId), pattern: getSummaryRoutePattern(userId) },
    ]

    for (const target of targets) {
      const indexedKeys = await redis.smembers(target.indexKey)
      if (indexedKeys.length > 0) {
        await redis.del(...indexedKeys)
      }
      await redis.del(target.indexKey)

      // 兼容历史缓存键：使用有上限的scan兜底清理，避免全库scan阻塞接口响应
      let cursor = '0'
      let rounds = 0

      do {
        const result = await redis.scan(cursor, 'MATCH', target.pattern, 'COUNT', 100)
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
