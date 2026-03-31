import { describe, expect, it } from 'vitest'
import {
  applyFixedAffiliateSyncValues,
  DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
  DEFAULT_PARTNERBOOST_BASE_URL,
  normalizeAffiliateSyncMode,
} from './affiliate-sync-config'

describe('affiliate sync config helpers', () => {
  it('overrides fixed affiliate settings with system defaults', () => {
    expect(applyFixedAffiliateSyncValues({
      partnerboost_base_url: 'https://custom.example.com',
      openclaw_affiliate_sync_interval_hours: '12',
      openclaw_affiliate_sync_mode: 'realtime',
    })).toEqual({
      partnerboost_base_url: DEFAULT_PARTNERBOOST_BASE_URL,
      openclaw_affiliate_sync_interval_hours: DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
      openclaw_affiliate_sync_mode: 'realtime',
    })
  })

  it('normalizes unknown sync mode to incremental', () => {
    expect(normalizeAffiliateSyncMode('realtime')).toBe('realtime')
    expect(normalizeAffiliateSyncMode('incremental')).toBe('incremental')
    expect(normalizeAffiliateSyncMode('')).toBe('incremental')
    expect(normalizeAffiliateSyncMode('manual')).toBe('incremental')
  })
})
