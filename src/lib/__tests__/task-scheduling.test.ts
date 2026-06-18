import { describe, expect, it } from 'vitest'
import { filterRowsByUserPackageExpiry } from '@/lib/common/task-scheduling'

describe('filterRowsByUserPackageExpiry', () => {
  const now = Date.parse('2026-06-18T12:00:00.000Z')

  it('keeps rows without expiry', () => {
    const rows = [{ id: 1 }, { id: 2, user_package_expires_at: null }]
    expect(filterRowsByUserPackageExpiry(rows, now)).toEqual(rows)
  })

  it('drops expired and invalid expiry timestamps', () => {
    const rows = [
      { id: 1, user_package_expires_at: '2026-06-19T00:00:00.000Z' },
      { id: 2, user_package_expires_at: '2026-06-18T11:59:59.000Z' },
      { id: 3, user_package_expires_at: 'not-a-date' },
    ]

    expect(filterRowsByUserPackageExpiry(rows, now)).toEqual([
      { id: 1, user_package_expires_at: '2026-06-19T00:00:00.000Z' },
    ])
  })
})
