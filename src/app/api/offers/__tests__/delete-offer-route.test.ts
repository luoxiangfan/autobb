import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/offers/[id]/route'

vi.mock('@/lib/offers', () => ({
  deleteOffer: vi.fn(async () => ({ success: true, message: 'ok' }))
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: vi.fn()
}))

const { deleteOffer } = await import('@/lib/offers')

describe('DELETE /api/offers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes removeGoogleAdsCampaigns=true to deleteOffer', async () => {
    const req = new NextRequest('http://localhost/api/offers/123?autoUnlink=true&removeGoogleAdsCampaigns=true', {
      method: 'DELETE',
      headers: { 'x-user-id': '1' }
    })

    const res = await DELETE(req, { params: { id: '123' } })

    expect(res.status).toBe(200)
    expect(deleteOffer).toHaveBeenCalledWith(123, 1, true, true)
  })

  it('defaults removeGoogleAdsCampaigns to false', async () => {
    const req = new NextRequest('http://localhost/api/offers/456', {
      method: 'DELETE',
      headers: { 'x-user-id': '2' }
    })

    const res = await DELETE(req, { params: { id: '456' } })

    expect(res.status).toBe(200)
    expect(deleteOffer).toHaveBeenCalledWith(456, 2, false, false)
  })
})
