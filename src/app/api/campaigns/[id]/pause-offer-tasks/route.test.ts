import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/pause-offer-tasks/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const pauseFns = vi.hoisted(() => ({
  pauseOfferTasks: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  pauseOfferTasks: pauseFns.pauseOfferTasks,
}))

describe('POST /api/campaigns/:id/pause-offer-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue({
      id: 1,
      offer_id: 1001,
      user_id: 7,
      status: 'PAUSED',
      is_deleted: 0,
    })
    pauseFns.pauseOfferTasks.mockResolvedValue({
      clickFarmTaskPaused: true,
      clickFarmTaskCount: 2,
      urlSwapTaskDisabled: true,
      urlSwapTaskCount: 1,
    })
  })

  it('returns 401 when missing user header', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/pause-offer-tasks', {
      method: 'POST',
    })

    const res = await POST(req, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('reuses pauseOfferTasks and returns success details', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/pause-offer-tasks', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
      },
    })

    const res = await POST(req, { params: Promise.resolve({ id: '1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(pauseFns.pauseOfferTasks).toHaveBeenCalledWith(
      1001,
      7,
      'manual',
      '用户通过广告系列页面手动暂停'
    )
    expect(data).toEqual({
      success: true,
      message: '任务暂停完成',
      details: {
        clickFarmTask: '已暂停',
        clickFarmTaskCount: 2,
        urlSwapTask: '已禁用',
        urlSwapTaskCount: 1,
      },
    })
  })

  it('returns 400 when campaign is deleted or removed', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      id: 1,
      offer_id: 1001,
      user_id: 7,
      status: 'REMOVED',
      is_deleted: 0,
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/pause-offer-tasks', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
      },
    })

    const res = await POST(req, { params: Promise.resolve({ id: '1' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('已删除/移除')
    expect(pauseFns.pauseOfferTasks).not.toHaveBeenCalled()
  })
})
