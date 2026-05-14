import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  query: vi.fn(),
}))

const clickFarmFns = vi.hoisted(() => ({
  createClickFarmTask: vi.fn(),
  updateClickFarmTask: vi.fn(),
  restartClickFarmTask: vi.fn(),
  getClickFarmTaskByOfferId: vi.fn(),
}))

const urlSwapFns = vi.hoisted(() => ({
  createUrlSwapTask: vi.fn(),
  updateUrlSwapTask: vi.fn(),
  enableUrlSwapTask: vi.fn(),
  getUrlSwapTaskByOfferId: vi.fn(),
}))

const utilFns = vi.hoisted(() => ({
  balanceDistribution: vi.fn(),
  getTimezoneByCountry: vi.fn(),
  getDateInTimezone: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/click-farm', () => ({
  createClickFarmTask: clickFarmFns.createClickFarmTask,
  updateClickFarmTask: clickFarmFns.updateClickFarmTask,
  restartClickFarmTask: clickFarmFns.restartClickFarmTask,
  getClickFarmTaskByOfferId: clickFarmFns.getClickFarmTaskByOfferId,
}))

vi.mock('@/lib/url-swap', () => ({
  createUrlSwapTask: urlSwapFns.createUrlSwapTask,
  updateUrlSwapTask: urlSwapFns.updateUrlSwapTask,
  enableUrlSwapTask: urlSwapFns.enableUrlSwapTask,
  getUrlSwapTaskByOfferId: urlSwapFns.getUrlSwapTaskByOfferId,
}))

vi.mock('@/lib/click-farm/distribution', () => ({
  balanceDistribution: utilFns.balanceDistribution,
}))

vi.mock('@/lib/timezone-utils', () => ({
  getTimezoneByCountry: utilFns.getTimezoneByCountry,
  getDateInTimezone: utilFns.getDateInTimezone,
}))

import { POST } from '@/app/api/campaigns/batch-start-tasks/route'

describe('POST /api/campaigns/batch-start-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 11 },
    })

    dbFns.getDatabase.mockResolvedValue({
      query: dbFns.query,
    })

    dbFns.query.mockResolvedValue([
      {
        offer_id: 201,
        offer_url: 'https://example.com/offer-201',
        affiliate_link: 'https://aff.example.com/201',
        target_country: 'US',
      },
    ])

    utilFns.balanceDistribution.mockReturnValue([2, 2, 2])
    utilFns.getTimezoneByCountry.mockReturnValue('America/New_York')
    utilFns.getDateInTimezone.mockReturnValue('2026-01-01')
  })

  it('creates new tasks when existing tasks are completed', async () => {
    clickFarmFns.getClickFarmTaskByOfferId.mockResolvedValue({
      id: 'cf-completed',
      status: 'completed',
    })
    urlSwapFns.getUrlSwapTaskByOfferId.mockResolvedValue({
      id: 'us-completed',
      status: 'completed',
    })
    clickFarmFns.createClickFarmTask.mockResolvedValue({})
    urlSwapFns.createUrlSwapTask.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/campaigns/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campaignIds: [301],
        enableClickFarm: true,
        enableUrlSwap: true,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(clickFarmFns.createClickFarmTask).toHaveBeenCalledTimes(1)
    expect(urlSwapFns.createUrlSwapTask).toHaveBeenCalledTimes(1)
    expect(clickFarmFns.updateClickFarmTask).not.toHaveBeenCalled()
    expect(clickFarmFns.restartClickFarmTask).not.toHaveBeenCalled()
    expect(urlSwapFns.updateUrlSwapTask).not.toHaveBeenCalled()
    expect(urlSwapFns.enableUrlSwapTask).not.toHaveBeenCalled()
    expect(data.data).toMatchObject({
      selectionIdKind: 'campaign',
      requestedCount: 1,
      requestedIdsCount: 1,
      matchedOfferCount: 1,
      unmatchedIdsCount: 0,
      failedOfferCount: 0,
      partialSuccess: false,
      clickFarmTasksCreated: 1,
      urlSwapTasksCreated: 1,
      errors: [],
    })
  })

  it('returns structured failure payload when all operations fail', async () => {
    clickFarmFns.getClickFarmTaskByOfferId.mockResolvedValue({
      id: 'cf-failed',
      status: 'running',
    })
    urlSwapFns.getUrlSwapTaskByOfferId.mockResolvedValue({
      id: 'us-failed',
      status: 'enabled',
    })
    clickFarmFns.updateClickFarmTask.mockRejectedValue(new Error('click-farm failed'))
    urlSwapFns.updateUrlSwapTask.mockRejectedValue(new Error('url-swap failed'))

    const req = new NextRequest('http://localhost/api/campaigns/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campaignIds: [301],
        enableClickFarm: true,
        enableUrlSwap: true,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.success).toBe(false)
    expect(data.partialSuccess).toBe(false)
    expect(data.data).toMatchObject({
      selectionIdKind: 'campaign',
      requestedCount: 1,
      requestedIdsCount: 1,
      matchedOfferCount: 1,
      unmatchedIdsCount: 0,
      failedOfferCount: 1,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 0,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
    })
    expect(Array.isArray(data.data.errors)).toBe(true)
    expect(data.data.errors).toHaveLength(2)
  })

  it('returns 400 when both task types are disabled', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campaignIds: [301],
        enableClickFarm: false,
        enableUrlSwap: false,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/任务类型/)
    expect(dbFns.query).not.toHaveBeenCalled()
  })

  it('returns 400 when both flags are JSON string false', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        campaignIds: [301],
        enableClickFarm: 'false',
        enableUrlSwap: 'false',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(dbFns.query).not.toHaveBeenCalled()
  })
})
