import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/products/summary/route'

const productsFns = vi.hoisted(() => ({
  listAffiliateProducts: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  buildProductSummaryCacheHash: vi.fn(),
  buildProductSummaryRouteCacheHash: vi.fn(),
  getCachedProductSummaryRoute: vi.fn(),
  setCachedProductSummary: vi.fn(),
  setCachedProductSummaryRoute: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  isProductManagementEnabledForUser: vi.fn(),
}))

vi.mock('@/lib/affiliate-products', () => ({
  listAffiliateProducts: productsFns.listAffiliateProducts,
  normalizeAffiliatePlatform: (value: string | null) => value,
  normalizeAffiliateLandingPageTypeFilter: (value: string | null) => value || 'all',
  normalizeAffiliateProductStatusFilter: (value: string | null) => value || 'all',
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/products-cache', () => ({
  buildProductSummaryCacheHash: cacheFns.buildProductSummaryCacheHash,
  buildProductSummaryRouteCacheHash: cacheFns.buildProductSummaryRouteCacheHash,
  getCachedProductSummaryRoute: cacheFns.getCachedProductSummaryRoute,
  setCachedProductSummary: cacheFns.setCachedProductSummary,
  setCachedProductSummaryRoute: cacheFns.setCachedProductSummaryRoute,
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  isProductManagementEnabledForUser: authFns.isProductManagementEnabledForUser,
}))

describe('GET /api/products/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.isProductManagementEnabledForUser.mockResolvedValue(true)
    cacheFns.buildProductSummaryCacheHash.mockReturnValue('summary-hash')
    cacheFns.buildProductSummaryRouteCacheHash.mockReturnValue('summary-route-hash')
    cacheFns.getCachedProductSummaryRoute.mockResolvedValue(null)
    cacheFns.setCachedProductSummary.mockResolvedValue(undefined)
    cacheFns.setCachedProductSummaryRoute.mockResolvedValue(undefined)
    productsFns.listAffiliateProducts.mockResolvedValue({
      total: 11,
      productsWithLinkCount: 3,
      landingPageStats: { productCount: 9, storeCount: 1, unknownCount: 1 },
      activeProductsCount: 8,
      invalidProductsCount: 1,
      syncMissingProductsCount: 1,
      unknownProductsCount: 1,
      blacklistedCount: 0,
      platformStats: {
        yeahpromos: {
          total: 6,
          visibleCount: 6,
          productCount: 5,
          storeCount: 1,
          productsWithLinkCount: 2,
          activeProductsCount: 5,
          invalidProductsCount: 1,
          syncMissingProductsCount: 0,
          unknownProductsCount: 0,
          blacklistedCount: 0,
        },
        partnerboost: {
          total: 5,
          visibleCount: 5,
          productCount: 4,
          storeCount: 0,
          productsWithLinkCount: 1,
          activeProductsCount: 3,
          invalidProductsCount: 0,
          syncMissingProductsCount: 1,
          unknownProductsCount: 1,
          blacklistedCount: 0,
        },
      },
    })
    dbFns.queryOne
      .mockResolvedValueOnce({ effective_count: 7 })
      .mockResolvedValueOnce({ last_score_calculated_at: '2026-04-01T00:00:00.000Z' })
  })

  it('returns cached payload when summary route cache hits', async () => {
    const cachedPayload = {
      success: true,
      total: 3,
      productsWithLinkCount: 1,
      landingPageStats: { productCount: 2, storeCount: 1, unknownCount: 0 },
      activeProductsCount: 2,
      invalidProductsCount: 0,
      syncMissingProductsCount: 1,
      unknownProductsCount: 0,
      blacklistedCount: 0,
      platformStats: {},
      recommendationScoreSummary: {
        effectiveCount: 1,
        lastCalculatedAt: null,
      },
    }
    cacheFns.getCachedProductSummaryRoute.mockResolvedValue(cachedPayload)

    const req = new NextRequest('http://localhost/api/products/summary', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual(cachedPayload)
    expect(productsFns.listAffiliateProducts).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductSummaryRoute).not.toHaveBeenCalled()
  })

  it('refresh=true bypasses read cache and writes computed payload', async () => {
    const req = new NextRequest('http://localhost/api/products/summary?refresh=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.getCachedProductSummaryRoute).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductSummaryRoute).toHaveBeenCalledWith(
      7,
      'summary-route-hash',
      expect.objectContaining({ success: true })
    )
    expect(cacheFns.setCachedProductSummary).toHaveBeenCalledWith(
      7,
      'summary-hash',
      expect.objectContaining({
        total: 11,
        productsWithLinkCount: 3,
      })
    )
    expect(productsFns.listAffiliateProducts).toHaveBeenCalledTimes(1)
  })

  it('noCache=true bypasses both read and write cache', async () => {
    const req = new NextRequest('http://localhost/api/products/summary?noCache=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.getCachedProductSummaryRoute).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductSummaryRoute).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductSummary).not.toHaveBeenCalled()
    expect(productsFns.listAffiliateProducts).toHaveBeenCalledTimes(1)
  })

  it('writes shared summary cache for later list-route reuse', async () => {
    const req = new NextRequest('http://localhost/api/products/summary', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(cacheFns.buildProductSummaryCacheHash).toHaveBeenCalledWith(
      expect.objectContaining({
        search: '',
        mid: '',
        platform: 'all',
        targetCountry: 'all',
        status: 'all',
      })
    )
    expect(cacheFns.setCachedProductSummary).toHaveBeenCalledWith(
      7,
      'summary-hash',
      expect.objectContaining({
        total: 11,
        landingPageStats: { productCount: 9, storeCount: 1, unknownCount: 1 },
      })
    )
  })
})
