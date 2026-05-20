/**
 * Offer抓取触发器
 *
 * @deprecated 请使用 enqueueExistingOfferExtractionAndMarkQueued 或 POST /api/offers/:id/rebuild。
 */

import { findOfferById } from './offers'
import { enqueueExistingOfferExtractionAndMarkQueued } from './offer-extraction-task'

export enum OfferScrapingPriority {
  URGENT = 10,
  HIGH = 7,
  NORMAL = 5,
  LOW = 3,
  BACKGROUND = 1,
}

function convertPriority(priority: number): 'high' | 'normal' | 'low' {
  if (priority >= 8) return 'high'
  if (priority >= 4) return 'normal'
  return 'low'
}

/**
 * @deprecated 转发至 offer-extraction（入队成功后再标记 queued）
 */
export async function triggerOfferScraping(
  offerId: number,
  userId: number,
  url: string,
  brand: string,
  targetCountry: string,
  priority: number = OfferScrapingPriority.NORMAL
): Promise<string> {
  console.warn(`[DEPRECATED] triggerOfferScraping Offer #${offerId} → offer-extraction`)

  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  const affiliateLink = (url || offer.affiliate_link || offer.url || '').trim()
  const mergedOffer = {
    ...offer,
    affiliate_link: affiliateLink || offer.affiliate_link,
    target_country: (targetCountry || offer.target_country || '').trim() || offer.target_country,
  }

  const { taskId } = await enqueueExistingOfferExtractionAndMarkQueued({
    offer: mergedOffer,
    userId,
    offerId,
    brandName: brand || offer.brand || undefined,
    skipCache: true,
    priority: convertPriority(priority),
  })

  return taskId
}
