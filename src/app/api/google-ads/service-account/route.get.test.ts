import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/google-ads/service-account/route'

const listServiceAccountsFn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn(async () => ({
    authenticated: true,
    user: { userId: 2, email: 'shared@test.com', role: 'user' },
  })),
  findUserById: vi.fn(async () => ({ id: 2, role: 'user' })),
}))

vi.mock('@/lib/google-ads-service-account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-service-account')>()
  return {
    ...actual,
    listServiceAccounts: listServiceAccountsFn,
  }
})

describe('GET /api/google-ads/service-account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists service accounts via shared owner resolution', async () => {
    listServiceAccountsFn.mockResolvedValue([
      { id: 'sa-admin', name: 'Admin SA', mcc_customer_id: '111', service_account_email: 'sa@test.com' },
    ])

    const response = await GET(new NextRequest('http://localhost/api/google-ads/service-account'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listServiceAccountsFn).toHaveBeenCalledWith(2)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].id).toBe('sa-admin')
  })
})
