import { describe, expect, it } from 'vitest'
import {
  getDefaultOfferExtractionMode,
  getExtractionModeFromRequestBody,
  getOfferExtractionModeProfile,
  normalizeOfferExtractionMode,
  parseExtractionModeFromRequestBody,
} from '../offer-extraction-mode'
import {
  getOfferAmazonProductMaxProxyRetries,
  shouldRunCompetitorDetailScrapingInAi,
  shouldSkipAmazonCompetitorExtractionOnExtract,
} from '../offer-extraction-performance'

describe('offer-extraction-mode', () => {
  it('normalizes aliases', () => {
    expect(normalizeOfferExtractionMode('快速')).toBe('fast')
    expect(normalizeOfferExtractionMode('均衡')).toBe('balanced')
    expect(normalizeOfferExtractionMode('原模式')).toBe('original')
    expect(normalizeOfferExtractionMode('标准')).toBe('original')
    expect(normalizeOfferExtractionMode('完整提取')).toBe('original')
  })

  it('parses extraction mode from request body', () => {
    expect(parseExtractionModeFromRequestBody({ extraction_mode: 'fast' })).toBe('fast')
    expect(parseExtractionModeFromRequestBody({ extractionMode: '标准' })).toBe('original')
    expect(parseExtractionModeFromRequestBody({ extractionMode: '完整提取' })).toBe('original')
    expect(parseExtractionModeFromRequestBody({})).toBeUndefined()
    expect(getExtractionModeFromRequestBody({ extraction_mode: 'nope' })).toEqual({
      provided: true,
      invalid: true,
    })
  })

  it('defaults to original', () => {
    const prev = process.env.OFFER_EXTRACTION_MODE_DEFAULT
    delete process.env.OFFER_EXTRACTION_MODE_DEFAULT
    expect(getDefaultOfferExtractionMode()).toBe('original')
    if (prev !== undefined) process.env.OFFER_EXTRACTION_MODE_DEFAULT = prev
  })

  it('applies distinct profiles per mode', () => {
    const fast = getOfferExtractionModeProfile('fast')
    const balanced = getOfferExtractionModeProfile('balanced')
    const original = getOfferExtractionModeProfile('original')

    expect(fast.skipAmazonCompetitorExtraction).toBe(true)
    expect(balanced.skipAmazonCompetitorExtraction).toBe(false)
    expect(original.skipAmazonCompetitorExtraction).toBe(false)

    expect(shouldSkipAmazonCompetitorExtractionOnExtract('fast')).toBe(true)
    expect(shouldRunCompetitorDetailScrapingInAi(true, 'fast')).toBe(false)
    expect(shouldRunCompetitorDetailScrapingInAi(true, 'balanced')).toBe(true)
    expect(shouldRunCompetitorDetailScrapingInAi(true, 'original')).toBe(true)

    expect(getOfferAmazonProductMaxProxyRetries('fast')).toBe(1)
    expect(getOfferAmazonProductMaxProxyRetries('original')).toBe(2)
  })
})
