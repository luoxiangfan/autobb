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
  }
})

import { PUT } from '@/app/api/admin/users/[id]/google-ads-auth/route'
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
