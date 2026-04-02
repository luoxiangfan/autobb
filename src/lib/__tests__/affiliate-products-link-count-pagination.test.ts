import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  buildProductSummaryCacheHash: vi.fn(() => 'summary-hash'),
  getCachedProductSummary: vi.fn(),
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

function createCachedSummary() {
  return {
    total: 0,
    productsWithLinkCount: 0,
    activeProductsCount: 0,
    invalidProductsCount: 0,
    syncMissingProductsCount: 0,
    unknownProductsCount: 0,
    blacklistedCount: 0,
    landingPageStats: {
      productCount: 0,
      storeCount: 0,
      unknownCount: 0,
    },
    platformStats: {
      yeahpromos: {
        total: 0,
        productCount: 0,
        storeCount: 0,
        productsWithLinkCount: 0,
        activeProductsCount: 0,
        invalidProductsCount: 0,
        syncMissingProductsCount: 0,
        unknownProductsCount: 0,
        blacklistedCount: 0,
      },
      partnerboost: {
        total: 0,
        productCount: 0,
        storeCount: 0,
        productsWithLinkCount: 0,
        activeProductsCount: 0,
        invalidProductsCount: 0,
        syncMissingProductsCount: 0,
        unknownProductsCount: 0,
        blacklistedCount: 0,
      },
    },
  }
}

describe('listAffiliateProducts link count query strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue(null)
    dbFns.exec.mockResolvedValue({ changes: 0 })
    cacheFns.buildProductSummaryCacheHash.mockReturnValue('summary-hash')
    cacheFns.getCachedProductSummary.mockResolvedValue(createCachedSummary())
    cacheFns.setCachedProductSummary.mockResolvedValue(undefined)
  })

  it('scopes offer-link aggregation to paged rows for non-relatedOfferCount sorting', async () => {
    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      sortBy: 'serial',
      sortOrder: 'desc',
    })

    expect(dbFns.query).toHaveBeenCalled()
    const [sql, params] = dbFns.query.mock.calls[0]
    const sqlText = String(sql)
    expect(sqlText).toContain('paged_products AS')
    expect(sqlText).toContain('INNER JOIN paged_products pp2 ON pp2.id = link.product_id')
    expect(params).toEqual([1, 1, 20, 0, 1])
  })

  it('keeps legacy full aggregation path when sorting by relatedOfferCount', async () => {
    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      sortBy: 'relatedOfferCount',
      sortOrder: 'desc',
    })

    expect(dbFns.query).toHaveBeenCalled()
    const [sql, params] = dbFns.query.mock.calls[0]
    const sqlText = String(sql)
    expect(sqlText).not.toContain('paged_products AS')
    expect(sqlText).toContain('GROUP BY link.product_id')
    expect(sqlText).toContain('link_counts ON link_counts.product_id = p.id')
    expect(params).toEqual([1, 1, 1, 20, 0])
  })
})
