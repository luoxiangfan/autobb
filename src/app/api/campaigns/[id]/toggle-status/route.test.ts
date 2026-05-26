import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  hasConfiguredGoogleAdsAuthFromContextMock,
  resetCampaignRouteAuthMocksOAuth,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'
import { PUT } from '@/app/api/campaigns/[id]/toggle-status/route'

const campaignRouteAuthFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const campaignFns = vi.hoisted(() => ({
  findCampaignById: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
}))

const transitionFns = vi.hoisted(() => ({
  applyCampaignTransition: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateDashboardCache: vi.fn(),
}))

const offerTaskFns = vi.hoisted(() => ({
  pauseOfferTasks: vi.fn(),
  resumeOfferTasksOnCampaignEnable: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: campaignFns.findCampaignById,
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: adsFns.updateGoogleAdsCampaignStatus,
}))

vi.mock('@/lib/google-ads-auth-context', () => ({
  getGoogleAdsAuthContext: campaignRouteAuthFns.getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext: hasConfiguredGoogleAdsAuthFromContextMock,
  resolveGoogleAdsApiAuthFromContext: campaignRouteAuthFns.resolveGoogleAdsApiAuthFromContext,
}))

vi.mock('@/lib/campaign-state-machine', () => ({
  applyCampaignTransition: transitionFns.applyCampaignTransition,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateDashboardCache: cacheFns.invalidateDashboardCache,
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  pauseOfferTasks: offerTaskFns.pauseOfferTasks,
  resumeOfferTasksOnCampaignEnable: offerTaskFns.resumeOfferTasksOnCampaignEnable,
}))

describe('PUT /api/campaigns/:id/toggle-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCampaignRouteAuthMocksOAuth(campaignRouteAuthFns)
    adsFns.updateGoogleAdsCampaignStatus.mockResolvedValue(undefined)
    transitionFns.applyCampaignTransition.mockResolvedValue({ updatedCount: 1 })
    offerTaskFns.pauseOfferTasks.mockResolvedValue({
      clickFarmTaskPaused: true,
      clickFarmTaskCount: 1,
      urlSwapTaskDisabled: true,
      urlSwapTaskCount: 1,
    })
    offerTaskFns.resumeOfferTasksOnCampaignEnable.mockResolvedValue({
      success: true,
      partialSuccess: false,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 1,
      errors: [],
    })
    campaignFns.findCampaignById.mockResolvedValue({
      id: 1,
      status: 'PAUSED',
    })
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns')) {
        return {
          id: 1,
          campaign_id: '1234567890',
          google_campaign_id: '1234567890',
          google_ads_account_id: 10,
          offer_id: 99,
          status: 'ENABLED',
          is_deleted: 0,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 10,
          customer_id: '1122334455',
          parent_mcc_id: null,
          service_account_id: null,
          is_active: 1,
          is_deleted: 0,
          status: 'ENABLED',
        }
      }
      return undefined
    })
  })

  it('returns 401 when missing user header', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })

    expect(res.status).toBe(401)
  })

  it('updates status and invalidates dashboard cache when succeeded', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.status).toBe('PAUSED')
    expect(data.offerTaskPause).toEqual({
      attempted: true,
      success: true,
      clickFarmTaskCount: 1,
      urlSwapTaskCount: 1,
    })
    expect(data.warnings).toEqual([])
    expect(adsFns.updateGoogleAdsCampaignStatus).toHaveBeenCalledWith({
      customerId: '1122334455',
      refreshToken: 'oauth-refresh-token',
      campaignId: '1234567890',
      status: 'PAUSED',
      accountId: 10,
      userId: 7,
      loginCustomerId: '9988776655',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(transitionFns.applyCampaignTransition).toHaveBeenCalledWith({
      userId: 7,
      campaignId: 1,
      action: 'TOGGLE_STATUS',
      payload: { status: 'PAUSED' },
    })
    expect(offerTaskFns.pauseOfferTasks).toHaveBeenCalledWith(
      99,
      7,
      'campaign_paused',
      '广告系列已暂停，自动暂停任务'
    )
    expect(cacheFns.invalidateDashboardCache).toHaveBeenCalledWith(7)
  })

  it('resumes offer tasks with defaults when next status is ENABLED', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'ENABLED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(offerTaskFns.pauseOfferTasks).not.toHaveBeenCalled()
    expect(offerTaskFns.resumeOfferTasksOnCampaignEnable).toHaveBeenCalledWith(99, 7)
    expect(data.offerTaskPause).toBeNull()
    expect(data.offerTaskResume).toEqual({
      attempted: true,
      success: true,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 1,
    })
    expect(data.warnings).toEqual([])
  })

  it('returns warning when resuming offer tasks fails partially', async () => {
    offerTaskFns.resumeOfferTasksOnCampaignEnable.mockResolvedValueOnce({
      success: false,
      partialSuccess: true,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
      errors: [{ offerId: 99, type: 'urlSwap', error: 'queue unavailable' }],
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'ENABLED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.offerTaskResume).toEqual({
      attempted: true,
      success: false,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
    })
    expect(data.warnings).toEqual([
      {
        code: 'OFFER_TASK_RESUME_FAILED',
        message: '换链接: queue unavailable',
      },
    ])
  })

  it('returns warning when pausing offer tasks fails', async () => {
    offerTaskFns.pauseOfferTasks.mockRejectedValueOnce(new Error('queue unavailable'))

    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.offerTaskPause).toEqual({ attempted: true, success: false })
    expect(data.warnings).toEqual([
      {
        code: 'OFFER_TASK_PAUSE_FAILED',
        message: 'queue unavailable',
      },
    ])
  })

  it('uses linked service account without requiring OAuth base credentials', async () => {
    campaignRouteAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 7,
      ownerUserId: 7,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-1', mccCustomerId: '2233445566' },
    })
    campaignRouteAuthFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account',
      refreshToken: '',
      serviceAccountId: 'sa-1',
      serviceAccountMccId: '2233445566',
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns')) {
        return {
          id: 1,
          campaign_id: '1234567890',
          google_campaign_id: '1234567890',
          google_ads_account_id: 10,
          status: 'ENABLED',
          is_deleted: 0,
        }
      }
      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 10,
          customer_id: '1122334455',
          parent_mcc_id: null,
          service_account_id: null,
          is_active: 1,
          is_deleted: 0,
          status: 'ENABLED',
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/toggle-status', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(adsFns.updateGoogleAdsCampaignStatus).toHaveBeenCalledWith({
      customerId: '1122334455',
      refreshToken: '',
      campaignId: '1234567890',
      status: 'PAUSED',
      accountId: 10,
      userId: 7,
      loginCustomerId: '2233445566',
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })
  })
})
