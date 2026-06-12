import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/google-ads/service-account/route'

const authAssignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  assertNoConflictingGoogleAdsAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
}))

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: authAssignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  assertNoConflictingGoogleAdsAuth: authContextFns.assertNoConflictingGoogleAdsAuth,
  invalidateGoogleAdsAuthContextCache: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn(async () => ({
    authenticated: true,
    user: { userId: 7, email: 'u@test.com', role: 'user' },
  })),
  findUserById: vi.fn(async () => ({ id: 7, role: 'user' })),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => dbFns),
}))

vi.mock('@/lib/google-ads/service-account/service-account', () => ({
  parseServiceAccountJson: vi.fn(() => ({
    clientEmail: 'sa@test.iam.gserviceaccount.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
    projectId: 'proj',
  })),
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
}))

describe('POST /api/google-ads/service-account auth mutex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    authContextFns.assertNoConflictingGoogleAdsAuth.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue(undefined)
  })

  it('returns 409 when service account save conflicts with existing OAuth', async () => {
    authContextFns.assertNoConflictingGoogleAdsAuth.mockRejectedValueOnce(
      new Error('当前已配置 OAuth 认证，请先在设置页删除 OAuth 后再配置服务账号。')
    )

    const req = new NextRequest('http://localhost/api/google-ads/service-account', {
      method: 'POST',
      body: JSON.stringify({
        name: 'SA',
        mccCustomerId: '1234567890',
        developerToken: 'dev-token-123456',
        serviceAccountJson: '{}',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain('OAuth')
    expect(dbFns.exec).not.toHaveBeenCalled()
  })
})
