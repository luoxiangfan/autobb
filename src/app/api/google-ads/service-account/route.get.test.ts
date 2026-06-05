import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/google-ads/service-account/route'

const listServiceAccountsFn = vi.hoisted(() => vi.fn())
const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsDisplayAuthType: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn(async () => ({
    authenticated: true,
    user: { userId: 2, email: 'shared@test.com', role: 'user' },
  })),
  findUserById: vi.fn(async () => ({ id: 2, role: 'user' })),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  resolveGoogleAdsDisplayAuthType: authContextFns.resolveGoogleAdsDisplayAuthType,
  assertNoConflictingGoogleAdsAuth: vi.fn(async () => {}),
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
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({ userId: 2 })
  })

  it('returns empty list when effective auth is not service_account', async () => {
    authContextFns.resolveGoogleAdsDisplayAuthType.mockReturnValue('oauth')
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 2,
      dualStack: false,
      canModify: true,
    })

    const response = await GET(new NextRequest('http://localhost/api/google-ads/service-account'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accounts).toEqual([])
    expect(listServiceAccountsFn).not.toHaveBeenCalled()
  })

  it('returns empty list for dual-stack shared user without modify access', async () => {
    authContextFns.resolveGoogleAdsDisplayAuthType.mockReturnValue(null)
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 2,
      dualStack: true,
      canModify: false,
    })

    const response = await GET(new NextRequest('http://localhost/api/google-ads/service-account'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accounts).toEqual([])
    expect(listServiceAccountsFn).not.toHaveBeenCalled()
  })

  it('lists service accounts when effective auth is service_account', async () => {
    authContextFns.resolveGoogleAdsDisplayAuthType.mockReturnValue('service_account')
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 2,
      dualStack: false,
      canModify: true,
    })
    listServiceAccountsFn.mockResolvedValue([
      {
        id: 'sa-admin',
        name: 'Admin SA',
        mcc_customer_id: '111',
        service_account_email: 'sa@test.com',
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/google-ads/service-account'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listServiceAccountsFn).toHaveBeenCalledWith(2)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].id).toBe('sa-admin')
  })

  it('lists service accounts for dual-stack owner cleanup when canModify', async () => {
    authContextFns.resolveGoogleAdsDisplayAuthType.mockReturnValue(null)
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 2,
      dualStack: true,
      canModify: true,
    })
    listServiceAccountsFn.mockResolvedValue([
      {
        id: 'sa-dual',
        name: 'Dual SA',
        mcc_customer_id: '111',
        service_account_email: 'sa@test.com',
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/google-ads/service-account'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(listServiceAccountsFn).toHaveBeenCalledWith(2)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].id).toBe('sa-dual')
  })
})
