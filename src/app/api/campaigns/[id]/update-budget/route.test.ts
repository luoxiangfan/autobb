import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/campaigns/[id]/update-budget/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  updateGoogleAdsCampaignBudget: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getUserAuthType: vi.fn(),
  getGoogleAdsCredentials: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateOfferCache: vi.fn(),
  invalidateDashboardCache: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignBudget: adsFns.updateGoogleAdsCampaignBudget,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: oauthFns.getUserAuthType,
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: cacheFns.invalidateOfferCache,
  invalidateDashboardCache: cacheFns.invalidateDashboardCache,
}))

describe('PUT /api/campaigns/:id/update-budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
    })
    dbFns.exec.mockResolvedValue({ changes: 1 })
    adsFns.updateGoogleAdsCampaignBudget.mockResolvedValue(undefined)
  })

  it('returns 422 when local campaign id is used in path', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('AND c.google_campaign_id = ?')) {
        return undefined
      }
      if (sql.includes('WHERE user_id = ?') && sql.includes('AND id = ?')) {
        return {
          id: 1972,
          campaign_id: '23578044853',
          google_campaign_id: '23578044853',
          status: 'ENABLED',
          is_deleted: false,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/1972/update-budget', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        budgetAmount: 18,
        budgetType: 'DAILY',
      }),
    })

    const res = await PUT(req, { params: { id: '1972' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('USE_GOOGLE_CAMPAIGN_ID')
    expect(data.googleCampaignId).toBe('23578044853')
    expect(data.expectedPath).toBe('/api/campaigns/23578044853/update-budget')
  })

  it('updates campaign budget successfully', async () => {
    dbFns.queryOne.mockResolvedValue({
      local_campaign_id: 12,
      google_ads_account_id: 9,
      offer_id: 77,
      status: 'ENABLED',
      is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: '9988776655',
      account_is_active: true,
      account_is_deleted: false,
    })

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-budget', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        budgetAmount: 19.99,
        budgetType: 'DAILY',
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(adsFns.updateGoogleAdsCampaignBudget).toHaveBeenCalledWith({
      customerId: '1234567890',
      refreshToken: 'refresh-token',
      campaignId: '23578044853',
      budgetAmount: 19.99,
      budgetType: 'DAILY',
      accountId: 9,
      userId: 1,
      loginCustomerId: '9988776655',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(dbFns.exec).toHaveBeenCalled()
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(1, 77)
    expect(cacheFns.invalidateDashboardCache).not.toHaveBeenCalled()
  })

  it('falls back to oauth login_customer_id when parent_mcc_id is missing', async () => {
    dbFns.queryOne.mockResolvedValue({
      local_campaign_id: 12,
      google_ads_account_id: 9,
      offer_id: null,
      status: 'ENABLED',
      is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: null,
      account_is_active: true,
      account_is_deleted: false,
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
      login_customer_id: '1122334455',
    })

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-budget', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        budgetAmount: 20,
        budgetType: 'DAILY',
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(adsFns.updateGoogleAdsCampaignBudget).toHaveBeenCalledWith({
      customerId: '1234567890',
      refreshToken: 'refresh-token',
      campaignId: '23578044853',
      budgetAmount: 20,
      budgetType: 'DAILY',
      accountId: 9,
      userId: 1,
      loginCustomerId: '1122334455',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(cacheFns.invalidateDashboardCache).toHaveBeenCalledWith(1)
  })

  it('retries with next login_customer_id candidate on access error', async () => {
    dbFns.queryOne.mockResolvedValue({
      local_campaign_id: 12,
      google_ads_account_id: 9,
      offer_id: 55,
      status: 'ENABLED',
      is_deleted: false,
      customer_id: '1234567890',
      parent_mcc_id: '9988776655',
      account_is_active: true,
      account_is_deleted: false,
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
      login_customer_id: '1122334455',
    })
    adsFns.updateGoogleAdsCampaignBudget
      .mockRejectedValueOnce(
        new Error(
          "User doesn't have permission to access customer. Note: If you're accessing a client customer, the manager's customer id must be set in the 'login-customer-id' header."
        )
      )
      .mockResolvedValueOnce(undefined)

    const req = new NextRequest('http://localhost/api/campaigns/23578044853/update-budget', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        budgetAmount: 20,
        budgetType: 'DAILY',
      }),
    })

    const res = await PUT(req, { params: { id: '23578044853' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(adsFns.updateGoogleAdsCampaignBudget).toHaveBeenCalledTimes(2)
    expect(adsFns.updateGoogleAdsCampaignBudget).toHaveBeenNthCalledWith(1, {
      customerId: '1234567890',
      refreshToken: 'refresh-token',
      campaignId: '23578044853',
      budgetAmount: 20,
      budgetType: 'DAILY',
      accountId: 9,
      userId: 1,
      loginCustomerId: '9988776655',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(adsFns.updateGoogleAdsCampaignBudget).toHaveBeenNthCalledWith(2, {
      customerId: '1234567890',
      refreshToken: 'refresh-token',
      campaignId: '23578044853',
      budgetAmount: 20,
      budgetType: 'DAILY',
      accountId: 9,
      userId: 1,
      loginCustomerId: '1122334455',
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(1, 55)
  })
})
