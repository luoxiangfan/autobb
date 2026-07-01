import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import {
  buildProductSummaryCacheHash,
  getCachedProductSummary,
  setCachedProductSummary,
  type ProductSummaryCachePayload,
} from '@/lib/common/server'
import { PRODUCT_SCORE_VALIDITY_DAYS, PRODUCT_SCORE_VALIDITY_WINDOW_MS } from './types'
import type {
  AffiliateLandingPageType,
  AffiliatePlatform,
  AffiliateProduct,
  AffiliateProductListItem,
  AffiliateProductLifecycleStatus,
  ProductLandingPageStats,
  ProductListOptions,
  ProductListResult,
  ProductSortField,
  ProductSortOrder,
  PlatformProductStats,
} from './types'
import {
  AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_BUSY,
  AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX,
  AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN,
  AFFILIATE_RAW_JSON_RETIREMENT_BUSY_SYNC_RUNS_THRESHOLD,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_KEY,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_TIMEOUT_MS,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_BASE_DELAY_MS,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_MAX_DELAY_MS,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_STATEMENT_TIMEOUT_MS,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR,
  AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS,
  AFFILIATE_RAW_JSON_RETIREMENT_PEAK_SYNC_RUNS_THRESHOLD,
  AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID,
  AFFILIATE_RAW_JSON_RETIREMENT_TABLE,
} from './constants'
import {
  detectAffiliateLandingPageType,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  normalizeCommissionRateMode,
  normalizeTriStateBool,
  resolveAffiliateProductLifecycleStatus,
} from './normalization'
import { hydratePartnerboostShortLinksForRows } from './offer-link-helpers'
import {
  normalizeCurrencyUnit,
  normalizePlatformValue,
  normalizeProductTargetCountryFilter,
  normalizeYmdDate,
  parseAllowedCountries,
  parseIntegerInRange,
  resolveProductCountryFilterCandidates,
  sleep,
} from './parsing'
import { isPostgresStatementTimeoutError } from './upsert'

const SORT_FIELD_SQL: Record<ProductSortField, string> = {
  serial: 'p.id',
  platform: 'p.platform',
  mid: 'p.mid',
  asin: 'p.asin',
  createdAt: 'p.created_at',
  allowedCountries: 'p.allowed_countries_json',
  priceAmount: 'p.price_amount',
  commissionRate: 'p.commission_rate',
  commissionAmount: 'p.commission_amount',
  reviewCount: 'p.review_count',
  promoLink: 'COALESCE(p.short_promo_link, p.promo_link)',
  relatedOfferCount: 'related_offer_count',
  updatedAt: 'p.updated_at',
  recommendationScore: 'p.recommendation_score', // 推荐指数排序
}

const NUMERIC_SORT_FIELDS_WITH_NULLS_LAST: Set<ProductSortField> = new Set([
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'recommendationScore', // 推荐指数排序时NULL值放最后
])

export function buildAffiliateProductsOrderBy(params: {
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
}): string {
  const { sortBy, sortOrder } = params
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC'
  const sortSql = SORT_FIELD_SQL[sortBy] || SORT_FIELD_SQL.serial

  if (NUMERIC_SORT_FIELDS_WITH_NULLS_LAST.has(sortBy)) {
    return `(${sortSql} IS NULL) ASC, ${sortSql} ${direction}, p.id DESC`
  }

  return `${sortSql} ${direction}, p.id DESC`
}

export function normalizeNumericRangeBounds(params: { min?: number | null; max?: number | null }): {
  min: number | null
  max: number | null
} {
  const min = typeof params.min === 'number' && Number.isFinite(params.min) ? params.min : null
  const max = typeof params.max === 'number' && Number.isFinite(params.max) ? params.max : null

  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }

  return { min, max }
}

export function appendNumericRangeWhere(params: {
  whereConditions: string[]
  whereParams: any[]
  columnSql: string
  min?: number | null
  max?: number | null
}): void {
  const { min, max } = normalizeNumericRangeBounds({ min: params.min, max: params.max })

  if (min !== null) {
    params.whereConditions.push(`${params.columnSql} >= ?`)
    params.whereParams.push(min)
  }

  if (max !== null) {
    params.whereConditions.push(`${params.columnSql} <= ?`)
    params.whereParams.push(max)
  }
}

export function normalizeDateRangeBounds(params: { from?: string | null; to?: string | null }): {
  from: string | null
  to: string | null
} {
  const from = normalizeYmdDate(params.from)
  const to = normalizeYmdDate(params.to)

  if (from && to && from > to) {
    return { from: to, to: from }
  }

  return { from, to }
}

export function appendDateRangeWhere(params: {
  whereConditions: string[]
  whereParams: any[]
  columnSql: string
  from?: string | null
  to?: string | null
}): void {
  const { from, to } = normalizeDateRangeBounds({ from: params.from, to: params.to })
  const toDayStartSql = (ymd: string): string => `${ymd} 00:00:00`
  const addDaysToYmd = (ymd: string, days: number): string | null => {
    const parsed = new Date(`${ymd}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) return null
    parsed.setUTCDate(parsed.getUTCDate() + days)
    return parsed.toISOString().slice(0, 10)
  }

  if (from) {
    params.whereConditions.push(`${params.columnSql} >= ?`)
    params.whereParams.push(toDayStartSql(from))
  }

  if (to) {
    const exclusiveEnd = addDaysToYmd(to, 1)
    if (exclusiveEnd) {
      params.whereConditions.push(`${params.columnSql} < ?`)
      params.whereParams.push(toDayStartSql(exclusiveEnd))
    } else {
      params.whereConditions.push(`${params.columnSql} <= ?`)
      params.whereParams.push(`${to} 23:59:59.999`)
    }
  }
}

export function buildAffiliateLandingTypeConditionSql(alias: string = 'p'): {
  byType: Record<AffiliateLandingPageType, string>
  productCondition: string
  storeCondition: string
  classificationSql: string
} {
  const asinPresent = `COALESCE(NULLIF(TRIM(${alias}.asin), ''), NULL) IS NOT NULL`
  const urlCandidates = [
    `LOWER(COALESCE(${alias}.product_url, ''))`,
    `LOWER(COALESCE(${alias}.short_promo_link, ''))`,
    `LOWER(COALESCE(${alias}.promo_link, ''))`,
  ]

  const matchesAnyPattern = (patterns: string[]): string =>
    urlCandidates
      .map((urlSql) => `(${patterns.map((pattern) => `${urlSql} LIKE '${pattern}'`).join(' OR ')})`)
      .join(' OR ')

  const amazonStoreByUrl = `(${matchesAnyPattern([
    '%amazon.%/stores/%',
    '%amazon.%/store/%',
    '%amazon.%/storefront/%',
  ])})`
  const amazonProductByUrl = `(${matchesAnyPattern(['%amazon.%/dp/%', '%amazon.%/gp/product/%'])})`
  const independentProductByUrl = `(${matchesAnyPattern([
    '%/products/%',
    '%/product/%',
    '%/p/%',
    '%/item/%',
    '%://%/%-p_%',
    '%://%/%.html%',
  ])})`
  const independentStoreByUrl = `(${matchesAnyPattern(['%/collections%', '%/shop%', '%/store%'])})`

  const amazonStore = `(NOT (${asinPresent}) AND (${amazonStoreByUrl}))`
  const amazonProduct = `((${asinPresent}) OR (NOT (${amazonStore}) AND (${amazonProductByUrl})))`
  const independentProduct = `(NOT (${amazonProduct}) AND NOT (${amazonStore}) AND (${independentProductByUrl}))`
  const independentStore = `(NOT (${amazonProduct}) AND NOT (${amazonStore}) AND NOT (${independentProduct}) AND (${independentStoreByUrl}))`

  const productCondition = `((${amazonProduct}) OR (${independentProduct}))`
  const storeCondition = `(NOT (${productCondition}) AND ((${amazonStore}) OR (${independentStore})))`
  const unknownCondition = `(NOT (${productCondition}) AND NOT (${storeCondition}))`
  const classificationSql = `
    CASE
      WHEN ${amazonProduct} THEN 'amazon_product'
      WHEN ${amazonStore} THEN 'amazon_store'
      WHEN ${independentProduct} THEN 'independent_product'
      WHEN ${independentStore} THEN 'independent_store'
      ELSE 'unknown'
    END
  `

  return {
    byType: {
      amazon_product: amazonProduct,
      amazon_store: amazonStore,
      independent_product: independentProduct,
      independent_store: independentStore,
      unknown: unknownCondition,
    },
    productCondition,
    storeCondition,
    classificationSql,
  }
}

export function buildConfirmedInvalidSql(columnSql: string = 'p.is_confirmed_invalid'): string {
  return `(COALESCE(${columnSql}, false) = true)`
}

export function parseDateToTimestamp(input: string | null): number | null {
  if (!input) return null
  const timestamp = Date.parse(input)
  if (!Number.isFinite(timestamp)) return null
  return timestamp
}

export function isMissingTableError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase()
  return /(no such table|does not exist)/i.test(message)
}

let affiliateProductsMerchantIdColumnAvailability: boolean | undefined
let affiliateProductsRawJsonColumnAvailability: boolean | undefined

export async function hasAffiliateProductsMerchantIdColumn(db: DatabaseAdapter): Promise<boolean> {
  if (typeof affiliateProductsMerchantIdColumnAvailability === 'boolean') {
    return affiliateProductsMerchantIdColumnAvailability
  }

  try {
    const row = await db.queryOne<{ exists: boolean }>(
      `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'affiliate_products'
              AND column_name = 'merchant_id'
          ) AS exists
        `
    )
    const exists = Boolean(row?.exists)
    affiliateProductsMerchantIdColumnAvailability = exists
    return exists
  } catch {
    return false
  }
}

export async function hasAffiliateProductsRawJsonColumn(
  db: DatabaseAdapter,
  options?: { refresh?: boolean }
): Promise<boolean> {
  if (!options?.refresh && typeof affiliateProductsRawJsonColumnAvailability === 'boolean') {
    return affiliateProductsRawJsonColumnAvailability
  }

  try {
    const row = await db.queryOne<{ exists: boolean }>(
      `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'affiliate_products'
              AND column_name = 'raw_json'
          ) AS exists
        `
    )
    const exists = Boolean(row?.exists)
    affiliateProductsRawJsonColumnAvailability = exists
    return exists
  } catch {
    return false
  }
}

export function isMissingColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase()
  return /(no such column|column .* does not exist|unknown column|undefined column)/i.test(message)
}

export function isRetriableRawJsonDropError(error: unknown): boolean {
  const code = String((error as any)?.code || '')
    .trim()
    .toUpperCase()
  if (code === '55P03' || code === '57014' || code === '40P01') {
    return true
  }

  const message = String((error as any)?.message || '').toLowerCase()
  return (
    message.includes('lock timeout') ||
    message.includes('statement timeout') ||
    message.includes('could not obtain lock on relation') ||
    message.includes('deadlock detected')
  )
}

export async function countActiveAffiliateProductSyncRuns(db: DatabaseAdapter): Promise<number> {
  try {
    const row = await db.queryOne<{ active_count: number }>(
      `
        SELECT COUNT(*) AS active_count
        FROM affiliate_product_sync_runs
        WHERE status IN ('pending', 'running')
      `
    )
    return toSafeNonNegativeInt(row?.active_count)
  } catch (error) {
    if (isMissingTableError(error)) {
      return 0
    }
    throw error
  }
}

export async function resolveAffiliateProductsRawJsonCleanupBatchSize(params: {
  db: DatabaseAdapter
  requestedBatchSize?: number
}): Promise<number> {
  if (typeof params.requestedBatchSize === 'number' && Number.isFinite(params.requestedBatchSize)) {
    return parseIntegerInRange(
      params.requestedBatchSize,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX
    )
  }

  const activeSyncRuns = await countActiveAffiliateProductSyncRuns(params.db)
  if (activeSyncRuns >= AFFILIATE_RAW_JSON_RETIREMENT_PEAK_SYNC_RUNS_THRESHOLD) {
    return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN
  }
  if (activeSyncRuns >= AFFILIATE_RAW_JSON_RETIREMENT_BUSY_SYNC_RUNS_THRESHOLD) {
    return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_BUSY
  }
  return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX
}

type RawJsonDropAttemptResult = 'dropped' | 'already_missing' | 'lock_not_acquired'

export function isWithinAffiliateRawJsonDropWindow(now: Date): boolean {
  const offsetHours = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS,
    -12,
    14
  )
  const startHour = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR,
    0,
    23
  )
  const endHour = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR,
    0,
    24
  )

  const localHour = (now.getUTCHours() + offsetHours + 24) % 24
  if (startHour === endHour) {
    return true
  }
  if (startHour < endHour) {
    return localHour >= startHour && localHour < endHour
  }
  return localHour >= startHour || localHour < endHour
}

export async function dropAffiliateProductsRawJsonColumnWithRetry(
  db: DatabaseAdapter
): Promise<RawJsonDropAttemptResult> {
  for (let attempt = 1; attempt <= AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await db.transaction(async () => {
        const lockRow = await db.queryOne<{ acquired: boolean }>(
          `SELECT pg_try_advisory_xact_lock(?) AS acquired`,
          [AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_KEY]
        )
        if (!lockRow?.acquired) {
          return 'lock_not_acquired' as const
        }

        await db.exec(
          `SET LOCAL lock_timeout = '${AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_TIMEOUT_MS}ms'`
        )
        await db.exec(
          `SET LOCAL statement_timeout = '${AFFILIATE_RAW_JSON_RETIREMENT_DROP_STATEMENT_TIMEOUT_MS}ms'`
        )
        await db.exec(`ALTER TABLE affiliate_products DROP COLUMN IF EXISTS raw_json`)
        return 'dropped' as const
      })

      return result
    } catch (error) {
      if (isMissingColumnError(error)) {
        return 'already_missing'
      }

      const canRetry =
        isRetriableRawJsonDropError(error) &&
        attempt < AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS
      if (!canRetry) {
        throw error
      }

      const delayMs = Math.min(
        AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_MAX_DELAY_MS,
        AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      )
      await sleep(delayMs)
    }
  }

  return 'lock_not_acquired'
}

export async function clearAffiliateProductsRawJsonBatch(
  db: DatabaseAdapter,
  batchSize: number
): Promise<number> {
  if (batchSize <= 0) return 0

  const result = await db.exec(
    `
        WITH target AS (
          SELECT ctid
          FROM affiliate_products
          WHERE raw_json IS NOT NULL
          LIMIT ?
        )
        UPDATE affiliate_products p
        SET raw_json = NULL
        FROM target
        WHERE p.ctid = target.ctid
      `,
    [batchSize]
  )
  return Number(result?.changes || 0)
}

export async function runAffiliateProductsRawJsonRetirementMaintenance(options?: {
  batchSize?: number
  now?: Date
  allowDropOutsideWindow?: boolean
}): Promise<void> {
  const db = await getDatabase()
  const now =
    options?.now instanceof Date && Number.isFinite(options.now.getTime())
      ? options.now
      : new Date()

  type RetirementControlRow = {
    drop_after_at: string | null
    cleanup_completed_at: string | null
    raw_json_drop_completed_at: string | null
  }

  let controlRow: RetirementControlRow | undefined
  try {
    controlRow = await db.queryOne<RetirementControlRow>(
      `
        SELECT
          drop_after_at,
          cleanup_completed_at,
          raw_json_drop_completed_at
        FROM ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        WHERE singleton_id = ?
        LIMIT 1
      `,
      [AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return
    }
    throw error
  }

  if (!controlRow) {
    return
  }

  const nowIso = now.toISOString()
  let rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db)

  if (!controlRow.cleanup_completed_at) {
    if (!rawJsonColumnExists) {
      await db.exec(
        `
          UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
          SET cleanup_completed_at = COALESCE(cleanup_completed_at, ?),
              updated_at = ?
          WHERE singleton_id = ?
        `,
        [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
      )
      controlRow.cleanup_completed_at = nowIso
    } else {
      const batchSize = await resolveAffiliateProductsRawJsonCleanupBatchSize({
        db,
        requestedBatchSize: options?.batchSize,
      })
      const cleanedRows = await clearAffiliateProductsRawJsonBatch(db, batchSize)
      if (cleanedRows === 0) {
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET cleanup_completed_at = COALESCE(cleanup_completed_at, ?),
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.cleanup_completed_at = nowIso
      }
    }
  }

  const dropAfterTimestamp = parseDateToTimestamp(controlRow.drop_after_at || null)
  const dropWindowReady =
    options?.allowDropOutsideWindow === true || isWithinAffiliateRawJsonDropWindow(now)
  if (
    rawJsonColumnExists &&
    !controlRow.raw_json_drop_completed_at &&
    dropAfterTimestamp !== null &&
    now.getTime() >= dropAfterTimestamp &&
    dropWindowReady
  ) {
    await db.exec(
      `
        UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        SET raw_json_drop_started_at = COALESCE(raw_json_drop_started_at, ?),
            last_error = NULL,
            updated_at = ?
        WHERE singleton_id = ?
      `,
      [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )

    try {
      const dropResult = await dropAffiliateProductsRawJsonColumnWithRetry(db)
      if (dropResult === 'lock_not_acquired') {
        rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })
      } else {
        rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })
      }

      if (!rawJsonColumnExists) {
        const dropCompletedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
                last_error = NULL,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.raw_json_drop_completed_at = dropCompletedAt
      }
    } catch (error) {
      if (isMissingColumnError(error)) {
        affiliateProductsRawJsonColumnAvailability = false
        rawJsonColumnExists = false
        const dropCompletedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
                last_error = NULL,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.raw_json_drop_completed_at = dropCompletedAt
      } else {
        const errorMessage = String((error as any)?.message || error || 'unknown error').slice(
          0,
          1000
        )
        const failedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET last_error = ?,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [errorMessage, failedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        throw error
      }
    }
  }

  rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })

  if (!rawJsonColumnExists && !controlRow.raw_json_drop_completed_at) {
    const dropCompletedAt = new Date().toISOString()
    await db.exec(
      `
        UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
            last_error = NULL,
            updated_at = ?
        WHERE singleton_id = ?
      `,
      [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )
  }
}

export function toHourBucketIso(date: Date): string {
  const copy = new Date(date.getTime())
  copy.setUTCMinutes(0, 0, 0)
  return copy.toISOString()
}

export function toSafeNonNegativeInt(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.trunc(parsed)
}

export function resolveLifecycleStatusFromRowForList(
  row: Pick<AffiliateProduct, 'is_confirmed_invalid' | 'last_seen_at'> & {
    baseline_started_at?: string | null
  }
): AffiliateProductLifecycleStatus {
  if (normalizeTriStateBool(row.is_confirmed_invalid) === true) {
    return 'invalid'
  }

  const baselineTimestamp = parseDateToTimestamp(row.baseline_started_at || null)
  if (baselineTimestamp === null) {
    return 'unknown'
  }

  const lastSeenTimestamp = parseDateToTimestamp(row.last_seen_at || null)
  if (lastSeenTimestamp !== null && lastSeenTimestamp >= baselineTimestamp) {
    return 'active'
  }

  return 'sync_missing'
}

export async function listAffiliateProducts(
  userId: number,
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const db = await getDatabase()
  const page = Math.max(1, options.page || 1)
  const pageSize = Math.min(1000, Math.max(10, options.pageSize || 20))
  const skipItems = options.skipItems === true
  const skipInvalidSummary = options.skipInvalidSummary === true
  const fastSummary = options.fastSummary === true
  const skipHeavySummary = fastSummary && options.skipHeavySummary === true
  const lightweightSummary = fastSummary && options.lightweightSummary === true
  const offset = (page - 1) * pageSize
  const sortBy = options.sortBy || 'serial'
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc'
  const orderBySql = buildAffiliateProductsOrderBy({ sortBy, sortOrder })
  const offerNotDeletedCondition = '(o.is_deleted = false OR o.is_deleted IS NULL)'
  const statusFilter = normalizeAffiliateProductStatusFilter(options.status)
  const landingPageTypeFilter = normalizeAffiliateLandingPageTypeFilter(options.landingPageType)
  const landingTypeSql = buildAffiliateLandingTypeConditionSql('p')
  const asinPresentConditionSql = `COALESCE(NULLIF(TRIM(p.asin), ''), NULL) IS NOT NULL`
  const preferFastLandingTypeFilter = options.preferFastLandingTypeFilter === true
  // lightweight 汇总只用于首屏快速统计；避免在大表上执行 URL LIKE 分类导致超时。
  const lightweightProductConditionSql = asinPresentConditionSql
  const lightweightStoreConditionSql = `(p.platform = 'partnerboost' AND NOT (${asinPresentConditionSql}))`
  type PlatformStatsAccumulator = Omit<PlatformProductStats, 'visibleCount'>
  const toSafeCount = (value: unknown): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }
  const createPlatformStatsAccumulator = (): Record<
    AffiliatePlatform,
    PlatformStatsAccumulator
  > => ({
    yeahpromos: {
      total: 0,
      productCount: 0,
      storeCount: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
    },
    partnerboost: {
      total: 0,
      productCount: 0,
      storeCount: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
    },
  })
  const resolveVisibleCount = (stats: PlatformStatsAccumulator): number => {
    if (statusFilter === 'all') return stats.total
    if (statusFilter === 'invalid') return stats.invalidProductsCount
    if (statusFilter === 'active') return stats.activeProductsCount
    if (statusFilter === 'sync_missing') return stats.syncMissingProductsCount
    return stats.unknownProductsCount
  }
  const toPlatformStats = (stats: PlatformStatsAccumulator): PlatformProductStats => ({
    ...stats,
    visibleCount: resolveVisibleCount(stats),
  })
  const finalizePlatformStats = (
    accumulator: Record<AffiliatePlatform, PlatformStatsAccumulator>
  ): Record<AffiliatePlatform, PlatformProductStats> => ({
    yeahpromos: toPlatformStats(accumulator.yeahpromos),
    partnerboost: toPlatformStats(accumulator.partnerboost),
  })
  const confirmedInvalidStatusSql = buildConfirmedInvalidSql()
  const recommendationScoreFreshSql = `(p.score_calculated_at >= (NOW() - INTERVAL '${PRODUCT_SCORE_VALIDITY_DAYS} days'))`
  const fullSyncBaselineCteSql = `
    WITH latest_platform_full_sync AS (
      SELECT ranked.platform, ranked.baseline_started_at
      FROM (
        SELECT
          r.platform,
          COALESCE(r.started_at, r.created_at) AS baseline_started_at,
          ROW_NUMBER() OVER (
            PARTITION BY r.platform
            ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC, r.id DESC
          ) AS row_num
        FROM affiliate_product_sync_runs r
        WHERE r.user_id = ?
          AND r.mode = 'platform'
          AND r.status = 'completed'
      ) ranked
      WHERE ranked.row_num = 1
    )
  `
  const whereConditions: string[] = ['p.user_id = ?']
  const whereParams: any[] = [userId]

  const platform = normalizePlatformValue(options.platform)
  if (platform) {
    whereConditions.push('p.platform = ?')
    whereParams.push(platform)
  }

  const search = (options.search || '').trim().toLowerCase()
  if (search) {
    const like = `%${search}%`
    whereConditions.push(`
      LOWER(
        COALESCE(p.mid, '')
        || ' '
        || COALESCE(p.asin, '')
        || ' '
        || COALESCE(p.product_name, '')
        || ' '
        || COALESCE(p.brand, '')
      ) LIKE ?
    `)
    whereParams.push(like)
  }

  const midRaw = (options.mid || '').trim()
  const mid = midRaw.toLowerCase()
  const hasMerchantIdColumn = midRaw ? await hasAffiliateProductsMerchantIdColumn(db) : false
  if (midRaw) {
    const prefersPartnerboostMerchantExact = hasMerchantIdColumn && /^\d{5}$/.test(midRaw)

    if (prefersPartnerboostMerchantExact) {
      // 典型场景：输入 PartnerBoost 商家ID（纯数字），走 merchant_id 精确匹配避免扫描。
      whereConditions.push(`(
        (
          p.platform = 'partnerboost'
          AND p.merchant_id = ?
        )
        OR (
          p.platform <> 'partnerboost'
          AND p.mid = ?
        )
      )`)
      whereParams.push(midRaw, midRaw)
    } else if (hasMerchantIdColumn) {
      // MID 筛选语义改为“精确匹配”，模糊检索请使用通用 search 输入框。
      whereConditions.push(`(
        (
          p.platform <> 'partnerboost'
          AND LOWER(p.mid) = ?
        )
        OR (
          p.platform = 'partnerboost'
          AND LOWER(p.merchant_id) = ?
        )
      )`)
      whereParams.push(mid, mid)
    } else {
      // 兼容旧库（尚未执行 merchant_id 迁移）时退化为 mid 精确匹配。
      whereConditions.push('LOWER(p.mid) = ?')
      whereParams.push(mid)
    }
  }

  const targetCountryCandidates = resolveProductCountryFilterCandidates(options.targetCountry)
  if (targetCountryCandidates.length > 0) {
    const normalizedCountriesJsonbSql = `COALESCE(NULLIF(BTRIM(p.allowed_countries_json), ''), '[]')::jsonb`
    const postgresCountryContainsSql = targetCountryCandidates
      .map(() => `${normalizedCountriesJsonbSql} @> ?::jsonb`)
      .join(' OR ')
    whereConditions.push(`(${postgresCountryContainsSql})`)
    for (const countryCode of targetCountryCandidates) {
      whereParams.push(JSON.stringify([countryCode]))
    }
  }

  if (landingPageTypeFilter !== 'all') {
    if (preferFastLandingTypeFilter && landingPageTypeFilter === 'amazon_product') {
      // 首屏列表优先保证可用性：amazon_product 在快速模式下退化为 ASIN 存在判定。
      whereConditions.push(asinPresentConditionSql)
    } else if (preferFastLandingTypeFilter && landingPageTypeFilter === 'independent_store') {
      // 首屏列表优先保证可用性：independent_store 在快速模式下退化为 partnerboost+无ASIN 判定。
      whereConditions.push(lightweightStoreConditionSql)
    } else {
      // Postgres 下避免 CASE = ? 的超长表达式，直接复用按类型布尔条件，减少筛选 CPU 压力。
      whereConditions.push(landingTypeSql.byType[landingPageTypeFilter])
    }
  }

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.review_count',
    min: options.reviewCountMin,
    max: options.reviewCountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.price_amount',
    min: options.priceAmountMin,
    max: options.priceAmountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_rate',
    min: options.commissionRateMin,
    max: options.commissionRateMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_amount',
    min: options.commissionAmountMin,
    max: options.commissionAmountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.recommendation_score',
    min: options.recommendationScoreMin,
    max: options.recommendationScoreMax,
  })

  if (options.recommendationScoreFreshOnly === true) {
    whereConditions.push('p.recommendation_score IS NOT NULL')
    whereConditions.push('p.score_calculated_at IS NOT NULL')
    whereConditions.push(recommendationScoreFreshSql)
  }

  const createdAtRange = normalizeDateRangeBounds({
    from: options.createdAtFrom,
    to: options.createdAtTo,
  })

  appendDateRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.created_at',
    from: createdAtRange.from,
    to: createdAtRange.to,
  })

  const baseWhereSql = whereConditions.join(' AND ')
  const filteredWhereConditions = [...whereConditions]
  const filteredWhereParams = [...whereParams]

  if (statusFilter !== 'all') {
    if (statusFilter === 'invalid') {
      filteredWhereConditions.push(confirmedInvalidStatusSql)
    } else if (statusFilter === 'active') {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NOT NULL
        AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= baseline.baseline_started_at
        AND NOT (${confirmedInvalidStatusSql})
      `)
    } else if (statusFilter === 'sync_missing') {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NOT NULL
        AND (
          p.last_seen_at IS NULL
          OR p.last_seen_at < baseline.baseline_started_at
        )
        AND NOT (${confirmedInvalidStatusSql})
      `)
    } else {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NULL
        AND NOT (${confirmedInvalidStatusSql})
      `)
    }
  }

  const filteredWhereSql = filteredWhereConditions.join(' AND ')
  const productStatusSelectSql =
    statusFilter === 'all' ? 'NULL AS product_status' : `'${statusFilter}' AS product_status`

  type ProductRowWithDerived = AffiliateProduct & {
    related_offer_count?: number
    active_offer_count?: number
    historical_offer_count?: number
    product_status?: AffiliateProductLifecycleStatus
    baseline_started_at?: string | null
  }
  const shouldScopeLinkCountsToPagedRows = sortBy !== 'relatedOfferCount'
  const orderBySqlForPagedRows = orderBySql.replace(/\bp\./g, 'pp.')

  const rowsPromise: Promise<ProductRowWithDerived[]> = skipItems
    ? Promise.resolve([])
    : shouldScopeLinkCountsToPagedRows
      ? db.query<ProductRowWithDerived>(
          `
          ${fullSyncBaselineCteSql},
          paged_products AS (
            SELECT
              p.*,
              ${productStatusSelectSql},
              baseline.baseline_started_at AS baseline_started_at
            FROM affiliate_products p
            LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
            WHERE ${filteredWhereSql}
            ORDER BY ${orderBySql}
            LIMIT ?
            OFFSET ?
          )
          SELECT
            pp.*,
            COALESCE(link_counts.active_offer_count, 0) AS active_offer_count,
            COALESCE(link_counts.historical_offer_count, 0) AS historical_offer_count,
            COALESCE(link_counts.historical_offer_count, 0) AS related_offer_count
          FROM paged_products pp
          LEFT JOIN (
            SELECT
              link.product_id,
              COUNT(DISTINCT CASE
                WHEN c.status = 'ENABLED' AND COALESCE(c.is_deleted, false) = false THEN link.offer_id
                ELSE NULL
              END) AS active_offer_count,
              COUNT(DISTINCT CASE
                WHEN COALESCE(c.google_campaign_id, '') <> '' THEN link.offer_id
                ELSE NULL
              END) AS historical_offer_count
            FROM affiliate_product_offer_links link
            INNER JOIN paged_products pp2 ON pp2.id = link.product_id
            INNER JOIN offers o
              ON o.user_id = link.user_id
              AND o.id = link.offer_id
              AND ${offerNotDeletedCondition}
            LEFT JOIN campaigns c
              ON c.user_id = link.user_id
              AND c.offer_id = link.offer_id
            WHERE link.user_id = ?
            GROUP BY link.product_id
          ) link_counts ON link_counts.product_id = pp.id
          ORDER BY ${orderBySqlForPagedRows}
        `,
          [userId, ...filteredWhereParams, pageSize, offset, userId]
        )
      : db.query<ProductRowWithDerived>(
          `
          ${fullSyncBaselineCteSql}
          SELECT
            p.*,
            ${productStatusSelectSql},
            baseline.baseline_started_at AS baseline_started_at,
            COALESCE(link_counts.active_offer_count, 0) AS active_offer_count,
            COALESCE(link_counts.historical_offer_count, 0) AS historical_offer_count,
            COALESCE(link_counts.historical_offer_count, 0) AS related_offer_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          LEFT JOIN (
            SELECT
              link.product_id,
              COUNT(DISTINCT CASE
                WHEN c.status = 'ENABLED' AND COALESCE(c.is_deleted, false) = false THEN link.offer_id
                ELSE NULL
              END) AS active_offer_count,
              COUNT(DISTINCT CASE
                WHEN COALESCE(c.google_campaign_id, '') <> '' THEN link.offer_id
                ELSE NULL
              END) AS historical_offer_count
            FROM affiliate_product_offer_links link
            INNER JOIN offers o
              ON o.user_id = link.user_id
              AND o.id = link.offer_id
              AND ${offerNotDeletedCondition}
            LEFT JOIN campaigns c
              ON c.user_id = link.user_id
              AND c.offer_id = link.offer_id
            WHERE link.user_id = ?
            GROUP BY link.product_id
          ) link_counts ON link_counts.product_id = p.id
          WHERE ${filteredWhereSql}
          ORDER BY ${orderBySql}
          LIMIT ?
          OFFSET ?
        `,
          [userId, userId, ...filteredWhereParams, pageSize, offset]
        )
  const summaryCachePayload: ProductSummaryCachePayload = {
    search,
    mid,
    platform: platform || 'all',
    targetCountry: normalizeProductTargetCountryFilter(options.targetCountry) || 'all',
    landingPageType: landingPageTypeFilter,
    status: statusFilter,
    reviewCountMin: options.reviewCountMin ?? null,
    reviewCountMax: options.reviewCountMax ?? null,
    priceAmountMin: options.priceAmountMin ?? null,
    priceAmountMax: options.priceAmountMax ?? null,
    commissionRateMin: options.commissionRateMin ?? null,
    commissionRateMax: options.commissionRateMax ?? null,
    commissionAmountMin: options.commissionAmountMin ?? null,
    commissionAmountMax: options.commissionAmountMax ?? null,
    recommendationScoreMin: options.recommendationScoreMin ?? null,
    recommendationScoreMax: options.recommendationScoreMax ?? null,
    createdAtFrom: createdAtRange.from,
    createdAtTo: createdAtRange.to,
  }
  const summaryCacheHash = buildProductSummaryCacheHash(summaryCachePayload)
  const cachedSummary = await getCachedProductSummary<{
    total: number
    productsWithLinkCount: number
    activeProductsCount: number
    invalidProductsCount: number
    syncMissingProductsCount: number
    unknownProductsCount: number
    blacklistedCount: number
    landingPageStats?: Partial<ProductLandingPageStats>
    platformStats?: Partial<Record<AffiliatePlatform, Partial<PlatformProductStats>>>
  }>(userId, summaryCacheHash)

  let total = 0
  let landingPageStats: ProductLandingPageStats = {
    productCount: 0,
    storeCount: 0,
    unknownCount: 0,
  }
  let productsWithLinkCount = 0
  let activeProductsCount = 0
  let invalidProductsCount = 0
  let syncMissingProductsCount = 0
  let unknownProductsCount = 0
  let blacklistedCount = 0
  const platformStatsAccumulator = createPlatformStatsAccumulator()
  let platformStats = finalizePlatformStats(platformStatsAccumulator)
  const resolveCachedLandingPageStats = (resolvedTotal: number): ProductLandingPageStats => {
    const productCount = toSafeCount(cachedSummary?.landingPageStats?.productCount)
    const storeCount = toSafeCount(cachedSummary?.landingPageStats?.storeCount)
    return {
      productCount,
      storeCount,
      unknownCount: Math.max(0, resolvedTotal - productCount - storeCount),
    }
  }
  const resolveLightweightLandingPageStats = (resolvedTotal: number): ProductLandingPageStats => {
    const cachedLandingStats = resolveCachedLandingPageStats(resolvedTotal)
    if (cachedLandingStats.productCount > 0 || cachedLandingStats.storeCount > 0) {
      return cachedLandingStats
    }

    // lightweightSummary 下沿用已聚合的平台计数兜底，避免额外重查询。
    const inferredProductCount = Math.max(
      0,
      platformStatsAccumulator.yeahpromos.productCount +
        platformStatsAccumulator.partnerboost.productCount
    )
    const inferredStoreCount = Math.max(
      0,
      platformStatsAccumulator.yeahpromos.storeCount +
        platformStatsAccumulator.partnerboost.storeCount
    )
    return {
      productCount: inferredProductCount,
      storeCount: inferredStoreCount,
      unknownCount: Math.max(0, resolvedTotal - inferredProductCount - inferredStoreCount),
    }
  }

  const cachedPlatformStats = cachedSummary?.platformStats
  const hasCachedPlatformStats = Boolean(
    cachedPlatformStats && typeof cachedPlatformStats === 'object'
  )
  let summaryComputationDegraded = false

  try {
    if (cachedSummary && hasCachedPlatformStats) {
      total = Number(cachedSummary.total || 0)
      productsWithLinkCount = Number(cachedSummary.productsWithLinkCount || 0)
      activeProductsCount = Number(cachedSummary.activeProductsCount || 0)
      invalidProductsCount = Number(cachedSummary.invalidProductsCount || 0)
      syncMissingProductsCount = Number(cachedSummary.syncMissingProductsCount || 0)
      unknownProductsCount = Number(cachedSummary.unknownProductsCount || 0)
      blacklistedCount = Number(cachedSummary.blacklistedCount || 0)

      for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
        const platformCached = cachedPlatformStats?.[platformKey]
        if (!platformCached || typeof platformCached !== 'object') continue
        platformStatsAccumulator[platformKey] = {
          total: toSafeCount(platformCached.total),
          productCount: toSafeCount(platformCached.productCount),
          storeCount: toSafeCount(platformCached.storeCount),
          productsWithLinkCount: toSafeCount(platformCached.productsWithLinkCount),
          activeProductsCount: toSafeCount(platformCached.activeProductsCount),
          invalidProductsCount: toSafeCount(platformCached.invalidProductsCount),
          syncMissingProductsCount: toSafeCount(platformCached.syncMissingProductsCount),
          unknownProductsCount: toSafeCount(platformCached.unknownProductsCount),
          blacklistedCount: toSafeCount(platformCached.blacklistedCount),
        }
      }

      platformStats = finalizePlatformStats(platformStatsAccumulator)
      const cachedLanding = cachedSummary.landingPageStats
      const productCount = toSafeCount(cachedLanding?.productCount)
      const storeCount = toSafeCount(cachedLanding?.storeCount)
      const fallbackProductCount =
        platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
      const fallbackStoreCount =
        platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
      const resolvedProductCount =
        productCount > 0 || storeCount > 0 ? productCount : fallbackProductCount
      const resolvedStoreCount =
        productCount > 0 || storeCount > 0 ? storeCount : fallbackStoreCount
      landingPageStats = {
        productCount: resolvedProductCount,
        storeCount: resolvedStoreCount,
        unknownCount: Math.max(0, total - resolvedProductCount - resolvedStoreCount),
      }
    } else if (skipHeavySummary) {
      if (cachedSummary) {
        total = Number(cachedSummary.total || 0)
        productsWithLinkCount = Number(cachedSummary.productsWithLinkCount || 0)
        activeProductsCount = Number(cachedSummary.activeProductsCount || 0)
        invalidProductsCount = Number(cachedSummary.invalidProductsCount || 0)
        syncMissingProductsCount = Number(cachedSummary.syncMissingProductsCount || 0)
        unknownProductsCount = Number(cachedSummary.unknownProductsCount || 0)
        blacklistedCount = Number(cachedSummary.blacklistedCount || 0)
      } else {
        total = 0
      }
      landingPageStats = resolveCachedLandingPageStats(total)
      platformStats = finalizePlatformStats(platformStatsAccumulator)
      summaryComputationDegraded = summaryComputationDegraded || total <= 0
    } else if (fastSummary) {
      if (cachedSummary) {
        productsWithLinkCount = Number(cachedSummary.productsWithLinkCount || 0)
        activeProductsCount = Number(cachedSummary.activeProductsCount || 0)
        invalidProductsCount = Number(cachedSummary.invalidProductsCount || 0)
        syncMissingProductsCount = Number(cachedSummary.syncMissingProductsCount || 0)
        unknownProductsCount = Number(cachedSummary.unknownProductsCount || 0)
        blacklistedCount = Number(cachedSummary.blacklistedCount || 0)
      }

      const basePlatformRows = lightweightSummary
        ? await db.query<{
            platform: string
            total_count: number
            lightweight_product_count: number
            lightweight_store_count: number
          }>(
            `
          SELECT
            p.platform AS platform,
            COUNT(*) AS total_count,
            SUM(
              CASE
                WHEN (
                  ${lightweightProductConditionSql}
                ) THEN 1
                ELSE 0
              END
            ) AS lightweight_product_count,
            SUM(
              CASE
                WHEN (
                  ${lightweightStoreConditionSql}
                ) THEN 1
                ELSE 0
              END
            ) AS lightweight_store_count
          FROM affiliate_products p
          WHERE ${baseWhereSql}
          GROUP BY p.platform
        `,
            [...whereParams]
          )
        : await db.query<{
            platform: string
            total_count: number
            product_count: number
            store_count: number
          }>(
            `
          SELECT
            p.platform AS platform,
            COUNT(*) AS total_count,
            SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
            SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
          FROM affiliate_products p
          WHERE ${baseWhereSql}
          GROUP BY p.platform
        `,
            [...whereParams]
          )

      for (const row of basePlatformRows) {
        const platformKey = normalizeAffiliatePlatform(row.platform)
        if (!platformKey) continue
        platformStatsAccumulator[platformKey].total = toSafeCount(row.total_count)
        if (lightweightSummary) {
          platformStatsAccumulator[platformKey].productCount = toSafeCount(
            (row as any).lightweight_product_count
          )
          platformStatsAccumulator[platformKey].storeCount = toSafeCount(
            (row as any).lightweight_store_count
          )
        } else {
          platformStatsAccumulator[platformKey].productCount = toSafeCount(
            (row as any).product_count
          )
          platformStatsAccumulator[platformKey].storeCount = toSafeCount((row as any).store_count)
        }
      }

      if (statusFilter === 'all') {
        total = Object.values(platformStatsAccumulator).reduce((sum, item) => sum + item.total, 0)
        platformStats = finalizePlatformStats(platformStatsAccumulator)
        landingPageStats = lightweightSummary
          ? resolveLightweightLandingPageStats(total)
          : (() => {
              const productCount =
                platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
              const storeCount =
                platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
              return {
                productCount,
                storeCount,
                unknownCount: Math.max(0, total - productCount - storeCount),
              }
            })()
      } else {
        const fastVisibleRows = lightweightSummary
          ? await db.query<{
              platform: string
              visible_count: number
              lightweight_product_count: number
              lightweight_store_count: number
            }>(
              `
            ${fullSyncBaselineCteSql}
            SELECT
              p.platform AS platform,
              COUNT(*) AS visible_count,
              SUM(
                CASE
                  WHEN (
                    ${lightweightProductConditionSql}
                  ) THEN 1
                  ELSE 0
                END
              ) AS lightweight_product_count,
              SUM(
                CASE
                  WHEN (
                    ${lightweightStoreConditionSql}
                  ) THEN 1
                  ELSE 0
                END
              ) AS lightweight_store_count
            FROM affiliate_products p
            LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
            WHERE ${filteredWhereSql}
            GROUP BY p.platform
          `,
              [userId, ...filteredWhereParams]
            )
          : await db.query<{
              platform: string
              visible_count: number
              product_count: number
              store_count: number
            }>(
              `
            ${fullSyncBaselineCteSql}
            SELECT
              p.platform AS platform,
              COUNT(*) AS visible_count,
              SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
              SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
            FROM affiliate_products p
            LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
            WHERE ${filteredWhereSql}
            GROUP BY p.platform
          `,
              [userId, ...filteredWhereParams]
            )

        for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
          platformStatsAccumulator[platformKey].productCount = 0
          platformStatsAccumulator[platformKey].storeCount = 0
        }

        let visibleTotal = 0
        for (const row of fastVisibleRows) {
          const platformKey = normalizeAffiliatePlatform(row.platform)
          if (!platformKey) continue
          const visibleCount = toSafeCount(row.visible_count)
          visibleTotal += visibleCount
          if (lightweightSummary) {
            platformStatsAccumulator[platformKey].productCount = toSafeCount(
              (row as any).lightweight_product_count
            )
            platformStatsAccumulator[platformKey].storeCount = toSafeCount(
              (row as any).lightweight_store_count
            )
          } else {
            platformStatsAccumulator[platformKey].productCount = toSafeCount(
              (row as any).product_count
            )
            platformStatsAccumulator[platformKey].storeCount = toSafeCount((row as any).store_count)
          }

          if (statusFilter === 'active') {
            platformStatsAccumulator[platformKey].activeProductsCount = visibleCount
            continue
          }
          if (statusFilter === 'invalid') {
            platformStatsAccumulator[platformKey].invalidProductsCount = visibleCount
            continue
          }
          if (statusFilter === 'sync_missing') {
            platformStatsAccumulator[platformKey].syncMissingProductsCount = visibleCount
            continue
          }
          platformStatsAccumulator[platformKey].unknownProductsCount = visibleCount
        }

        total = visibleTotal
        if (statusFilter === 'active') {
          activeProductsCount = visibleTotal
        } else if (statusFilter === 'invalid') {
          invalidProductsCount = visibleTotal
        } else if (statusFilter === 'sync_missing') {
          syncMissingProductsCount = visibleTotal
        } else if (statusFilter === 'unknown') {
          unknownProductsCount = visibleTotal
        }

        platformStats = finalizePlatformStats(platformStatsAccumulator)
        landingPageStats = lightweightSummary
          ? resolveLightweightLandingPageStats(total)
          : (() => {
              const productCount =
                platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
              const storeCount =
                platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
              return {
                productCount,
                storeCount,
                unknownCount: Math.max(0, total - productCount - storeCount),
              }
            })()
      }

      if (!lightweightSummary) {
        await setCachedProductSummary(userId, summaryCacheHash, {
          total,
          productsWithLinkCount,
          activeProductsCount,
          invalidProductsCount,
          syncMissingProductsCount,
          unknownProductsCount,
          blacklistedCount,
          landingPageStats,
          platformStats,
        })
      }
    } else {
      const summaryRow = await db.queryOne<{
        total_count: number
        active_products_count: number
        sync_missing_products_count: number
        unknown_products_count: number
        blacklisted_count: number
        products_with_link_count: number
        yeahpromos_count: number
      }>(
        `
        ${fullSyncBaselineCteSql}
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS active_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS sync_missing_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS unknown_products_count,
          SUM(CASE WHEN COALESCE(p.is_blacklisted, false) = true THEN 1 ELSE 0 END) AS blacklisted_count,
          SUM(
            CASE
              WHEN COALESCE(NULLIF(TRIM(p.short_promo_link), ''), NULLIF(TRIM(p.promo_link), '')) IS NOT NULL THEN 1
              ELSE 0
            END
          ) AS products_with_link_count,
          SUM(CASE WHEN p.platform = 'yeahpromos' THEN 1 ELSE 0 END) AS yeahpromos_count
        FROM affiliate_products p
        LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
        WHERE ${baseWhereSql}
      `,
        [userId, ...whereParams]
      )

      const platformSummaryRows = await db.query<{
        platform: string
        total_count: number
        product_count: number
        store_count: number
        active_products_count: number
        sync_missing_products_count: number
        unknown_products_count: number
        blacklisted_count: number
        products_with_link_count: number
      }>(
        `
        ${fullSyncBaselineCteSql}
        SELECT
          p.platform AS platform,
          COUNT(*) AS total_count,
          SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
          SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS active_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS sync_missing_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS unknown_products_count,
          SUM(CASE WHEN COALESCE(p.is_blacklisted, false) = true THEN 1 ELSE 0 END) AS blacklisted_count,
          SUM(
            CASE
              WHEN COALESCE(NULLIF(TRIM(p.short_promo_link), ''), NULLIF(TRIM(p.promo_link), '')) IS NOT NULL THEN 1
              ELSE 0
            END
          ) AS products_with_link_count
        FROM affiliate_products p
        LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
        WHERE ${baseWhereSql}
        GROUP BY p.platform
      `,
        [userId, ...whereParams]
      )

      for (const row of platformSummaryRows) {
        const platformKey = normalizeAffiliatePlatform(row.platform)
        if (!platformKey) continue
        platformStatsAccumulator[platformKey] = {
          total: toSafeCount(row.total_count),
          productCount: toSafeCount(row.product_count),
          storeCount: toSafeCount(row.store_count),
          productsWithLinkCount: toSafeCount(row.products_with_link_count),
          activeProductsCount: toSafeCount(row.active_products_count),
          invalidProductsCount: 0,
          syncMissingProductsCount: toSafeCount(row.sync_missing_products_count),
          unknownProductsCount: toSafeCount(row.unknown_products_count),
          blacklistedCount: toSafeCount(row.blacklisted_count),
        }
      }

      let invalidActiveOverlapCount = 0
      let invalidSyncMissingOverlapCount = 0
      let invalidUnknownOverlapCount = 0

      if (!skipInvalidSummary) {
        const invalidSummaryRow = await db.queryOne<{
          invalid_products_count: number
          invalid_active_overlap_count: number
          invalid_sync_missing_overlap_count: number
          invalid_unknown_overlap_count: number
        }>(
          `
          ${fullSyncBaselineCteSql}
          SELECT
            COUNT(*) AS invalid_products_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS invalid_active_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS invalid_sync_missing_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS invalid_unknown_overlap_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${baseWhereSql}
            AND ${confirmedInvalidStatusSql}
        `,
          [userId, ...whereParams]
        )

        const invalidSummaryByPlatformRows = await db.query<{
          platform: string
          invalid_products_count: number
          invalid_active_overlap_count: number
          invalid_sync_missing_overlap_count: number
          invalid_unknown_overlap_count: number
        }>(
          `
          ${fullSyncBaselineCteSql}
          SELECT
            p.platform AS platform,
            COUNT(*) AS invalid_products_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS invalid_active_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS invalid_sync_missing_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS invalid_unknown_overlap_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${baseWhereSql}
            AND ${confirmedInvalidStatusSql}
          GROUP BY p.platform
        `,
          [userId, ...whereParams]
        )

        invalidProductsCount = Number(invalidSummaryRow?.invalid_products_count || 0)
        invalidActiveOverlapCount = Number(invalidSummaryRow?.invalid_active_overlap_count || 0)
        invalidSyncMissingOverlapCount = Number(
          invalidSummaryRow?.invalid_sync_missing_overlap_count || 0
        )
        invalidUnknownOverlapCount = Number(invalidSummaryRow?.invalid_unknown_overlap_count || 0)

        for (const row of invalidSummaryByPlatformRows) {
          const platformKey = normalizeAffiliatePlatform(row.platform)
          if (!platformKey) continue
          const invalidCount = toSafeCount(row.invalid_products_count)
          const invalidActiveOverlap = toSafeCount(row.invalid_active_overlap_count)
          const invalidSyncMissingOverlap = toSafeCount(row.invalid_sync_missing_overlap_count)
          const invalidUnknownOverlap = toSafeCount(row.invalid_unknown_overlap_count)

          platformStatsAccumulator[platformKey].invalidProductsCount = invalidCount
          platformStatsAccumulator[platformKey].activeProductsCount = Math.max(
            0,
            platformStatsAccumulator[platformKey].activeProductsCount - invalidActiveOverlap
          )
          platformStatsAccumulator[platformKey].syncMissingProductsCount = Math.max(
            0,
            platformStatsAccumulator[platformKey].syncMissingProductsCount -
              invalidSyncMissingOverlap
          )
          platformStatsAccumulator[platformKey].unknownProductsCount = Math.max(
            0,
            platformStatsAccumulator[platformKey].unknownProductsCount - invalidUnknownOverlap
          )
        }
      }

      const baseActiveProductsCount = Number(summaryRow?.active_products_count || 0)
      const baseSyncMissingProductsCount = Number(summaryRow?.sync_missing_products_count || 0)
      const baseUnknownProductsCount = Number(summaryRow?.unknown_products_count || 0)

      activeProductsCount = Math.max(0, baseActiveProductsCount - invalidActiveOverlapCount)
      syncMissingProductsCount = Math.max(
        0,
        baseSyncMissingProductsCount - invalidSyncMissingOverlapCount
      )
      unknownProductsCount = Math.max(0, baseUnknownProductsCount - invalidUnknownOverlapCount)

      total = (() => {
        if (statusFilter === 'all') return Number(summaryRow?.total_count || 0)
        if (statusFilter === 'invalid') return invalidProductsCount
        if (statusFilter === 'active') return activeProductsCount
        if (statusFilter === 'sync_missing') return syncMissingProductsCount
        return unknownProductsCount
      })()
      productsWithLinkCount = Number(summaryRow?.products_with_link_count || 0)
      blacklistedCount = Number(summaryRow?.blacklisted_count || 0)

      if (statusFilter !== 'all') {
        const filteredLandingRows = await db.query<{
          platform: string
          product_count: number
          store_count: number
        }>(
          `
          ${fullSyncBaselineCteSql}
          SELECT
            p.platform AS platform,
            SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
            SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${filteredWhereSql}
          GROUP BY p.platform
        `,
          [userId, ...filteredWhereParams]
        )

        for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
          platformStatsAccumulator[platformKey].productCount = 0
          platformStatsAccumulator[platformKey].storeCount = 0
        }
        for (const row of filteredLandingRows) {
          const platformKey = normalizeAffiliatePlatform(row.platform)
          if (!platformKey) continue
          platformStatsAccumulator[platformKey].productCount = toSafeCount(row.product_count)
          platformStatsAccumulator[platformKey].storeCount = toSafeCount(row.store_count)
        }
      }

      platformStats = finalizePlatformStats(platformStatsAccumulator)
      const productCount =
        platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
      const storeCount = platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
      landingPageStats = {
        productCount,
        storeCount,
        unknownCount: Math.max(0, total - productCount - storeCount),
      }

      await setCachedProductSummary(userId, summaryCacheHash, {
        total,
        productsWithLinkCount,
        activeProductsCount,
        invalidProductsCount,
        syncMissingProductsCount,
        unknownProductsCount,
        blacklistedCount,
        landingPageStats,
        platformStats,
      })
    }
  } catch (error) {
    if (fastSummary && isPostgresStatementTimeoutError(error)) {
      summaryComputationDegraded = true
      console.warn(
        `[listAffiliateProducts] summary degraded due statement timeout (userId=${userId}, status=${statusFilter}, landingPageType=${landingPageTypeFilter}, targetCountry=${options.targetCountry || 'all'})`
      )
    } else {
      // rowsPromise 已经启动；在抛出前吞掉其 reject，避免进程级 unhandled rejection。
      await rowsPromise.catch(() => {})
      throw error
    }
  }

  const rows = await rowsPromise
  if (summaryComputationDegraded && total <= 0) {
    // 降级时优先保证列表可用；总量在下一次 summary 命中缓存后可恢复为精确值。
    total = offset + rows.length
  }
  if (!skipItems) {
    await hydratePartnerboostShortLinksForRows({
      db,
      userId,
      rows,
    })
  }

  const items = skipItems
    ? []
    : rows.map((row, index) => {
        const rowForMapping =
          statusFilter === 'all'
            ? {
                ...row,
                product_status: resolveLifecycleStatusFromRowForList(row),
              }
            : row
        return mapAffiliateProductRow(rowForMapping, offset + index + 1)
      })

  return {
    items,
    total,
    landingPageStats,
    productsWithLinkCount,
    activeProductsCount,
    invalidProductsCount,
    syncMissingProductsCount,
    unknownProductsCount,
    blacklistedCount,
    platformStats,
    page,
    pageSize,
  }
}

export function mapAffiliateProductRow(
  row: AffiliateProduct & {
    related_offer_count?: number
    active_offer_count?: number
    historical_offer_count?: number
    product_status?: AffiliateProductLifecycleStatus
  },
  serialNumber?: number
): AffiliateProductListItem {
  const normalizedCommissionRateMode = normalizeCommissionRateMode(row.commission_rate_mode)
  const hasComparableCommissionValues =
    row.commission_amount !== null && row.commission_rate !== null
  const looksLikeAmountModeFromValues = hasComparableCommissionValues
    ? Math.abs(Number(row.commission_amount) - Number(row.commission_rate)) < 0.000001
    : false

  const commissionRateMode: 'percent' | 'amount' =
    normalizedCommissionRateMode || (looksLikeAmountModeFromValues ? 'amount' : 'percent')

  const inferredCommissionCurrency = normalizeCurrencyUnit(row.price_currency)

  const normalizedCommissionAmount =
    commissionRateMode === 'amount'
      ? (row.commission_amount ?? row.commission_rate)
      : row.commission_amount

  const normalizedCommissionRate =
    commissionRateMode === 'amount'
      ? (row.commission_amount ?? row.commission_rate)
      : row.commission_rate

  const normalizedReviewCount = row.review_count
  const isDeepLink = normalizeTriStateBool(row.is_deeplink)
  const landingPageType = detectAffiliateLandingPageType({
    asin: row.asin,
    productUrl: row.product_url,
    promoLink: row.promo_link,
    shortPromoLink: row.short_promo_link,
  })
  const normalizedId = Number(row.id)
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error(`[affiliate-products] invalid affiliate_products.id: ${String(row.id)}`)
  }
  const resolvedSerial =
    typeof serialNumber === 'number' && Number.isFinite(serialNumber) ? serialNumber : normalizedId

  const merchantId = (() => {
    if (row.platform === 'partnerboost') {
      const partnerboostMerchantId = String(row.merchant_id || '').trim()
      return partnerboostMerchantId || null
    }

    const defaultMerchantId = String(row.mid || '').trim()
    return defaultMerchantId || null
  })()

  const recommendationScoreCalculatedAtMs = parseDateToTimestamp(row.score_calculated_at || null)
  const recommendationScoreIsFresh =
    Number.isFinite(Number(row.recommendation_score)) &&
    recommendationScoreCalculatedAtMs !== null &&
    Date.now() - recommendationScoreCalculatedAtMs <= PRODUCT_SCORE_VALIDITY_WINDOW_MS

  return {
    id: normalizedId,
    serial: resolvedSerial,
    platform: row.platform,
    mid: row.mid,
    merchantId,
    productStatus: resolveAffiliateProductLifecycleStatus(row.product_status),
    asin: row.asin,
    landingPageType,
    isDeepLink,
    brand: row.brand,
    productName: row.product_name,
    productUrl: row.product_url,
    allowedCountries: parseAllowedCountries(row.allowed_countries_json),
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    commissionRate: normalizedCommissionRate,
    commissionRateMode,
    commissionAmount: normalizedCommissionAmount,
    commissionCurrency: inferredCommissionCurrency,
    reviewCount: normalizedReviewCount,
    promoLink: row.short_promo_link || row.promo_link,
    shortPromoLink: row.short_promo_link,
    activeOfferCount: Number(row.active_offer_count || 0),
    historicalOfferCount: Number(row.historical_offer_count || 0),
    relatedOfferCount: Number(row.related_offer_count || 0),
    isBlacklisted: row.is_blacklisted === true,
    recommendationScore: recommendationScoreIsFresh ? row.recommendation_score || null : null,
    recommendationReasons:
      recommendationScoreIsFresh && row.recommendation_reasons
        ? JSON.parse(row.recommendation_reasons)
        : null,
    seasonalityScore: row.seasonality_score || null,
    productAnalysis: row.product_analysis ? JSON.parse(row.product_analysis) : null,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
