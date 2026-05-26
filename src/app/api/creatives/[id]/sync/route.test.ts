import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  defaultOAuthGoogleAdsCallBundle,
  defaultPreparedGoogleAdsAccountApiCall,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'
import { POST } from '@/app/api/creatives/[id]/sync/route'

const creativeFns = vi.hoisted(() => ({
  findAdCreativeById: vi.fn(),
  updateAdCreative: vi.fn(),
}))

const adGroupFns = vi.hoisted(() => ({
  findAdGroupById: vi.fn(),
}))

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
}))

const accountFns = vi.hoisted(() => ({
  findGoogleAdsAccountById: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  createGoogleAdsResponsiveSearchAd: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
}))

const oauthAccountsAuthFns = vi.hoisted(() => ({
  loadOAuthGoogleAdsCallBundleForContext: vi.fn(),
  prepareGoogleAdsAccountApiCall: vi.fn(),
}))

vi.mock('@/lib/ad-creative', () => ({
  findAdCreativeById: creativeFns.findAdCreativeById,
  updateAdCreative: creativeFns.updateAdCreative,
}))

vi.mock('@/lib/ad-groups', () => ({
  findAdGroupById: adGroupFns.findAdGroupById,
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
}))

vi.mock('@/lib/google-ads-accounts', () => ({
  findGoogleAdsAccountById: accountFns.findGoogleAdsAccountById,
}))

vi.mock('@/lib/google-ads-api', () => ({
  createGoogleAdsResponsiveSearchAd: adsFns.createGoogleAdsResponsiveSearchAd,
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
    prepareGoogleAdsAccountApiCall: oauthAccountsAuthFns.prepareGoogleAdsAccountApiCall,
  }
})

describe('POST /api/creatives/:id/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    creativeFns.findAdCreativeById.mockResolvedValue({
      id: 3,
      userId: 7,
      ad_group_id: 5,
      ad_id: null,
      headlines: ['Headline One', 'Headline Two', 'Headline Three'],
      descriptions: ['Description one here.', 'Description two here.'],
      finalUrl: 'https://example.com',
      path1: null,
      path2: null,
    })
    adGroupFns.findAdGroupById.mockResolvedValue({
      id: 5,
      userId: 7,
      campaignId: 19,
      adGroupId: '11223344',
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
    oauthAccountsAuthFns.prepareGoogleAdsAccountApiCall.mockResolvedValue({
      ...defaultPreparedGoogleAdsAccountApiCall,
      apiAuth: {
        ...defaultPreparedGoogleAdsAccountApiCall.apiAuth,
        refreshToken: 'shared-refresh-token',
      },
      refreshToken: 'shared-refresh-token',
    })
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { auth: { authType: 'oauth' } },
      apiAuth: {
        authType: 'oauth',
        refreshToken: 'shared-refresh-token',
        serviceAccountId: undefined,
      },
    })
    adsFns.createGoogleAdsResponsiveSearchAd.mockResolvedValue({ adId: '55667788' })
    creativeFns.updateAdCreative.mockResolvedValue({ id: 3, ad_id: '55667788' })
  })

  it('returns 401 when x-user-id header is missing', async () => {
    const req = new NextRequest('http://localhost/api/creatives/3/sync', {
      method: 'POST',
    })

    const res = await POST(req, { params: { id: '3' } })
    expect(res.status).toBe(401)
  })

  it('syncs with shared oauth when account row has no refresh_token', async () => {
    const req = new NextRequest('http://localhost/api/creatives/3/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '3' } })
    expect(res.status).toBe(200)
    expect(adsFns.createGoogleAdsResponsiveSearchAd).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'shared-refresh-token' })
    )
  })

  it('returns 400 when shared oauth is not configured', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValueOnce({
      ok: false,
      reason: 'oauth_refresh_missing',
    })

    const req = new NextRequest('http://localhost/api/creatives/3/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '3' } })
    expect(res.status).toBe(400)
    expect(adsFns.createGoogleAdsResponsiveSearchAd).not.toHaveBeenCalled()
  })
})
