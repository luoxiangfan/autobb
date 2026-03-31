import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/active-brand-snapshot/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const campaignsFns = vi.hoisted(() => ({
  queryActiveCampaigns: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/active-campaigns-query', () => ({
  queryActiveCampaigns: campaignsFns.queryActiveCampaigns,
}))

describe('GET /api/campaigns/active-brand-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 11 },
    })

    campaignsFns.queryActiveCampaigns.mockResolvedValue({
      ownCampaigns: [{ id: '1001', name: '101-301-NIKE-Search', status: 'ENABLED' }],
      manualCampaigns: [{ id: '2001', name: 'Manual Campaign', status: 'ENABLED' }],
      otherCampaigns: [{ id: '1002', name: '102-302-ADIDAS-Search', status: 'ENABLED' }],
      total: { enabled: 3, own: 1, manual: 1, other: 1 },
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/active-brand-snapshot?accountId=9')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid accountId', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/active-brand-snapshot?accountId=0')
    const res = await GET(req)

    expect(res.status).toBe(400)
  })

  it('returns brand snapshot and safety flags', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/active-brand-snapshot?accountId=9')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.totalEnabledCampaigns).toBe(3)
    expect(data.data.knownBrandCount).toBe(2)
    expect(data.data.hasUnknownBrand).toBe(true)
    expect(data.data.isSingleBrandSafe).toBe(false)
    expect(campaignsFns.queryActiveCampaigns).toHaveBeenCalledWith(0, 9, 11)
  })
})
