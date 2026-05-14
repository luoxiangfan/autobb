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

describe('POST /api/offers/batch-start-tasks integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 42 },
    })
    dbFns.getDatabase.mockResolvedValue({
      query: dbFns.query,
    })
    dbFns.query.mockResolvedValue([
      { id: 101, target_country: 'US' },
      { id: 102, target_country: 'US' },
    ])

    utilFns.generateDefaultDistribution.mockReturnValue([1, 2, 3])
    utilFns.getTimezoneByCountry.mockReturnValue('America/New_York')
    utilFns.getDateInTimezone.mockReturnValue('2026-01-01')
  })

  it('returns structured partial-success payload with failedItemsByType aggregation', async () => {
    clickFarmFns.getClickFarmTaskByOfferId.mockImplementation(async (offerId: number) => ({
      id: `cf-${offerId}`,
      status: 'running',
    }))
    urlSwapFns.getUrlSwapTaskByOfferId.mockResolvedValue(null)

    clickFarmFns.updateClickFarmTask.mockImplementation(async (taskId: string) => {
      if (taskId === 'cf-101') throw new Error('click-farm unavailable')
      return {}
    })
    urlSwapFns.createUrlSwapTask.mockImplementation(async (userId: number, payload: { offer_id: number }) => {
      if (payload.offer_id === 101) throw new Error('missing campaign mapping')
      return {}
    })

    const req = new NextRequest('http://localhost/api/offers/batch-start-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerIds: [101, 102],
        enableClickFarm: true,
        enableUrlSwap: true,
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(207)
    expect(data.success).toBe(false)
    expect(data.partialSuccess).toBe(true)
    expect(data.data).toMatchObject({
      requestedCount: 2,
      requestedIdsCount: 2,
      matchedOfferCount: 2,
      failedOfferCount: 1,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 1,
      failedItemsByType: {
        clickFarm: 1,
        urlSwap: 1,
        general: 0,
      },
    })
    expect(Array.isArray(data.data.errors)).toBe(true)
    expect(data.data.errors).toHaveLength(2)
  })
})
