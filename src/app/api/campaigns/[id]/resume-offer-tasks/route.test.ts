import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/resume-offer-tasks/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const resumeFns = vi.hoisted(() => ({
  resumeOfferTasksOnCampaignEnable: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  resumeOfferTasksOnCampaignEnable: resumeFns.resumeOfferTasksOnCampaignEnable,
}))

describe('POST /api/campaigns/:id/resume-offer-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue({
      id: 1,
      offer_id: 1001,
      status: 'PAUSED',
      is_deleted: 0,
    })
    resumeFns.resumeOfferTasksOnCampaignEnable.mockResolvedValue({
      success: true,
      partialSuccess: false,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 1,
      urlSwapTasksUpdated: 0,
      errors: [],
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1/resume-offer-tasks', {
      method: 'POST',
    })

    const res = await POST(req, { params: { id: '1' } })
    expect(res.status).toBe(401)
  })

  it('returns 400 when campaign is not enabled', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      id: 1,
      offer_id: 1001,
      status: 'PAUSED',
      is_deleted: 0,
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/resume-offer-tasks', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('未启用')
    expect(resumeFns.resumeOfferTasksOnCampaignEnable).not.toHaveBeenCalled()
  })

  it('resumes offer tasks with batch defaults', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      id: 1,
      offer_id: 1001,
      status: 'ENABLED',
      is_deleted: 0,
    })

    const req = new NextRequest('http://localhost/api/campaigns/1/resume-offer-tasks', {
      method: 'POST',
      headers: { 'x-user-id': '7' },
    })

    const res = await POST(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(resumeFns.resumeOfferTasksOnCampaignEnable).toHaveBeenCalledWith(1001, 7)
    expect(data.success).toBe(true)
    expect(data.details).toEqual({
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 1,
      urlSwapTasksUpdated: 0,
    })
  })
})
