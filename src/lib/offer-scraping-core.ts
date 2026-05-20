/**
 * @deprecated 已由 offer-extraction 管线取代。
 * 保留 `performScrapeAndAnalysis` 兼容入口，内部转发至 offer-extraction 队列。
 */

import { findOfferById } from './offers'

export async function performScrapeAndAnalysis(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): Promise<void> {
  const { triggerOfferScraping, OfferScrapingPriority } = await import('./offer-scraping')
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  const { validateExistingOfferForExtraction } = await import('@/lib/offer-extract-request')
  const { targetCountry } = validateExistingOfferForExtraction(offer)

  await triggerOfferScraping(
    offerId,
    userId,
    url,
    brand,
    targetCountry,
    OfferScrapingPriority.NORMAL
  )
}
