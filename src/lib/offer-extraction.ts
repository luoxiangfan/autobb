/**
 * @deprecated 请使用 `enqueueExistingOfferExtractionAndMarkQueued` 或 `POST /api/offers/:id/rebuild`。
 * 本模块仅保留 `triggerOfferExtraction` 兼容入口，内部已转发至 offer-extraction 队列。
 */

import { findOfferById } from './offers'
import { enqueueExistingOfferExtractionAndMarkQueued } from './offer-extraction-task'

export interface OfferExtractionOptions {
  offerId: number
  userId: number
  affiliateLink: string
  targetCountry: string
  /** @deprecated 已忽略；提取由 offer-extraction 队列统一执行 */
  enableAI?: boolean
  /** @deprecated 已忽略 */
  enableReviewAnalysis?: boolean
  /** @deprecated 已忽略 */
  enableCompetitorAnalysis?: boolean
  /** @deprecated 已忽略 */
  enableAdExtraction?: boolean
}

function normalizeOptions(
  optionsOrOfferId: OfferExtractionOptions | number,
  userId?: number,
  affiliateLink?: string,
  targetCountry?: string,
  _enableAI?: boolean
): OfferExtractionOptions {
  if (typeof optionsOrOfferId === 'object') {
    return optionsOrOfferId
  }
  return {
    offerId: optionsOrOfferId,
    userId: userId!,
    affiliateLink: affiliateLink!,
    targetCountry: targetCountry!,
  }
}

export async function triggerOfferExtraction(
  options: OfferExtractionOptions
): Promise<void>
export async function triggerOfferExtraction(
  offerId: number,
  userId: number,
  affiliateLink: string,
  targetCountry: string,
  enableAI?: boolean
): Promise<void>
export async function triggerOfferExtraction(
  optionsOrOfferId: OfferExtractionOptions | number,
  userId?: number,
  affiliateLink?: string,
  targetCountry?: string
): Promise<void> {
  const options = normalizeOptions(optionsOrOfferId, userId, affiliateLink, targetCountry)
  const { offerId, userId: uid, affiliateLink: aLink, targetCountry: tCountry } = options

  console.warn(`[DEPRECATED] triggerOfferExtraction Offer #${offerId} → offer-extraction queue`)

  const offer = await findOfferById(offerId, uid)
  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  const link = (aLink || offer.affiliate_link || offer.url || '').trim()
  const mergedOffer = {
    ...offer,
    affiliate_link: link || offer.affiliate_link,
    target_country: (tCountry || offer.target_country || '').trim() || offer.target_country,
  }

  await enqueueExistingOfferExtractionAndMarkQueued({
    offer: mergedOffer,
    userId: uid,
    offerId,
    skipCache: false,
  })
}
