import { describe, expect, it } from 'vitest'
import {
  buildBatchStartTasksApiData,
  buildBatchStartTasksHttpParts,
  coerceBatchStartTaskFlag,
} from '@/lib/batch-start-tasks-route-helpers'

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
    const data = buildBatchStartTasksApiData(base, 3, 1)
    expect(data.unmatchedIdsCount).toBe(2)
  })
})

describe('buildBatchStartTasksHttpParts', () => {
  it('appends unmatched hint to success message', () => {
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
    })
    expect(data.unmatchedIdsCount).toBe(1)
    expect(message).toContain('已跳过 1 个未命中的请求 ID')
  })
})
