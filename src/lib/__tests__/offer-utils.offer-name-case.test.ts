import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDatabaseMock = vi.fn()

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

describe('offer-utils: offer name casing consistency', () => {
  beforeEach(() => {
    getDatabaseMock.mockReset()
  })

  it('counts existing offers case-insensitively when generating offer_name', async () => {
    const mockDb = {
      queryOne: vi.fn()
        .mockResolvedValueOnce({ count: '2' }) // existing same brand/country (case-insensitive)
        .mockResolvedValueOnce({ count: '0' }), // proposed offer_name uniqueness check
    }
    getDatabaseMock.mockResolvedValue(mockDb)

    const { generateOfferName } = await import('../offer-utils')
    const result = await generateOfferName('IDOO', 'US', 1)

    expect(result).toBe('IDOO_US_03')

    const [countSql, countParams] = mockDb.queryOne.mock.calls[0]
    expect(countSql).toContain('LOWER(TRIM(brand)) = LOWER(TRIM(?))')
    expect(countSql).toContain('UPPER(TRIM(target_country)) = UPPER(TRIM(?))')
    expect(countParams).toEqual([1, 'IDOO', 'US'])

    const [uniqueSql] = mockDb.queryOne.mock.calls[1]
    expect(uniqueSql).toContain('LOWER(offer_name) = LOWER(?)')
  })

  it('treats different-case offer_name as conflict and increments sequence', async () => {
    const mockDb = {
      queryOne: vi.fn()
        .mockResolvedValueOnce({ count: '0' }) // existing brand/country count
        .mockResolvedValueOnce({ count: '1' }) // _01 exists in different case
        .mockResolvedValueOnce({ count: '0' }), // _02 available
    }
    getDatabaseMock.mockResolvedValue(mockDb)

    const { generateOfferName } = await import('../offer-utils')
    const result = await generateOfferName('Idoo', 'US', 1)

    expect(result).toBe('Idoo_US_02')
  })

  it('checks offer_name uniqueness case-insensitively', async () => {
    const mockDb = {
      queryOne: vi.fn().mockResolvedValue({ count: '1' }),
    }
    getDatabaseMock.mockResolvedValue(mockDb)

    const { isOfferNameUnique } = await import('../offer-utils')
    const result = await isOfferNameUnique('IDOO_US_01', 1, 3692)

    expect(result).toBe(false)
    const [sql, params] = mockDb.queryOne.mock.calls[0]
    expect(sql).toContain('LOWER(offer_name) = LOWER(?)')
    expect(params).toEqual([1, 'IDOO_US_01', 3692])
  })

  it('normalizes UK country code to GB when generating offer_name', async () => {
    const mockDb = {
      queryOne: vi.fn()
        .mockResolvedValueOnce({ count: '0' })
        .mockResolvedValueOnce({ count: '0' }),
    }
    getDatabaseMock.mockResolvedValue(mockDb)

    const { generateOfferName } = await import('../offer-utils')
    const result = await generateOfferName('Ringconn', 'UK', 1)

    expect(result).toBe('Ringconn_GB_01')
    const [, countParams] = mockDb.queryOne.mock.calls[0]
    expect(countParams).toEqual([1, 'Ringconn', 'GB'])
  })
})
