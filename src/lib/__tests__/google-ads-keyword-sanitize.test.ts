import { describe, expect, it } from 'vitest'
import { sanitizeKeywordForGoogleAds } from '@/lib/google-ads-api'

describe('sanitizeKeywordForGoogleAds', () => {
  it('truncates keywords to 10 words to satisfy Google Ads limit', () => {
    const input = 'anker solix c300x dc portable power station with 100w fast charger'
    const result = sanitizeKeywordForGoogleAds(input)

    expect(result.text).toBe('anker solix c300x dc portable power station with 100w fast')
    expect(result.originalWordCount).toBe(11)
    expect(result.truncatedByWordLimit).toBe(true)
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(10)
  })

  it('truncates keyword length to at most 80 characters', () => {
    const input = `${'a'.repeat(60)} ${'b'.repeat(60)}`
    const result = sanitizeKeywordForGoogleAds(input)

    expect(result.text.length).toBeLessThanOrEqual(80)
    expect(result.truncatedByCharLimit).toBe(true)
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('drops keyword when it becomes empty after sanitization', () => {
    const input = '🔥🔥🔥'
    const result = sanitizeKeywordForGoogleAds(input)

    expect(result.text).toBe('')
    expect(result.truncatedByWordLimit).toBe(false)
    expect(result.truncatedByCharLimit).toBe(false)
  })
})
