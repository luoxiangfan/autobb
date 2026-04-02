import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  buildProductSummaryCacheHash: vi.fn(() => 'summary-hash'),
  getCachedProductSummary: vi.fn(async () => null),
  setCachedProductSummary: vi.fn(async () => {}),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    query: dbFns.query,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
    transaction: async (fn: () => Promise<unknown>) => await fn(),
    close: async () => {},
  })),
}))

vi.mock('@/lib/products-cache', () => ({
  buildProductSummaryCacheHash: cacheFns.buildProductSummaryCacheHash,
  getCachedProductSummary: cacheFns.getCachedProductSummary,
  setCachedProductSummary: cacheFns.setCachedProductSummary,
}))

describe('listAffiliateProducts fastSummary platform stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue(null)
    dbFns.exec.mockResolvedValue({ changes: 0 })
    cacheFns.buildProductSummaryCacheHash.mockReturnValue('summary-hash')
    cacheFns.getCachedProductSummary.mockResolvedValue(null)
    cacheFns.setCachedProductSummary.mockResolvedValue(undefined)
  })

  it('returns non-zero platform totals for status=all when summary cache misses', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'yeahpromos', total_count: 63074 },
      { platform: 'partnerboost', total_count: 182650 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      fastSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(245724)
    expect(result.platformStats.yeahpromos.total).toBe(63074)
    expect(result.platformStats.yeahpromos.visibleCount).toBe(63074)
    expect(result.platformStats.partnerboost.total).toBe(182650)
    expect(result.platformStats.partnerboost.visibleCount).toBe(182650)
    expect(dbFns.query).toHaveBeenCalledTimes(1)
    expect(dbFns.queryOne).not.toHaveBeenCalled()
    expect(cacheFns.setCachedProductSummary).toHaveBeenCalledTimes(1)
  })

  it('includes anchored url patterns for slug and html product pages in landing classification SQL', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'partnerboost', total_count: 10, product_count: 8, store_count: 1 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      fastSummary: true,
      skipItems: true,
    })

    expect(dbFns.query).toHaveBeenCalledTimes(1)
    const [sql] = dbFns.query.mock.calls[0]
    const sqlText = String(sql)
    expect(sqlText).toContain('%://%/%-p_%')
    expect(sqlText).toContain('%://%/%.html%')
  })

  it('returns per-platform visible counts for status=active while preserving platform totals', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', total_count: 63074 },
        { platform: 'partnerboost', total_count: 182650 },
      ])
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', visible_count: 6636 },
        { platform: 'partnerboost', visible_count: 172107 },
      ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'active',
      fastSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(178743)
    expect(result.activeProductsCount).toBe(178743)
    expect(result.platformStats.yeahpromos.total).toBe(63074)
    expect(result.platformStats.yeahpromos.visibleCount).toBe(6636)
    expect(result.platformStats.yeahpromos.activeProductsCount).toBe(6636)
    expect(result.platformStats.partnerboost.total).toBe(182650)
    expect(result.platformStats.partnerboost.visibleCount).toBe(172107)
    expect(result.platformStats.partnerboost.activeProductsCount).toBe(172107)
    expect(dbFns.query).toHaveBeenCalledTimes(2)
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('filters by targetCountry using allowedCountries containment with UK/GB alias', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'partnerboost', total_count: 42 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      targetCountry: 'UK',
      fastSummary: true,
      skipItems: true,
    })

    expect(dbFns.query).toHaveBeenCalledTimes(1)
    const [sql, params] = dbFns.query.mock.calls[0]
    expect(String(sql)).toContain('allowed_countries_json')
    expect(params).toEqual(expect.arrayContaining([
      '%"uk"%',
      '%"gb"%',
    ]))
  })

  it('uses hybrid lightweight classification: PartnerBoost uses URL rules while other platforms keep ASIN fallback', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'yeahpromos', total_count: 63074, lightweight_product_count: 61000, lightweight_store_count: 0 },
      { platform: 'partnerboost', total_count: 182650, lightweight_product_count: 140000, lightweight_store_count: 5000 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      fastSummary: true,
      lightweightSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(245724)
    expect(result.landingPageStats).toEqual({
      productCount: 201000,
      storeCount: 5000,
      unknownCount: 39724,
    })
    expect(result.platformStats.yeahpromos.productCount).toBe(61000)
    expect(result.platformStats.partnerboost.productCount).toBe(140000)
    expect(result.platformStats.partnerboost.storeCount).toBe(5000)

    expect(dbFns.query).toHaveBeenCalledTimes(1)
    const [sql] = dbFns.query.mock.calls[0]
    expect(String(sql)).toContain('asin')
    expect(String(sql)).toContain("p.platform = 'partnerboost'")
    expect(String(sql)).toContain('%/products/%')
    expect(cacheFns.setCachedProductSummary).not.toHaveBeenCalled()
  })

  it('applies lightweight partnerboost URL classification on visible rows when status is filtered', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', total_count: 100, lightweight_product_count: 90, lightweight_store_count: 0 },
        { platform: 'partnerboost', total_count: 200, lightweight_product_count: 120, lightweight_store_count: 30 },
      ])
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', visible_count: 40, lightweight_product_count: 35, lightweight_store_count: 0 },
        { platform: 'partnerboost', visible_count: 80, lightweight_product_count: 45, lightweight_store_count: 10 },
      ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'active',
      fastSummary: true,
      lightweightSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(120)
    expect(result.activeProductsCount).toBe(120)
    expect(result.landingPageStats).toEqual({
      productCount: 80,
      storeCount: 10,
      unknownCount: 30,
    })
    expect(result.platformStats.yeahpromos.total).toBe(100)
    expect(result.platformStats.yeahpromos.visibleCount).toBe(40)
    expect(result.platformStats.partnerboost.total).toBe(200)
    expect(result.platformStats.partnerboost.visibleCount).toBe(80)
    expect(result.platformStats.partnerboost.productCount).toBe(45)
    expect(result.platformStats.partnerboost.storeCount).toBe(10)
  })
})
