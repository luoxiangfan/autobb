import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/offers/route'

const offerFns = vi.hoisted(() => ({
  listOffers: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  getOrSet: vi.fn(),
  set: vi.fn(),
  generateCacheKey: vi.fn(),
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  listOffers: offerFns.listOffers,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/api-cache', () => ({
  apiCache: {
    getOrSet: cacheFns.getOrSet,
    set: cacheFns.set,
  },
  generateCacheKey: cacheFns.generateCacheKey,
  invalidateOfferCache: cacheFns.invalidateOfferCache,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: (handler: any) => handler,
}))

function createOfferRow() {
  return {
    id: 101,
    url: 'https://example.com/offer/101',
    brand: 'DemoBrand',
    category: 'tech',
    target_country: 'US',
    affiliate_link: 'https://aff.example.com/101',
    brand_description: 'demo description',
    unique_selling_points: 'point-1',
    product_highlights: 'highlight-1',
    target_audience: 'developers',
    final_url: 'https://shop.example.com/product/101',
    final_url_suffix: 'utm_source=test',
    scrape_status: 'in_progress',
    scrape_error: null,
    scraped_at: '2026-03-03T00:00:00.000Z',
    is_active: 1,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    offer_name: 'DemoBrand_US_01',
    target_language: 'English',
    product_price: '$19.99',
    commission_payout: '10%',
    commission_type: 'percent',
    commission_value: '10',
    commission_currency: 'USD',
    linked_accounts: [{ accountId: 1, accountName: 'Main', customerId: '123', campaignCount: 2 }],
    is_blacklisted: false,
  }
}

describe('GET /api/offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheFns.generateCacheKey.mockReturnValue('offers:user:7:default')
    cacheFns.getOrSet.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => await fn())
  })

  it('returns 401 when user id header is missing', async () => {
    const req = new NextRequest('http://localhost/api/offers')
    const res = await GET(req)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授权' })
  })

  it('returns compact contract for ids query', async () => {
    const offer = createOfferRow()
    offerFns.listOffers.mockResolvedValue({
      offers: [offer],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?ids=101,  202,abc', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(offerFns.listOffers).toHaveBeenCalledWith(7, { ids: [101, 202], limit: 2 })
    expect(cacheFns.getOrSet).not.toHaveBeenCalled()
    expect(data).toEqual({
      success: true,
      offers: [
        {
          id: 101,
          brand: 'DemoBrand',
          scrapeStatus: 'in_progress',
          scrapeError: null,
          affiliateLink: 'https://aff.example.com/101',
          targetCountry: 'US',
        },
      ],
      total: 1,
    })
  })

  it('returns 400 for invalid ids query', async () => {
    const req = new NextRequest('http://localhost/api/offers?ids=foo,bar', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '无效的IDs参数' })
  })

  it('returns summary contract for dashboard usage', async () => {
    const queryOne = vi.fn().mockResolvedValue({
      total: '5',
      active: '3',
      pendingScrape: '2',
    })
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/offers?summary=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(offerFns.listOffers).not.toHaveBeenCalled()
    expect(data).toEqual({
      success: true,
      summary: {
        total: 5,
        active: 3,
        pendingScrape: 2,
      },
    })
  })

  it('uses cached path by default and keeps list response contract stable', async () => {
    const offer = createOfferRow()
    offerFns.listOffers.mockResolvedValue({
      offers: [offer],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?limit=10&offset=0', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(cacheFns.generateCacheKey).toHaveBeenCalledWith('offers', 7, {
      limit: 10,
      offset: 0,
      isActive: undefined,
      targetCountry: undefined,
      searchQuery: undefined,
      scrapeStatus: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    })
    expect(cacheFns.getOrSet).toHaveBeenCalledWith('offers:user:7:default', expect.any(Function), 120000)
    expect(cacheFns.set).not.toHaveBeenCalled()

    expect(data.success).toBe(true)
    expect(data.total).toBe(1)
    expect(data.limit).toBe(10)
    expect(data.offset).toBe(0)
    expect(data.offers).toHaveLength(1)
    expect(data.offers[0]).toMatchObject({
      id: 101,
      url: 'https://example.com/offer/101',
      brand: 'DemoBrand',
      targetCountry: 'US',
      scrapeStatus: 'in_progress',
      isActive: true,
      offerName: 'DemoBrand_US_01',
      targetLanguage: 'English',
      productPrice: '$19.99',
      commissionPayout: '10%',
      commissionType: 'percent',
      commissionValue: '10',
      commissionCurrency: 'USD',
      linkedAccounts: [{ accountId: 1, accountName: 'Main', customerId: '123', campaignCount: 2 }],
      isBlacklisted: false,
    })
  })

  it('bypasses cache when refresh=true', async () => {
    offerFns.listOffers.mockResolvedValue({
      offers: [createOfferRow()],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?refresh=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(cacheFns.getOrSet).not.toHaveBeenCalled()
    expect(cacheFns.set).toHaveBeenCalledWith(
      'offers:user:7:default',
      expect.objectContaining({ success: true }),
      120000
    )
    expect(data.success).toBe(true)
    expect(data.total).toBe(1)
  })

  it('bypasses read/write cache when noCache=true', async () => {
    offerFns.listOffers.mockResolvedValue({
      offers: [createOfferRow()],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?noCache=true', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(cacheFns.getOrSet).not.toHaveBeenCalled()
    expect(cacheFns.set).not.toHaveBeenCalled()
    expect(data.success).toBe(true)
    expect(data.total).toBe(1)
  })

  it('passes scrapeStatus/sortBy/sortOrder query params to listOffers', async () => {
    offerFns.listOffers.mockResolvedValue({
      offers: [createOfferRow()],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?limit=20&offset=40&scrapeStatus=in_progress&sortBy=targetCountry&sortOrder=asc', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(cacheFns.generateCacheKey).toHaveBeenCalledWith('offers', 7, {
      limit: 20,
      offset: 40,
      isActive: undefined,
      targetCountry: undefined,
      searchQuery: undefined,
      scrapeStatus: 'in_progress',
      sortBy: 'targetCountry',
      sortOrder: 'asc',
    })
    expect(offerFns.listOffers).toHaveBeenCalledWith(7, {
      limit: 20,
      offset: 40,
      isActive: undefined,
      targetCountry: undefined,
      searchQuery: undefined,
      scrapeStatus: 'in_progress',
      sortBy: 'targetCountry',
      sortOrder: 'asc',
    })
    expect(data.success).toBe(true)
    expect(data.total).toBe(1)
  })

  it('returns compatibility signal and falls back sort when sortBy is unsupported', async () => {
    offerFns.listOffers.mockResolvedValue({
      offers: [createOfferRow()],
      total: 1,
    })

    const req = new NextRequest('http://localhost/api/offers?limit=20&offset=0&sortBy=linkedAccounts&sortOrder=asc', {
      headers: { 'x-user-id': '7' },
    })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(cacheFns.generateCacheKey).toHaveBeenCalledWith('offers', 7, {
      limit: 20,
      offset: 0,
      isActive: undefined,
      targetCountry: undefined,
      searchQuery: undefined,
      scrapeStatus: undefined,
      sortBy: 'linkedAccounts',
      sortOrder: 'asc',
    })
    expect(offerFns.listOffers).toHaveBeenCalledWith(7, {
      limit: 20,
      offset: 0,
      isActive: undefined,
      targetCountry: undefined,
      searchQuery: undefined,
      scrapeStatus: undefined,
      sortBy: undefined,
      sortOrder: 'asc',
    })
    expect(data.compatibility).toEqual({
      code: 'PARTIAL_UNSUPPORTED_SORT',
      requestedSortBy: 'linkedAccounts',
      appliedSortBy: 'createdAt',
      appliedSortOrder: 'asc',
    })
  })
})

describe('POST /api/offers', () => {
  it('returns 410 with alternatives for authenticated requests', async () => {
    const req = new NextRequest('http://localhost/api/offers', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(410)
    expect(data).toEqual({
      error: 'POST /api/offers 已下线，请改用 /api/offers/extract 或 /api/offers/extract/stream',
      code: 'OFFERS_POST_DEPRECATED',
      alternatives: ['/api/offers/extract', '/api/offers/extract/stream'],
    })
  })
})
