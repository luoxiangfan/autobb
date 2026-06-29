/**
 * Store Offer 换链任务创建后从 Google Ads 回填 Sitelink 子目标映射。
 */
import { logger } from '@/lib/common/server'
import {
  getActiveUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap,
} from './url-swap-sitelink-targets'
import { getUrlSwapTaskByOfferId } from './url-swap-queries'
import { backfillUrlSwapSitelinkTargets } from './backfill-sitelink-targets'

export interface SyncStoreSitelinkTargetsForOfferResult {
  upserted: number
  skipped: boolean
  errors: string[]
}

/**
 * Campaign 已发布 Sitelink 但换链任务晚于发布创建时，发布阶段不会写入映射，需在此补全。
 */
export async function syncStoreSitelinkTargetsForOffer(
  offerId: number,
  userId: number
): Promise<SyncStoreSitelinkTargetsForOfferResult> {
  const { pageType, storeProductLinks } = await loadOfferStoreProductLinksForUrlSwap(
    offerId,
    userId
  )
  if (pageType !== 'store' || storeProductLinks.length === 0) {
    return { upserted: 0, skipped: true, errors: [] }
  }

  const task = await getUrlSwapTaskByOfferId(offerId, userId)
  if (!task) {
    return { upserted: 0, skipped: true, errors: [] }
  }

  const existingTargets = await getActiveUrlSwapSitelinkTargets(task.id, userId)
  if (existingTargets.length > 0) {
    return { upserted: 0, skipped: true, errors: [] }
  }

  const result = await backfillUrlSwapSitelinkTargets({
    offerId,
    userId,
    dryRun: false,
  })

  if (result.upsertedMappings > 0) {
    logger.debug(
      `[url-swap] Store Sitelink 映射已回填: offer=${offerId}, count=${result.upsertedMappings}`
    )
  }

  return {
    upserted: result.upsertedMappings,
    skipped: false,
    errors: result.errors,
  }
}
