import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const { createWithAuthMock } =
    await import('@/__tests__/lib/helpers/campaign-route-with-auth-mock')
  return {
    verifyAuth: authFns.verifyAuth,
    withAuth: (handler: any, options?: { requireAdmin?: boolean }) =>
      createWithAuthMock(authFns.verifyAuth)(handler, options),
  }
})

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { GET } from '@/app/api/campaigns/affiliate-platforms/route'

describe('GET /api/campaigns/affiliate-platforms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authFns.verifyAuth).mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    } as any)
  })

  it('counts only occupying campaigns matched by offer affiliate_link', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('system_settings')) {
        return [{ key: 'yeahpromos_token', description: 'YeahPromos' }]
      }
      if (sql.includes('FROM campaigns c')) {
        expect(sql).toContain("creation_status != 'failed'")
        expect(sql).toContain("!= 'REMOVED'")
        expect(sql).toContain('o.is_deleted = FALSE')
        expect(sql).toContain("creation_status != 'failed'")
        return [
          { id: 1, affiliate_link: 'https://yeahpromos.com/offer-a' },
          { id: 2, affiliate_link: 'https://partnerboost.com/offer-b' },
        ]
      }
      return []
    })

    vi.mocked(getDatabase).mockResolvedValue({
      query,
    } as any)

    const response = await GET(
      new NextRequest('http://localhost/api/campaigns/affiliate-platforms')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.affiliates).toEqual([{ name: 'YeahPromos', count: 1 }])
  })
})
