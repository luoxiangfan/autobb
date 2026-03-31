import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
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

describe('upsertAffiliateProducts postgres two-phase upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('builds a typed incoming CTE to avoid text inference mismatches', async () => {
    const { upsertAffiliateProducts } = await import('@/lib/affiliate-products')

    const result = await upsertAffiliateProducts(1, 'partnerboost', [
      {
        platform: 'partnerboost',
        mid: 'PB-MID-001',
        asin: 'B000TEST01',
        brand: 'Brand',
        productName: 'Demo Product',
        productUrl: 'https://example.com/product',
        promoLink: 'https://example.com/promo',
        shortPromoLink: null,
        allowedCountries: ['US'],
        priceAmount: 19.99,
        priceCurrency: 'USD',
        commissionRate: 10,
        commissionAmount: 2,
        commissionRateMode: 'percent',
        reviewCount: 120,
        isDeepLink: false,
        isConfirmedInvalid: false,
      },
    ], { progressEvery: 1 })

    expect(result).toMatchObject({
      totalFetched: 1,
      createdCount: 1,
      updatedCount: 0,
    })

    expect(dbFns.exec).toHaveBeenCalledTimes(3)

    const updateSql = String(dbFns.exec.mock.calls[0]?.[0] || '')
    const updateParams = dbFns.exec.mock.calls[0]?.[1] || []
    const touchSql = String(dbFns.exec.mock.calls[1]?.[0] || '')
    const touchParams = dbFns.exec.mock.calls[1]?.[1] || []
    const insertSql = String(dbFns.exec.mock.calls[2]?.[0] || '')
    const insertParams = dbFns.exec.mock.calls[2]?.[1] || []

    expect(updateSql).toContain('WITH incoming AS')
    expect(updateSql).toContain('FROM (VALUES')
    expect(updateSql).toContain('AS v (')
    expect(updateSql).toContain('v.user_id::integer AS user_id')
    expect(updateSql).toContain('v.price_amount::double precision AS price_amount')
    expect(updateSql).toContain('v.commission_rate_mode::text AS commission_rate_mode')
    expect(updateSql).toContain('v.review_count::integer AS review_count')
    expect(updateSql).toContain('v.is_deeplink::boolean AS is_deeplink')
    expect(updateSql).toContain('v.is_confirmed_invalid::boolean AS is_confirmed_invalid')
    expect(updateSql).toContain('WHERE p.user_id = incoming.user_id')
    expect(updateSql).toContain('p.merchant_id IS DISTINCT FROM incoming.merchant_id')
    expect(updateSql).toContain('price_amount = COALESCE(incoming.price_amount, p.price_amount)')
    expect(updateSql).toContain('price_currency = COALESCE(incoming.price_currency, p.price_currency)')
    expect(updateSql).not.toContain('WHERE p.user_id = incoming.user_id::integer')

    expect(touchSql).toContain('SET')
    expect(touchSql).toContain('last_synced_at = incoming.last_synced_at')
    expect(touchSql).toContain('last_seen_at = incoming.last_seen_at')
    expect(touchSql).toContain('AND NOT (')

    expect(insertSql).toContain('ON p.user_id = incoming.user_id')
    expect(insertSql).toContain('merchant_id = CASE')
    expect(insertSql).toContain('commission_rate_mode = CASE')
    expect(insertSql).toContain('is_deeplink = CASE')
    expect(insertSql).toContain('is_confirmed_invalid = CASE')
    expect(insertSql).toContain('THEN COALESCE(EXCLUDED.price_amount, affiliate_products.price_amount)')
    expect(insertSql).toContain('THEN COALESCE(EXCLUDED.price_currency, affiliate_products.price_currency)')
    expect(insertSql).toContain('updated_at = CASE')
    expect(insertSql).toContain('affiliate_products.last_synced_at IS DISTINCT FROM EXCLUDED.last_synced_at')
    expect(insertSql).not.toContain('ON p.user_id = incoming.user_id::integer')

    expect(updateParams).toHaveLength(22)
    expect(touchParams).toHaveLength(22)
    expect(insertParams).toHaveLength(22)
    expect(updateParams[0]).toBe(1)
    expect(typeof updateParams[0]).toBe('number')
    expect(updateParams[11]).toBe(19.99)
  })
})
