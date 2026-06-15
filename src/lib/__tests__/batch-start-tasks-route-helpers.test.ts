import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  buildBatchStartTasksApiData,
  buildBatchStartTasksHttpParts,
  coerceBatchStartTaskFlag,
  parseBatchStartRequestBody,
} from '@/lib/campaign'

describe('coerceBatchStartTaskFlag', () => {
  it('treats string false as off', () => {
    expect(coerceBatchStartTaskFlag('false', true)).toBe(false)
    expect(coerceBatchStartTaskFlag('FALSE', true)).toBe(false)
    expect(coerceBatchStartTaskFlag('0', true)).toBe(false)
  })

  it('treats string true as on', () => {
    expect(coerceBatchStartTaskFlag('true', false)).toBe(true)
    expect(coerceBatchStartTaskFlag('1', false)).toBe(true)
  })

  it('uses default for ambiguous string', () => {
    expect(coerceBatchStartTaskFlag('maybe', true)).toBe(true)
    expect(coerceBatchStartTaskFlag('maybe', false)).toBe(false)
  })
})

describe('parseBatchStartRequestBody', () => {
  it('returns INVALID_JSON for malformed body', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    const r = await parseBatchStartRequestBody(req)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      const j = await r.response.json()
      expect(j.code).toBe('INVALID_JSON')
    }
  })

  it('returns INVALID_BODY for JSON array', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    })
    const r = await parseBatchStartRequestBody(req)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const j = await r.response.json()
      expect(j.code).toBe('INVALID_BODY')
    }
  })
})

describe('buildBatchStartTasksApiData', () => {
  it('computes unmatchedIdsCount', () => {
    const base = {
      success: true,
      partialSuccess: false,
      requestedCount: 1,
      processedOfferCount: 1,
      failedOfferCount: 0,
      failedItemsByType: { clickFarm: 0, urlSwap: 0, general: 0 },
      clickFarmTasksCreated: 1,
      clickFarmTasksUpdated: 0,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
      errors: [],
    }
    const data = buildBatchStartTasksApiData(base, 3, 1, 'offer')
    expect(data.unmatchedIdsCount).toBe(2)
    expect(data.selectionIdKind).toBe('offer')
  })
})

describe('buildBatchStartTasksHttpParts', () => {
  it('appends offer-style unmatched hint', () => {
    const result = {
      success: true,
      partialSuccess: false,
      requestedCount: 1,
      processedOfferCount: 1,
      failedOfferCount: 0,
      failedItemsByType: { clickFarm: 0, urlSwap: 0, general: 0 },
      clickFarmTasksCreated: 1,
      clickFarmTasksUpdated: 0,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
      errors: [],
    }
    const { message, data } = buildBatchStartTasksHttpParts({
      result,
      requestedIdsCount: 2,
      matchedOfferCount: 1,
      selectionIdKind: 'offer',
    })
    expect(data.unmatchedIdsCount).toBe(1)
    expect(message).toContain('已跳过 1 个未命中的 Offer ID')
  })

  it('appends campaign-style unmatched hint', () => {
    const result = {
      success: true,
      partialSuccess: false,
      requestedCount: 1,
      processedOfferCount: 1,
      failedOfferCount: 0,
      failedItemsByType: { clickFarm: 0, urlSwap: 0, general: 0 },
      clickFarmTasksCreated: 1,
      clickFarmTasksUpdated: 0,
      urlSwapTasksCreated: 0,
      urlSwapTasksUpdated: 0,
      errors: [],
    }
    const { message } = buildBatchStartTasksHttpParts({
      result,
      requestedIdsCount: 3,
      matchedOfferCount: 1,
      selectionIdKind: 'campaign',
    })
    expect(message).toContain('不完全对应')
    expect(message).toContain('约 2 个')
  })
})
