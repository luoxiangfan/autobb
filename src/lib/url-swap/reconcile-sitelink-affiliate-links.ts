/**
 * Align url_swap_sitelink_targets.affiliate_link with store_product_links via landing URL match.
 */
import { logger } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import { getOfferById } from './url-swap-offer-lookup'
import {
  findAffiliateLinkForSitelinkFinalUrl,
  findStoreProductLinkIndexForSitelinkFinalUrl,
} from './sitelink-affiliate-matching'
import { resolveStoreProductLinkFinalUrls } from './resolve-store-product-link-finals'
import {
  getUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap,
  type UrlSwapSitelinkTarget,
} from './url-swap-sitelink-targets'

export interface ReconcileUrlSwapSitelinkAffiliateLinksResult {
  updated: number
  targets: UrlSwapSitelinkTarget[]
}

export function enrichUrlSwapSitelinkTargetsAffiliateLinks(
  targets: UrlSwapSitelinkTarget[],
  resolvedLinks: Awaited<ReturnType<typeof resolveStoreProductLinkFinalUrls>>
): UrlSwapSitelinkTarget[] {
  return targets.map((target) => {
    const matchedAffiliateLink = findAffiliateLinkForSitelinkFinalUrl(
      target.current_final_url,
      resolvedLinks
    )
    if (!matchedAffiliateLink || matchedAffiliateLink === target.affiliate_link?.trim()) {
      return target
    }
    return { ...target, affiliate_link: matchedAffiliateLink }
  })
}

export async function reconcileUrlSwapSitelinkAffiliateLinks(params: {
  taskId: string
  offerId: number
  userId: number
}): Promise<ReconcileUrlSwapSitelinkAffiliateLinksResult> {
  const targets = await getUrlSwapSitelinkTargets(params.taskId, params.userId)
  if (targets.length === 0) {
    return { updated: 0, targets }
  }

  const { pageType, storeProductLinks } = await loadOfferStoreProductLinksForUrlSwap(
    params.offerId,
    params.userId
  )
  if (pageType !== 'store' || storeProductLinks.length === 0) {
    return { updated: 0, targets }
  }

  const offer = await getOfferById(params.offerId)
  if (!offer?.target_country) {
    return { updated: 0, targets }
  }

  const resolvedLinks = await resolveStoreProductLinkFinalUrls({
    storeProductLinks,
    targetCountry: offer.target_country,
    userId: params.userId,
    offerId: params.offerId,
  })

  const enrichedTargets = enrichUrlSwapSitelinkTargetsAffiliateLinks(targets, resolvedLinks)
  const db = await getDatabase()
  const now = new Date().toISOString()
  let updated = 0

  for (const target of enrichedTargets) {
    const matchedIndex = findStoreProductLinkIndexForSitelinkFinalUrl(
      target.current_final_url,
      resolvedLinks
    )
    if (matchedIndex < 0) continue

    const matchedAffiliateLink = resolvedLinks[matchedIndex]?.affiliateLink?.trim() || ''
    if (!matchedAffiliateLink) continue

    const original = targets.find((item) => item.id === target.id)
    if (!original || original.affiliate_link?.trim() === matchedAffiliateLink) {
      continue
    }

    try {
      await db.exec(
        `
        UPDATE url_swap_sitelink_targets
        SET affiliate_link = ?,
            updated_at = ?
        WHERE id = ?
      `,
        [matchedAffiliateLink, now, target.id]
      )
      target.updated_at = now
      updated++
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[url-swap] Sitelink affiliate_link 持久化失败（仍返回校正结果）: target=${target.id}, error=${message}`
      )
    }
  }

  if (updated > 0) {
    logger.debug(
      `[url-swap] Sitelink affiliate_link 已按落地页对齐: task=${params.taskId}, updated=${updated}`
    )
  }

  return {
    updated,
    targets: enrichedTargets.sort((a, b) => a.sort_index - b.sort_index),
  }
}

export function resolveAffiliateLinkForSitelinkTarget(
  target: Pick<UrlSwapSitelinkTarget, 'current_final_url' | 'sort_index' | 'affiliate_link'>,
  storeProductLinks: string[],
  resolvedLinks: Awaited<ReturnType<typeof resolveStoreProductLinkFinalUrls>>
): string {
  const matched = findAffiliateLinkForSitelinkFinalUrl(target.current_final_url, resolvedLinks)
  if (matched) return matched

  return storeProductLinks[target.sort_index]?.trim() || target.affiliate_link?.trim() || ''
}
