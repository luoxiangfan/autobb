import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
  updateCampaign: vi.fn(),
}))

const googleAdsFns = vi.hoisted(() => ({
  updateGoogleAdsCampaignName: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
  updateCampaign: campaignFns.updateCampaign,
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignName: googleAdsFns.updateGoogleAdsCampaignName,
  getGoogleAdsCredentialsFromDB: googleAdsFns.getGoogleAdsCredentialsFromDB,
}))

const oauthFns = vi.hoisted(() => ({
  getGoogleAdsCredentials: vi.fn(),
  getUserAuthType: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
  getUserAuthType: oauthFns.getUserAuthType,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn().mockResolvedValue({
    queryOne: dbFns.queryOne,
  }),
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateDashboardCache: vi.fn(),
}))

function makeRequest(body: unknown, userId = '1') {
  return new NextRequest('http://localhost/api/campaigns/10/campaign-name', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/campaigns/:id/campaign-name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'token' })
    campaignFns.findCampaignById.mockResolvedValue({
      id: 10,
      campaignName: 'Old Name',
    })
    campaignFns.updateCampaign.mockResolvedValue({
      id: 10,
      campaignName: 'New Name',
    })
    dbFns.queryOne.mockResolvedValue({
      id: 10,
      campaign_id: null,
      google_campaign_id: null,
      google_ads_account_id: null,
      status: 'ENABLED',
      is_deleted: 0,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const response = await PUT(
      new NextRequest('http://localhost/api/campaigns/10/campaign-name', {
        method: 'PUT',
        body: JSON.stringify({ campaignName: 'New Name' }),
      }),
      { params: { id: '10' } }
    )
    expect(response.status).toBe(401)
  })

  it('returns 400 when campaign name is empty', async () => {
    const response = await PUT(makeRequest({ campaignName: '   ' }), { params: { id: '10' } })
    expect(response.status).toBe(400)
  })

  it('updates local campaign name for unpublished campaign', async () => {
    const response = await PUT(makeRequest({ campaignName: 'New Name' }), { params: { id: '10' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.syncedToGoogleAds).toBe(false)
    expect(campaignFns.updateCampaign).toHaveBeenCalledWith(10, 1, { campaignName: 'New Name' })
    expect(googleAdsFns.updateGoogleAdsCampaignName).not.toHaveBeenCalled()
  })

  it('returns existing campaign when name unchanged', async () => {
    campaignFns.findCampaignById.mockResolvedValue({
      id: 10,
      campaignName: 'Same Name',
    })

    const response = await PUT(makeRequest({ campaignName: 'Same Name' }), { params: { id: '10' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.syncedToGoogleAds).toBe(false)
    expect(campaignFns.updateCampaign).not.toHaveBeenCalled()
  })
})
