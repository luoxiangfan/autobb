import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'
import { toDbJsonObjectField } from '@/lib/json-field'

type OfferPageType = 'store' | 'product'

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
}

function normalizeLinks(links: string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(links)) return undefined
  const normalized = Array.from(
    new Set(
      links
        .map((link) => (typeof link === 'string' ? link.trim() : ''))
        .filter((link) => Boolean(link))
    )
  ).slice(0, 3)
  return normalized.length > 0 ? normalized : undefined
}

export async function createOfferExtractionTaskForExistingOffer(
  params: CreateOfferExtractionTaskForExistingOfferParams
): Promise<string> {
  const db = await getDatabase()
  const queue = getQueueManager()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const affiliateLink = (params.affiliateLink || '').trim()
  if (!affiliateLink) {
    throw new Error('Offer缺少可用于提取的链接')
  }

  const pageType: OfferPageType = params.pageType === 'store' ? 'store' : 'product'
  const normalizedStoreProductLinks = pageType === 'store'
    ? normalizeLinks(params.storeProductLinks)
    : undefined

  const skipCache = params.skipCache ?? false
  const skipWarmup = params.skipWarmup ?? false
  const taskId = crypto.randomUUID()

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
      taskId,
      params.userId,
      params.offerId,
      affiliateLink,
      params.targetCountry,
      pageType,
      normalizedStoreProductLinks ? JSON.stringify(normalizedStoreProductLinks) : null,
      params.productPrice || null,
      params.commissionPayout || null,
      (params.brandName || '').trim() || null,
      db.type === 'postgres' ? skipCache : (skipCache ? 1 : 0),
      db.type === 'postgres' ? skipWarmup : (skipWarmup ? 1 : 0),
    ]
  )

  const taskData: OfferExtractionTaskData = {
    affiliateLink,
    targetCountry: params.targetCountry,
    skipCache,
    skipWarmup,
    productPrice: params.productPrice || undefined,
    commissionPayout: params.commissionPayout || undefined,
    brandName: (params.brandName || '').trim() || undefined,
    pageType,
    storeProductLinks: normalizedStoreProductLinks,
  }

  try {
    await queue.enqueue(
      'offer-extraction',
      taskData,
      params.userId,
      {
        parentRequestId: params.parentRequestId,
        priority: params.priority || 'normal',
        requireProxy: true,
        maxRetries: 2,
        taskId,
      }
    )
  } catch (error: any) {
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
        error?.message || '任务入队失败',
        toDbJsonObjectField({ message: error?.message || '任务入队失败' }, db.type, { message: '任务入队失败' }),
        taskId,
      ]
    )
    throw error
  }

  return taskId
}
