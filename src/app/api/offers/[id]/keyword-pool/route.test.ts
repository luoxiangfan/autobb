import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, POST } from '@/app/api/offers/[id]/keyword-pool/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getKeywordPoolByOfferId: vi.fn(),
  getOrCreateKeywordPool: vi.fn(),
  generateOfferKeywordPool: vi.fn(),
  deleteKeywordPool: vi.fn(),
  getAvailableBuckets: vi.fn(),
  getUsedBuckets: vi.fn(),
  getBucketInfo: vi.fn(),
  determineClusteringStrategy: vi.fn(),
}))

const rebuildFns = vi.hoisted(() => ({
  postRebuild: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getKeywordPoolByOfferId: keywordPoolFns.getKeywordPoolByOfferId,
  getOrCreateKeywordPool: keywordPoolFns.getOrCreateKeywordPool,
  generateOfferKeywordPool: keywordPoolFns.generateOfferKeywordPool,
  deleteKeywordPool: keywordPoolFns.deleteKeywordPool,
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getUsedBuckets: keywordPoolFns.getUsedBuckets,
  getBucketInfo: keywordPoolFns.getBucketInfo,
  determineClusteringStrategy: keywordPoolFns.determineClusteringStrategy,
}))

vi.mock('@/app/api/offers/[id]/rebuild/route', () => ({
  POST: rebuildFns.postRebuild,
}))

describe('POST /api/offers/:id/keyword-pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    offerFns.findOfferById.mockResolvedValue({
      id: 77,
      user_id: 1,
    })

    keywordPoolFns.getKeywordPoolByOfferId.mockResolvedValue(null)
    keywordPoolFns.generateOfferKeywordPool.mockResolvedValue({
      id: 501,
      offerId: 77,
      totalKeywords: 12,
      brandKeywords: [],
      bucketAKeywords: [],
      bucketBKeywords: [],
      bucketCKeywords: [],
      bucketDKeywords: [],
      balanceScore: 0.92,
      clusteringModel: 'mock-cluster',
    })
    keywordPoolFns.determineClusteringStrategy.mockReturnValue({
      bucketCount: 3,
      strategy: 'mixed',
      message: 'test strategy',
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A', 'B', 'D'])
    keywordPoolFns.getBucketInfo.mockImplementation((pool: any, bucket: string) => {
      if (bucket === 'A') return { intent: '品牌意图', intentEn: 'Brand Intent', keywords: pool.bucketAKeywords }
      if (bucket === 'B' || bucket === 'C') return { intent: '商品型号/产品族意图', intentEn: 'Model Intent', keywords: [...pool.bucketAKeywords, ...pool.bucketBKeywords] }
      return { intent: '商品需求意图', intentEn: 'Product Demand Intent', keywords: [...pool.bucketAKeywords, ...pool.bucketBKeywords, ...pool.bucketCKeywords, ...pool.bucketDKeywords] }
    })

    rebuildFns.postRebuild.mockResolvedValue(
      NextResponse.json({
        success: true,
        taskId: 'rebuild-77',
        offerId: 77,
        message: 'Offer重建任务已创建，正在后台处理',
      })
    )
  })

  it('delegates forceRegenerate=true to offer rebuild route', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/keyword-pool', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegenerate: true,
        keywords: ['k1', 'k2'],
      }),
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(rebuildFns.postRebuild).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.generateOfferKeywordPool).not.toHaveBeenCalled()
    expect(data.taskId).toBe('rebuild-77')
  })

  it('keeps normal pool creation path when forceRegenerate is false', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/keyword-pool', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        keywords: ['keyword-1'],
      }),
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(rebuildFns.postRebuild).not.toHaveBeenCalled()
    expect(keywordPoolFns.generateOfferKeywordPool).toHaveBeenCalledWith(77, 1, ['keyword-1'])
    expect(data.success).toBe(true)
    expect(data.message).toBe('关键词池创建成功')
    expect(data.data.bucketBCount).toBe(0)
    expect(data.data.bucketCCount).toBe(0)
    expect(data.data.rawBucketCounts).toEqual({
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    })
  })
})

describe('GET /api/offers/:id/keyword-pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    offerFns.findOfferById.mockResolvedValue({
      id: 77,
      user_id: 1,
    })

    keywordPoolFns.getKeywordPoolByOfferId.mockResolvedValue({
      id: 501,
      offerId: 77,
      totalKeywords: 12,
      brandKeywords: [{ keyword: 'eufy', searchVolume: 1000, source: 'BRAND' }],
      bucketAKeywords: [{ keyword: 'eufy camera', searchVolume: 400, source: 'A' }],
      bucketBKeywords: [{ keyword: 'home security camera', searchVolume: 300, source: 'B' }],
      bucketCKeywords: [{ keyword: 'wireless camera', searchVolume: 200, source: 'C' }],
      bucketDKeywords: [{ keyword: 'eufy outdoor camera', searchVolume: 250, source: 'D' }],
      bucketAIntent: '品牌商品锚点',
      bucketBIntent: '商品需求场景',
      bucketCIntent: '功能规格特性',
      bucketDIntent: '商品需求扩展',
      storeBucketAKeywords: [],
      storeBucketBKeywords: [],
      storeBucketCKeywords: [],
      storeBucketDKeywords: [],
      storeBucketSKeywords: [],
      storeBucketAIntent: '品牌商品集合',
      storeBucketBIntent: '商品需求场景',
      storeBucketCIntent: '热门商品线',
      storeBucketDIntent: '信任服务信号',
      storeBucketSIntent: '店铺全量覆盖',
      linkType: 'product',
      userId: 1,
      clusteringModel: 'mock-cluster',
      clusteringPromptVersion: 'v1',
      balanceScore: 0.92,
      createdAt: '2026-03-16T00:00:00.000Z',
      updatedAt: '2026-03-16T00:00:00.000Z',
    })
    keywordPoolFns.getUsedBuckets.mockResolvedValue(['A'])
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B', 'D'])
    keywordPoolFns.getBucketInfo.mockImplementation((pool: any, bucket: string) => {
      if (bucket === 'A') return { intent: '品牌意图', intentEn: 'Brand Intent', keywords: pool.bucketAKeywords }
      if (bucket === 'B' || bucket === 'C') return { intent: '商品型号/产品族意图', intentEn: 'Model Intent', keywords: [...pool.bucketAKeywords, ...pool.bucketBKeywords] }
      return { intent: '商品需求意图', intentEn: 'Product Demand Intent', keywords: [...pool.bucketAKeywords, ...pool.bucketBKeywords, ...pool.bucketCKeywords, ...pool.bucketDKeywords] }
    })
  })

  it('returns canonical creative slots when includeBucketDetails=true', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/keyword-pool?includeBucketDetails=true', {
      method: 'GET',
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.bucketACount).toBe(1)
    expect(data.data.bucketBCount).toBe(2)
    expect(data.data.bucketCCount).toBe(2)
    expect(data.data.bucketDCount).toBe(4)
    expect(data.data.rawBucketCounts).toEqual({
      A: 1,
      B: 1,
      C: 1,
      D: 1,
    })
    expect(data.data.slotOrder).toEqual(['A', 'B', 'D'])
    expect(data.data.creativeSlots.A.creativeType).toBe('brand_intent')
    expect(data.data.creativeSlots.B.creativeType).toBe('model_intent')
    expect(data.data.creativeSlots.D.creativeType).toBe('product_intent')
    expect(data.data.buckets.B.intentEn).toBe('Model Intent')
    expect(data.data.buckets.C.intentEn).toBe('Model Intent')
    expect(data.data.buckets.D.intentEn).toBe('Product Demand Intent')
    expect(data.data.rawBuckets.D.intentEn).toBe('Demand Expansion')
  })
})
