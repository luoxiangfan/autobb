import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/google-ads/credentials/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  findUserById: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContextMetadata: vi.fn(),
  getGoogleAdsAuthContext: vi.fn(),
  hasConfiguredGoogleAdsAuthFromContext: vi.fn(),
  resolveGoogleAdsDisplayAuthType: vi.fn(),
  googleAdsAuthContextDualStackError: vi.fn(),
  resolveGoogleAdsCredentialStatusSummary: vi.fn(),
  resolveGoogleAdsCredentialStatusFields: vi.fn(),
  resolveGoogleAdsCredentialStatusFieldsFromMetadata: vi.fn(),
  oauthRefreshConfiguredFromContext: vi.fn(),
  serviceAccountConfiguredFromContext: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const { createWithAuthMock } =
    await import('@/__tests__/lib/helpers/campaign-route-with-auth-mock')
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    verifyAuth: authFns.verifyAuth,
    findUserById: authFns.findUserById,
    withAuth: (handler: any, options?: { requireAdmin?: boolean }) =>
      createWithAuthMock(authFns.verifyAuth)(handler, options),
  }
})

vi.mock('@/lib/google-ads/auth/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/auth/context')>()
  return {
    ...actual,
    getGoogleAdsAuthContextMetadata: authContextFns.getGoogleAdsAuthContextMetadata,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
    hasConfiguredGoogleAdsAuthFromContext: authContextFns.hasConfiguredGoogleAdsAuthFromContext,
    resolveGoogleAdsDisplayAuthType: authContextFns.resolveGoogleAdsDisplayAuthType,
    googleAdsAuthContextDualStackError: authContextFns.googleAdsAuthContextDualStackError,
    resolveGoogleAdsCredentialStatusSummary: authContextFns.resolveGoogleAdsCredentialStatusSummary,
    resolveGoogleAdsCredentialStatusFields: authContextFns.resolveGoogleAdsCredentialStatusFields,
    resolveGoogleAdsCredentialStatusFieldsFromMetadata:
      authContextFns.resolveGoogleAdsCredentialStatusFieldsFromMetadata,
    oauthRefreshConfiguredFromContext: authContextFns.oauthRefreshConfiguredFromContext,
    serviceAccountConfiguredFromContext: authContextFns.serviceAccountConfiguredFromContext,
  }
})

describe('GET /api/google-ads/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 5, email: 'sub@test.com', role: 'user' },
    })
    authContextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      assignment: { assignmentMode: 'shared_admin', authType: 'oauth', sharedAdminUserId: 99 },
      canModify: false,
      isShared: true,
      auth: { authType: 'oauth' },
      dualStack: false,
    })
    authContextFns.googleAdsAuthContextDualStackError.mockReturnValue(null)
    authContextFns.resolveGoogleAdsDisplayAuthType.mockReturnValue('oauth')
    authContextFns.hasConfiguredGoogleAdsAuthFromContext.mockReturnValue(true)
    authContextFns.oauthRefreshConfiguredFromContext.mockReturnValue(true)
    authContextFns.serviceAccountConfiguredFromContext.mockReturnValue(false)
    authContextFns.resolveGoogleAdsCredentialStatusFieldsFromMetadata.mockReturnValue({
      clientId: '123456789012345678901.apps.googleusercontent.com',
      developerToken: 'plain-dev-token',
      loginCustomerId: '1234567890',
      hasRefreshToken: true,
      hasServiceAccount: false,
      serviceAccountId: null,
      serviceAccountName: null,
      apiAccessLevel: 'explorer',
      lastVerifiedAt: null,
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      canModify: false,
      isShared: true,
      assignment: { assignmentMode: 'shared_admin', authType: 'oauth', sharedAdminUserId: 99 },
      oauthCredentials: {
        client_id: '123456789012345678901.apps.googleusercontent.com',
        client_secret: 'plain-secret',
        developer_token: 'plain-dev-token',
        refresh_token: 'rt',
      },
    })
    authContextFns.resolveGoogleAdsCredentialStatusFields.mockReturnValue({
      clientId: '123456789012345678901.apps.googleusercontent.com',
      developerToken: 'plain-dev-token',
      loginCustomerId: '1234567890',
      hasRefreshToken: true,
      hasServiceAccount: false,
      serviceAccountId: null,
      serviceAccountName: null,
      apiAccessLevel: 'explorer',
      lastVerifiedAt: null,
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    authFns.findUserById.mockResolvedValue({
      email: 'admin@test.com',
      username: 'admin',
    })
  })

  it('masks clientId and hides developerToken for shared read-only users', async () => {
    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      headers: { 'x-user-id': '5' },
    })

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.data.clientId).toBe('12345678....com')
    expect(payload.data.developerToken).toBeNull()
    expect(payload.data.clientIdConfigured).toBe(true)
    expect(payload.data.developerTokenConfigured).toBe(true)
    expect(payload.data.clientSecretConfigured).toBe(true)
    expect(payload.data.canModify).toBe(false)
    expect(authContextFns.getGoogleAdsAuthContext).not.toHaveBeenCalled()
  })

  it('returns full credential fields for users who can modify', async () => {
    authContextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      assignment: { assignmentMode: 'own', authType: 'oauth' },
      canModify: true,
      isShared: false,
    })
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      canModify: true,
      isShared: false,
      assignment: { assignmentMode: 'own', authType: 'oauth' },
      oauthCredentials: {
        client_id: '123456789012345678901.apps.googleusercontent.com',
        client_secret: 'plain-secret',
        developer_token: 'plain-dev-token',
        refresh_token: 'rt',
      },
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.data.clientId).toBe('123456789012345678901.apps.googleusercontent.com')
    expect(payload.data.developerToken).toBe('plain-dev-token')
    expect(payload.data.clientIdConfigured).toBeUndefined()
    expect(payload.data.clientSecretConfigured).toBeUndefined()
  })
})
