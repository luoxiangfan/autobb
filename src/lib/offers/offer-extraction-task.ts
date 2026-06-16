import { getDatabase } from '@/lib/db'
import type { Offer } from '@/lib/offers/server'
import { updateOffer, updateOfferScrapeStatus } from '@/lib/offers/server'
import { getQueueManager } from '@/lib/queue'
import type { Task } from '@/lib/queue/types'
import {
  executeOfferExtraction,
  type OfferExtractionTaskData,
} from '@/lib/queue/executors/offer-extraction-executor'
import { toDbJsonObjectField } from '@/lib/db'
import {
  getDefaultOfferExtractionMode,
  normalizeOfferExtractionMode,
  type OfferExtractionMode,
} from '@/lib/offers/server'
import {
  OfferExtractRequestError,
  resolveValidatedTargetCountry,
  validateExistingOfferForExtraction,
} from '@/lib/offers/server'
import {
  MAX_STORE_PRODUCT_LINKS,
  normalizeStoreProductLinkList,
  storeProductLinksTypeError,
} from '@/lib/offers/store-product-links'

/** offer_tasks 中视为“占用中”、不可重复入队的状态 */
const ACTIVE_OFFER_EXTRACTION_TASK_STATUSES = ['pending', 'running'] as const

export function isOfferScrapeStatusBusy(scrapeStatus: string | null | undefined): boolean {
  return scrapeStatus === 'queued' || scrapeStatus === 'in_progress'
}

/** 查询已有进行中的 offer-extraction 任务（pending / running） */
export async function findOfferIdsWithActiveExtractionTasks(
  offerIds: number[]
): Promise<Set<number>> {
  if (offerIds.length === 0) {
    return new Set()
  }

  const db = getDatabase()
  const placeholders = offerIds.map(() => '?').join(',')
  const statusList = ACTIVE_OFFER_EXTRACTION_TASK_STATUSES.map(() => '?').join(', ')
  const rows = await db.query<{ offer_id: number }>(
    `SELECT DISTINCT offer_id FROM offer_tasks
     WHERE offer_id IN (${placeholders})
     AND status IN (${statusList})`,
    [...offerIds, ...ACTIVE_OFFER_EXTRACTION_TASK_STATUSES]
  )

  return new Set(rows.map((row) => row.offer_id))
}

/** 单条 rebuild/scrape 入队前防重（scrape_status + offer_tasks） */
export async function assertOfferAvailableForExtractionEnqueue(offer: {
  id: number
  scrape_status?: string | null
}): Promise<void> {
  if (isOfferScrapeStatusBusy(offer.scrape_status)) {
    throw new OfferExtractRequestError(409, '该 Offer 正在提取中，请稍后再试')
  }

  const busyOfferIds = await findOfferIdsWithActiveExtractionTasks([offer.id])
  if (busyOfferIds.has(offer.id)) {
    throw new OfferExtractRequestError(409, '该 Offer 已有进行中的提取任务，请稍后再试')
  }
}

export type OfferPageType = 'store' | 'product'

export type OfferExtractionOfferInput = Pick<
  Offer,
  | 'id'
  | 'affiliate_link'
  | 'url'
  | 'target_country'
  | 'product_price'
  | 'commission_payout'
  | 'brand'
  | 'page_type'
  | 'store_product_links'
  | 'extraction_mode'
>

export type CreateOfferExtractionTaskForExistingOfferParams = {
  userId: number
  offerId: number
  affiliateLink: string
  targetCountry: string
  productPrice?: string | null
  commissionPayout?: string | null
  brandName?: string | null
  pageType?: OfferPageType | null
  storeProductLinks?: string[] | null
  parentRequestId?: string
  priority?: 'high' | 'normal' | 'low'
  skipCache?: boolean
  skipWarmup?: boolean
  extractionMode?: OfferExtractionMode | string
  /** 复用已有队列/任务 ID（遗留 scrape 任务内联执行） */
  taskId?: string
  /** 不入队，在当前 worker 内直接执行 extract+AI（避免 scrape→extraction 双任务） */
  runInline?: boolean
  /** apply/rebuild 已写入 extraction_mode 时跳过重复 updateOffer */
  skipExtractionModePersist?: boolean
}

function normalizeLinks(links: string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(links)) return undefined
  const normalized = normalizeStoreProductLinkList(links)
  return normalized.length > 0 ? normalized : undefined
}

/** 解析 offers.store_product_links JSON 字段（最多 {@link MAX_STORE_PRODUCT_LINKS} 条去重链接） */
export function parseStoreProductLinks(raw: string | null | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined
  try {
    const parsed = JSON.parse(raw)
    return normalizeLinks(Array.isArray(parsed) ? parsed : undefined)
  } catch {
    return undefined
  }
}

/** 推断 page_type：显式字段 > 店铺单品链接 > Amazon stores URL */
export function inferOfferPageType(params: {
  pageType?: string | null
  affiliateLink?: string | null
  storeProductLinks?: string[] | null
}): OfferPageType {
  if (params.pageType === 'store' || params.pageType === 'product') {
    return params.pageType
  }
  if (params.storeProductLinks && params.storeProductLinks.length > 0) {
    return 'store'
  }
  const link = (params.affiliateLink || '').toLowerCase()
  if (link.includes('/stores/') || link.includes('/store/')) {
    return 'store'
  }
  return 'product'
}

const STORE_PRODUCT_LINKS_TYPE_ERROR = storeProductLinksTypeError()

/** 解析 API 请求体中的店铺单品链接（不依赖 page_type，供先推断页类型再校验） */
export function parseStoreProductLinksInput(
  storeProductLinks: unknown
): { links: string[] } | { error: string } {
  if (storeProductLinks === undefined || storeProductLinks === null) {
    return { links: [] }
  }
  if (!Array.isArray(storeProductLinks)) {
    return { error: STORE_PRODUCT_LINKS_TYPE_ERROR }
  }
  const links = normalizeStoreProductLinkList(
    storeProductLinks.map((link) => (typeof link === 'string' ? link.trim() : '')).filter(Boolean)
  )
  for (const link of links) {
    try {
      new URL(link)
    } catch {
      return { error: `单品推广链接无效: ${link}` }
    }
  }
  return { links }
}

/** 先解析链接、再 infer page_type（extract / extract/stream 共用） */
export function resolveExtractPageInput(params: {
  pageType?: string | null
  affiliateLink: string
  storeProductLinks?: unknown
}): { pageType: OfferPageType; storeProductLinks: string[] } | { error: string } {
  const parsed = parseStoreProductLinksInput(params.storeProductLinks)
  if ('error' in parsed) {
    return parsed
  }

  const pageType = inferOfferPageType({
    pageType: params.pageType === 'store' || params.pageType === 'product' ? params.pageType : null,
    affiliateLink: params.affiliateLink,
    storeProductLinks: parsed.links.length > 0 ? parsed.links : undefined,
  })

  return {
    pageType,
    storeProductLinks: pageType === 'store' ? parsed.links : [],
  }
}

/** 从 Offer 记录组装提取任务参数（rebuild / scrape 共用） */
export function buildExtractionTaskParamsFromOffer(
  offer: OfferExtractionOfferInput,
  overrides: Partial<CreateOfferExtractionTaskForExistingOfferParams> & {
    userId: number
    offerId?: number
  }
): CreateOfferExtractionTaskForExistingOfferParams {
  const affiliateLink = (overrides.affiliateLink ?? offer.affiliate_link ?? offer.url ?? '').trim()
  const storeProductLinks =
    overrides.storeProductLinks ?? parseStoreProductLinks(offer.store_product_links)
  const pageType = inferOfferPageType({
    pageType: overrides.pageType ?? offer.page_type,
    affiliateLink,
    storeProductLinks,
  })

  if (!affiliateLink) {
    throw new OfferExtractRequestError(400, 'Offer缺少推广链接，无法提取')
  }

  const targetCountry = overrides.targetCountry?.trim()
    ? resolveValidatedTargetCountry(overrides.targetCountry)
    : validateExistingOfferForExtraction({
        affiliate_link: offer.affiliate_link,
        url: offer.url,
        target_country: offer.target_country,
      }).targetCountry

  return {
    userId: overrides.userId,
    offerId: overrides.offerId ?? offer.id,
    affiliateLink,
    targetCountry,
    productPrice: overrides.productPrice ?? offer.product_price,
    commissionPayout: overrides.commissionPayout ?? offer.commission_payout,
    brandName: overrides.brandName ?? offer.brand ?? undefined,
    pageType,
    storeProductLinks,
    parentRequestId: overrides.parentRequestId,
    priority: overrides.priority,
    skipCache: overrides.skipCache,
    skipWarmup: overrides.skipWarmup,
    extractionMode: overrides.extractionMode ?? offer.extraction_mode ?? undefined,
    taskId: overrides.taskId,
    runInline: overrides.runInline,
  }
}

async function upsertOfferTaskRow(params: {
  taskId: string
  userId: number
  offerId: number
  affiliateLink: string
  targetCountry: string
  pageType: OfferPageType
  storeProductLinksJson: string | null
  productPrice: string | null
  commissionPayout: string | null
  brandName: string | null
  skipCache: boolean
  skipWarmup: boolean
}): Promise<void> {
  const db = await getDatabase()
  const nowFunc = 'NOW()'
  const skipCacheVal = params.skipCache
  const skipWarmupVal = params.skipWarmup

  const existing = await db.queryOne<{ id: string }>('SELECT id FROM offer_tasks WHERE id = ?', [
    params.taskId,
  ])

  if (existing) {
    await db.exec(
      `
        UPDATE offer_tasks SET
          user_id = ?,
          offer_id = ?,
          status = 'pending',
          stage = 'resolving_link',
          progress = 0,
          message = '准备开始提取...',
          affiliate_link = ?,
          target_country = ?,
          page_type = ?,
          store_product_links = ?,
          product_price = ?,
          commission_payout = ?,
          brand_name = ?,
          skip_cache = ?,
          skip_warmup = ?,
          error = NULL,
          completed_at = NULL,
          started_at = NULL,
          updated_at = ${nowFunc}
        WHERE id = ?
      `,
      [
        params.userId,
        params.offerId,
        params.affiliateLink,
        params.targetCountry,
        params.pageType,
        params.storeProductLinksJson,
        params.productPrice,
        params.commissionPayout,
        params.brandName,
        skipCacheVal,
        skipWarmupVal,
        params.taskId,
      ]
    )
    return
  }

  await db.exec(
    `
      INSERT INTO offer_tasks (
        id,
        user_id,
        offer_id,
        status,
        stage,
        progress,
        message,
        affiliate_link,
        target_country,
        page_type,
        store_product_links,
        product_price,
        commission_payout,
        brand_name,
        skip_cache,
        skip_warmup,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'pending', 'resolving_link', 0, '准备开始提取...', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `,
    [
      params.taskId,
      params.userId,
      params.offerId,
      params.affiliateLink,
      params.targetCountry,
      params.pageType,
      params.storeProductLinksJson,
      params.productPrice,
      params.commissionPayout,
      params.brandName,
      skipCacheVal,
      skipWarmupVal,
    ]
  )
}

export type EnqueueExistingOfferExtractionParams = {
  offer: OfferExtractionOfferInput
  userId: number
  offerId: number
  extractionMode?: OfferExtractionMode | string
  parentRequestId?: string
  priority?: 'high' | 'normal' | 'low'
  skipCache?: boolean
  skipWarmup?: boolean
  skipExtractionModePersist?: boolean
  taskId?: string
  runInline?: boolean
  brandName?: string | null
}

/** rebuild / scrape / batch/rebuild 共用：校验前置条件并入队 */
async function enqueueExistingOfferExtraction(
  params: EnqueueExistingOfferExtractionParams
): Promise<{
  taskId: string
  extractionMode: OfferExtractionMode
  affiliateLink: string
  targetCountry: string
}> {
  const { affiliateLink, targetCountry } = validateExistingOfferForExtraction(params.offer)
  const extractionMode = normalizeOfferExtractionMode(
    params.extractionMode ?? params.offer.extraction_mode
  )

  const taskId = await createOfferExtractionTaskForExistingOffer({
    ...buildExtractionTaskParamsFromOffer(params.offer, {
      userId: params.userId,
      offerId: params.offerId,
      affiliateLink,
      targetCountry,
      extractionMode,
      parentRequestId: params.parentRequestId,
      priority: params.priority ?? 'normal',
      skipCache: params.skipCache ?? true,
      skipWarmup: params.skipWarmup ?? false,
      skipExtractionModePersist: params.skipExtractionModePersist,
      taskId: params.taskId,
      runInline: params.runInline,
      brandName: params.brandName ?? undefined,
    }),
  })

  return { taskId, extractionMode, affiliateLink, targetCountry }
}

/** 入队成功但后续状态同步失败时：移出队列并标记任务/Offer 失败 */
export async function compensateOfferExtractionEnqueueFailure(params: {
  taskId: string
  offerId: number
  userId: number
  failMessage: string
}): Promise<void> {
  const db = getDatabase()
  const queue = getQueueManager()
  const nowFunc = 'NOW()'

  try {
    await queue.removeTask(params.taskId)
  } catch (removeError) {
    console.warn(`⚠️ 补偿时移除队列任务失败 task_id=${params.taskId}:`, removeError)
  }

  try {
    await db.exec(
      `
        UPDATE offer_tasks
        SET
          status = 'failed',
          message = ?,
          error = ?,
          completed_at = ${nowFunc},
          updated_at = ${nowFunc}
        WHERE id = ?
      `,
      [
        params.failMessage,
        toDbJsonObjectField(
          { message: params.failMessage },
          {
            message: params.failMessage,
          }
        ),
        params.taskId,
      ]
    )
  } catch (taskError) {
    console.warn(`⚠️ 补偿时标记 offer_tasks 失败失败 task_id=${params.taskId}:`, taskError)
  }

  try {
    await updateOfferScrapeStatus(params.offerId, params.userId, 'failed', params.failMessage)
  } catch (statusError) {
    console.warn(`⚠️ 补偿时同步 scrape_status 失败 offer_id=${params.offerId}:`, statusError)
  }
}

/**
 * 校验并入队成功后，再将 scrape_status 设为 queued（避免入队失败却卡在 queued）
 */
export async function enqueueExistingOfferExtractionAndMarkQueued(
  params: EnqueueExistingOfferExtractionParams
): Promise<{
  taskId: string
  extractionMode: OfferExtractionMode
  affiliateLink: string
  targetCountry: string
}> {
  const result = await enqueueExistingOfferExtraction(params)
  try {
    await updateOfferScrapeStatus(params.offerId, params.userId, 'queued')
  } catch (statusError) {
    const failMessage = '提取任务状态同步失败，已取消入队'
    console.warn(
      `⚠️ 入队成功但更新 scrape_status=queued 失败 offer_id=${params.offerId} task_id=${result.taskId}:`,
      statusError
    )
    await compensateOfferExtractionEnqueueFailure({
      taskId: result.taskId,
      offerId: params.offerId,
      userId: params.userId,
      failMessage,
    })
    throw new OfferExtractRequestError(
      500,
      statusError instanceof Error ? statusError.message : failMessage
    )
  }
  return result
}

export async function createOfferExtractionTaskForExistingOffer(
  params: CreateOfferExtractionTaskForExistingOfferParams
): Promise<string> {
  const db = await getDatabase()
  const queue = getQueueManager()
  const nowFunc = 'NOW()'

  const affiliateLink = (params.affiliateLink || '').trim()
  if (!affiliateLink) {
    throw new Error('Offer缺少可用于提取的链接')
  }

  const targetCountry = (params.targetCountry || '').trim()
  if (!targetCountry) {
    throw new Error('Offer缺少推广国家，无法提取')
  }

  const pageType = inferOfferPageType({
    pageType: params.pageType,
    affiliateLink,
    storeProductLinks: params.storeProductLinks,
  })
  const normalizedStoreProductLinks =
    pageType === 'store' ? normalizeLinks(params.storeProductLinks) : undefined

  const skipCache = params.skipCache ?? false
  const skipWarmup = params.skipWarmup ?? false
  const extractionMode = normalizeOfferExtractionMode(
    params.extractionMode ?? getDefaultOfferExtractionMode()
  )
  const taskId = params.taskId ?? crypto.randomUUID()

  if (params.offerId && params.userId && !params.skipExtractionModePersist) {
    await updateOffer(params.offerId, params.userId, { extraction_mode: extractionMode })
  }

  await upsertOfferTaskRow({
    taskId,
    userId: params.userId,
    offerId: params.offerId,
    affiliateLink,
    targetCountry,
    pageType,
    storeProductLinksJson: normalizedStoreProductLinks
      ? JSON.stringify(normalizedStoreProductLinks)
      : null,
    productPrice: params.productPrice || null,
    commissionPayout: params.commissionPayout || null,
    brandName: (params.brandName || '').trim() || null,
    skipCache,
    skipWarmup,
  })

  const taskData: OfferExtractionTaskData = {
    affiliateLink,
    targetCountry,
    skipCache,
    skipWarmup,
    productPrice: params.productPrice || undefined,
    commissionPayout: params.commissionPayout || undefined,
    brandName: (params.brandName || '').trim() || undefined,
    pageType,
    storeProductLinks: normalizedStoreProductLinks,
    extractionMode,
  }

  if (params.runInline) {
    const inlineTask: Task<OfferExtractionTaskData> = {
      id: taskId,
      type: 'offer-extraction',
      data: taskData,
      userId: params.userId,
      priority: params.priority || 'normal',
      status: 'pending',
      createdAt: Date.now(),
      requireProxy: true,
      parentRequestId: params.parentRequestId,
    }
    await executeOfferExtraction(inlineTask)
    return taskId
  }

  try {
    await queue.enqueue('offer-extraction', taskData, params.userId, {
      parentRequestId: params.parentRequestId,
      priority: params.priority || 'normal',
      requireProxy: true,
      maxRetries: 2,
      taskId,
    })
  } catch (error: any) {
    const failMessage = error?.message || '任务入队失败'
    await db.exec(
      `
        UPDATE offer_tasks
        SET
          status = 'failed',
          message = ?,
          error = ?,
          completed_at = ${nowFunc},
          updated_at = ${nowFunc}
        WHERE id = ?
      `,
      [
        failMessage,
        toDbJsonObjectField({ message: failMessage }, { message: '任务入队失败' }),
        taskId,
      ]
    )
    try {
      await updateOfferScrapeStatus(params.offerId, params.userId, 'failed', failMessage)
    } catch (statusError) {
      console.warn(`⚠️ 入队失败后同步 scrape_status 失败 offer_id=${params.offerId}:`, statusError)
    }
    throw error
  }

  return taskId
}

export type CreateOfferExtractionTaskForNewOfferParams = {
  userId: number
  affiliateLink: string
  targetCountry: string
  productPrice?: string | null
  commissionPayout?: string | null
  commissionType?: 'percent' | 'amount'
  commissionValue?: string | null
  commissionCurrency?: string | null
  brandName?: string | null
  pageType?: OfferPageType | null
  storeProductLinks?: string[] | null
  parentRequestId?: string
  priority?: 'high' | 'normal' | 'low'
  skipCache?: boolean
  skipWarmup?: boolean
  extractionMode?: OfferExtractionMode | string
  maxRetries?: number
}

/** 新建 Offer 提取任务（offer_tasks.offer_id 为空，由 executor 创建 Offer） */
export async function createOfferExtractionTaskForNewOffer(
  params: CreateOfferExtractionTaskForNewOfferParams
): Promise<string> {
  const db = await getDatabase()
  const queue = getQueueManager()
  const nowFunc = 'NOW()'

  const affiliateLink = (params.affiliateLink || '').trim()
  if (!affiliateLink) {
    throw new Error('affiliate_link is required')
  }

  const targetCountry = (params.targetCountry || '').trim()
  if (targetCountry.length < 2) {
    throw new Error('target_country is required')
  }

  const pageType = inferOfferPageType({
    pageType: params.pageType,
    affiliateLink,
    storeProductLinks: params.storeProductLinks,
  })
  const normalizedStoreProductLinks =
    pageType === 'store' ? normalizeLinks(params.storeProductLinks) : undefined

  const skipCache = params.skipCache ?? false
  const skipWarmup = params.skipWarmup ?? false
  const extractionMode = normalizeOfferExtractionMode(
    params.extractionMode ?? getDefaultOfferExtractionMode()
  )
  const taskId = crypto.randomUUID()

  const skipCacheVal = skipCache
  const skipWarmupVal = skipWarmup

  await db.exec(
    `
      INSERT INTO offer_tasks (
        id,
        user_id,
        status,
        stage,
        progress,
        message,
        affiliate_link,
        target_country,
        page_type,
        store_product_links,
        product_price,
        commission_payout,
        brand_name,
        skip_cache,
        skip_warmup,
        created_at,
        updated_at
      ) VALUES (?, ?, 'pending', 'resolving_link', 0, '准备开始提取...', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `,
    [
      taskId,
      params.userId,
      affiliateLink,
      targetCountry,
      pageType,
      normalizedStoreProductLinks ? JSON.stringify(normalizedStoreProductLinks) : null,
      params.productPrice || null,
      params.commissionPayout || null,
      (params.brandName || '').trim() || null,
      skipCacheVal,
      skipWarmupVal,
    ]
  )

  const taskData: OfferExtractionTaskData = {
    affiliateLink,
    targetCountry,
    skipCache,
    skipWarmup,
    productPrice: params.productPrice || undefined,
    commissionPayout: params.commissionPayout || undefined,
    commissionType: params.commissionType,
    commissionValue: params.commissionValue || undefined,
    commissionCurrency: params.commissionCurrency || undefined,
    brandName: (params.brandName || '').trim() || undefined,
    pageType,
    storeProductLinks: normalizedStoreProductLinks,
    extractionMode,
  }

  try {
    await queue.enqueue('offer-extraction', taskData, params.userId, {
      parentRequestId: params.parentRequestId,
      priority: params.priority || 'normal',
      requireProxy: true,
      maxRetries: params.maxRetries ?? 2,
      taskId,
    })
  } catch (error: any) {
    const failMessage = error?.message || '任务入队失败'
    await db.exec(
      `
        UPDATE offer_tasks
        SET
          status = 'failed',
          message = ?,
          error = ?,
          completed_at = ${nowFunc},
          updated_at = ${nowFunc}
        WHERE id = ?
      `,
      [
        failMessage,
        toDbJsonObjectField({ message: failMessage }, { message: '任务入队失败' }),
        taskId,
      ]
    )
    throw error
  }

  return taskId
}
