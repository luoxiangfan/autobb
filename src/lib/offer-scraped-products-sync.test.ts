import { describe, expect, it, vi, beforeEach } from 'vitest'

const exec = vi.fn().mockResolvedValue(undefined)
const getDatabase = vi.fn().mockResolvedValue({
  exec,
})

vi.mock('./db', () => ({
  getDatabase,
}))

describe('syncScrapedProductsFromExtractData', () => {
  beforeEach(() => {
    exec.mockClear()
    getDatabase.mockClear()
  })

  it('syncs store products with amazon_store source', async () => {
    const { syncScrapedProductsFromExtractData } = await import('./offer-scraped-products-sync')
    await syncScrapedProductsFromExtractData(1, 2, {
      products: [{ name: 'A', productUrl: 'https://a' }],
      debug: { isAmazonStore: true },
    })
    expect(exec).toHaveBeenCalled()
    const insertCall = exec.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO scraped_products')
    )
    expect(insertCall?.[1]).toContain('amazon_store')
  })

  it('syncs single product when productName present without products array', async () => {
    const { syncScrapedProductsFromExtractData } = await import('./offer-scraped-products-sync')
    await syncScrapedProductsFromExtractData(3, 4, {
      productName: 'Widget',
      finalUrl: 'https://amazon.com/dp/X',
      debug: { isAmazonProductPage: true },
    })
    const insertCall = exec.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO scraped_products')
    )
    expect(insertCall?.[1]).toContain('amazon_product')
    expect(insertCall?.[1]).toContain('Widget')
  })
})
