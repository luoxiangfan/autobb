import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyOfferUpdateFromBody,
  pickOfferUpdateBody,
  resolveStoreProductLinksForUpdate,
} from './offer-update-from-body'

vi.mock('@/lib/offers', () => ({
  findOfferById: vi.fn(),
  updateOffer: vi.fn(),
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: vi.fn(),
}))

import { findOfferById, updateOffer } from '@/lib/offers'
import { invalidateOfferCache } from '@/lib/api-cache'

const mockOffer = {
  id: 1,
  user_id: 10,
  brand: 'Acme',
  page_type: 'product',
  store_product_links: null,
} as any

describe('pickOfferUpdateBody', () => {
  it('picks offer fields and ignores unknown keys', () => {
    expect(
      pickOfferUpdateBody({
        brand: 'Acme',
        extraction_mode: 'fast',
        taskId: 'ignore-me',
      })
    ).toEqual({
      brand: 'Acme',
      extraction_mode: 'fast',
    })
  })

  it('returns null when body has no recognized offer fields', () => {
    expect(pickOfferUpdateBody({ taskId: 'x' })).toBeNull()
    expect(pickOfferUpdateBody({})).toBeNull()
  })
})

describe('resolveStoreProductLinksForUpdate', () => {
  it('clears links when page_type is product', () => {
    expect(resolveStoreProductLinksForUpdate('product', undefined)).toBeNull()
  })

  it('does not touch links when page_type is omitted', () => {
    expect(resolveStoreProductLinksForUpdate(undefined, undefined)).toBeUndefined()
  })

  it('serializes store links when page_type is store', () => {
    expect(
      resolveStoreProductLinksForUpdate('store', ['https://example.com/a', 'https://example.com/a'])
    ).toBe(JSON.stringify(['https://example.com/a']))
  })
})

describe('applyOfferUpdateFromBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateOffer).mockImplementation(async (id, userId) => {
      invalidateOfferCache(userId, id)
      return mockOffer
    })
    vi.mocked(findOfferById).mockResolvedValue(mockOffer)
  })

  it('clears store_product_links when switching to product page type', async () => {
    await applyOfferUpdateFromBody(1, 10, { page_type: 'product' })

    expect(updateOffer).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({ store_product_links: null, page_type: 'product' })
    )
  })

  it('invalidates offer cache after a successful update', async () => {
    await applyOfferUpdateFromBody(1, 10, { brand: 'New Brand' })

    expect(invalidateOfferCache).toHaveBeenCalledWith(10, 1)
  })

  it('does not invalidate cache when body has no offer fields', async () => {
    await applyOfferUpdateFromBody(1, 10, { taskId: 'only-task' })

    expect(updateOffer).not.toHaveBeenCalled()
    expect(invalidateOfferCache).not.toHaveBeenCalled()
  })

  it('normalizes Chinese extraction mode aliases', async () => {
    await applyOfferUpdateFromBody(1, 10, { extraction_mode: '快速' })

    expect(updateOffer).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({ extraction_mode: 'fast' })
    )
  })

  it('infers page_type store when only store_product_links are provided', async () => {
    await applyOfferUpdateFromBody(1, 10, {
      store_product_links: ['https://amazon.com/dp/B001'],
    })

    expect(updateOffer).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({
        page_type: 'store',
        store_product_links: JSON.stringify(['https://amazon.com/dp/B001']),
      })
    )
  })

  it('rejects whitespace target_country with 400', async () => {
    const result = await applyOfferUpdateFromBody(1, 10, { target_country: '  ' })

    expect(result).toEqual({
      error: '目标国家不能为空',
      status: 400,
    })
    expect(updateOffer).not.toHaveBeenCalled()
  })

  it('rejects invalid extraction_mode with 400', async () => {
    const result = await applyOfferUpdateFromBody(1, 10, { extraction_mode: 'bogus' })

    expect(result).toEqual({
      error: '无效的提取模式，可选：fast、balanced、original',
      status: 400,
    })
    expect(updateOffer).not.toHaveBeenCalled()
    expect(invalidateOfferCache).not.toHaveBeenCalled()
  })
})
