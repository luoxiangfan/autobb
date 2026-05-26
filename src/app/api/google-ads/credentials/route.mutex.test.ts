import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/google-ads/credentials/route'

const authAssignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  assertNoConflictingGoogleAdsAuth: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  saveGoogleAdsCredentials: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: authAssignmentFns.assertUserCanModifyGoogleAdsAuth,
  isGoogleAdsAuthShared: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  assertNoConflictingGoogleAdsAuth: authContextFns.assertNoConflictingGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  saveGoogleAdsCredentials: oauthFns.saveGoogleAdsCredentials,
  getGoogleAdsCredentials: vi.fn(),
  deleteGoogleAdsCredentials: vi.fn(),
  verifyGoogleAdsCredentials: vi.fn(),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-access-level-detector', () => ({
  updateApiAccessLevel: vi.fn(),
}))

describe('POST /api/google-ads/credentials auth mutex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAssignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    authContextFns.assertNoConflictingGoogleAdsAuth.mockResolvedValue(undefined)
    oauthFns.saveGoogleAdsCredentials.mockResolvedValue({ id: 1 })
  })

  it('returns 409 when OAuth save conflicts with existing service account', async () => {
    authContextFns.assertNoConflictingGoogleAdsAuth.mockRejectedValueOnce(
      new Error('当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。')
    )

    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
      body: JSON.stringify({
        client_id: 'cid',
        client_secret: 'secret',
        refresh_token: 'rt',
        developer_token: 'dev-token-123456',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain('服务账号')
    expect(oauthFns.saveGoogleAdsCredentials).not.toHaveBeenCalled()
  })
})
