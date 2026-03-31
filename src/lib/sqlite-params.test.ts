import { describe, expect, it } from 'vitest'

import { normalizeSqliteParams } from '@/lib/sqlite-params'

describe('normalizeSqliteParams', () => {
  it('converts booleans, undefined, and Date values', () => {
    const date = new Date('2024-01-01T00:00:00.000Z')
    expect(normalizeSqliteParams([true, false, undefined, null, date])).toEqual([
      1,
      0,
      null,
      null,
      date.toISOString(),
    ])
  })

  it('throws for unsupported types with index info', () => {
    expect(() => normalizeSqliteParams(['ok', { a: 1 } as unknown as string])).toThrow(/index 1/i)
  })
})

