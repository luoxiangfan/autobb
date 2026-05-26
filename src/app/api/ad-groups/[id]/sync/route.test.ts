import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { defaultOAuthGoogleAdsCallBundle } from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'
import { POST } from '@/app/api/ad-groups/[id]/sync/route'

const adGroupFns = vi.hoisted(() => ({
  findAdGroupById: vi.fn(),
  updateAdGroup: vi.fn(),
}))

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
}))

const accountFns = vi.hoisted(() => ({
  findGoogleAdsAccountById: vi.fn(),
}))

const keywordFns = vi.hoisted(() => ({
  findKeywordsByAdGroupId: vi.fn(),
  updateKeyword: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  createGoogleAdsAdGroup: vi.fn(),
  createGoogleAdsKeywordsBatch: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
}))

const oauthAccountsAuthFns = vi.hoisted(() => ({
  loadOAuthGoogleAdsCallBundleForContext: vi.fn(),
}))

vi.mock('@/lib/ad-groups', () => ({
  findAdGroupById: adGroupFns.findAdGroupById,
  updateAdGroup: adGroupFns.updateAdGroup,
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
}))

vi.mock('@/lib/google-ads-accounts', () => ({
  findGoogleAdsAccountById: accountFns.findGoogleAdsAccountById,
}))

vi.mock('@/lib/keywords', () => ({
  findKeywordsByAdGroupId: keywordFns.findKeywordsByAdGroupId,
  updateKeyword: keywordFns.updateKeyword,
}))

vi.mock('@/lib/google-ads-api', () => ({
  createGoogleAdsAdGroup: adsFns.createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch: adsFns.createGoogleAdsKeywordsBatch,
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  googleAdsApiAuthValidationErrorMessage: (reason: string) => reason,
  resolveGoogleAdsApiAuthForAccount: authContextFns.resolveGoogleAdsApiAuthForAccount,
}))

vi.mock('@/lib/google-ads-accounts-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-accounts-auth')>()
  return {
    ...actual,
    loadOAuthGoogleAdsCallBundleForContext: oauthAccountsAuthFns.loadOAuthGoogleAdsCallBundleForContext,
  }
})

describe('POST /api/ad-groups/:id/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adGroupFns.findAdGroupById.mockResolvedValue({
      id: 5,
      userId: 7,
      campaignId: 19,
      adGroupId: null,
      adGroupName: 'Ad Group A',
      maxCpc: 0.5,
      status: 'PAUSED',
    })
    campaignFns.findCampaignById.mockResolvedValue({
      id: 19,
      userId: 7,
      googleAdsAccountId: 9,
      campaignId: '99887766',
    })
    accountFns.findGoogleAdsAccountById.mockResolvedValue({
      id: 9,
      customerId: '1234567890',
      refreshToken: null,
      serviceAccountId: null,
      parentMccId: null,
    })
    oauthAccountsAuthFns.loadOAuthGoogleAdsCallBundleForContext.mockResolvedValue(
      defaultOAuthGoogleAdsCallBundle
    )
    keywordFns.findKeywordsByAdGroupId.mockResolvedValue([])
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { auth: { authType: 'oauth' } },
      apiAuth: {
        authType: 'oauth',
        refreshToken: 'shared-refresh-token',
        serviceAccountId: undefined,
      },
    })
    adsFns.createGoogleAdsAdGroup.mockResolvedValue({ adGroupId: '11223344' })
    adGroupFns.updateAdGroup.mockResolvedValue({ id: 5, adGroupId: '11223344' })
  })

  it('returns 401 when x-user-id header is missing', async () => {
    const req = new NextRequest('http://localhost/api/ad-groups/5/sync', {
      method: 'POST',
    })

    const res = await POST(req, { params: { id: '5' } })
    expect(res.status).toBe(401)
  })

  it('syncs with shared oauth when account row has no refresh_token', async () => {
    const req = new NextRequest('http://localhost/api/ad-groups/5/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '5' } })
    expect(res.status).toBe(200)
    expect(adsFns.createGoogleAdsAdGroup).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'shared-refresh-token' })
    )
  })

  it('returns 400 when shared oauth is not configured', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValueOnce({
      ok: false,
      reason: 'oauth_refresh_missing',
    })

    const req = new NextRequest('http://localhost/api/ad-groups/5/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '5' } })
    expect(res.status).toBe(400)
    expect(adsFns.createGoogleAdsAdGroup).not.toHaveBeenCalled()
  })
})
