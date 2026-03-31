import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/products/route'

const productsFns = vi.hoisted(() => ({
  listAffiliateProducts: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  buildProductListCacheHash: vi.fn(),
  getCachedProductList: vi.fn(),
  setLatestProductListQuery: vi.fn(),
  setCachedProductList: vi.fn(),
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

vi.mock('@/lib/products-cache', () => ({
  buildProductListCacheHash: cacheFns.buildProductListCacheHash,
  getCachedProductList: cacheFns.getCachedProductList,
  setLatestProductListQuery: cacheFns.setLatestProductListQuery,
  setCachedProductList: cacheFns.setCachedProductList,
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  isProductManagementEnabledForUser: authFns.isProductManagementEnabledForUser,
}))

describe('GET /api/products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.isProductManagementEnabledForUser.mockResolvedValue(true)
    cacheFns.buildProductListCacheHash.mockReturnValue('hash-1')
    cacheFns.setLatestProductListQuery.mockResolvedValue(undefined)
    cacheFns.getCachedProductList.mockResolvedValue(null)
    cacheFns.setCachedProductList.mockResolvedValue(undefined)
    productsFns.listAffiliateProducts.mockResolvedValue({
      items: [{ id: 1, name: 'P1' }],
      total: 1,
      productsWithLinkCount: 1,
      activeProductsCount: 1,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
      platformStats: {
        yeahpromos: { total: 1, active: 1, invalid: 0 },
        partnerboost: { total: 0, active: 0, invalid: 0 },
      },
      page: 1,
      pageSize: 20,
    })
  })

  it('returns cached payload in normal mode', async () => {
    const cachedPayload = {
      success: true,
      items: [{ id: 99 }],
      total: 1,
      productsWithLinkCount: 1,
      activeProductsCount: 1,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
      platformStats: {
        yeahpromos: { total: 1, active: 1, invalid: 0 },
        partnerboost: { total: 0, active: 0, invalid: 0 },
      },
      page: 1,
      pageSize: 20,
    }
    cacheFns.getCachedProductList.mockResolvedValue(cachedPayload)

    const req = new NextRequest('http://localhost/api/products', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual(cachedPayload)
    expect(cacheFns.getCachedProductList).toHaveBeenCalledWith(7, 'hash-1')
    expect(productsFns.listAffiliateProducts).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductList).not.toHaveBeenCalled()
  })

  it('refresh=true bypasses read cache and writes latest result', async () => {
    cacheFns.getCachedProductList.mockResolvedValue({
      success: true,
      items: [{ id: 99 }],
    })

    const req = new NextRequest('http://localhost/api/products?refresh=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.getCachedProductList).not.toHaveBeenCalled()
    expect(productsFns.listAffiliateProducts).toHaveBeenCalledTimes(1)
    expect(cacheFns.setCachedProductList).toHaveBeenCalledWith(
      7,
      'hash-1',
      expect.objectContaining({ success: true })
    )
  })

  it('noCache=true bypasses read and write cache', async () => {
    cacheFns.getCachedProductList.mockResolvedValue({
      success: true,
      items: [{ id: 99 }],
    })

    const req = new NextRequest('http://localhost/api/products?noCache=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.getCachedProductList).not.toHaveBeenCalled()
    expect(productsFns.listAffiliateProducts).toHaveBeenCalledTimes(1)
    expect(cacheFns.setCachedProductList).not.toHaveBeenCalled()
  })

  it('passes recommendation score range filters to cache payload and list query', async () => {
    const req = new NextRequest(
      'http://localhost/api/products?recommendationScoreMin=3.5&recommendationScoreMax=4.8',
      { headers: { 'x-user-id': '7' } }
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(cacheFns.buildProductListCacheHash).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendationScoreMin: 3.5,
        recommendationScoreMax: 4.8,
      })
    )
    expect(productsFns.listAffiliateProducts).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        recommendationScoreMin: 3.5,
        recommendationScoreMax: 4.8,
        lightweightSummary: true,
      })
    )
  })
})
