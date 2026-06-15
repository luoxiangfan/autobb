import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const extractionFns = vi.hoisted(() => ({
  createOfferExtractionTaskForNewOffer: vi.fn(),
}))

vi.mock('@/lib/offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offers')>()
  return {
    ...actual,
    createOfferExtractionTaskForNewOffer: extractionFns.createOfferExtractionTaskForNewOffer,
  }
})

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    query: vi.fn().mockResolvedValue([]),
  }),
}))

import { POST } from '@/app/api/offers/extract/stream/route'

describe('POST /api/offers/extract/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractionFns.createOfferExtractionTaskForNewOffer.mockResolvedValue('task-stream-1')
  })

  it('returns 401 JSON when x-user-id is missing', async () => {
    const req = new NextRequest('http://localhost/api/offers/extract/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized', message: '请先登录' })
  })

  it('returns 400 JSON for invalid request body', async () => {
    const req = new NextRequest('http://localhost/api/offers/extract/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: 'not-json',
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toEqual({
      error: 'Invalid request',
      message: '请求体必须是有效的 JSON',
    })
    expect(extractionFns.createOfferExtractionTaskForNewOffer).not.toHaveBeenCalled()
  })

  it('returns 400 JSON when extraction_mode is invalid', async () => {
    const req = new NextRequest('http://localhost/api/offers/extract/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        affiliate_link: 'https://aff.example.com/track',
        target_country: 'US',
        extraction_mode: 'bogus',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toBe('Invalid request')
    expect(data.message).toContain('提取模式')
    expect(extractionFns.createOfferExtractionTaskForNewOffer).not.toHaveBeenCalled()
  })
})
