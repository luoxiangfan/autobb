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

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: dbFns.getDatabase,
  }
})

vi.mock('@/lib/queue', () => ({
  getQueueManager: queueFns.getQueueManager,
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

describe('POST /api/offers/batch/generate-creatives-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    dbFns.getDatabase.mockReturnValue({
      query: dbFns.query,
      exec: dbFns.exec,
    })

    queueFns.getQueueManager.mockReturnValue({
      enqueue: queueFns.enqueue,
    })

    authFns.validateGoogleAdsConfigForCreativeGeneration.mockResolvedValue({
      ok: true,
      authContext: { auth: { authType: 'oauth' } },
      apiAuth: { authType: 'oauth', serviceAccountId: undefined, refreshToken: 'refresh-token' },
    })

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('task-102')

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

  it('uses canonical available buckets per offer and skips quota-full offers without raw bucket aggregation', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { id: 101, scrape_status: 'completed' },
        { id: 102, scrape_status: 'completed' },
      ])
      .mockResolvedValueOnce([])
    dbFns.exec.mockResolvedValue(undefined)
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce([]).mockResolvedValueOnce(['A'])

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
        googleAdsConfigIncomplete: 0,
      },
      taskIds: ['task-102'],
    })
    expect(data.partialWarning).toContain('已入队 1 个任务')
    expect(data.partialWarning).toContain('创意槽位已满')
    expect(data.warning).toBeUndefined()
    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenNthCalledWith(
      1,
      1,
      undefined,
      expect.objectContaining({
        prepareByLinkedSa: expect.any(Map),
        validationByOfferId: expect.any(Map),
      })
    )
    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenNthCalledWith(
      2,
      1,
      102,
      expect.objectContaining({
        prepareByLinkedSa: expect.any(Map),
        validationByOfferId: expect.any(Map),
      })
    )
  })

  it('returns 400 when user-level Google Ads config is missing', async () => {
    authFns.validateGoogleAdsConfigForCreativeGeneration.mockResolvedValueOnce({
      ok: false,
      message: '未配置 Google Ads 认证',
      missingFields: [],
    })

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({ offerIds: [102] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.errorCode).toBe('CREATIVE_GOOGLE_ADS_NOT_CONFIGURED')
    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenCalledTimes(1)
    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenCalledWith(
      1,
      undefined,
      expect.objectContaining({
        prepareByLinkedSa: expect.any(Map),
        validationByOfferId: expect.any(Map),
      })
    )
    expect(dbFns.query).not.toHaveBeenCalled()
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('skips offers when per-offer Google Ads config validation fails', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 102, scrape_status: 'completed' }])
      .mockResolvedValueOnce([])
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['A'])
    authFns.validateGoogleAdsConfigForCreativeGeneration
      .mockResolvedValueOnce({
        ok: true,
        authContext: { auth: { authType: 'oauth' } },
        apiAuth: { authType: 'oauth', serviceAccountId: undefined, refreshToken: 'refresh-token' },
      })
      .mockResolvedValueOnce({
        ok: false,
        message: 'Google Ads OAuth 授权已过期',
        missingFields: [],
      })

    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({ offerIds: [102] }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.enqueuedCount).toBe(0)
    expect(data.skipReasons.googleAdsConfigIncomplete).toBe(1)
    expect(data.warning).toContain('用户级 Google Ads 配置已通过')
    expect(data.warning).toContain('Google Ads 账号配置不完整')
    expect(authFns.validateGoogleAdsConfigForCreativeGeneration).toHaveBeenNthCalledWith(
      2,
      1,
      102,
      expect.objectContaining({
        prepareByLinkedSa: expect.any(Map),
        validationByOfferId: expect.any(Map),
      })
    )
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('rejects legacy creativeType aliases', async () => {
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

    expect(res.status).toBe(400)
    expect(data.errorCode).toBe('CREATIVE_TYPE_INVALID')
    expect(dbFns.query).not.toHaveBeenCalled()
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('allows explicitly disabling quality-gate bypass for a batch request', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 102, scrape_status: 'completed' }])
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

  it('rejects legacy bucket C requests', async () => {
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

    expect(res.status).toBe(400)
    expect(data.error).toBe('Invalid bucket')
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('keeps canonical bucket B without legacy fallback when creativeType is omitted', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 102, scrape_status: 'completed' }])
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

  it('rejects invalid generationMode', async () => {
    const req = new NextRequest('http://localhost/api/offers/batch/generate-creatives-queue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        offerIds: [102],
        generationMode: 'bogus',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('Invalid generationMode')
    expect(queueFns.enqueue).not.toHaveBeenCalled()
  })

  it('forwards fast generationMode with profile-capped maxRetries', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 102, scrape_status: 'completed' }])
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
        generationMode: '快速',
        maxRetries: 5,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        generationMode: 'fast',
        maxRetries: 0,
      }),
      1,
      expect.objectContaining({
        taskId: 'task-102',
      })
    )
    expect(data.generationMode).toBe('fast')
    expect(data.enqueuedCount).toBe(1)
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('generation_mode'),
      expect.arrayContaining(['fast'])
    )
  })

  it('forwards balanced generationMode with profile-capped maxRetries', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 102, scrape_status: 'completed' }])
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
        generationMode: '均衡',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'ad-creative',
      expect.objectContaining({
        offerId: 102,
        generationMode: 'balanced',
        maxRetries: 1,
      }),
      1,
      expect.any(Object)
    )
    expect(data.generationMode).toBe('balanced')
  })
})
