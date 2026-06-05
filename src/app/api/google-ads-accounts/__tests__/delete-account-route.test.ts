import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/google-ads-accounts/[id]/route'

const accountFns = vi.hoisted(() => ({
  findGoogleAdsAccountById: vi.fn(),
  deleteGoogleAdsAccount: vi.fn(async () => true),
}))

const campaignListFns = vi.hoisted(() => ({
  listDeletableRemoteCampaignsForAccount: vi.fn(async () => [{ google_campaign_id: '9001' }]),
  limitDeletableRemoteCampaigns: vi.fn(
    (campaigns: { google_campaign_id: string }[], max: number) => ({
      selected: campaigns.slice(0, max),
      truncated: Math.max(0, campaigns.length - max),
      maxCampaigns: max,
    })
  ),
}))

const remoteFns = vi.hoisted(() => ({
  executeGoogleAdsCampaignRemoteActions: vi.fn(async () => ({
    planned: 1,
    attempted: 1,
    paused: 0,
    removed: 1,
    pausedFallback: 0,
    failed: 0,
    action: 'REMOVE' as const,
    executed: true,
    failures: [],
    truncated: 0,
    maxCampaigns: 50,
    timedOut: false,
    concurrency: 3,
  })),
}))

vi.mock('@/lib/google-ads-accounts', () => accountFns)
vi.mock('@/lib/google-ads-account-delete-campaigns', () => campaignListFns)
vi.mock('@/lib/google-ads-campaign-remote-actions', () => remoteFns)

describe('DELETE /api/google-ads-accounts/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accountFns.findGoogleAdsAccountById.mockResolvedValue({
      id: 9,
      customerId: '1234567890',
      parentMccId: null,
      isActive: true,
    })
  })

  it('returns remote removal summary when removeGoogleAdsCampaigns=true in body', async () => {
    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(accountFns.deleteGoogleAdsAccount).toHaveBeenCalledWith(9, 7)
    expect(remoteFns.executeGoogleAdsCampaignRemoteActions).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        shouldRemove: true,
        skipAccountEligibilityCheck: true,
      })
    )
    expect(data.data).toMatchObject({
      localDeleted: true,
      googleAds: {
        planned: 1,
        removed: 1,
        failed: 0,
        failures: [],
      },
    })
  })

  it('parses removeGoogleAdsCampaigns from query when body is empty', async () => {
    const req = new NextRequest(
      'http://localhost/api/google-ads-accounts/9?removeGoogleAdsCampaigns=true',
      {
        method: 'DELETE',
        headers: { 'x-user-id': '7' },
      }
    )

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    expect(res.status).toBe(200)
    expect(remoteFns.executeGoogleAdsCampaignRemoteActions).toHaveBeenCalled()
  })

  it('parses JSON body without Content-Type header', async () => {
    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    expect(res.status).toBe(200)
    expect(remoteFns.executeGoogleAdsCampaignRemoteActions).toHaveBeenCalled()
  })

  it('skips remote removal when removeGoogleAdsCampaigns is omitted', async () => {
    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(campaignListFns.listDeletableRemoteCampaignsForAccount).not.toHaveBeenCalled()
    expect(remoteFns.executeGoogleAdsCampaignRemoteActions).not.toHaveBeenCalled()
    expect(data.data.googleAds.action).toBe('NONE')
  })

  it('returns warnings when some remote removals fail', async () => {
    remoteFns.executeGoogleAdsCampaignRemoteActions.mockResolvedValueOnce({
      planned: 2,
      attempted: 2,
      paused: 0,
      removed: 1,
      pausedFallback: 0,
      failed: 1,
      action: 'REMOVE',
      executed: true,
      failures: [{ campaignId: '9002', reason: 'PERMISSION_DENIED' }],
    })

    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: { 'x-user-id': '7', 'content-type': 'application/json' },
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    const data = await res.json()

    expect(data.data.googleAds.failures).toHaveLength(1)
    expect(data.data.warnings).toEqual(
      expect.arrayContaining(['部分 Google Ads 远端广告系列删除失败，请查看 failures 明细'])
    )
  })

  it('runs remote removal before local delete', async () => {
    const callOrder: string[] = []
    remoteFns.executeGoogleAdsCampaignRemoteActions.mockImplementation(async () => {
      callOrder.push('remote')
      return {
        planned: 1,
        attempted: 1,
        paused: 0,
        removed: 1,
        pausedFallback: 0,
        failed: 0,
        action: 'REMOVE',
        executed: true,
        failures: [],
      }
    })
    accountFns.deleteGoogleAdsAccount.mockImplementation(async () => {
      callOrder.push('local')
      return true
    })

    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: { 'x-user-id': '7', 'content-type': 'application/json' },
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })

    await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    expect(callOrder).toEqual(['remote', 'local'])
  })

  it('returns localDeleted false with 500 when local delete fails after remote', async () => {
    accountFns.deleteGoogleAdsAccount.mockResolvedValueOnce(false)
    remoteFns.executeGoogleAdsCampaignRemoteActions.mockResolvedValueOnce({
      planned: 1,
      attempted: 1,
      paused: 0,
      removed: 1,
      pausedFallback: 0,
      failed: 0,
      action: 'REMOVE',
      executed: true,
      failures: [],
      truncated: 0,
      maxCampaigns: 50,
      timedOut: false,
      concurrency: 3,
    })

    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      headers: { 'x-user-id': '7', 'content-type': 'application/json' },
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: '9' }) })
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.data.localDeleted).toBe(false)
    expect(data.data.googleAds.removed).toBe(1)
    expect(data.data.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/本地账号删除失败/)])
    )
  })
})
