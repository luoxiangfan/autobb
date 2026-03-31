import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import {
  USER_EXECUTION_SUSPENDED_ERROR_CODE,
  assertUserExecutionAllowed,
  buildUserExecutionEligibleSql,
  clearUserExecutionEligibilityCache,
  getUserExecutionEligibility,
  hasPackageExpired,
  isExpiredOverDays,
} from '@/lib/user-execution-eligibility'

describe('user-execution-eligibility', () => {
  const queryOne = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    clearUserExecutionEligibilityCache()

    vi.mocked(getDatabase).mockReturnValue({
      type: 'sqlite',
      query: vi.fn(),
      queryOne,
      exec: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn(),
    } as any)
  })

  it('allows system tasks (userId <= 0)', async () => {
    const result = await getUserExecutionEligibility(0)
    expect(result).toEqual({ userId: 0, eligible: true })
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('blocks inactive users', async () => {
    queryOne.mockResolvedValueOnce({
      is_active: 0,
      package_expires_at: null,
    })

    const result = await getUserExecutionEligibility(42)
    expect(result).toEqual({
      userId: 42,
      eligible: false,
      reason: 'inactive',
    })
  })

  it('blocks expired users and throws suspended error with code', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString()
    queryOne.mockResolvedValue({
      is_active: 1,
      package_expires_at: expired,
    })

    await expect(assertUserExecutionAllowed(99)).rejects.toMatchObject({
      code: USER_EXECUTION_SUSPENDED_ERROR_CODE,
      reason: 'package_expired',
    })
  })

  it('fails closed when eligibility query throws', async () => {
    queryOne.mockRejectedValue(new Error('db unavailable'))

    const result = await getUserExecutionEligibility(108)
    expect(result).toEqual({
      userId: 108,
      eligible: false,
      reason: 'eligibility_check_failed',
    })

    await expect(assertUserExecutionAllowed(108, { bypassCache: true })).rejects.toMatchObject({
      code: USER_EXECUTION_SUSPENDED_ERROR_CODE,
      reason: 'eligibility_check_failed',
    })
  })

  it('builds SQL user eligibility condition for postgres', () => {
    const sql = buildUserExecutionEligibleSql({ dbType: 'postgres', userAlias: 'u' })
    expect(sql).toContain('u.is_active = true')
    expect(sql).toContain('u.package_expires_at')
    expect(sql).toContain("NULLIF(BTRIM(u.package_expires_at), '')::timestamptz")
    expect(sql).toContain('NOW()')
  })

  it('supports date helper functions', () => {
    const now = new Date('2026-03-03T12:00:00.000Z')
    expect(hasPackageExpired('2026-03-03T11:59:59.000Z', now)).toBe(true)
    expect(hasPackageExpired('invalid-date', now, { invalidAsExpired: true })).toBe(true)
    expect(isExpiredOverDays('2026-01-31T00:00:00.000Z', 30, now)).toBe(true)
  })
})
