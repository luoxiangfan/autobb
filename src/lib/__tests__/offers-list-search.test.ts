import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
    query: dbFns.query,
  })),
}))

describe('listOffers search query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue({ count: 0 })
    dbFns.query.mockResolvedValue([])
  })

  it('uses case-insensitive postgres search over id/brand/offer_name/url/final_url/category', async () => {
    const { listOffers } = await import('@/lib/offers')

    await listOffers(7, { searchQuery: 'roborock' })

    const countSql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')
    const countParams = (dbFns.queryOne.mock.calls[0]?.[1] || []) as unknown[]
    const listSql = String(dbFns.query.mock.calls[0]?.[0] || '')

    expect(countSql).toContain('CAST(o.id AS TEXT) ILIKE ?')
    expect(countSql).toContain('o.brand ILIKE ?')
    expect(countSql).toContain('o.offer_name ILIKE ?')
    expect(countSql).toContain('o.url ILIKE ?')
    expect(countSql).toContain('o.final_url ILIKE ?')
    expect(countSql).toContain('o.category ILIKE ?')
    expect(listSql).toContain('CAST(o.id AS TEXT) ILIKE ?')
    expect(listSql).toContain('o.offer_name ILIKE ?')
    expect(countParams).toEqual([
      7,
      '%roborock%',
      '%roborock%',
      '%roborock%',
      '%roborock%',
      '%roborock%',
      '%roborock%',
    ])
  })
})
