import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/google-ads/idle-accounts/route'

const mocks = vi.hoisted(() => ({
  getIdleAdsAccounts: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  getIdleAdsAccounts: mocks.getIdleAdsAccounts,
}))

describe('GET /api/google-ads/idle-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps is_active consistently for postgres boolean and sqlite integer', async () => {
    mocks.getIdleAdsAccounts.mockResolvedValue([
      {
        id: 810,
        customer_id: '9056168564',
        account_name: 'Autoads-16',
        is_active: true,
        created_at: '2026-01-30 19:22:23.043549+00',
        updated_at: '2026-02-11 09:49:37.795117+00',
      },
      {
        id: 811,
        customer_id: '9088631625',
        account_name: 'Autoads-17',
        is_active: 1,
        created_at: '2026-01-30 19:22:24.217649+00',
        updated_at: '2026-02-10 13:37:45.704802+00',
      },
    ])

    const req = new NextRequest('http://localhost/api/google-ads/idle-accounts', {
      headers: { 'x-user-id': '1' },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.accounts).toHaveLength(2)
    expect(data.accounts[0].isActive).toBe(true)
    expect(data.accounts[1].isActive).toBe(true)
  })
})
