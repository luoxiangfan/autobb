import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/[id]/generate-creatives-queue/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  getQueueManager: vi.fn(),
  enqueue: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  exec: vi.fn(),
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

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: queueFns.getQueueManager,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
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

describe('POST /api/offers/:id/generate-creatives-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      scrape_status: 'completed',
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

    dbFns.getDatabase.mockReturnValue({
      type: 'sqlite',
      exec: dbFns.exec,
    })

    queueFns.getQueueManager.mockReturnValue({
      enqueue: queueFns.enqueue,
    })

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

  it('rejects a requested bucket when the canonical available buckets do not include it', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A', 'D'])

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        bucket: 'B',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenCalledWith(96)
    expect(data.error.code).toBe('CREA_5006')
    expect(data.message).toContain('桶B类型创意')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(queueFns.getQueueManager).not.toHaveBeenCalled()
  })

  it('rejects queue creation when no creative slot is available', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue([])

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenCalledWith(96)
    expect(data.error.code).toBe('CREA_5006')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(queueFns.getQueueManager).not.toHaveBeenCalled()
  })

  it('maps coverage requests to canonical bucket D and keeps legacy synthetic payload compatibility', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['D'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        coverage: true,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(keywordPoolFns.getAvailableBuckets).toHaveBeenCalledWith(96)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        bucket: 'D',
        coverage: true,
        synthetic: true,
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.bucket).toBe('D')
  })

  it('forwards quality gate force-generate flags into queue payload', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B', 'D'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        bucket: 'B',
        force_generate: true,
        force_generate_reason: 'user_confirmed_from_quality_gate_modal',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        bucket: 'B',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'user_confirmed_from_quality_gate_modal',
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.bucket).toBe('B')
  })

  it('accepts canonical/legacy creativeType and maps to the expected bucket', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B', 'D'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'model_focus',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        bucket: 'B',
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.bucket).toBe('B')
  })

  it('rejects inconsistent creativeType and bucket combinations', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A', 'B', 'D'])

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'model_intent',
        bucket: 'D',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('creativeType-bucket-conflict')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(queueFns.getQueueManager).not.toHaveBeenCalled()
  })

  it('falls back legacy bucket C requests to bucket D when model-anchor evidence is missing', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['D'])
    creativeTypeFns.deriveCanonicalCreativeType.mockReturnValueOnce('product_intent')
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        bucket: 'C',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        bucket: 'D',
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.bucket).toBe('D')
  })

  it('keeps canonical bucket B without legacy fallback when creativeType is omitted', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        bucket: 'B',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(creativeTypeFns.deriveCanonicalCreativeType).not.toHaveBeenCalled()
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        bucket: 'B',
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.bucket).toBe('B')
  })

  it('returns structured auth error fields when user is missing', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data).toMatchObject({
      error: '未授权',
      errorCode: 'AUTH_REQUIRED',
      errorCategory: 'auth',
      errorRetryable: false,
      errorUserMessage: '登录状态已失效，请重新登录后再试。',
    })
    expect(data.structuredError).toMatchObject({
      code: 'AUTH_REQUIRED',
      category: 'auth',
      retryable: false,
    })
  })

  it('returns structured validation error fields for invalid creativeType', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'unknown_type',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Invalid creativeType',
      errorCode: 'CREATIVE_TYPE_INVALID',
      errorCategory: 'validation',
      errorRetryable: false,
    })
    expect(data.structuredError).toMatchObject({
      code: 'CREATIVE_TYPE_INVALID',
      category: 'validation',
      retryable: false,
    })
  })
})
