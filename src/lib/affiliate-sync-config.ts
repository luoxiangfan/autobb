export const DEFAULT_PARTNERBOOST_BASE_URL = 'https://app.partnerboost.com'
export const DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS = '1'

export const FIXED_AFFILIATE_SYNC_SETTINGS = {
  partnerboost_base_url: DEFAULT_PARTNERBOOST_BASE_URL,
  openclaw_affiliate_sync_interval_hours: DEFAULT_AFFILIATE_SYNC_INTERVAL_HOURS,
} as const

export type FixedAffiliateSyncSettingKey = keyof typeof FIXED_AFFILIATE_SYNC_SETTINGS

export function isFixedAffiliateSyncSettingKey(key: string): key is FixedAffiliateSyncSettingKey {
  return key in FIXED_AFFILIATE_SYNC_SETTINGS
}

export function getFixedAffiliateSyncSettingValue(key: string): string | undefined {
  if (!isFixedAffiliateSyncSettingKey(key)) return undefined
  return FIXED_AFFILIATE_SYNC_SETTINGS[key]
}

export function applyFixedAffiliateSyncValues<T extends Record<string, string | null | undefined>>(settings: T): T {
  const next = { ...settings }

  for (const [key, value] of Object.entries(FIXED_AFFILIATE_SYNC_SETTINGS)) {
    next[key as keyof T] = value as T[keyof T]
  }

  return next
}

export function normalizeAffiliateSyncMode(value: string | null | undefined): 'incremental' | 'realtime' {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'realtime' ? 'realtime' : 'incremental'
}
