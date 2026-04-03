import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisFns = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    get: redisFns.get,
  }),
}))

vi.mock('@/lib/config', () => ({
  REDIS_PREFIX_CONFIG: {
    cache: 'test:',
  },
}))

describe('products-cache latest query normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisFns.get.mockResolvedValue(null)
  })

  it('preserves pageSize values above 100 when reading latest product query', async () => {
    redisFns.get
      .mockResolvedValueOnce(JSON.stringify({
        page: 1,
        pageSize: 500,
        search: '',
        mid: '',
        targetCountry: 'all',
        landingPageType: 'all',
        sortBy: 'serial',
        sortOrder: 'desc',
        platform: 'all',
        status: 'all',
        reviewCountMin: null,
        reviewCountMax: null,
        priceAmountMin: null,
        priceAmountMax: null,
        commissionRateMin: null,
        commissionRateMax: null,
        commissionAmountMin: null,
        commissionAmountMax: null,
        recommendationScoreMin: null,
        recommendationScoreMax: null,
        createdAtFrom: null,
        createdAtTo: null,
      }))
      .mockResolvedValueOnce(null)

    const { getLatestProductListQuery } = await import('@/lib/products-cache')
    const latestQuery = await getLatestProductListQuery(7)

    expect(latestQuery).toEqual(expect.objectContaining({
      pageSize: 500,
    }))
  })
})
