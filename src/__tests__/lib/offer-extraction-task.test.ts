import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfferExtractRequestError } from '@/lib/offers/server'
import {
  assertOfferAvailableForExtractionEnqueue,
  buildExtractionTaskParamsFromOffer,
  compensateOfferExtractionEnqueueFailure,
  findOfferIdsWithActiveExtractionTasks,
  inferOfferPageType,
  isOfferScrapeStatusBusy,
  parseStoreProductLinks,
  parseStoreProductLinksInput,
  resolveExtractPageInput,
} from '@/lib/offers/server'
import { storeProductLinksTypeError } from '@/lib/offers/store-product-links'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}))

const offerStatusFns = vi.hoisted(() => ({
  updateOfferScrapeStatus: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  removeTask: vi.fn(),
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: dbFns.getDatabase,
  }
})

vi.mock('@/lib/offers/offers', () => ({
  updateOffer: vi.fn(),
  updateOfferScrapeStatus: offerStatusFns.updateOfferScrapeStatus,
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: () => ({
    removeTask: queueFns.removeTask,
  }),
}))

describe('buildExtractionTaskParamsFromOffer', () => {
  it('throws when target country is missing', () => {
    expect(() =>
      buildExtractionTaskParamsFromOffer(
        {
          id: 1,
          affiliate_link: 'https://aff.example.com',
          url: 'https://aff.example.com',
          target_country: '',
        } as any,
        { userId: 7, offerId: 1 }
      )
    ).toThrow(OfferExtractRequestError)
  })

  it('does not default to US when country is provided', () => {
    const params = buildExtractionTaskParamsFromOffer(
      {
        id: 1,
        affiliate_link: 'https://aff.example.com',
        url: 'https://aff.example.com',
        target_country: 'DE',
      } as any,
      { userId: 7, offerId: 1 }
    )
    expect(params.targetCountry).toBe('DE')
  })
})

describe('offer extraction enqueue guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockReturnValue({
      query: dbFns.query,
      exec: dbFns.exec,
    })
    dbFns.query.mockResolvedValue([])
    dbFns.exec.mockResolvedValue(undefined)
    queueFns.removeTask.mockResolvedValue(true)
    offerStatusFns.updateOfferScrapeStatus.mockResolvedValue(undefined)
  })

  it('isOfferScrapeStatusBusy detects queued and in_progress', () => {
    expect(isOfferScrapeStatusBusy('queued')).toBe(true)
    expect(isOfferScrapeStatusBusy('in_progress')).toBe(true)
    expect(isOfferScrapeStatusBusy('completed')).toBe(false)
    expect(isOfferScrapeStatusBusy('pending')).toBe(false)
  })

  it('findOfferIdsWithActiveExtractionTasks queries pending and running', async () => {
    dbFns.query.mockResolvedValue([{ offer_id: 42 }])

    const busy = await findOfferIdsWithActiveExtractionTasks([42, 43])

    expect(busy).toEqual(new Set([42]))
    expect(dbFns.query).toHaveBeenCalledWith(expect.stringMatching(/status IN \(\?, \?\)/), [
      42,
      43,
      'pending',
      'running',
    ])
  })

  it('assertOfferAvailableForExtractionEnqueue rejects busy scrape_status', async () => {
    await expect(
      assertOfferAvailableForExtractionEnqueue({ id: 1, scrape_status: 'queued' })
    ).rejects.toMatchObject({ status: 409 })
    expect(dbFns.query).not.toHaveBeenCalled()
  })

  it('assertOfferAvailableForExtractionEnqueue rejects active offer_tasks', async () => {
    dbFns.query.mockResolvedValue([{ offer_id: 5 }])

    await expect(
      assertOfferAvailableForExtractionEnqueue({ id: 5, scrape_status: 'completed' })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('提取任务') })
  })

  it('compensateOfferExtractionEnqueueFailure removes queue task and marks failed', async () => {
    dbFns.exec.mockResolvedValue(undefined)
    queueFns.removeTask.mockResolvedValue(true)
    offerStatusFns.updateOfferScrapeStatus.mockResolvedValue(undefined)

    await compensateOfferExtractionEnqueueFailure({
      taskId: 'task-rollback-1',
      offerId: 9,
      userId: 7,
      failMessage: 'sync failed',
    })

    expect(queueFns.removeTask).toHaveBeenCalledWith('task-rollback-1')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      expect.arrayContaining(['sync failed', 'task-rollback-1'])
    )
    expect(offerStatusFns.updateOfferScrapeStatus).toHaveBeenCalledWith(
      9,
      7,
      'failed',
      'sync failed'
    )
  })
})

describe('offer-extraction-task helpers', () => {
  describe('parseStoreProductLinks', () => {
    it('parses and dedupes JSON array', () => {
      const raw = JSON.stringify([
        'https://amazon.com/dp/A1',
        'https://amazon.com/dp/A1',
        'https://amazon.com/dp/A2',
      ])
      expect(parseStoreProductLinks(raw)).toEqual([
        'https://amazon.com/dp/A1',
        'https://amazon.com/dp/A2',
      ])
    })

    it('returns undefined for invalid JSON', () => {
      expect(parseStoreProductLinks('not-json')).toBeUndefined()
    })
  })

  describe('inferOfferPageType', () => {
    it('respects explicit page_type', () => {
      expect(inferOfferPageType({ pageType: 'product' })).toBe('product')
      expect(inferOfferPageType({ pageType: 'store' })).toBe('store')
    })

    it('infers store from supplemental links', () => {
      expect(
        inferOfferPageType({
          storeProductLinks: ['https://amazon.com/dp/B001'],
        })
      ).toBe('store')
    })

    it('infers store from Amazon stores URL', () => {
      expect(
        inferOfferPageType({
          affiliateLink: 'https://www.amazon.com/stores/page/ABC',
        })
      ).toBe('store')
    })

    it('defaults to product', () => {
      expect(inferOfferPageType({ affiliateLink: 'https://example.com/item' })).toBe('product')
    })
  })

  describe('resolveExtractPageInput', () => {
    it('infers store from links when page_type is omitted', () => {
      const result = resolveExtractPageInput({
        affiliateLink: 'https://example.com/item',
        storeProductLinks: ['https://amazon.com/dp/B001'],
      })
      expect(result).toEqual({
        pageType: 'store',
        storeProductLinks: ['https://amazon.com/dp/B001'],
      })
    })

    it('rejects non-array store_product_links before inferring page type', () => {
      expect(
        resolveExtractPageInput({
          affiliateLink: 'https://example.com/item',
          storeProductLinks: 'not-an-array',
        })
      ).toEqual({ error: storeProductLinksTypeError() })
    })

    it('returns empty store links for product page type', () => {
      expect(
        resolveExtractPageInput({
          pageType: 'product',
          affiliateLink: 'https://amazon.com/stores/page/ABC',
          storeProductLinks: ['https://amazon.com/dp/B001'],
        })
      ).toEqual({
        pageType: 'product',
        storeProductLinks: [],
      })
    })
  })

  describe('parseStoreProductLinksInput', () => {
    it('validates URL format', () => {
      expect(parseStoreProductLinksInput(['not-a-url'])).toEqual({
        error: '单品推广链接无效: not-a-url',
      })
    })
  })
})
