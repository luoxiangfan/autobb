import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PUT } from '@/app/api/campaigns/[id]/route'

const campaignFns = vi.hoisted(() => ({
  updateCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateDashboardCache: vi.fn(),
}))

vi.mock('@/lib/campaigns', () => ({
  findCampaignById: vi.fn(),
  updateCampaign: campaignFns.updateCampaign,
  deleteCampaign: campaignFns.deleteCampaign,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateDashboardCache: cacheFns.invalidateDashboardCache,
}))

describe('/api/campaigns/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('DELETE returns 401 when missing user header', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1', {
      method: 'DELETE',
    })

    const res = await DELETE(req, { params: { id: '1' } })
    expect(res.status).toBe(401)
  })

  it('PUT returns 401 when missing user header', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED' }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    expect(res.status).toBe(401)
  })

  it('PUT invalidates dashboard cache when update succeeds', async () => {
    campaignFns.updateCampaign.mockResolvedValue({
      id: 1,
      campaignName: 'Demo campaign',
      status: 'PAUSED',
    })

    const req = new NextRequest('http://localhost/api/campaigns/1', {
      method: 'PUT',
      headers: {
        'x-user-id': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        campaignName: 'Demo campaign',
        status: 'PAUSED',
      }),
    })

    const res = await PUT(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(campaignFns.updateCampaign).toHaveBeenCalledWith(1, 7, {
      campaignName: 'Demo campaign',
      status: 'PAUSED',
    })
    expect(cacheFns.invalidateDashboardCache).toHaveBeenCalledWith(7)
  })

  it('DELETE returns 200 when deleting draft campaign succeeds', async () => {
    campaignFns.deleteCampaign.mockResolvedValue({ success: true })

    const req = new NextRequest('http://localhost/api/campaigns/1', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
    })

    const res = await DELETE(req, { params: { id: '1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(campaignFns.deleteCampaign).toHaveBeenCalledWith(1, 7)
    expect(cacheFns.invalidateDashboardCache).toHaveBeenCalledWith(7)
  })

  it('DELETE returns 409 when campaign is not draft', async () => {
    campaignFns.deleteCampaign.mockResolvedValue({ success: false, reason: 'NOT_DRAFT' })

    const req = new NextRequest('http://localhost/api/campaigns/2', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
    })

    const res = await DELETE(req, { params: { id: '2' } })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain('仅草稿或已移除广告系列支持删除')
  })

  it('DELETE returns 409 when campaign already deleted', async () => {
    campaignFns.deleteCampaign.mockResolvedValue({ success: false, reason: 'ALREADY_DELETED' })

    const req = new NextRequest('http://localhost/api/campaigns/3', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
    })

    const res = await DELETE(req, { params: { id: '3' } })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toBe('该广告系列已删除')
  })

  it('DELETE returns 404 when campaign not found', async () => {
    campaignFns.deleteCampaign.mockResolvedValue({ success: false, reason: 'NOT_FOUND' })

    const req = new NextRequest('http://localhost/api/campaigns/4', {
      method: 'DELETE',
      headers: { 'x-user-id': '7' },
    })

    const res = await DELETE(req, { params: { id: '4' } })

    expect(res.status).toBe(404)
  })
})
