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
  generateDefaultDistribution: vi.fn(),
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
  generateDefaultDistribution: utilFns.generateDefaultDistribution,
}))

vi.mock('@/lib/timezone-utils', () => ({
  getTimezoneByCountry: utilFns.getTimezoneByCountry,
  getDateInTimezone: utilFns.getDateInTimezone,
}))

import { POST } from '@/app/api/offers/batch-start-tasks/route'

describe('POST /api/offers/batch-start-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    dbFns.getDatabase.mockResolvedValue({
      query: dbFns.query,
    })

    dbFns.query.mockResolvedValue([
      {
        id: 101,
        offer_url: 'https://example.com/offer-101',
        affiliate_link: 'https://aff.example.com/101',
        target_country: 'US',
      },
    ])

    utilFns.generateDefaultDistribution.mockReturnValue([1, 2, 3])
    utilFns.getTimezoneByCountry.mockReturnValue('America/New_York')
    utilFns.getDateInTimezone.mockReturnValue('2026-01-01')
  })

  it('restarts paused click-farm task and enables disabled url-swap task', async () => {
    clickFarmFns.getClickFarmTaskByOfferId.mockResolvedValue({
      id: 'cf-task-1',
      status: 'paused',
    })
    urlSwapFns.getUrlSwapTaskByOfferId.mockResolvedValue({
      id: 'us-task-1',
      status: 'disabled',
    })
    clickFarmFns.updateClickFarmTask.mockResolvedValue({})
    clickFarmFns.restartClickFarmTask.mockResolvedValue({})
    urlSwapFns.updateUrlSwapTask.mockResolvedValue({})
    urlSwapFns.enableUrlSwapTask.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/offers/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerIds: [101],
        enableClickFarm: true,
        enableUrlSwap: true,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(clickFarmFns.updateClickFarmTask).toHaveBeenCalledTimes(1)
    expect(clickFarmFns.restartClickFarmTask).toHaveBeenCalledWith('cf-task-1', 7)
    expect(urlSwapFns.updateUrlSwapTask).toHaveBeenCalledTimes(1)
    expect(urlSwapFns.enableUrlSwapTask).toHaveBeenCalledWith('us-task-1', 7)
    expect(clickFarmFns.createClickFarmTask).not.toHaveBeenCalled()
    expect(urlSwapFns.createUrlSwapTask).not.toHaveBeenCalled()
    expect(data.data).toMatchObject({
      requestedCount: 1,
      requestedIdsCount: 1,
      matchedOfferCount: 1,
      failedOfferCount: 0,
      partialSuccess: false,
      clickFarmTasksUpdated: 1,
      urlSwapTasksUpdated: 1,
      errors: [],
    })
  })

  it('uses timezone-local scheduled date instead of UTC date boundary', async () => {
    clickFarmFns.getClickFarmTaskByOfferId.mockResolvedValue({
      id: 'cf-task-2',
      status: 'running',
    })
    urlSwapFns.getUrlSwapTaskByOfferId.mockResolvedValue(null)
    clickFarmFns.updateClickFarmTask.mockResolvedValue({})
    urlSwapFns.createUrlSwapTask.mockResolvedValue({})
    utilFns.getTimezoneByCountry.mockReturnValue('America/New_York')
    utilFns.getDateInTimezone.mockReturnValue('2025-12-31')

    const req = new NextRequest('http://localhost/api/offers/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerIds: [101],
        enableClickFarm: true,
        enableUrlSwap: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(utilFns.getDateInTimezone).toHaveBeenCalledWith(expect.any(Date), 'America/New_York')
    expect(clickFarmFns.updateClickFarmTask).toHaveBeenCalledWith(
      'cf-task-2',
      7,
      expect.objectContaining({
        scheduled_start_date: '2025-12-31',
      })
    )
  })

  it('returns 400 when both task types are disabled', async () => {
    const req = new NextRequest('http://localhost/api/offers/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerIds: [101],
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
})
