import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/offers/[id]/unlink/route'

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn(async () => ({ authenticated: true, user: { userId: 1 } }))
}))

vi.mock('@/lib/offers', () => ({
  unlinkOfferFromAccount: vi.fn(async () => ({ unlinkedCount: 1 }))
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => ({
      id: 9,
      customer_id: null,
      parent_mcc_id: null,
      is_active: 1,
      is_deleted: 0
    }))
  }))
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(async () => null),
  getUserAuthType: vi.fn(async () => ({ authType: 'oauth' }))
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: vi.fn()
}))

const { unlinkOfferFromAccount } = await import('@/lib/offers')

describe('POST /api/offers/:id/unlink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns googleAds.action=REMOVE when removeGoogleAdsCampaigns=true', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/unlink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 9, removeGoogleAdsCampaigns: true })
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(unlinkOfferFromAccount).toHaveBeenCalledWith(77, 9, 1)
    expect(data.data.googleAds.action).toBe('REMOVE')
  })

  it('defaults googleAds.action=PAUSE when removeGoogleAdsCampaigns=false', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/unlink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 9 })
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.googleAds.action).toBe('PAUSE')
  })
})
