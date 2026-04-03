import type { Task } from '@/lib/queue/types'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { scheduleProductScoreCalculation } from '@/lib/queue/schedulers/product-score-scheduler'
import {
  checkAffiliatePlatformConfig,
  type AffiliatePlatform,
  type AffiliateProductSyncCheckpoint,
  type AffiliateProductSyncProgress,
  getAffiliateProductSyncRunById,
  listAffiliateProducts,
  normalizeAffiliatePlatform,
  type ProductSortField,
  type ProductSortOrder,
  recordAffiliateProductSyncHourlySnapshot,
  type SyncMode,
  syncAffiliateProducts,
  updateAffiliateProductSyncRun,
} from '@/lib/affiliate-products'
import {
  buildProductListCacheHash,
  getLatestProductListQuery,
  invalidateProductListCache,
  type ProductListCachePayload,
  setCachedProductList,
} from '@/lib/products-cache'
import { getDatabase } from '@/lib/db'

export type AffiliateProductSyncTaskData = {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  runId: number
  productId?: number
  trigger?: 'manual' | 'retry' | 'schedule'
}

const PLATFORM_CONTINUATION_DELAY_MS = 2 * 60 * 1000
const RECOVERY_RETRY_MAX_ATTEMPTS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_RECOVERY_RETRY_MAX_ATTEMPTS',
  4,
  10
)
const RECOVERY_SYNC_MAX_ATTEMPTS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_RECOVERY_SYNC_MAX_ATTEMPTS',
 4,
  5
)
const RECOVERY_RETRY_BASE_DELAY_MS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_RECOVERY_RETRY_BASE_DELAY_MS',
  600,
  60000
)
const RECOVERY_RETRY_MAX_DELAY_MS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_RECOVERY_RETRY_MAX_DELAY_MS',
  4000,
  60000
)
const STALL_GUARD_LOOKBACK_BUCKETS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_STALL_LOOKBACK_BUCKETS',
  6,
  48
)
const STALL_GUARD_MIN_BUCKETS = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_STALL_MIN_BUCKETS',
  4,
  24
)
const STALL_GUARD_MIN_PROCESSED_BATCHES = resolvePositiveIntEnv(
  'AFFILIATE_SYNC_STALL_MIN_PROCESSED_BATCHES',
  60,
  20000
)

function resolvePositiveIntEnv(name: string, fallback: number, max: number): number {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.min(max, Math.floor(raw))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPostgresRecoveryModeError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toUpperCase()
  if (
    code === '57P03'
    || code === 'CONNECTION_CLOSED'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
  ) return true

  const message = String((error as any)?.message || error || '').toLowerCase()
  if (!message) return false

  return message.includes('the database system is in recovery mode')
    || message.includes('database system is in recovery mode')
    || message.includes('connection_closed')
    || message.includes('connection closed')
    || message.includes('econnreset')
    || message.includes('etimedout')
}

function getRecoveryRetryDelayMs(attempt: number): number {
  const exponentialDelay = RECOVERY_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1))
  const cappedDelay = Math.min(RECOVERY_RETRY_MAX_DELAY_MS, exponentialDelay)
  const jitter = 0.85 + (Math.random() * 0.3)
  return Math.max(50, Math.floor(cappedDelay * jitter))
}

async function withRecoveryModeRetry<T>(params: {
  label: string
  operation: () => Promise<T>
  maxAttempts?: number
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(Number(params.maxAttempts || RECOVERY_RETRY_MAX_ATTEMPTS)))

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await params.operation()
    } catch (error: any) {
      if (!isPostgresRecoveryModeError(error) || attempt >= maxAttempts) {
        throw error
      }

      const nextAttempt = attempt + 1
      const delayMs = getRecoveryRetryDelayMs(attempt)
      console.warn(
        `[affiliate-product-sync] ${params.label} hit PostgreSQL recovery mode, retrying (${nextAttempt}/${maxAttempts}) in ${delayMs}ms`
      )
      await sleep(delayMs)
    }
  }

  // Unreachable fallback for TypeScript control flow.
  throw new Error(`[affiliate-product-sync] ${params.label} exceeded retry attempts`)
}

type StallGrowthWindow = {
  minTotal: number
  maxTotal: number
  bucketCount: number
  stalled: boolean
}

async function readRunGrowthWindow(params: {
  userId: number
  runId: number
  lookbackBuckets: number
  minBuckets: number
}): Promise<StallGrowthWindow | null> {
  const db = await getDatabase()
  const safeLookback = Math.max(1, params.lookbackBuckets)
  const safeMinBuckets = Math.max(1, params.minBuckets)

  try {
    const rows = await db.query<{ max_total_items: number }>(
      `
        SELECT max_total_items
        FROM affiliate_product_sync_hourly_stats
        WHERE user_id = ?
          AND run_id = ?
        ORDER BY hour_bucket DESC
        LIMIT ?
      `,
      [params.userId, params.runId, safeLookback]
    )

    if (!Array.isArray(rows) || rows.length < safeMinBuckets) {
      return null
    }

    const totals = rows
      .map((row) => {
        const value = Number(row?.max_total_items || 0)
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
      })
    if (totals.length < safeMinBuckets) {
      return null
    }

    let minTotal = totals[0]
    let maxTotal = totals[0]
    for (const total of totals) {
      if (total < minTotal) minTotal = total
      if (total > maxTotal) maxTotal = total
    }

    return {
      minTotal,
      maxTotal,
      bucketCount: totals.length,
      stalled: maxTotal <= minTotal,
    }
  } catch (error: any) {
    const code = String(error?.code || '').toUpperCase()
    const message = String(error?.message || '')
    if (code === '42P01' || message.includes('affiliate_product_sync_hourly_stats')) {
      return null
    }
    console.warn(
      `[affiliate-product-sync] failed to evaluate stall guard for run=${params.runId}: ${message || error}`
    )
    return null
  }
}

const DEFAULT_CACHE_WARM_PARAMS: {
  page: number
  pageSize: number
  search: string
  mid: string
  targetCountry: string
  landingPageType: 'all' | 'amazon_product' | 'amazon_store' | 'independent_product' | 'independent_store' | 'unknown'
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all'
  status: 'all' | 'active' | 'invalid' | 'sync_missing' | 'unknown'
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
} = {
  page: 1,
  pageSize: 20,
  search: '',
  mid: '',
  targetCountry: 'all',
  landingPageType: 'all',
  sortBy: 'serial',
  sortOrder: 'desc',
  platform: 'all',
  status: 'all',
  reviewCountMin: null,
  reviewCountMax: null,
  priceAmountMin: null,
  priceAmountMax: null,
  commissionRateMin: null,
  commissionRateMax: null,
  commissionAmountMin: null,
  commissionAmountMax: null,
  recommendationScoreMin: null,
  recommendationScoreMax: null,
  createdAtFrom: null,
  createdAtTo: null,
}

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'createdAt',
  'allowedCountries',
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'promoLink',
  'relatedOfferCount',
  'updatedAt',
  'recommendationScore',
])

type CacheWarmParams = {
  page: number
  pageSize: number
  search: string
  mid: string
  targetCountry: string
  landingPageType: 'all' | 'amazon_product' | 'amazon_store' | 'independent_product' | 'independent_store' | 'unknown'
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all' | AffiliatePlatform
  status: 'all' | 'active' | 'invalid' | 'sync_missing' | 'unknown'
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

function normalizeOptionalBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

function normalizeOptionalDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function normalizeWarmParams(payload: ProductListCachePayload): CacheWarmParams {
  const page = Math.max(1, Number(payload.page || 1))
  const pageSize = Math.min(1000, Math.max(10, Number(payload.pageSize || 20)))
  const search = String(payload.search || '').trim()
  const mid = String(payload.mid || '').trim()

  const sortByRaw = String(payload.sortBy || 'serial') as ProductSortField
  const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'

  const sortOrder = String(payload.sortOrder || 'desc').toLowerCase() === 'asc'
    ? 'asc'
    : 'desc' as ProductSortOrder

  const platform = payload.platform === 'all'
    ? 'all'
    : (normalizeAffiliatePlatform(payload.platform) || 'all')
  const statusRaw = String(payload.status || '').trim().toLowerCase()
  const status = statusRaw === 'active' || statusRaw === 'invalid' || statusRaw === 'sync_missing' || statusRaw === 'unknown'
    ? statusRaw
    : 'all'
  const rawTargetCountry = String(payload.targetCountry || '').trim().toUpperCase()
  const targetCountry = /^[A-Z]{2,3}$/.test(rawTargetCountry) ? rawTargetCountry : 'all'
  const rawLandingPageType = String(payload.landingPageType || '').trim().toLowerCase()
  const landingPageType = rawLandingPageType === 'amazon_product'
    || rawLandingPageType === 'amazon_store'
    || rawLandingPageType === 'independent_product'
    || rawLandingPageType === 'independent_store'
    || rawLandingPageType === 'unknown'
    ? rawLandingPageType
    : 'all'
  const createdAtFrom = normalizeOptionalDate(payload.createdAtFrom)
  const createdAtTo = normalizeOptionalDate(payload.createdAtTo)
  const normalizedDateRange = createdAtFrom && createdAtTo && createdAtFrom > createdAtTo
    ? { createdAtFrom: createdAtTo, createdAtTo: createdAtFrom }
    : { createdAtFrom, createdAtTo }

  return {
    page,
    pageSize,
    search,
    mid,
    targetCountry,
    landingPageType,
    sortBy,
    sortOrder,
    platform,
    status,
    reviewCountMin: normalizeOptionalBound(payload.reviewCountMin),
    reviewCountMax: normalizeOptionalBound(payload.reviewCountMax),
    priceAmountMin: normalizeOptionalBound(payload.priceAmountMin),
    priceAmountMax: normalizeOptionalBound(payload.priceAmountMax),
    commissionRateMin: normalizeOptionalBound(payload.commissionRateMin),
    commissionRateMax: normalizeOptionalBound(payload.commissionRateMax),
    commissionAmountMin: normalizeOptionalBound(payload.commissionAmountMin),
    commissionAmountMax: normalizeOptionalBound(payload.commissionAmountMax),
    recommendationScoreMin: normalizeOptionalBound(payload.recommendationScoreMin),
    recommendationScoreMax: normalizeOptionalBound(payload.recommendationScoreMax),
    createdAtFrom: normalizedDateRange.createdAtFrom,
    createdAtTo: normalizedDateRange.createdAtTo,
  }
}

async function warmProductListCacheByParams(userId: number, params: CacheWarmParams): Promise<void> {
  const listResult = await listAffiliateProducts(userId, {
    ...params,
    mid: params.mid,
    targetCountry: params.targetCountry === 'all' ? undefined : params.targetCountry,
    landingPageType: params.landingPageType === 'all' ? undefined : params.landingPageType,
    reviewCountMin: params.reviewCountMin ?? undefined,
    reviewCountMax: params.reviewCountMax ?? undefined,
    priceAmountMin: params.priceAmountMin ?? undefined,
    priceAmountMax: params.priceAmountMax ?? undefined,
    commissionRateMin: params.commissionRateMin ?? undefined,
    commissionRateMax: params.commissionRateMax ?? undefined,
    commissionAmountMin: params.commissionAmountMin ?? undefined,
    commissionAmountMax: params.commissionAmountMax ?? undefined,
    recommendationScoreMin: params.recommendationScoreMin ?? undefined,
    recommendationScoreMax: params.recommendationScoreMax ?? undefined,
    createdAtFrom: params.createdAtFrom ?? undefined,
    createdAtTo: params.createdAtTo ?? undefined,
  })
  const responsePayload = {
    success: true as const,
    items: listResult.items,
    total: listResult.total,
    productsWithLinkCount: listResult.productsWithLinkCount,
    landingPageStats: listResult.landingPageStats,
    activeProductsCount: listResult.activeProductsCount,
    invalidProductsCount: listResult.invalidProductsCount,
    syncMissingProductsCount: listResult.syncMissingProductsCount,
    unknownProductsCount: listResult.unknownProductsCount,
    blacklistedCount: listResult.blacklistedCount,
    platformStats: listResult.platformStats,
    page: listResult.page,
    pageSize: listResult.pageSize,
  }

  const cacheHash = buildProductListCacheHash(params)
  await setCachedProductList(userId, cacheHash, responsePayload)
}

async function refreshAndWarmProductListCache(userId: number): Promise<void> {
  await invalidateProductListCache(userId)

  const warmTargets = new Map<string, CacheWarmParams>()
  const defaultParams = normalizeWarmParams(DEFAULT_CACHE_WARM_PARAMS)
  warmTargets.set(buildProductListCacheHash(defaultParams), defaultParams)

  const latestQuery = await getLatestProductListQuery(userId)
  if (latestQuery) {
    const latestParams = normalizeWarmParams(latestQuery)
    warmTargets.set(buildProductListCacheHash(latestParams), latestParams)
  }

  for (const params of warmTargets.values()) {
    await warmProductListCacheByParams(userId, params)
  }
}

export async function executeAffiliateProductSync(task: Task<AffiliateProductSyncTaskData>) {
  const data = task.data
  if (!data?.userId || !data?.platform || !data?.runId) {
    throw new Error('任务参数不完整')
  }

  const platformLabel = data.platform === 'partnerboost'
    ? 'PartnerBoost'
    : data.platform === 'yeahpromos'
      ? 'YeahPromos'
      : '联盟平台'
  const supportsPlatformResume = data.mode === 'platform'
    && (data.platform === 'partnerboost' || data.platform === 'yeahpromos')
  const toSafeCount = (value: unknown): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }

  const existingRun = await withRecoveryModeRetry({
    label: `load run context(run=${data.runId})`,
    maxAttempts: RECOVERY_SYNC_MAX_ATTEMPTS,
    operation: () => getAffiliateProductSyncRunById({
      runId: data.runId,
      userId: data.userId,
    }),
  })

  let resumeSourceRun = supportsPlatformResume && Number(existingRun?.cursor_page || 0) > 0
    ? existingRun
    : null

  const resumeFromPage = resumeSourceRun
    ? Math.max(1, toSafeCount(resumeSourceRun.cursor_page || 1))
    : undefined
  const resumeFromScope = resumeSourceRun
    ? (String(resumeSourceRun.cursor_scope || '').trim() || undefined)
    : undefined
  const baseTotalItems = resumeSourceRun ? toSafeCount(resumeSourceRun.total_items) : 0
  const baseCreatedCount = resumeSourceRun ? toSafeCount(resumeSourceRun.created_count) : 0
  const baseUpdatedCount = resumeSourceRun ? toSafeCount(resumeSourceRun.updated_count) : 0
  const baseProcessedBatches = resumeSourceRun ? toSafeCount(resumeSourceRun.processed_batches) : 0

  const startedAt = new Date().toISOString()
  await withRecoveryModeRetry({
    label: `mark run running(run=${data.runId})`,
    operation: () => updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'running',
      startedAt: resumeSourceRun?.id === data.runId
        ? (existingRun?.started_at || startedAt)
        : startedAt,
      completedAt: null,
      totalItems: baseTotalItems,
      createdCount: baseCreatedCount,
      updatedCount: baseUpdatedCount,
      failedCount: 0,
      cursorPage: resumeFromPage || 1,
      cursorScope: resumeFromScope || null,
      processedBatches: baseProcessedBatches,
      lastHeartbeatAt: startedAt,
      errorMessage: null,
    }),
  })

  try {
    const configCheck = await checkAffiliatePlatformConfig(data.userId, data.platform)
    if (!configCheck.configured) {
      throw new Error(`配置不完整: ${configCheck.missingKeys.join(', ')}`)
    }

    const result = await withRecoveryModeRetry({
      label: `sync window(run=${data.runId}, platform=${data.platform})`,
      maxAttempts: RECOVERY_SYNC_MAX_ATTEMPTS,
      operation: () => syncAffiliateProducts({
        userId: data.userId,
        platform: data.platform,
        mode: data.mode || 'platform',
        productId: data.productId,
        resumeFromPage,
        resumeFromScope,
        progressEvery: 20,
        onProgress: async (progress: AffiliateProductSyncProgress) => {
          await withRecoveryModeRetry({
            label: `progress snapshot(run=${data.runId})`,
            operation: () => recordAffiliateProductSyncHourlySnapshot({
              userId: data.userId,
              runId: data.runId,
              platform: data.platform,
              totalItems: baseTotalItems + toSafeCount(progress.totalFetched),
            }),
          })

          await withRecoveryModeRetry({
            label: `progress update(run=${data.runId})`,
            operation: () => updateAffiliateProductSyncRun({
              runId: data.runId,
              status: 'running', // ✅ 确保状态始终为 running
              totalItems: baseTotalItems + toSafeCount(progress.totalFetched),
              createdCount: baseCreatedCount + toSafeCount(progress.createdCount),
              updatedCount: baseUpdatedCount + toSafeCount(progress.updatedCount),
              failedCount: progress.failedCount,
              lastHeartbeatAt: new Date().toISOString(),
            }),
          })
        },
        onCheckpoint: async (checkpoint: AffiliateProductSyncCheckpoint) => {
          await withRecoveryModeRetry({
            label: `checkpoint snapshot(run=${data.runId})`,
            operation: () => recordAffiliateProductSyncHourlySnapshot({
              userId: data.userId,
              runId: data.runId,
              platform: data.platform,
              totalItems: baseTotalItems + toSafeCount(checkpoint.totalFetched),
            }),
          })

          await withRecoveryModeRetry({
            label: `checkpoint update(run=${data.runId})`,
            operation: () => updateAffiliateProductSyncRun({
              runId: data.runId,
              status: 'running', // ✅ 确保状态始终为 running
              totalItems: baseTotalItems + toSafeCount(checkpoint.totalFetched),
              createdCount: baseCreatedCount + toSafeCount(checkpoint.createdCount),
              updatedCount: baseUpdatedCount + toSafeCount(checkpoint.updatedCount),
              failedCount: checkpoint.failedCount,
              cursorPage: checkpoint.cursorPage,
              cursorScope: checkpoint.cursorScope || null,
              processedBatches: baseProcessedBatches + toSafeCount(checkpoint.processedBatches),
              lastHeartbeatAt: new Date().toISOString(),
            }),
          })
        },
      }),
    })

    await withRecoveryModeRetry({
      label: `final snapshot(run=${data.runId})`,
      operation: () => recordAffiliateProductSyncHourlySnapshot({
        userId: data.userId,
        runId: data.runId,
        platform: data.platform,
        totalItems: baseTotalItems + toSafeCount(result.totalFetched),
      }),
    })

    try {
      await refreshAndWarmProductListCache(data.userId)
    } catch (cacheError: any) {
      console.warn('[affiliate-product-sync] cache refresh/warm failed:', cacheError?.message || cacheError)
    }

    const finalTotalItems = baseTotalItems + toSafeCount(result.totalFetched)
    const finalCreatedCount = baseCreatedCount + toSafeCount(result.createdCount)
    const finalUpdatedCount = baseUpdatedCount + toSafeCount(result.updatedCount)
    const windowFetchedCount = toSafeCount(result.totalFetched)
    const windowCreatedCount = toSafeCount(result.createdCount)
    const windowUpdatedCount = toSafeCount(result.updatedCount)
    let shouldContinuePlatformSync = data.mode === 'platform' && Boolean(result.hasMore)
    let completionWarningMessage: string | null = null

    // 仅在“无后续分页可续跑”时，将首轮 0 数据标记为 completed 警告。
    // 若 hasMore=true，说明仍有后续 scope/page 可抓取，不应提前结束。
    if (data.mode === 'platform' && finalTotalItems === 0 && !resumeSourceRun && !shouldContinuePlatformSync) {
      const emptyRunWarning = '⚠️ 同步完成但未抓取到任何商品，请检查平台配置、登录态或代理设置'
      console.warn(
        `[affiliate-product-sync] Platform sync completed with 0 items for platform=${data.platform}, userId=${data.userId}. This may indicate configuration or authentication issues.`
      )

      // YP 平台若首轮全量抓取仍为 0，按失败处理，避免“看似 completed 实际失败”。
      if (data.platform === 'yeahpromos') {
        throw new Error(`YeahPromos 同步失败：${emptyRunWarning}`)
      }

      // 仍然标记为completed，但在error_message中记录警告
      await withRecoveryModeRetry({
        label: `complete empty run(run=${data.runId})`,
        operation: () => updateAffiliateProductSyncRun({
          runId: data.runId,
          status: 'completed',
          totalItems: 0,
          createdCount: 0,
          updatedCount: 0,
          failedCount: 0,
          cursorPage: 0,
          cursorScope: null,
          completedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          errorMessage: emptyRunWarning,
        }),
      })

      return {
        success: true,
        runId: data.runId,
        totalFetched: 0,
        createdCount: 0,
        updatedCount: 0,
      }
    }

    if (shouldContinuePlatformSync) {
      const noWindowProgress = windowFetchedCount === 0
        && windowCreatedCount === 0
        && windowUpdatedCount === 0
      const reachedStallGuardBatchThreshold = baseProcessedBatches >= STALL_GUARD_MIN_PROCESSED_BATCHES
      if (noWindowProgress && reachedStallGuardBatchThreshold) {
        const growthWindow = await readRunGrowthWindow({
          userId: data.userId,
          runId: data.runId,
          lookbackBuckets: STALL_GUARD_LOOKBACK_BUCKETS,
          minBuckets: STALL_GUARD_MIN_BUCKETS,
        })

        if (growthWindow?.stalled) {
          if (data.platform === 'partnerboost') {
            shouldContinuePlatformSync = false
            completionWarningMessage = `⚠️ ${platformLabel} 同步最近 ${growthWindow.bucketCount} 小时累计抓取保持 ${growthWindow.maxTotal} 且当前窗口无新增，已判定到达尾页并自动完成。`
            console.warn(
              `[affiliate-product-sync] stalled run treated as completed: run=${data.runId}, platform=${data.platform}, bucketCount=${growthWindow.bucketCount}, total=${growthWindow.maxTotal}`
            )
          } else {
            throw new Error(
              `同步任务疑似卡死：最近 ${growthWindow.bucketCount} 小时累计抓取始终为 ${growthWindow.maxTotal}，且当前窗口无新增。为避免长期 running，任务已自动终止，请检查 ${platformLabel} 页面分页、登录态与代理配置后重试。`
            )
          }
        }
      }

      if (shouldContinuePlatformSync) {
        const nextCursorPage = Math.max(1, toSafeCount(result.nextCursorPage || 1))
        const nextCursorScope = String(result.nextCursorScope || '').trim() || null
        const continuationScheduledAt = new Date(Date.now() + PLATFORM_CONTINUATION_DELAY_MS).toISOString()
        const heartbeatAt = new Date().toISOString()

        await withRecoveryModeRetry({
          label: `persist continuation checkpoint(run=${data.runId})`,
          operation: () => updateAffiliateProductSyncRun({
            runId: data.runId,
            status: 'running', // ✅ 修复：保持 running 状态，不要重置为 queued
            totalItems: finalTotalItems,
            createdCount: finalCreatedCount,
            updatedCount: finalUpdatedCount,
            failedCount: 0,
            cursorPage: nextCursorPage,
            cursorScope: nextCursorScope,
            completedAt: null,
            lastHeartbeatAt: heartbeatAt,
            errorMessage: null,
          }),
        })

        const queue = getQueueManagerForTaskType('affiliate-product-sync')
        await queue.enqueue(
          'affiliate-product-sync',
          {
            userId: data.userId,
            platform: data.platform,
            mode: data.mode,
            runId: data.runId,
            productId: data.productId,
            trigger: 'retry',
            scheduledAt: continuationScheduledAt,
          },
          data.userId,
          {
            priority: 'normal',
            maxRetries: 1,
          }
        )

        return {
          success: true,
          runId: data.runId,
          totalFetched: finalTotalItems,
          createdCount: finalCreatedCount,
          updatedCount: finalUpdatedCount,
          continued: true,
        }
      }
    }

    await withRecoveryModeRetry({
      label: `mark run completed(run=${data.runId})`,
      operation: () => updateAffiliateProductSyncRun({
        runId: data.runId,
        status: 'completed',
        totalItems: finalTotalItems,
        createdCount: finalCreatedCount,
        updatedCount: finalUpdatedCount,
        failedCount: 0,
        cursorPage: 0,
        cursorScope: null,
        completedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        errorMessage: completionWarningMessage,
      }),
    })

    const shouldScheduleScoreCalculation = finalTotalItems > 0
      || finalCreatedCount > 0
      || finalUpdatedCount > 0
    if (shouldScheduleScoreCalculation) {
      try {
        const scoreTaskId = await scheduleProductScoreCalculation(data.userId, {
          productIds: data.mode === 'single' && data.productId ? [data.productId] : undefined,
          forceRecalculate: false,
          batchSize: data.mode === 'single' ? 20 : 200,
          includeSeasonalityAnalysis: true,
          trigger: 'sync-complete',
          priority: 'normal',
        })
        console.log(
          `[affiliate-product-sync] 推荐指数计算任务已提交: run=${data.runId}, task=${scoreTaskId}, user=${data.userId}`
        )
      } catch (scoreError: any) {
        console.warn(
          `[affiliate-product-sync] 推荐指数计算调度失败(不影响同步成功): ${scoreError?.message || scoreError}`
        )
      }
    }

    return {
      success: true,
      runId: data.runId,
      totalFetched: finalTotalItems,
      createdCount: finalCreatedCount,
      updatedCount: finalUpdatedCount,
    }
  } catch (error: any) {
    try {
      await withRecoveryModeRetry({
        label: `mark run failed(run=${data.runId})`,
        operation: () => updateAffiliateProductSyncRun({
          runId: data.runId,
          status: 'failed',
          failedCount: 1,
          lastHeartbeatAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          errorMessage: error?.message || '同步失败',
        }),
      })
    } catch (persistError: any) {
      console.error(
        `[affiliate-product-sync] failed to persist failed status for run=${data.runId}: ${persistError?.message || persistError}`
      )
    }
    throw error
  }
}
