import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/route'

const campaignFns = vi.hoisted(() => ({
  createCampaign: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const adsAccountFns = vi.hoisted(() => ({
  findGoogleAdsAccountById: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/campaigns', () => ({
  createCampaign: campaignFns.createCampaign,
  findCampaignsByUserId: vi.fn(),
  findCampaignsByOfferId: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/google-ads-accounts', () => ({
  findGoogleAdsAccountById: adsAccountFns.findGoogleAdsAccountById,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: cacheFns.invalidateOfferCache,
}))

describe('POST /api/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    offerFns.findOfferById.mockResolvedValue({ id: 11, brand: 'Demo offer' })
    adsAccountFns.findGoogleAdsAccountById.mockResolvedValue({ id: 22, customerId: '1234567890' })
    campaignFns.createCampaign.mockResolvedValue({
      id: 101,
      userId: 7,
      offerId: 11,
      googleAdsAccountId: 22,
      campaignName: 'Demo Campaign',
      budgetAmount: 19.99,
      budgetType: 'DAILY',
      status: 'PAUSED',
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    })
  })

  it('returns 401 when user id header is missing', async () => {
    const req = new NextRequest('http://localhost/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('creates campaign and invalidates offer/dashboard cache', async () => {
    const req = new NextRequest('http://localhost/api/campaigns', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        offerId: 11,
        googleAdsAccountId: 22,
        campaignName: 'Demo Campaign',
        budgetAmount: 19.99,
        budgetType: 'DAILY',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(campaignFns.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      offerId: 11,
      googleAdsAccountId: 22,
      campaignName: 'Demo Campaign',
      budgetAmount: 19.99,
      budgetType: 'DAILY',
    }))
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(7, 11)
  })

  it('returns 404 when offer does not exist', async () => {
    offerFns.findOfferById.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/campaigns', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        offerId: 11,
        googleAdsAccountId: 22,
        campaignName: 'Demo Campaign',
        budgetAmount: 19.99,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toBe('Offer不存在或无权访问')
    expect(cacheFns.invalidateOfferCache).not.toHaveBeenCalled()
  })
})
