import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  defaultPreparedGoogleAdsApiCallForLinkedAccount,
  hasConfiguredGoogleAdsAuthFromContextMock,
  resetCampaignRouteAuthMocksOAuth,
} from '@/__tests__/lib/helpers/campaign-route-auth-context-mock'
import { POST } from '@/app/api/campaigns/[id]/keywords/negatives/add/route'

const campaignRouteAuthFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}))

const adsFns = vi.hoisted(() => ({
  createGoogleAdsKeywordsBatch: vi.fn(),
}))

const oauthAccountsAuthFns = vi.hoisted(() => ({
  prepareGoogleAdsApiCallForLinkedAccount: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const { createWithAuthMock } =
    await import('@/__tests__/lib/helpers/campaign-route-with-auth-mock')
  return {
    verifyAuth: authFns.verifyAuth,
    withAuth: (handler: any, options?: { requireAdmin?: boolean }) =>
      createWithAuthMock(authFns.verifyAuth)(handler, options),
  }
})

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: vi.fn(async () => ({
      queryOne: dbFns.queryOne,
      query: dbFns.query,
      exec: dbFns.exec,
    })),
  }
})

vi.mock('@/lib/google-ads/api/api', () => ({
  createGoogleAdsKeywordsBatch: adsFns.createGoogleAdsKeywordsBatch,
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  getGoogleAdsAuthContext: campaignRouteAuthFns.getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext: hasConfiguredGoogleAdsAuthFromContextMock,
  resolveGoogleAdsApiAuthFromContext: campaignRouteAuthFns.resolveGoogleAdsApiAuthFromContext,
}))

vi.mock('@/lib/google-ads/accounts/auth/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/accounts/auth/index')>()
  return {
    ...actual,
    prepareGoogleAdsApiCallForLinkedAccount:
      oauthAccountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount,
  }
})

describe('POST /api/campaigns/:id/keywords/negatives/add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: {
        userId: 1,
        email: 'u@example.com',
        role: 'user',
        packageType: 'trial',
      },
    })
    resetCampaignRouteAuthMocksOAuth(campaignRouteAuthFns)
    oauthAccountsAuthFns.prepareGoogleAdsApiCallForLinkedAccount.mockResolvedValue(
      defaultPreparedGoogleAdsApiCallForLinkedAccount
    )
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns c')) {
        return {
          id: 12,
          campaign_name: 'Dreo_US_3653',
          status: 'ENABLED',
          is_deleted: 0,
          google_ads_account_id: 8,
          google_ad_group_id: '9001',
          customer_id: '1234567890',
          parent_mcc_id: null,
          service_account_id: null,
          account_is_active: 1,
          account_is_deleted: 0,
        }
      }
      if (sql.includes('FROM ad_groups')) {
        return {
          id: 701,
          ad_group_id: '9001',
        }
      }
      return undefined
    })
    dbFns.query.mockResolvedValue([])
    dbFns.exec.mockResolvedValue({ changes: 1, lastInsertRowid: 99 })
  })

  it('adds negative keywords with default EXACT match type', async () => {
    adsFns.createGoogleAdsKeywordsBatch
      .mockResolvedValueOnce([{ keywordId: 'n-1', resourceName: 'x', keywordText: 'free' }])
      .mockResolvedValueOnce([
        { keywordId: 'n-2', resourceName: 'y', keywordText: 'manual download' },
      ])

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/negatives/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['free', 'manual download'],
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: '12' }) })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.addedCount).toBe(2)
    expect(adsFns.createGoogleAdsKeywordsBatch).toHaveBeenCalledTimes(2)
    expect(adsFns.createGoogleAdsKeywordsBatch.mock.calls[0]?.[0]?.keywords?.[0]).toMatchObject({
      keywordText: 'free',
      isNegative: true,
      negativeKeywordMatchType: 'EXACT',
    })
    const hasConfigSync = dbFns.exec.mock.calls.some(
      (call: any[]) =>
        String(call?.[0] || '').includes('UPDATE campaigns') &&
        String(call?.[0] || '').includes('campaign_config')
    )
    expect(hasConfigSync).toBe(true)
  })
})
