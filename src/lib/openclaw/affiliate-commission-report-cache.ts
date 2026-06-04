import { createHash } from 'crypto'
import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import {
  compressJsonPayloadText,
  decompressJsonPayloadText,
  type JsonPayloadCodec,
} from '@/lib/json-payload-compression'
import type {
  AffiliateCommissionDateBounds,
  AffiliateCommissionLineItem,
} from '@/lib/openclaw/affiliate-commission-types'

export const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000
const MEMORY_CACHE_MAX_ENTRIES = 32
const DATE_BOUNDS_CACHE_MAX_ENTRIES = 32

export type MemoryCacheEntry = {
  expiresAt: number
  sourceUpdatedAt: string | null
  attributionUpdatedAt: string | null
  lineItems: AffiliateCommissionLineItem[]
}

type DateBoundsCacheEntry = {
  expiresAt: number
  dateBounds: AffiliateCommissionDateBounds
}

const memoryCache = new Map<string, MemoryCacheEntry>()
const dateBoundsMemoryCache = new Map<string, DateBoundsCacheEntry>()

export function buildAffiliateCommissionLineItemsCacheKey(params: {
  userIds: number[]
  startDate: string
  endDate: string
  platform: string
  showUserScope: boolean
}): string {
  const payload = [
    'aca-v1',
    'pb-tx-v3',
    params.userIds.slice().sort((left, right) => left - right).join(','),
    params.startDate,
    params.endDate,
    params.platform,
    params.showUserScope ? '1' : '0',
  ].join('|')

  return createHash('sha256').update(payload).digest('hex')
}

export function buildAffiliateCommissionDateBoundsCacheKey(params: {
  userIds: number[]
  platform: string
}): string {
  const payload = [
    'bounds-v1',
    params.userIds.slice().sort((left, right) => left - right).join(','),
    params.platform,
  ].join('|')

  return createHash('sha256').update(payload).digest('hex')
}

function trimMemoryCache(): void {
  if (memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES) return

  const oldestKey = memoryCache.keys().next().value
  if (oldestKey) {
    memoryCache.delete(oldestKey)
  }
}

function trimDateBoundsCache(): void {
  if (dateBoundsMemoryCache.size <= DATE_BOUNDS_CACHE_MAX_ENTRIES) return

  const oldestKey = dateBoundsMemoryCache.keys().next().value
  if (oldestKey) {
    dateBoundsMemoryCache.delete(oldestKey)
  }
}

export function readAffiliateCommissionLineItemsMemoryCache(cacheKey: string): MemoryCacheEntry | null {
  const entry = memoryCache.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(cacheKey)
    return null
  }
  return entry
}

export function writeAffiliateCommissionLineItemsMemoryCache(
  cacheKey: string,
  entry: Omit<MemoryCacheEntry, 'expiresAt'>
): void {
  trimMemoryCache()
  memoryCache.set(cacheKey, {
    ...entry,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
  })
}

export function readAffiliateCommissionDateBoundsMemoryCache(
  cacheKey: string
): AffiliateCommissionDateBounds | null {
  const entry = dateBoundsMemoryCache.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    dateBoundsMemoryCache.delete(cacheKey)
    return null
  }
  return entry.dateBounds
}

export function writeAffiliateCommissionDateBoundsMemoryCache(
  cacheKey: string,
  dateBounds: AffiliateCommissionDateBounds
): void {
  trimDateBoundsCache()
  dateBoundsMemoryCache.set(cacheKey, {
    dateBounds,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
  })
}

export function clearAffiliateCommissionLineItemsMemoryCache(): void {
  memoryCache.clear()
  dateBoundsMemoryCache.clear()
}

export async function readAffiliateCommissionLineItemsDbCache(params: {
  cacheKey: string
  sourceUpdatedAt: string | null
}): Promise<AffiliateCommissionLineItem[] | null> {
  const db = await getDatabase()
  const row = await db.queryOne<{
    line_items_json: string
    line_items_codec: string
    source_updated_at: unknown
  }>(
    `
      SELECT line_items_json, line_items_codec, source_updated_at
      FROM openclaw_affiliate_commission_report_cache
      WHERE cache_key = ?
    `,
    [params.cacheKey]
  )

  if (!row) return null

  const cachedSourceUpdatedAt = row.source_updated_at ? String(row.source_updated_at) : null
  if (params.sourceUpdatedAt && cachedSourceUpdatedAt !== params.sourceUpdatedAt) {
    return null
  }

  const jsonText = decompressJsonPayloadText(
    row.line_items_json,
    row.line_items_codec as JsonPayloadCodec
  )

  try {
    const parsed = JSON.parse(jsonText) as AffiliateCommissionLineItem[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeAffiliateCommissionLineItemsDbCache(params: {
  cacheKey: string
  lineItems: AffiliateCommissionLineItem[]
  sourceUpdatedAt: string | null
}): Promise<void> {
  const db = await getDatabase()
  const serialized = JSON.stringify(params.lineItems)
  const compressed = compressJsonPayloadText(serialized)

  await db.exec(
    `
      INSERT INTO openclaw_affiliate_commission_report_cache
        (cache_key, line_items_json, line_items_codec, source_updated_at, built_at)
      VALUES
        (?, ?, ?, ?, ${nowFunc(db.type)})
      ON CONFLICT(cache_key) DO UPDATE SET
        line_items_json = excluded.line_items_json,
        line_items_codec = excluded.line_items_codec,
        source_updated_at = excluded.source_updated_at,
        built_at = excluded.built_at
    `,
    [
      params.cacheKey,
      compressed.payload,
      compressed.codec,
      params.sourceUpdatedAt,
    ]
  )
}

export async function invalidateAffiliateCommissionReportCacheForUserDate(params: {
  userId: number
  reportDate: string
}): Promise<void> {
  void params
  clearAffiliateCommissionLineItemsMemoryCache()

  const db = await getDatabase()
  try {
    await db.exec('DELETE FROM openclaw_affiliate_commission_report_cache')
  } catch {
    // Best-effort invalidation; stale rows are rejected via source_updated_at checks.
  }
}
