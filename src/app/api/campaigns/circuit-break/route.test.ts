import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/circuit-break/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const campaignsFns = vi.hoisted(() => ({
  queryActiveCampaigns: vi.fn(),
  pauseCampaigns: vi.fn(),
}))

const actionLogFns = vi.hoisted(() => ({
  recordOpenclawAction: vi.fn(),
}))

const transitionFns = vi.hoisted(() => ({
  applyCampaignTransitionByGoogleCampaignIds: vi.fn(async () => ({
    updatedCount: 3,
    matchedCampaignIds: [1, 2, 3],
  })),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/active-campaigns-query', () => ({
  queryActiveCampaigns: campaignsFns.queryActiveCampaigns,
  pauseCampaigns: campaignsFns.pauseCampaigns,
}))

vi.mock('@/lib/openclaw/action-logs', () => ({
  recordOpenclawAction: actionLogFns.recordOpenclawAction,
}))

vi.mock('@/lib/campaign-state-machine', () => ({
  applyCampaignTransitionByGoogleCampaignIds: transitionFns.applyCampaignTransitionByGoogleCampaignIds,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: cacheFns.invalidateOfferCache,
}))

describe('POST /api/campaigns/circuit-break', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    campaignsFns.queryActiveCampaigns.mockResolvedValue({
      ownCampaigns: [{ id: '1001', name: 'Own A', status: 'ENABLED' }],
      manualCampaigns: [{ id: '1002', name: 'Manual B', status: 'ENABLED' }],
      otherCampaigns: [{ id: '1003', name: 'Other C', status: 'ENABLED' }],
      total: { enabled: 3, own: 1, manual: 1, other: 1 },
    })

    campaignsFns.pauseCampaigns.mockResolvedValue({
      attemptedCount: 3,
      pausedCount: 3,
      failedCount: 0,
      failures: [],
    })

    transitionFns.applyCampaignTransitionByGoogleCampaignIds.mockResolvedValue({
      updatedCount: 3,
      matchedCampaignIds: [1, 2, 3],
    })
    actionLogFns.recordOpenclawAction.mockResolvedValue(undefined)
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/circuit-break', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 9 }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid accountId', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/circuit-break', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 0 }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('supports dryRun preview without pausing', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/circuit-break', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 9, dryRun: true }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.dryRun).toBe(true)
    expect(data.data.summary.enabledCampaigns).toBe(3)
    expect(campaignsFns.pauseCampaigns).not.toHaveBeenCalled()
    expect(transitionFns.applyCampaignTransitionByGoogleCampaignIds).not.toHaveBeenCalled()
    expect(cacheFns.invalidateOfferCache).not.toHaveBeenCalled()
  })

  it('pauses campaigns and syncs local status', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/circuit-break', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 9, reason: 'daily_spend_cap', source: 'openclaw-strategy' }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.result.pausedCount).toBe(3)
    expect(campaignsFns.pauseCampaigns).toHaveBeenCalledWith(expect.any(Array), 9, 7)
    expect(transitionFns.applyCampaignTransitionByGoogleCampaignIds).toHaveBeenCalledTimes(1)
    expect(actionLogFns.recordOpenclawAction).toHaveBeenCalled()
    expect(cacheFns.invalidateOfferCache).toHaveBeenCalledWith(7)
  })
})
