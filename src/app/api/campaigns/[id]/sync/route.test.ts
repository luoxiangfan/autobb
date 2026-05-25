import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/sync/route'

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
  updateCampaign: vi.fn(),
}))

const accountFns = vi.hoisted(() => ({
  findGoogleAdsAccountById: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  createGoogleAdsCampaign: vi.fn(),
}))

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
  updateCampaign: campaignFns.updateCampaign,
}))

vi.mock('@/lib/google-ads-accounts', () => ({
  findGoogleAdsAccountById: accountFns.findGoogleAdsAccountById,
}))

vi.mock('@/lib/google-ads-api', () => ({
  createGoogleAdsCampaign: adsFns.createGoogleAdsCampaign,
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  googleAdsApiAuthValidationErrorMessage: (reason: string) => reason,
  resolveGoogleAdsApiAuthForAccount: authContextFns.resolveGoogleAdsApiAuthForAccount,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: cacheFns.invalidateOfferCache,
}))

describe('POST /api/campaigns/:id/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    campaignFns.findCampaignById.mockResolvedValue({
      id: 19,
      userId: 7,
      offerId: 11,
      googleAdsAccountId: 9,
      campaignId: null,
      campaignName: 'Campaign A',
      budgetAmount: 20,
      budgetType: 'DAILY',
      targetCpa: null,
      maxCpc: 0.5,
      status: 'PAUSED',
      startDate: null,
      endDate: null,
      creationStatus: 'draft',
      creationError: null,
      lastSyncAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    campaignFns.updateCampaign.mockResolvedValue({
      id: 19,
      creationStatus: 'synced',
      campaignId: '99887766',
    })
    accountFns.findGoogleAdsAccountById.mockResolvedValue({
      id: 9,
      customerId: '1234567890',
      refreshToken: null,
      serviceAccountId: null,
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
    adsFns.createGoogleAdsCampaign.mockResolvedValue({
      campaignId: '99887766',
    })
  })

  it('returns 401 when x-user-id header is missing', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/19/sync', {
      method: 'POST',
    })

    const res = await POST(req, { params: { id: '19' } })
    expect(res.status).toBe(401)
  })

  it('syncs with shared oauth when account row has no refresh_token', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/19/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '19' } })
    expect(res.status).toBe(200)
    expect(adsFns.createGoogleAdsCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'shared-refresh-token' })
    )
  })

  it('returns 400 when shared oauth is not configured', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValueOnce({
      ok: false,
      reason: 'oauth_refresh_missing',
    })

    const req = new NextRequest('http://localhost/api/campaigns/19/sync', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '19' } })
    expect(res.status).toBe(400)
    expect(adsFns.createGoogleAdsCampaign).not.toHaveBeenCalled()
  })

  it('invalidates offer cache after successful sync', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/19/sync', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
      },
    })

    const res = await POST(req, { params: { id: '19' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(7, 11)
    expect(campaignFns.updateCampaign).toHaveBeenCalledTimes(2)
  })

  it('marks failed status and invalidates cache when sync fails', async () => {
    adsFns.createGoogleAdsCampaign.mockRejectedValueOnce(new Error('sync failed'))

    const req = new NextRequest('http://localhost/api/campaigns/19/sync', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
      },
    })

    const res = await POST(req, { params: { id: '19' } })
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.error).toContain('sync failed')
    expect(campaignFns.updateCampaign).toHaveBeenLastCalledWith(
      19,
      7,
      expect.objectContaining({
        creationStatus: 'failed',
      })
    )
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(7, 11)
  })
})
