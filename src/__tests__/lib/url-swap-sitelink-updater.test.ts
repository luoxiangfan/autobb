import { describe, expect, it } from 'vitest'
import {
  mergeSitelinkPhaseIntoHistory,
  shouldRunUrlSwapSitelinkPhase,
} from '@/lib/url-swap/url-swap-sitelink-updater'

describe('shouldRunUrlSwapSitelinkPhase', () => {
  it('runs only when campaign suffix update was attempted and succeeded', () => {
    expect(
      shouldRunUrlSwapSitelinkPhase({
        campaignUpdateAttempted: true,
        campaignUpdateSuccessCount: 1,
      })
    ).toBe(true)

    expect(
      shouldRunUrlSwapSitelinkPhase({
        campaignUpdateAttempted: true,
        campaignUpdateSuccessCount: 0,
      })
    ).toBe(false)

    expect(
      shouldRunUrlSwapSitelinkPhase({
        campaignUpdateAttempted: false,
        campaignUpdateSuccessCount: 0,
      })
    ).toBe(false)
  })
})

describe('mergeSitelinkPhaseIntoHistory', () => {
  it('merges sitelink updates into swap history when updates exist', () => {
    const entry = {
      swapped_at: '2026-01-01T00:00:00.000Z',
      previous_final_url: 'https://shop.example.com',
      previous_final_url_suffix: 'a=1',
      new_final_url: 'https://shop.example.com',
      new_final_url_suffix: 'a=2',
      success: true,
    }

    const merged = mergeSitelinkPhaseIntoHistory(entry, {
      enabled: true,
      changed: true,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      updates: [
        {
          sort_index: 0,
          asset_id: '123',
          link_text: 'Series A',
          previous_final_url_suffix: 'x=1',
          new_final_url_suffix: 'x=2',
          success: true,
        },
      ],
    })

    expect(merged.sitelink_success_count).toBe(1)
    expect(merged.sitelink_updates).toHaveLength(1)
    expect(merged.new_final_url_suffix).toBe('a=2')
  })

  it('returns entry unchanged when sitelink phase has no updates', () => {
    const entry = {
      swapped_at: '2026-01-01T00:00:00.000Z',
      previous_final_url: '',
      previous_final_url_suffix: '',
      new_final_url: '',
      new_final_url_suffix: '',
      success: true,
    }

    const merged = mergeSitelinkPhaseIntoHistory(entry, {
      enabled: true,
      changed: false,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      updates: [],
    })

    expect(merged).toEqual(entry)
  })
})
