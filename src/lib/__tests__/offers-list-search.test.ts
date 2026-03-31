import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  type: 'postgres' as 'postgres' | 'sqlite',
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: dbFns.type,
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

  it('uses case-insensitive postgres search over id/brand/offer_name/url/category', async () => {
    dbFns.type = 'postgres'
    const { listOffers } = await import('@/lib/offers')

    await listOffers(7, { searchQuery: 'roborock' })

    const countSql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')
    const countParams = (dbFns.queryOne.mock.calls[0]?.[1] || []) as unknown[]
    const listSql = String(dbFns.query.mock.calls[0]?.[0] || '')

    expect(countSql).toContain('CAST(id AS TEXT) ILIKE ?')
    expect(countSql).toContain('brand ILIKE ?')
    expect(countSql).toContain('offer_name ILIKE ?')
    expect(countSql).toContain('url ILIKE ?')
    expect(countSql).toContain('category ILIKE ?')
    expect(listSql).toContain('CAST(id AS TEXT) ILIKE ?')
    expect(listSql).toContain('offer_name ILIKE ?')
    expect(countParams).toEqual([
      7,
      '%roborock%',
      '%roborock%',
      '%roborock%',
      '%roborock%',
      '%roborock%',
    ])
  })

  it('uses sqlite LIKE search with the same field set', async () => {
    dbFns.type = 'sqlite'
    const { listOffers } = await import('@/lib/offers')

    await listOffers(9, { searchQuery: 'robo' })

    const countSql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')
    const countParams = (dbFns.queryOne.mock.calls[0]?.[1] || []) as unknown[]

    expect(countSql).toContain('CAST(id AS TEXT) LIKE ?')
    expect(countSql).toContain('brand LIKE ?')
    expect(countSql).toContain('offer_name LIKE ?')
    expect(countSql).toContain('url LIKE ?')
    expect(countSql).toContain('category LIKE ?')
    expect(countParams).toEqual([9, '%robo%', '%robo%', '%robo%', '%robo%', '%robo%'])
  })
})
