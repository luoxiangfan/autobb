/**
 * Align url_swap_sitelink_targets.affiliate_link with store_product_links via landing URL match.
 */
import { logger } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import { splitUrlBaseAndSuffix } from '@/lib/creatives/sitelink-utils'
import { getOfferById } from './url-swap-offer-lookup'
import {
  normalizeSitelinkLandingUrl,
  resolveSitelinkTargetStoreMapping,
} from './sitelink-affiliate-matching'
import { resolveStoreProductLinkFinalUrls } from './resolve-store-product-link-finals'
import { refreshUrlSwapSitelinkTargetsFromGoogleAds } from './refresh-sitelink-targets-from-ads'
import {
  getUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap,
  type UrlSwapSitelinkTarget,
} from './url-swap-sitelink-targets'

export interface ReconcileUrlSwapSitelinkAffiliateLinksResult {
  updated: number
  targets: UrlSwapSitelinkTarget[]
  url_refresh?: Awaited<ReturnType<typeof refreshUrlSwapSitelinkTargetsFromGoogleAds>>
}

function applySitelinkTargetStoreMapping(
  target: UrlSwapSitelinkTarget,
  mapping: NonNullable<ReturnType<typeof resolveSitelinkTargetStoreMapping>>
): UrlSwapSitelinkTarget {
  const next: UrlSwapSitelinkTarget = { ...target, affiliate_link: mapping.affiliateLink }

  if (mapping.finalUrl) {
    try {
      const split = splitUrlBaseAndSuffix(mapping.finalUrl)
      next.current_final_url = split.base
      if (split.suffix) {
        next.current_final_url_suffix = split.suffix
      }
    } catch {
      next.current_final_url = mapping.finalUrl
    }
  }

  return next
}

export function enrichUrlSwapSitelinkTargetsAffiliateLinks(
  targets: UrlSwapSitelinkTarget[],
  storeProductLinks: string[],
  resolvedLinks: Awaited<ReturnType<typeof resolveStoreProductLinkFinalUrls>>
): UrlSwapSitelinkTarget[] {
  return targets.map((target) => {
    const mapping = resolveSitelinkTargetStoreMapping(target, storeProductLinks, resolvedLinks)
    if (!mapping) return target
    return applySitelinkTargetStoreMapping(target, mapping)
  })
}

function sitelinkTargetNeedsPersist(
  original: UrlSwapSitelinkTarget,
  enriched: UrlSwapSitelinkTarget
): boolean {
  if (original.affiliate_link?.trim() !== enriched.affiliate_link?.trim()) return true
  if (
    normalizeSitelinkLandingUrl(original.current_final_url) !==
    normalizeSitelinkLandingUrl(enriched.current_final_url)
  ) {
    return true
  }
  return (original.current_final_url_suffix ?? '') !== (enriched.current_final_url_suffix ?? '')
}

export async function reconcileUrlSwapSitelinkAffiliateLinks(params: {
  taskId: string
  offerId: number
  userId: number
  refreshFromGoogleAds?: boolean
}): Promise<ReconcileUrlSwapSitelinkAffiliateLinksResult> {
  let urlRefresh: Awaited<ReturnType<typeof refreshUrlSwapSitelinkTargetsFromGoogleAds>> | undefined

  if (params.refreshFromGoogleAds !== false) {
    urlRefresh = await refreshUrlSwapSitelinkTargetsFromGoogleAds({
      taskId: params.taskId,
      userId: params.userId,
    })
  }

  const targets = await getUrlSwapSitelinkTargets(params.taskId, params.userId)
  if (targets.length === 0) {
    return { updated: 0, targets, url_refresh: urlRefresh }
  }

  const { pageType, storeProductLinks } = await loadOfferStoreProductLinksForUrlSwap(
    params.offerId,
    params.userId
  )
  if (pageType !== 'store' || storeProductLinks.length === 0) {
    return { updated: 0, targets, url_refresh: urlRefresh }
  }

  const offer = await getOfferById(params.offerId)
  if (!offer?.target_country) {
    return { updated: 0, targets, url_refresh: urlRefresh }
  }

  const resolvedLinks = await resolveStoreProductLinkFinalUrls({
    storeProductLinks,
    targetCountry: offer.target_country,
    userId: params.userId,
    offerId: params.offerId,
  })

  const enrichedTargets = enrichUrlSwapSitelinkTargetsAffiliateLinks(
    targets,
    storeProductLinks,
    resolvedLinks
  )
  const db = await getDatabase()
  const now = new Date().toISOString()
  let updated = 0

  for (const target of enrichedTargets) {
    const original = targets.find((item) => item.id === target.id)
    if (!original || !sitelinkTargetNeedsPersist(original, target)) continue

    try {
      await db.exec(
        `
        UPDATE url_swap_sitelink_targets
        SET affiliate_link = ?,
            current_final_url = ?,
            current_final_url_suffix = ?,
            updated_at = ?
        WHERE id = ?
      `,
        [
          target.affiliate_link,
          target.current_final_url,
          target.current_final_url_suffix,
          now,
          target.id,
        ]
      )
      target.updated_at = now
      updated++
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[url-swap] Sitelink 映射持久化失败（仍返回校正结果）: target=${target.id}, error=${message}`
      )
    }
  }

  if (updated > 0) {
    logger.debug(`[url-swap] Sitelink 映射已校正: task=${params.taskId}, updated=${updated}`)
  }

  return {
    updated,
    targets: enrichedTargets.sort((a, b) => a.sort_index - b.sort_index),
    url_refresh: urlRefresh,
  }
}

export function resolveAffiliateLinkForSitelinkTarget(
  target: Pick<UrlSwapSitelinkTarget, 'current_final_url' | 'sort_index' | 'affiliate_link'>,
  storeProductLinks: string[],
  resolvedLinks: Awaited<ReturnType<typeof resolveStoreProductLinkFinalUrls>>
): string {
  const mapping = resolveSitelinkTargetStoreMapping(target, storeProductLinks, resolvedLinks)
  return mapping?.affiliateLink || target.affiliate_link?.trim() || ''
}
