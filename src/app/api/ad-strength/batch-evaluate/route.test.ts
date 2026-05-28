import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/ad-strength/batch-evaluate/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const authExpandFns = vi.hoisted(() => ({
  loadKeywordPoolExpandCredentialsForOffer: vi.fn(),
}))

const evaluateFns = vi.hoisted(() => ({
  evaluateAdStrength: vi.fn(),
}))

const mockPlannerSession = { volumeAuth: { authType: 'oauth' as const } }

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/google-ads-accounts-auth', () => ({
  loadKeywordPoolExpandCredentialsForOffer: authExpandFns.loadKeywordPoolExpandCredentialsForOffer,
}))

vi.mock('@/lib/ad-strength-evaluator', () => ({
  evaluateAdStrength: evaluateFns.evaluateAdStrength,
}))

function buildCreativePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'creative-1',
    headlines: ['Headline one', 'Headline two', 'Headline three'],
    descriptions: ['Description one', 'Description two'],
    keywords: ['brand keyword'],
    brandName: 'TestBrand',
    ...overrides,
  }
}

describe('POST /api/ad-strength/batch-evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })

    evaluateFns.evaluateAdStrength.mockResolvedValue({
      rating: 'GOOD',
      overallScore: 80,
      dimensions: {},
      suggestions: [],
    })
  })

  it('preloads planner session once per offer when multiple creatives share offerId', async () => {
    offerFns.findOfferById.mockResolvedValue({ id: 42, user_id: 1 })
    authExpandFns.loadKeywordPoolExpandCredentialsForOffer.mockResolvedValue({
      ok: true,
      creds: { authType: 'oauth', linkedServiceAccountId: null },
      plannerSession: mockPlannerSession,
    })

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [
          buildCreativePayload({ id: 'a', offerId: 42 }),
          buildCreativePayload({ id: 'b', offerId: 42 }),
        ],
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(authExpandFns.loadKeywordPoolExpandCredentialsForOffer).toHaveBeenCalledTimes(1)
    expect(authExpandFns.loadKeywordPoolExpandCredentialsForOffer).toHaveBeenCalledWith(1, 42)
    expect(evaluateFns.evaluateAdStrength).toHaveBeenCalledTimes(2)
    expect(evaluateFns.evaluateAdStrength).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: 42,
        plannerSession: mockPlannerSession,
      })
    )
    expect(evaluateFns.evaluateAdStrength).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: 42,
        plannerSession: mockPlannerSession,
      })
    )
  })

  it('does not pass offerId when offer is not owned by the user', async () => {
    offerFns.findOfferById.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [buildCreativePayload({ offerId: 999 })],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(authExpandFns.loadKeywordPoolExpandCredentialsForOffer).not.toHaveBeenCalled()
    expect(evaluateFns.evaluateAdStrength).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: undefined,
        plannerSession: undefined,
        skipKeywordPoolExpandLoad: false,
      })
    )
  })

  it('normalizes string offerId and preloads planner session once', async () => {
    offerFns.findOfferById.mockResolvedValue({ id: 42, user_id: 1 })
    authExpandFns.loadKeywordPoolExpandCredentialsForOffer.mockResolvedValue({
      ok: true,
      creds: { authType: 'oauth', linkedServiceAccountId: null },
      plannerSession: mockPlannerSession,
    })

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [buildCreativePayload({ offerId: '42' })],
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(authExpandFns.loadKeywordPoolExpandCredentialsForOffer).toHaveBeenCalledWith(1, 42)
    expect(evaluateFns.evaluateAdStrength).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: 42,
        plannerSession: mockPlannerSession,
        skipKeywordPoolExpandLoad: false,
      })
    )
  })

  it('passes offerId with skipKeywordPoolExpandLoad when expand preload fails', async () => {
    offerFns.findOfferById.mockResolvedValue({ id: 42, user_id: 1 })
    authExpandFns.loadKeywordPoolExpandCredentialsForOffer.mockResolvedValue({ ok: false })

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [buildCreativePayload({ offerId: 42 })],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(evaluateFns.evaluateAdStrength).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: 42,
        plannerSession: undefined,
        skipKeywordPoolExpandLoad: true,
      })
    )
  })

  it('returns null averageScore when every creative evaluation fails', async () => {
    evaluateFns.evaluateAdStrength.mockRejectedValue(new Error('evaluation failed'))

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [
          buildCreativePayload({ id: 'a' }),
          buildCreativePayload({ id: 'b' }),
        ],
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.successCount).toBe(0)
    expect(data.summary.averageScore).toBeNull()
    expect(data.summary.allFailed).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    authFns.verifyAuth.mockResolvedValueOnce({
      authenticated: false,
      error: '未授权',
    })

    const req = new NextRequest('http://localhost/api/ad-strength/batch-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creatives: [buildCreativePayload()],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(evaluateFns.evaluateAdStrength).not.toHaveBeenCalled()
  })
})
