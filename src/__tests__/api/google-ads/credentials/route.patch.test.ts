import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/google-ads/credentials/route'
import { GOOGLE_ADS_DUAL_STACK_WARNING } from '@/lib/google-ads/auth/context'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

const accessLevelFns = vi.hoisted(() => ({
  updateApiAccessLevel: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const { createWithAuthMock } =
    await import('@/__tests__/lib/helpers/campaign-route-with-auth-mock')
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    verifyAuth: authFns.verifyAuth,
    withAuth: (handler: any, options?: { requireAdmin?: boolean }) =>
      createWithAuthMock(authFns.verifyAuth)(handler, options),
  }
})

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: assignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads/auth/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/auth/context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  }
})

vi.mock('@/lib/google-ads/settings/access-level-detector', () => ({
  updateApiAccessLevel: accessLevelFns.updateApiAccessLevel,
}))

describe('PATCH /api/google-ads/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, email: 'user@test.com', role: 'user' },
    })
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    accessLevelFns.updateApiAccessLevel.mockResolvedValue(undefined)
  })

  it('returns 409 with DUAL_STACK_CONFLICT when auth context has dual stack', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: true,
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: { id: 'sa-1' },
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      method: 'PATCH',
      headers: { 'x-user-id': '7' },
      body: JSON.stringify({ apiAccessLevel: 'basic' }),
    })

    const res = await PATCH(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('DUAL_STACK_CONFLICT')
    expect(data.message).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(data.authConfigWarning).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(accessLevelFns.updateApiAccessLevel).not.toHaveBeenCalled()
  })

  it('returns 404 when credentials are not configured', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      dualStack: false,
      auth: {},
      oauthCredentials: null,
      serviceAccountConfig: null,
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      method: 'PATCH',
      headers: { 'x-user-id': '7' },
      body: JSON.stringify({ apiAccessLevel: 'basic' }),
    })

    const res = await PATCH(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe('CREDENTIALS_NOT_CONFIGURED')
    expect(accessLevelFns.updateApiAccessLevel).not.toHaveBeenCalled()
  })
})
