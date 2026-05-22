import { describe, expect, it } from 'vitest'
import { backupHasCampaignConfig } from '@/lib/campaign-backup-config'

describe('backupHasCampaignConfig', () => {
  it('returns false for null, empty string, and empty object', () => {
    expect(backupHasCampaignConfig(null)).toBe(false)
    expect(backupHasCampaignConfig(undefined)).toBe(false)
    expect(backupHasCampaignConfig('')).toBe(false)
    expect(backupHasCampaignConfig('{}')).toBe(false)
    expect(backupHasCampaignConfig({})).toBe(false)
  })

  it('returns true for non-empty object or JSON string', () => {
    expect(backupHasCampaignConfig({ keywords: ['a'] })).toBe(true)
    expect(backupHasCampaignConfig(JSON.stringify({ bid: 1 }))).toBe(true)
  })

  it('returns false for invalid JSON string', () => {
    expect(backupHasCampaignConfig('{not json')).toBe(false)
  })
})
