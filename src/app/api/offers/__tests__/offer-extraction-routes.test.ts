/**
 * Offer 提取相关路由 HTTP 集成测试（mock DB/队列，校验状态码与入参传递）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as postExtract } from '@/app/api/offers/extract/route'
import { POST as postRebuild } from '@/app/api/offers/[id]/rebuild/route'
import { PUT as putOffer } from '@/app/api/offers/[id]/route'
import { POST as postBatchCreate } from '@/app/api/offers/batch/create/route'

const extractionFns = vi.hoisted(() => ({
  createOfferExtractionTaskForNewOffer: vi.fn(),
  enqueueExistingOfferExtractionAndMarkQueued: vi.fn(),
  assertOfferAvailableForExtractionEnqueue: vi.fn(),
}))

const updateFns = vi.hoisted(() => ({
  applyOfferUpdateFromBody: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  updateOfferScrapeStatus: vi.fn(),
}))

const keywordFns = vi.hoisted(() => ({
  deleteKeywordPool: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  exec: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  enqueue: vi.fn(),
}))

vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers/server')>()
  return {
    ...actual,
    createOfferExtractionTaskForNewOffer: extractionFns.createOfferExtractionTaskForNewOffer,
    enqueueExistingOfferExtractionAndMarkQueued:
      extractionFns.enqueueExistingOfferExtractionAndMarkQueued,
    assertOfferAvailableForExtractionEnqueue:
      extractionFns.assertOfferAvailableForExtractionEnqueue,
  }
})

vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers/server')>()
  return {
    ...actual,
    applyOfferUpdateFromBody: updateFns.applyOfferUpdateFromBody,
  }
})

vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers/server')>()
  return {
    ...actual,
    updateOfferScrapeStatus: offerFns.updateOfferScrapeStatus,
  }
})

vi.mock('@/lib/keywords/offer-pool', () => ({
  deleteKeywordPool: keywordFns.deleteKeywordPool,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: () => ({
    enqueue: queueFns.enqueue,
  }),
}))

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = { 'x-user-id': '7' }
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    user_id: 7,
    affiliate_link: 'https://aff.example.com/42',
    url: 'https://aff.example.com/42',
    target_country: 'UK',
    extraction_mode: 'balanced',
    page_type: 'product',
    store_product_links: null,
    ...overrides,
  }
}

describe('POST /api/offers/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractionFns.createOfferExtractionTaskForNewOffer.mockResolvedValue('task-new-1')
  })

  it('returns 401 when x-user-id is missing', async () => {
    const req = new NextRequest('http://localhost/api/offers/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
      }),
    })

    const res = await postExtract(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/offers/extract', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: 'not-json',
    })

    const res = await postExtract(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid extraction_mode', async () => {
    const req = jsonRequest('http://localhost/api/offers/extract', {
      affiliate_link: 'https://aff.example.com',
      target_country: 'US',
      extraction_mode: 'bogus',
    })

    const res = await postExtract(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.message).toContain('提取模式')
    expect(extractionFns.createOfferExtractionTaskForNewOffer).not.toHaveBeenCalled()
  })

  it('enqueues store extract with bare commission_payout', async () => {
    const req = jsonRequest('http://localhost/api/offers/extract', {
      affiliate_link: 'https://www.amazon.com/stores/page/ABC',
      target_country: 'US',
      commission_payout: '30',
    })

    const res = await postExtract(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({
      success: true,
      taskId: 'task-new-1',
      message: '任务已创建，开始处理',
    })
    expect(extractionFns.createOfferExtractionTaskForNewOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        affiliateLink: expect.stringContaining('amazon.com/stores'),
        targetCountry: 'US',
        commissionPayout: '30',
        pageType: 'store',
      })
    )
  })
})

describe('POST /api/offers/:id/rebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractionFns.assertOfferAvailableForExtractionEnqueue.mockResolvedValue(undefined)
    offerFns.updateOfferScrapeStatus.mockResolvedValue(undefined)
    keywordFns.deleteKeywordPool.mockResolvedValue(undefined)
    extractionFns.enqueueExistingOfferExtractionAndMarkQueued.mockResolvedValue({
      taskId: 'task-rebuild-1',
      extractionMode: 'balanced',
      affiliateLink: 'https://aff.example.com/42',
      targetCountry: 'DE',
    })
  })

  it('returns 401 when x-user-id is missing', async () => {
    const req = new NextRequest('http://localhost/api/offers/42/rebuild', {
      method: 'POST',
      body: '{}',
    })

    const res = await postRebuild(req, { params: Promise.resolve({ id: '42' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid extraction_mode before apply', async () => {
    const req = jsonRequest('http://localhost/api/offers/42/rebuild', {
      extraction_mode: 'bogus',
    })

    const res = await postRebuild(req, { params: Promise.resolve({ id: '42' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.message).toContain('提取模式')
    expect(updateFns.applyOfferUpdateFromBody).not.toHaveBeenCalled()
  })

  it('returns 400 when offer lacks target_country after apply', async () => {
    extractionFns.enqueueExistingOfferExtractionAndMarkQueued.mockReset()
    updateFns.applyOfferUpdateFromBody.mockResolvedValue({
      offer: makeOffer({ target_country: '' }),
    })
    const { OfferExtractRequestError } = await import('@/lib/offers/server')
    extractionFns.enqueueExistingOfferExtractionAndMarkQueued.mockRejectedValue(
      new OfferExtractRequestError(400, 'Offer缺少推广国家，无法提取')
    )

    const req = jsonRequest('http://localhost/api/offers/42/rebuild', {})
    const res = await postRebuild(req, { params: Promise.resolve({ id: '42' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.message).toContain('推广国家')
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledTimes(1)
    expect(offerFns.updateOfferScrapeStatus).not.toHaveBeenCalled()
  })

  it('passes validated targetCountry to extraction task (not silent US)', async () => {
    updateFns.applyOfferUpdateFromBody.mockResolvedValue({
      offer: makeOffer({ target_country: 'DE' }),
    })

    const req = jsonRequest('http://localhost/api/offers/42/rebuild', {})
    const res = await postRebuild(req, { params: Promise.resolve({ id: '42' }) })

    expect(res.status).toBe(200)
    expect(extractionFns.assertOfferAvailableForExtractionEnqueue).toHaveBeenCalled()
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        offerId: 42,
        offer: expect.objectContaining({ target_country: 'DE' }),
      })
    )
    expect(keywordFns.deleteKeywordPool).toHaveBeenCalledWith(42)
  })

  it('returns 409 when offer is already extracting', async () => {
    const { OfferExtractRequestError } = await import('@/lib/offers/server')
    updateFns.applyOfferUpdateFromBody.mockResolvedValue({
      offer: makeOffer({ scrape_status: 'in_progress' }),
    })
    extractionFns.assertOfferAvailableForExtractionEnqueue.mockRejectedValue(
      new OfferExtractRequestError(409, '该 Offer 正在提取中，请稍后再试')
    )

    const req = jsonRequest('http://localhost/api/offers/42/rebuild', {})
    const res = await postRebuild(req, { params: Promise.resolve({ id: '42' }) })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toBe('Conflict')
    expect(extractionFns.enqueueExistingOfferExtractionAndMarkQueued).not.toHaveBeenCalled()
  })
})

describe('PUT /api/offers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when applyOfferUpdateFromBody rejects invalid extraction_mode', async () => {
    updateFns.applyOfferUpdateFromBody.mockResolvedValue({
      error: '无效的提取模式，可选：fast、balanced、original',
      status: 400,
    })

    const req = new NextRequest('http://localhost/api/offers/42', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({ extraction_mode: 'bogus' }),
    })

    const res = await putOffer(req, { params: Promise.resolve({ id: '42' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('提取模式')
    expect(updateFns.applyOfferUpdateFromBody).toHaveBeenCalledWith(42, 7, {
      extraction_mode: 'bogus',
    })
  })
})

describe('POST /api/offers/batch/create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockReturnValue({
      exec: dbFns.exec,
    })
    dbFns.exec.mockResolvedValue(undefined)
    queueFns.enqueue.mockResolvedValue(undefined)
  })

  it('skips rows with invalid extraction_mode and returns skipReasons', async () => {
    const csv = [
      'affiliate_link,target_country,extraction_mode',
      'https://aff.example.com/a,US,bogus',
      'https://aff.example.com/b,UK,fast',
    ].join('\n')

    const file = new File([csv], 'offers.csv', { type: 'text/csv' })
    const form = new FormData()
    form.append('file', file)

    const req = new NextRequest('http://localhost/api/offers/batch/create', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
      body: form,
    })

    const res = await postBatchCreate(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.totalCount).toBe(1)
    expect(data.skippedCount).toBe(1)
    expect(data.skipReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          reason: expect.stringContaining('无效的提取模式'),
        }),
      ])
    )
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'batch-offer-creation',
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            affiliate_link: 'https://aff.example.com/b',
            target_country: 'UK',
            extraction_mode: 'fast',
          }),
        ],
      }),
      7,
      expect.any(Object)
    )
  })
})
