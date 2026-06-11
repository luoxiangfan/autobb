import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/google-ads/credentials/verify/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  verifyGoogleAdsCredentials: vi.fn(),
}))

const accessLevelFns = vi.hoisted(() => ({
  autoDetectAndUpdateAccessLevel: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: assignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  verifyGoogleAdsCredentials: oauthFns.verifyGoogleAdsCredentials,
}))

vi.mock('@/lib/google-ads-access-level-detector', () => ({
  autoDetectAndUpdateAccessLevel: accessLevelFns.autoDetectAndUpdateAccessLevel,
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
  resolveConfiguredGoogleAdsAuthType: vi.fn(() => 'oauth'),
}))

describe('POST /api/google-ads/credentials/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 3, email: 'user@test.com', role: 'user' },
    })
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
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

  it('returns 403 when user cannot modify shared Google Ads auth', async () => {
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockRejectedValue(
      new Error('当前 Google Ads 认证配置由管理员共享，无法自行修改或删除')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/google-ads/credentials/verify', {
        method: 'POST',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('共享')
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
