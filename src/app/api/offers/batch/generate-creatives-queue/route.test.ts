import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/batch/generate-creatives-queue/route'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  getQueueManager: vi.fn(),
  enqueue: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  getGoogleAdsConfig: vi.fn(),
  getUserAuthType: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getAvailableBuckets: vi.fn(),
}))

const creativeTypeFns = vi.hoisted(() => ({
  deriveCanonicalCreativeType: vi.fn(),
  mapCreativeTypeToBucketSlot: vi.fn(),
  normalizeCanonicalCreativeType: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: queueFns.getQueueManager,
}))

vi.mock('@/lib/keyword-planner', () => ({
  getGoogleAdsConfig: authFns.getGoogleAdsConfig,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: authFns.getUserAuthType,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
}))

vi.mock('@/lib/creative-type', () => ({
  deriveCanonicalCreativeType: creativeTypeFns.deriveCanonicalCreativeType,
  mapCreativeTypeToBucketSlot: creativeTypeFns.mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType: creativeTypeFns.normalizeCanonicalCreativeType,
}))

describe('POST /api/offers/batch/generate-creatives-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    dbFns.getDatabase.mockReturnValue({
      type: 'sqlite',
      query: dbFns.query,
      exec: dbFns.exec,
    })

    queueFns.getQueueManager.mockReturnValue({
      enqueue: queueFns.enqueue,
    })

    authFns.getUserAuthType.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: null,
    })
    authFns.getGoogleAdsConfig.mockResolvedValue({
      developerToken: 'dev-token',
      refreshToken: 'refresh-token',
      customerId: 'customer-id',
    })

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('task-102')

    creativeTypeFns.normalizeCanonicalCreativeType.mockImplementation((value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase()
      if (!normalized) return null
      if (normalized === 'brand_focus' || normalized === 'brand_intent') return 'brand_intent'
      if (normalized === 'model_focus' || normalized === 'model_intent') return 'model_intent'
      if (normalized === 'brand_product' || normalized === 'product_intent') return 'product_intent'
      return null
    })

    creativeTypeFns.mapCreativeTypeToBucketSlot.mockImplementation((value: unknown) => {
      if (value === 'brand_intent') return 'A'
      if (value === 'model_intent') return 'B'
      if (value === 'product_intent') return 'D'
      return null
    })

    creativeTypeFns.deriveCanonicalCreativeType.mockImplementation((params: any) => {
      const normalizedType = creativeTypeFns.normalizeCanonicalCreativeType(params?.creativeType)
      if (normalizedType) return normalizedType
      const bucket = String(params?.keywordBucket || '').trim().toUpperCase()
      if (bucket === 'A') return 'brand_intent'
      if (bucket === 'B' || bucket === 'C') return 'model_intent'
      if (bucket === 'D' || bucket === 'S') return 'product_intent'
      return null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses canonical available buckets per offer and skips quota-full offers without raw bucket aggregation', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 101, scrape_status: 'completed' },
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['A'])

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [101, 102],
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(dbFns.query).toHaveBeenCalledTimes(2)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenNthCalledWith(1, 101)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenNthCalledWith(2, 102)
    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(queueFns.enqueue).toHaveBeenCalledTimes(1)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        bucket: 'A',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'offers_batch_auto_bypass_quality_gate',
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data).toMatchObject({
      success: true,
      requestedCount: 2,
      enqueuedCount: 1,
      skippedCount: 1,
      failedCount: 0,
      skipReasons: {
        notFoundOrNoAccess: 0,
        scrapeNotReady: 0,
        taskAlreadyRunning: 0,
        quotaFull: 1,
      },
      taskIds: ['task-102'],
    })
  })

  it('accepts legacy creativeType and maps to canonical bucket slot', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['D'])

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        creativeType: 'brand_product',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        bucket: 'D',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'offers_batch_auto_bypass_quality_gate',
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data.enqueuedCount).toBe(1)
  })

  it('allows explicitly disabling quality-gate bypass for a batch request', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A'])

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        forceGenerateOnQualityGate: false,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        bucket: 'A',
        forceGenerateOnQualityGate: false,
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data.enqueuedCount).toBe(1)
  })

  it('rejects inconsistent creativeType and bucket combinations', async () => {
    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        creativeType: 'model_intent',
        bucket: 'D',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('creativeType-bucket-conflict')
    expect(dbFns.query).not.toHaveBeenCalled()
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('falls back legacy C bucket to D when model-anchor evidence is missing', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['D'])
    creativeTypeFns.deriveCanonicalCreativeType.mockReturnValueOnce('product_intent')

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        bucket: 'C',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        bucket: 'D',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'offers_batch_auto_bypass_quality_gate',
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data.enqueuedCount).toBe(1)
  })

  it('keeps canonical bucket B without legacy fallback when creativeType is omitted', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['B'])

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        bucket: 'B',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(creativeTypeFns.deriveCanonicalCreativeType).not.toHaveBeenCalled()
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        bucket: 'B',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'offers_batch_auto_bypass_quality_gate',
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data.enqueuedCount).toBe(1)
  })
})
