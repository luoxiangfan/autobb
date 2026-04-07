import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/keywords/add/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}))

const dbState = vi.hoisted(() => ({
  type: 'sqlite' as 'sqlite' | 'postgres',
}))

const adsFns = vi.hoisted(() => ({
  createGoogleAdsKeywordsBatch: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getUserAuthType: vi.fn(),
  getGoogleAdsCredentials: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  promoteKeywordsToOfferKeywordPool: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: dbState.type,
    queryOne: dbFns.queryOne,
    query: dbFns.query,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  createGoogleAdsKeywordsBatch: adsFns.createGoogleAdsKeywordsBatch,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: oauthFns.getUserAuthType,
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  promoteKeywordsToOfferKeywordPool: keywordPoolFns.promoteKeywordsToOfferKeywordPool,
}))

describe('POST /api/campaigns/:id/keywords/add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.type = 'sqlite'

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: {
        userId: 1,
        email: 'u@example.com',
        role: 'user',
        packageType: 'trial',
      },
    })

    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'oauth',
      serviceAccountId: undefined,
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'oauth-refresh-token',
    })
    keywordPoolFns.promoteKeywordsToOfferKeywordPool.mockResolvedValue({
      promotedCount: 2,
      skippedCount: 0,
      poolCreated: false,
      poolUpdated: true,
    })

    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaigns c')) {
        return {
          id: 12,
          offer_id: 55,
          campaign_name: 'Dreo_US_3653',
          status: 'ENABLED',
          is_deleted: 0,
          google_ads_account_id: 8,
          google_ad_group_id: '9001',
          offer_brand: 'Dreo',
          customer_id: '1234567890',
          account_refresh_token: null,
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

  it('auto-selects match type for new keywords and persists created rows', async () => {
    adsFns.createGoogleAdsKeywordsBatch.mockResolvedValue([
      { keywordId: '1001', resourceName: 'x', keywordText: 'Dreo' },
      { keywordId: '1002', resourceName: 'y', keywordText: 'air conditioner deals' },
    ])

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['Dreo', 'air conditioner deals'],
      }),
    })

    const res = await POST(req, { params: { id: '12' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.addedCount).toBe(2)
    expect(payload.addedKeywords[0].matchType).toBe('EXACT')
    expect(adsFns.createGoogleAdsKeywordsBatch).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.promoteKeywordsToOfferKeywordPool).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.promoteKeywordsToOfferKeywordPool).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: 55,
        userId: 1,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
      })
    )
    const hasConfigSync = dbFns.exec.mock.calls.some(
      (call: any[]) => String(call?.[0] || '').includes('UPDATE campaigns')
        && String(call?.[0] || '').includes('campaign_config')
    )
    expect(hasConfigSync).toBe(true)
  })

  it('handles duplicate keyword errors gracefully with single-keyword fallback', async () => {
    adsFns.createGoogleAdsKeywordsBatch
      .mockRejectedValueOnce(new Error('RESOURCE_ALREADY_EXISTS: duplicate keyword'))
      .mockRejectedValueOnce(new Error('already exists'))
      .mockResolvedValueOnce([
        { keywordId: '2002', resourceName: 'z', keywordText: 'portable ac deals' },
      ])

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['Dreo', 'portable ac deals'],
      }),
    })

    const res = await POST(req, { params: { id: '12' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.addedCount).toBe(1)
    expect(payload.duplicateKeywords).toContain('Dreo')
    expect(adsFns.createGoogleAdsKeywordsBatch).toHaveBeenCalledTimes(3)
  })

  it('falls back to single-keyword retries for non-duplicate batch failures', async () => {
    adsFns.createGoogleAdsKeywordsBatch
      .mockRejectedValueOnce(new Error('Google Ads batch mutate failed'))
      .mockResolvedValueOnce([
        { keywordId: '3001', resourceName: 'r1', keywordText: 'Dreo' },
      ])
      .mockRejectedValueOnce(new Error('Keyword policy violation'))

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['Dreo', 'portable ac deals'],
      }),
    })

    const res = await POST(req, { params: { id: '12' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.addedCount).toBe(1)
    expect(payload.failures).toEqual([
      expect.objectContaining({
        keywordText: 'portable ac deals',
        message: 'Keyword policy violation',
      }),
    ])
    expect(adsFns.createGoogleAdsKeywordsBatch).toHaveBeenCalledTimes(3)
  })

  it('writes boolean flags for postgres keyword inserts', async () => {
    dbState.type = 'postgres'
    adsFns.createGoogleAdsKeywordsBatch.mockResolvedValue([
      { keywordId: '3001', resourceName: 'p', keywordText: 'Dreo official' },
    ])

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['Dreo official'],
      }),
    })

    const res = await POST(req, { params: { id: '12' } })
    expect(res.status).toBe(200)

    const insertCall = dbFns.exec.mock.calls.find(
      (call: any[]) => String(call?.[0] || '').includes('INSERT INTO keywords')
    )
    expect(insertCall).toBeTruthy()

    const insertParams = insertCall?.[1] as any[]
    expect(insertParams[6]).toBe(false)
    expect(insertParams[7]).toBe(false)
  })

  it('does not fail request when keyword-pool promotion fails', async () => {
    adsFns.createGoogleAdsKeywordsBatch.mockResolvedValue([
      { keywordId: '4001', resourceName: 'p', keywordText: 'Dreo heater' },
    ])
    keywordPoolFns.promoteKeywordsToOfferKeywordPool.mockRejectedValueOnce(new Error('pool update failed'))

    const req = new NextRequest('http://localhost/api/campaigns/12/keywords/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: ['Dreo heater'],
      }),
    })

    const res = await POST(req, { params: { id: '12' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.addedCount).toBe(1)
    expect(keywordPoolFns.promoteKeywordsToOfferKeywordPool).toHaveBeenCalledTimes(1)
  })
})
