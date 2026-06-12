import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/google-ads/credentials/verify/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  verifyGoogleAdsCredentials: vi.fn(),
}))

const accessLevelFns = vi.hoisted(() => ({
  autoDetectAndUpdateAccessLevel: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  getGoogleAdsAuthContextMetadata: vi.fn(),
  resolveGoogleAdsAuthReadyFailure: vi.fn(),
  googleAdsAuthReadyFailurePayload: vi.fn((failure: { message: string; reason: string }) => ({
    error: failure.message,
    code: failure.reason === 'dual_stack' ? 'DUAL_STACK_CONFLICT' : 'CREDENTIALS_NOT_CONFIGURED',
    message: failure.message,
  })),
  googleAdsAuthReadyFailureHttpStatus: vi.fn((reason: string) =>
    reason === 'dual_stack' ? 409 : 404
  ),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads/oauth/oauth', () => ({
  verifyGoogleAdsCredentials: oauthFns.verifyGoogleAdsCredentials,
}))

vi.mock('@/lib/google-ads/settings/access-level-detector', () => ({
  autoDetectAndUpdateAccessLevel: accessLevelFns.autoDetectAndUpdateAccessLevel,
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  getGoogleAdsAuthContextMetadata: authContextFns.getGoogleAdsAuthContextMetadata,
  resolveConfiguredGoogleAdsAuthType: vi.fn(() => 'oauth'),
  resolveGoogleAdsAuthReadyFailure: authContextFns.resolveGoogleAdsAuthReadyFailure,
  googleAdsAuthReadyFailurePayload: authContextFns.googleAdsAuthReadyFailurePayload,
  googleAdsAuthReadyFailureHttpStatus: authContextFns.googleAdsAuthReadyFailureHttpStatus,
}))

describe('POST /api/google-ads/credentials/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 3, email: 'user@test.com', role: 'user' },
    })
    authContextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      canModify: true,
      dualStack: false,
      auth: { authType: 'oauth' },
    })
    authContextFns.resolveGoogleAdsAuthReadyFailure.mockReturnValue(null)
    oauthFns.verifyGoogleAdsCredentials.mockResolvedValue({
      valid: true,
      customer_id: '1234567890',
      authType: 'oauth',
      authContext: { auth: { authType: 'oauth' } },
    })
    accessLevelFns.autoDetectAndUpdateAccessLevel.mockResolvedValue('explorer')
  })

  it('returns 401 when unauthenticated', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false })

    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )

    expect(response.status).toBe(401)
  })

  it('returns 409 when auth is dual stack', async () => {
    authContextFns.resolveGoogleAdsAuthReadyFailure.mockReturnValue({
      reason: 'dual_stack',
      message: '检测到 OAuth 与服务账号同时存在',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('DUAL_STACK_CONFLICT')
    expect(oauthFns.verifyGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('allows verify for shared read-only users when credentials are ready', async () => {
    authContextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      canModify: false,
      isShared: true,
      dualStack: false,
      auth: { authType: 'oauth' },
    })

    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(oauthFns.verifyGoogleAdsCredentials).toHaveBeenCalledWith(3)
  })

  it('returns success when credentials are valid', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.valid).toBe(true)
    expect(body.data.customerId).toBe('1234567890')
    expect(oauthFns.verifyGoogleAdsCredentials).toHaveBeenCalledWith(3)
  })

  it('returns 400 when credentials are invalid', async () => {
    oauthFns.verifyGoogleAdsCredentials.mockResolvedValue({
      valid: false,
      error: '缺少Refresh Token，请完成 OAuth 授权',
      authType: 'oauth',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.data.valid).toBe(false)
  })
})
