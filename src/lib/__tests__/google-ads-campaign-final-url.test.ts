import { describe, expect, it } from 'vitest'

import { firstNonEmptyFinalUrlFromCampaignConfig } from '@/lib/google-ads/campaign/final-url'

describe('firstNonEmptyFinalUrlFromCampaignConfig', () => {
  it('returns empty when config is undefined', () => {
    expect(firstNonEmptyFinalUrlFromCampaignConfig(undefined)).toBe('')
  })

  it('returns empty for empty finalUrls array', () => {
    expect(firstNonEmptyFinalUrlFromCampaignConfig({ finalUrls: [] })).toBe('')
  })

  it('skips leading empty or whitespace-only strings', () => {
    expect(
      firstNonEmptyFinalUrlFromCampaignConfig({
        finalUrls: ['', '   ', '\t', 'https://example.com/path'],
      })
    ).toBe('https://example.com/path')
  })

  it('returns first non-empty string when earlier entries are blank', () => {
    expect(
      firstNonEmptyFinalUrlFromCampaignConfig({
        finalUrls: ['', 'https://middle.example/a', 'https://last.example/b'],
      })
    ).toBe('https://middle.example/a')
  })

  it('returns empty when no string entries (runtime-tolerant)', () => {
    expect(
      firstNonEmptyFinalUrlFromCampaignConfig({
        // Simulates malformed / loosely typed API payloads
        finalUrls: [1, {}, null] as unknown as string[],
      })
    ).toBe('')
  })
})
