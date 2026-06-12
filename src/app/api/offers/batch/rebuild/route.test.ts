import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
  updateOfferScrapeStatus: vi.fn(),
}))

const extractionFns = vi.hoisted(() => ({
  enqueueExistingOfferExtractionAndMarkQueued: vi.fn(),
}))

const keywordFns = vi.hoisted(() => ({
  deleteKeywordPool: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers')>()
  return {
    ...actual,
    findOfferById: offerFns.findOfferById,
    updateOfferScrapeStatus: offerFns.updateOfferScrapeStatus,
  }
})

vi.mock('@/lib/offer-extraction-task', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offer-extraction-task')>()
  return {
    ...actual,
    enqueueExistingOfferExtractionAndMarkQueued:
      extractionFns.enqueueExistingOfferExtractionAndMarkQueued,
  }
})

vi.mock('@/lib/offer-keyword-pool', () => ({
  deleteKeywordPool: keywordFns.deleteKeywordPool,
}))

import { OfferExtractRequestError } from '@/lib/offer-extract-request'
import { POST } from '@/app/api/offers/batch/rebuild/route'

describe('POST /api/offers/batch/rebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockReturnValue({ query: dbFns.query })
    dbFns.query.mockResolvedValueOnce([{ id: 10 }]).mockResolvedValueOnce([])
    offerFns.findOfferById.mockResolvedValue({
      id: 10,
      affiliate_link: 'https://aff.example.com/10',
      target_country: 'UK',
      extraction_mode: 'fast',
      scrape_status: 'completed',
    })
    offerFns.updateOfferScrapeStatus.mockResolvedValue(undefined)
    extractionFns.enqueueExistingOfferExtractionAndMarkQueued.mockResolvedValue({
      taskId: 'task-10',
      extractionMode: 'fast',
      affiliateLink: 'https://aff.example.com/10',
      targetCountry: 'GB',
    })
    keywordFns.deleteKeywordPool.mockResolvedValue(undefined)
  })

  it('records failure when enqueue rejects missing target country', async () => {
    offerFns.findOfferById.mockResolvedValue({
      id: 11,
      affiliate_link: 'https://aff.example.com/11',
      target_country: '  ',
      extraction_mode: 'fast',
      scrape_status: 'completed',
    })
    extractionFns.enqueueExistingOfferExtractionAndMarkQueued.mockRejectedValue(
      new OfferExtractRequestError(400, 'Offer缺少推广国家，无法提取')
    )
    dbFns.query
      .mockReset()
      .mockResolvedValueOnce([{ id: 11 }])
      .mockResolvedValueOnce([])

    const req = new NextRequest('http://localhost/api/offers/batch/rebuild', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({ offerIds: [11] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.failedCount).toBe(1)
    expect(data.enqueuedCount).toBe(0)
    expect(data.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offerId: 11,
          reason: 'Offer缺少推广国家，无法提取',
        }),
      ])
    )
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 11 })
    )
  })

  it('skips offers with running extraction tasks', async () => {
    dbFns.query
      .mockReset()
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ offer_id: 10 }])

    const req = new NextRequest('http://localhost/api/offers/batch/rebuild', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({ offerIds: [10] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.skippedCount).toBe(1)
    expect(data.enqueuedCount).toBe(0)
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).not.toHaveBeenCalled()
    expect(dbFns.query).toHaveBeenCalledWith(
      expect.stringMatching(/status IN \(\?, \?\)/),
      expect.arrayContaining([10, 'pending', 'running'])
    )
  })

  it('enqueues valid offers', async () => {
    const req = new NextRequest('http://localhost/api/offers/batch/rebuild', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({ offerIds: [10] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.enqueuedCount).toBe(1)
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: 10 })
    )
  })
})
