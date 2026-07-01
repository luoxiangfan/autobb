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
  validateGoogleAdsConfigForCreativeGeneration: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getAvailableBuckets: vi.fn(),
}))

const creativeTypeFns = vi.hoisted(() => ({
  deriveCanonicalCreativeType: vi.fn(),
  mapCreativeTypeToBucketSlot: vi.fn(),
  normalizeCanonicalCreativeType: vi.fn(),
}))

vi.mock('@/lib/offers/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers/server')>()
  return {
    ...actual,
    findOfferById: offerFns.findOfferById,
  }
})

vi.mock('@/lib/queue', () => ({
  getQueueManager: queueFns.getQueueManager,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/google-ads/accounts/auth/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/accounts/auth/index')>()
  return {
    ...actual,
    validateGoogleAdsConfigForCreativeGeneration:
      authFns.validateGoogleAdsConfigForCreativeGeneration,
  }
})

vi.mock('@/lib/keywords/offer-pool', () => ({
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
}))

vi.mock('@/lib/creatives/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creatives/server')>()
  return {
    ...actual,
    deriveCanonicalCreativeType: creativeTypeFns.deriveCanonicalCreativeType,
    mapCreativeTypeToBucketSlot: creativeTypeFns.mapCreativeTypeToBucketSlot,
    normalizeCanonicalCreativeType: creativeTypeFns.normalizeCanonicalCreativeType,
  }
})

describe('POST /api/offers/:id/generate-creatives-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      scrape_status: 'completed',
    })

    authFns.validateGoogleAdsConfigForCreativeGeneration.mockResolvedValue({
      ok: true,
      authContext: { auth: { authType: 'oauth' } },
      apiAuth: { authType: 'oauth', serviceAccountId: undefined, refreshToken: 'refresh-token' },
    })

    dbFns.getDatabase.mockReturnValue({
      exec: dbFns.exec,
    })

    queueFns.getQueueManager.mockReturnValue({
      enqueue: queueFns.enqueue,
    })

    creativeTypeFns.normalizeCanonicalCreativeType.mockImplementation((value: unknown) => {
      const normalized = String(value || '')
        .trim()
        .toLowerCase()
      if (!normalized) return null
      if (normalized === 'brand_intent') return 'brand_intent'
      if (normalized === 'model_intent') return 'model_intent'
      if (normalized === 'product_intent') return 'product_intent'
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
      const bucket = String(params?.keywordBucket || '')
        .trim()
        .toUpperCase()
      if (bucket === 'A') return 'brand_intent'
      if (bucket === 'B') return 'model_intent'
      if (bucket === 'D') return 'product_intent'
      return null
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('validates Google Ads config with offer-linked SA before enqueue', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A'])

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({ bucket: 'A' }),
    })

    await POST(req, { params: Promise.resolve({ id: '96' }) })

    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        prepareByLinkedSa: expect.any(Map),
        validationByOfferId: expect.any(Map),
        validationByUserId: expect.any(Map),
      })
    )
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

  it('rejects legacy creativeType aliases', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B', 'D'])

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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.errorCode).toBe('CREATIVE_TYPE_INVALID')
    expect(queueFns.enqueue).not.toHaveBeenCalled()
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('creativeType-bucket-conflict')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
    expect(queueFns.getQueueManager).not.toHaveBeenCalled()
  })

  it('rejects legacy bucket C requests', async () => {
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('Invalid bucket')
    expect(queueFns.enqueue).not.toHaveBeenCalled()
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBeTruthy()
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

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
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

  it('rejects invalid generationMode', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        generationMode: 'not-a-mode',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.errorCode).toBe('CREATIVE_GENERATION_MODE_INVALID')
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('forwards fast generationMode with profile-capped maxRetries', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['D'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        generationMode: 'fast',
        bucket: 'D',
        maxRetries: 99,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 96,
        generationMode: 'fast',
        maxRetries: 0,
      }),
      1,
      expect.objectContaining({
        taskId: expect.any(String),
      })
    )
    expect(data.generationMode).toBe('fast')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('generation_mode'),
      expect.arrayContaining(['fast'])
    )
  })

  it('forwards balanced generationMode with profile-capped maxRetries', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['D'])
    dbFns.exec.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/offers/96/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        generationMode: 'balanced',
        bucket: 'D',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: '96' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        generationMode: 'balanced',
        maxRetries: 1,
      }),
      1,
      expect.any(Object)
    )
    expect(data.generationMode).toBe('balanced')
  })
})
