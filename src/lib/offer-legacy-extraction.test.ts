/**
 * 废弃入口 triggerOfferScraping / triggerOfferExtraction 与主路径一致：不直接设 queued
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueFns = vi.hoisted(() => ({
  enqueueExistingOfferExtractionAndMarkQueued: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
  updateOfferScrapeStatus: vi.fn(),
}))

vi.mock('./offer-extraction-task', () => ({
  enqueueExistingOfferExtractionAndMarkQueued: enqueueFns.enqueueExistingOfferExtractionAndMarkQueued,
}))

vi.mock('./offers', () => ({
  findOfferById: offerFns.findOfferById,
  updateOfferScrapeStatus: offerFns.updateOfferScrapeStatus,
}))

import { triggerOfferExtraction } from './offer-extraction'
import { triggerOfferScraping } from './offer-scraping'

const baseOffer = {
  id: 99,
  affiliate_link: 'https://aff.example.com/99',
  url: 'https://aff.example.com/99',
  target_country: 'US',
  brand: 'TestBrand',
  extraction_mode: 'balanced',
}

describe('deprecated offer extraction triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    offerFns.findOfferById.mockResolvedValue(baseOffer)
    enqueueFns.enqueueExistingOfferExtractionAndMarkQueued.mockResolvedValue({
      taskId: 'task-legacy-1',
      extractionMode: 'balanced',
      affiliateLink: 'https://aff.example.com/99',
      targetCountry: 'US',
    })
  })

  it('triggerOfferScraping delegates to enqueueExistingOfferExtractionAndMarkQueued', async () => {
    const taskId = await triggerOfferScraping(
      99,
      7,
      'https://override.example.com',
      'OverrideBrand',
      'DE',
      5
    )

    expect(taskId).toBe('task-legacy-1')
    expect(enqueueFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        offerId: 99,
        brandName: 'OverrideBrand',
        skipCache: true,
        priority: 'normal',
      })
    )
    expect(offerFns.updateOfferScrapeStatus).not.toHaveBeenCalled()
  })

  it('triggerOfferExtraction delegates to enqueueExistingOfferExtractionAndMarkQueued', async () => {
    await triggerOfferExtraction(99, 7, 'https://aff.example.com/99', 'US')

    expect(enqueueFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        offerId: 99,
        skipCache: false,
      })
    )
    expect(offerFns.updateOfferScrapeStatus).not.toHaveBeenCalled()
  })

  it('triggerOfferScraping propagates enqueue failures without setting queued locally', async () => {
    const { OfferExtractRequestError } = await import('./offer-extract-request')
    enqueueFns.enqueueExistingOfferExtractionAndMarkQueued.mockRejectedValue(
      new OfferExtractRequestError(400, 'Offer缺少推广国家，无法提取')
    )

    await expect(
      triggerOfferScraping(99, 7, 'https://aff.example.com/99', 'Brand', '  ')
    ).rejects.toThrow(OfferExtractRequestError)

    expect(offerFns.updateOfferScrapeStatus).not.toHaveBeenCalled()
  })
})
