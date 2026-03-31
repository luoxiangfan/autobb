import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/offline/route'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => ({
    authenticated: true,
    user: {
      userId: 1,
      email: 'tester@example.com',
      role: 'user',
      packageType: 'trial',
    },
  })),
}))

const transitionFns = vi.hoisted(() => ({
  applyCampaignTransition: vi.fn(async () => ({ updatedCount: 1, matchedCampaignIds: [123] })),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    exec: dbFns.exec,
    query: dbFns.query,
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/campaign-state-machine', () => ({
  applyCampaignTransition: transitionFns.applyCampaignTransition,
}))

vi.mock('@/lib/url-swap', () => ({
  markUrlSwapTargetsRemovedByCampaignId: vi.fn(async () => {}),
  pauseUrlSwapTargetsByOfferId: vi.fn(async () => {}),
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(async () => ({ removedCount: 2, scannedCount: 10 })),
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(async () => ({ removedCount: 1, scannedCount: 6 })),
}))

vi.mock('@/lib/queue/init-queue', () => ({
  getOrCreateQueueManager: vi.fn(async () => ({
    getPendingTasks: vi.fn(async () => []),
    removeTask: vi.fn(async () => true),
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(async () => null),
  getCustomerWithCredentials: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(async () => null),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(async () => null),
}))

vi.mock('@/lib/google-ads-api-tracker', () => ({
  trackApiUsage: vi.fn(async () => {}),
  ApiOperationType: {
    MUTATE: 'mutate',
  },
}))

const { invalidateOfferCache } = await import('@/lib/api-cache')
const { removePendingClickFarmQueueTasksByTaskIds } = await import('@/lib/click-farm/queue-cleanup')
const { removePendingUrlSwapQueueTasksByTaskIds } = await import('@/lib/url-swap/queue-cleanup')
const { applyCampaignTransition } = await import('@/lib/campaign-state-machine')
const {
  updateGoogleAdsCampaignStatus,
  getGoogleAdsCredentialsFromDB,
  getCustomerWithCredentials,
} = await import('@/lib/google-ads-api')
const { getGoogleAdsCredentials } = await import('@/lib/google-ads-oauth')
const { getServiceAccountConfig } = await import('@/lib/google-ads-service-account')

describe('POST /api/campaigns/:id/offline', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: {
        userId: 1,
        email: 'tester@example.com',
        role: 'user',
        packageType: 'trial',
      },
    })
    dbFns.exec.mockResolvedValue({ changes: 1 })
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: null,
      parent_mcc_id: null,
      service_account_id: null,
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM click_farm_tasks') && sql.includes("status = 'paused'") && sql.includes("pause_reason = 'offline'")) {
        return [
          { id: 'cf-task-1' },
          { id: 'cf-task-2' },
        ]
      }
      if (sql.includes('FROM url_swap_tasks') && sql.includes("status = 'disabled'")) {
        return [
          { id: 'us-task-1' },
          { id: 'us-task-2' },
        ]
      }
      return []
    })
  })

  it('cleans click-farm queue by task IDs when pauseClickFarmTasks is true', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pauseClickFarmTasks: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.clickFarmPaused).toBe(1)
    expect(vi.mocked(applyCampaignTransition)).toHaveBeenCalledWith({
      userId: 1,
      campaignId: 123,
      action: 'OFFLINE',
    })
    expect(vi.mocked(invalidateOfferCache)).toHaveBeenCalledWith(1, 777)
    expect(vi.mocked(removePendingClickFarmQueueTasksByTaskIds)).toHaveBeenCalledWith(['cf-task-1', 'cf-task-2'], 1)
  })

  it('cleans url-swap queue by task IDs when pauseUrlSwapTasks is true', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pauseUrlSwapTasks: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.urlSwapPaused).toBe(1)
    expect(vi.mocked(removePendingUrlSwapQueueTasksByTaskIds)).toHaveBeenCalledWith(['us-task-1', 'us-task-2'], 1)
  })

  it('waitRemote=true executes google ads update synchronously and returns completed summary', async () => {
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: null,
      service_account_id: null,
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })
    vi.mocked(getGoogleAdsCredentialsFromDB).mockResolvedValue({
      useServiceAccount: false,
      login_customer_id: null,
    } as any)
    vi.mocked(getGoogleAdsCredentials).mockResolvedValue({
      refresh_token: 'rtok',
    } as any)
    vi.mocked(updateGoogleAdsCampaignStatus).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        waitRemote: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.googleAds.queued).toBe(false)
    expect(data.googleAds.planned).toBe(1)
    expect(data.googleAds.paused).toBe(1)
    expect(data.googleAds.failed).toBe(0)
    expect(vi.mocked(updateGoogleAdsCampaignStatus)).toHaveBeenCalled()
  })

  it('waitRemote=true reports google ads failures in response summary', async () => {
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: null,
      service_account_id: null,
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })
    vi.mocked(getGoogleAdsCredentialsFromDB).mockResolvedValue({
      useServiceAccount: false,
      login_customer_id: null,
    } as any)
    vi.mocked(getGoogleAdsCredentials).mockResolvedValue({
      refresh_token: 'rtok',
    } as any)
    vi.mocked(updateGoogleAdsCampaignStatus).mockRejectedValue(new Error('quota limited'))

    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        waitRemote: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.googleAds.queued).toBe(false)
    expect(data.googleAds.failed).toBe(1)
    expect(Array.isArray(data.googleAds.errors)).toBe(true)
    expect(String(data.googleAds.errors?.[0] || '')).toContain('quota limited')
  })

  it('waitRemote=true falls back to pause when remove fails', async () => {
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: null,
      service_account_id: null,
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })
    vi.mocked(getGoogleAdsCredentialsFromDB).mockResolvedValue({
      useServiceAccount: false,
      login_customer_id: null,
    } as any)
    vi.mocked(getGoogleAdsCredentials).mockResolvedValue({
      refresh_token: 'rtok',
    } as any)
    vi.mocked(getCustomerWithCredentials).mockResolvedValue({
      campaigns: {
        remove: vi.fn(async () => {
          throw new Error('remove rejected')
        }),
      },
    } as any)
    vi.mocked(updateGoogleAdsCampaignStatus).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        waitRemote: true,
        removeGoogleAdsCampaign: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.googleAds.action).toBe('REMOVE')
    expect(data.googleAds.planned).toBe(1)
    expect(data.googleAds.removed).toBe(0)
    expect(data.googleAds.pausedFallback).toBe(1)
    expect(data.googleAds.failed).toBe(0)
    expect(vi.mocked(updateGoogleAdsCampaignStatus)).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: '999000111',
        status: 'PAUSED',
      })
    )
  })

  it('waitRemote=true uses linked service account without requiring OAuth base credentials', async () => {
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: null,
      service_account_id: 'sa-1',
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })
    vi.mocked(getServiceAccountConfig).mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '2233445566',
    } as any)
    vi.mocked(updateGoogleAdsCampaignStatus).mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        waitRemote: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.googleAds.paused).toBe(1)
    expect(vi.mocked(getGoogleAdsCredentialsFromDB)).not.toHaveBeenCalled()
    expect(vi.mocked(getGoogleAdsCredentials)).not.toHaveBeenCalled()
    expect(vi.mocked(getServiceAccountConfig)).toHaveBeenCalledWith(1, 'sa-1')
    expect(vi.mocked(updateGoogleAdsCampaignStatus)).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: '999000111',
        authType: 'service_account',
        serviceAccountId: 'sa-1',
      })
    )
  })
})
