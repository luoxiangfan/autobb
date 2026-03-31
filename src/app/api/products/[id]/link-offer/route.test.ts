import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/products/[id]/link-offer/route'

const affiliateProductFns = vi.hoisted(() => ({
  linkOfferToAffiliateProduct: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  isProductManagementEnabledForUser: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  invalidateProductListCache: vi.fn(),
}))

vi.mock('@/lib/affiliate-products', () => ({
  linkOfferToAffiliateProduct: affiliateProductFns.linkOfferToAffiliateProduct,
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  isProductManagementEnabledForUser: authFns.isProductManagementEnabledForUser,
}))

vi.mock('@/lib/products-cache', () => ({
  invalidateProductListCache: cacheFns.invalidateProductListCache,
}))

describe('POST /api/products/:id/link-offer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.isProductManagementEnabledForUser.mockResolvedValue(true)
    affiliateProductFns.linkOfferToAffiliateProduct.mockResolvedValue({
      product: { id: 56 },
      offerId: 88,
      linked: true,
    })
    cacheFns.invalidateProductListCache.mockResolvedValue(undefined)
  })

  it('returns 401 when user is missing', async () => {
    const req = new NextRequest('http://localhost/api/products/56/link-offer', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: '56' }) })

    expect(res.status).toBe(401)
  })

  it('returns 403 when product management is disabled', async () => {
    authFns.isProductManagementEnabledForUser.mockResolvedValue(false)

    const req = new NextRequest('http://localhost/api/products/56/link-offer', {
      method: 'POST',
      headers: {
        'x-user-id': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ offerId: 88 }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: '56' }) })

    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid product id', async () => {
    const req = new NextRequest('http://localhost/api/products/abc/link-offer', {
      method: 'POST',
      headers: {
        'x-user-id': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ offerId: 88 }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'abc' }) })

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/products/56/link-offer', {
      method: 'POST',
      headers: {
        'x-user-id': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ offer_id: 88 }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: '56' }) })

    expect(res.status).toBe(400)
  })

  it('creates a new link successfully', async () => {
    const req = new NextRequest('http://localhost/api/products/56/link-offer', {
      method: 'POST',
      headers: {
        'x-user-id': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ offerId: 88 }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: '56' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({
      success: true,
      linked: true,
      productId: 56,
      offerId: 88,
      message: 'product与offer链路已建立',
    })
    expect(affiliateProductFns.linkOfferToAffiliateProduct).toHaveBeenCalledWith({
      userId: 1,
      productId: 56,
      offerId: 88,
    })
    expect(cacheFns.invalidateProductListCache).toHaveBeenCalledWith(1)
  })

  it('returns idempotent success when link already exists', async () => {
    affiliateProductFns.linkOfferToAffiliateProduct.mockResolvedValue({
      product: { id: 56 },
      offerId: 88,
      linked: false,
    })

    const req = new NextRequest('http://localhost/api/products/56/link-offer', {
      method: 'POST',
      headers: {
        'x-user-id': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ offerId: 88 }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: '56' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.message).toBe('product与offer链路已存在')
    expect(data.linked).toBe(false)
  })
})
