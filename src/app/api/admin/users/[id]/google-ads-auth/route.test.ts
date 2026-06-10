import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  findUserById: vi.fn(),
}))

const contextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContextMetadata: vi.fn(),
  adminHasConfiguredAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  upsertGoogleAdsAuthAssignment: vi.fn(),
  getGoogleAdsAuthAssignment: vi.fn(),
  deleteGoogleAdsAuthAssignment: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  saveGoogleAdsCredentials: vi.fn(),
  deleteGoogleAdsCredentials: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  deleteAllGoogleAdsServiceAccountsForUser: vi.fn(),
  parseServiceAccountJson: vi.fn(),
  replaceGoogleAdsServiceAccountForUser: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
  findUserById: authFns.findUserById,
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContextMetadata: contextFns.getGoogleAdsAuthContextMetadata,
  }
})

vi.mock('@/lib/google-ads-auth-assignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-assignment')>()
  return {
    ...actual,
    adminHasConfiguredAuth: contextFns.adminHasConfiguredAuth,
    upsertGoogleAdsAuthAssignment: assignmentFns.upsertGoogleAdsAuthAssignment,
    getGoogleAdsAuthAssignment: assignmentFns.getGoogleAdsAuthAssignment,
    deleteGoogleAdsAuthAssignment: assignmentFns.deleteGoogleAdsAuthAssignment,
  }
})

vi.mock('@/lib/google-ads-oauth', () => ({
  saveGoogleAdsCredentials: oauthFns.saveGoogleAdsCredentials,
  deleteGoogleAdsCredentials: oauthFns.deleteGoogleAdsCredentials,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  deleteAllGoogleAdsServiceAccountsForUser:
    serviceAccountFns.deleteAllGoogleAdsServiceAccountsForUser,
  parseServiceAccountJson: serviceAccountFns.parseServiceAccountJson,
  replaceGoogleAdsServiceAccountForUser: serviceAccountFns.replaceGoogleAdsServiceAccountForUser,
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((value: string) => value),
}))

import { PUT, DELETE } from '@/app/api/admin/users/[id]/google-ads-auth/route'
import { GOOGLE_ADS_DUAL_STACK_WARNING } from '@/lib/google-ads-auth-context'

describe('PUT /api/admin/users/[id]/google-ads-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1, role: 'admin' },
    })
    authFns.findUserById.mockResolvedValue({ id: 2, username: 'user2' })
    contextFns.adminHasConfiguredAuth.mockResolvedValue(true)
    assignmentFns.upsertGoogleAdsAuthAssignment.mockResolvedValue({})
  })

  it('clears orphan credentials before assigning shared_admin', async () => {
    contextFns.getGoogleAdsAuthContextMetadata
      .mockResolvedValueOnce({
        userId: 2,
        ownerUserId: 2,
        dualStack: false,
        assignment: null,
        isShared: false,
        canModify: true,
        auth: { authType: 'oauth' as const },
        oauthCredentials: { client_id: 'orphan.apps.googleusercontent.com' },
        serviceAccountConfig: null,
        oauthHasRefreshToken: false,
        serviceAccountConfigured: false,
      })
      .mockResolvedValueOnce({
        userId: 2,
        ownerUserId: 2,
        dualStack: false,
        assignment: null,
        isShared: false,
        canModify: true,
        auth: { authType: 'oauth' as const },
        oauthCredentials: { client_id: 'orphan.apps.googleusercontent.com' },
        serviceAccountConfig: null,
        oauthHasRefreshToken: false,
        serviceAccountConfigured: false,
      })
      .mockResolvedValue({
        userId: 2,
        ownerUserId: 1,
        dualStack: false,
        assignment: {
          assignmentMode: 'shared_admin',
          authType: 'oauth',
          sharedAdminUserId: 1,
        },
        isShared: true,
        canModify: false,
        auth: { authType: 'oauth' as const },
        oauthCredentials: { refresh_token: 'admin-rt' },
        serviceAccountConfig: null,
        oauthHasRefreshToken: true,
        serviceAccountConfigured: false,
      })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'PUT',
      body: JSON.stringify({
        assignmentMode: 'shared_admin',
        authType: 'oauth',
      }),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: '2' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(oauthFns.deleteGoogleAdsCredentials).toHaveBeenCalledWith(2)
    expect(assignmentFns.upsertGoogleAdsAuthAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        assignmentMode: 'shared_admin',
        sharedAdminUserId: 1,
      })
    )
  })

  it('returns 409 when target user auth context is dual-stack', async () => {
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 2,
      dualStack: true,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: { authType: 'oauth' as const },
      oauthCredentials: { refresh_token: 'rt', client_id: 'cid' },
      serviceAccountConfig: { id: 'sa-1' },
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'PUT',
      body: JSON.stringify({
        assignmentMode: 'shared_admin',
        authType: 'oauth',
      }),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: '2' }) })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('DUAL_STACK_CONFLICT')
    expect(data.authConfigWarning).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(assignmentFns.upsertGoogleAdsAuthAssignment).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/users/[id]/google-ads-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1, role: 'admin' },
    })
    authFns.findUserById.mockResolvedValue({ id: 2, username: 'user2' })
    oauthFns.deleteGoogleAdsCredentials.mockResolvedValue(undefined)
    serviceAccountFns.deleteAllGoogleAdsServiceAccountsForUser.mockResolvedValue(undefined)
    assignmentFns.deleteGoogleAdsAuthAssignment.mockResolvedValue(undefined)
  })

  it('clears self-configured OAuth when no assignment record exists', async () => {
    assignmentFns.getGoogleAdsAuthAssignment.mockResolvedValue(null)
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 2,
      dualStack: false,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: { authType: 'oauth' as const },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: null,
      oauthHasRefreshToken: true,
      serviceAccountConfigured: false,
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '2' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(oauthFns.deleteGoogleAdsCredentials).toHaveBeenCalledWith(2)
    expect(serviceAccountFns.deleteAllGoogleAdsServiceAccountsForUser).not.toHaveBeenCalled()
    expect(assignmentFns.deleteGoogleAdsAuthAssignment).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no assignment and no credentials', async () => {
    assignmentFns.getGoogleAdsAuthAssignment.mockResolvedValue(null)
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 2,
      dualStack: false,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: {},
      oauthCredentials: null,
      serviceAccountConfig: null,
      oauthHasRefreshToken: false,
      serviceAccountConfigured: false,
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '2' }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain('没有 Google Ads 认证配置')
  })

  it('clears orphan credentials when deleting shared_admin assignment', async () => {
    assignmentFns.getGoogleAdsAuthAssignment.mockResolvedValue({
      assignmentMode: 'shared_admin',
      authType: 'oauth',
      userId: 2,
      sharedAdminUserId: 1,
    })
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 1,
      dualStack: false,
      assignment: { assignmentMode: 'shared_admin', authType: 'oauth', sharedAdminUserId: 1 },
      isShared: true,
      canModify: false,
      auth: { authType: 'oauth' as const },
      oauthCredentials: { refresh_token: 'admin-rt' },
      serviceAccountConfig: null,
      oauthHasRefreshToken: true,
      serviceAccountConfigured: false,
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '2' }) })

    expect(res.status).toBe(200)
    expect(oauthFns.deleteGoogleAdsCredentials).toHaveBeenCalledWith(2)
    expect(assignmentFns.deleteGoogleAdsAuthAssignment).toHaveBeenCalledWith(2)
  })

  it('clears partial OAuth and dual-stack when assignment exists (own mode)', async () => {
    assignmentFns.getGoogleAdsAuthAssignment.mockResolvedValue({
      assignmentMode: 'own',
      authType: 'oauth',
      userId: 2,
    })
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 2,
      dualStack: true,
      assignment: { assignmentMode: 'own', authType: 'oauth' },
      isShared: false,
      canModify: true,
      auth: { authType: 'oauth' as const },
      oauthCredentials: { refresh_token: 'rt', client_id: 'cid' },
      serviceAccountConfig: { id: 'sa-1' },
      oauthHasRefreshToken: true,
      serviceAccountConfigured: true,
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '2' }) })

    expect(res.status).toBe(200)
    expect(oauthFns.deleteGoogleAdsCredentials).toHaveBeenCalledWith(2)
    expect(serviceAccountFns.deleteAllGoogleAdsServiceAccountsForUser).toHaveBeenCalledWith(2)
    expect(assignmentFns.deleteGoogleAdsAuthAssignment).toHaveBeenCalledWith(2)
  })

  it('clears partial OAuth without refresh_token when no assignment', async () => {
    assignmentFns.getGoogleAdsAuthAssignment.mockResolvedValue(null)
    contextFns.getGoogleAdsAuthContextMetadata.mockResolvedValue({
      userId: 2,
      ownerUserId: 2,
      dualStack: false,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: {},
      oauthCredentials: { client_id: 'cid.apps.googleusercontent.com' },
      serviceAccountConfig: null,
      oauthHasRefreshToken: false,
      serviceAccountConfigured: false,
    })

    const req = new NextRequest('http://localhost/api/admin/users/2/google-ads-auth', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '2' }) })

    expect(res.status).toBe(200)
    expect(oauthFns.deleteGoogleAdsCredentials).toHaveBeenCalledWith(2)
  })
})
