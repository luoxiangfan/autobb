function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export interface GoogleAdsAccountDeleteRemoteConfig {
  maxCampaigns: number
  concurrency: number
  perCampaignTimeoutMs: number
  totalTimeoutMs: number
}

export function getGoogleAdsAccountDeleteRemoteConfig(): GoogleAdsAccountDeleteRemoteConfig {
  return {
    maxCampaigns: parseBoundedInt(process.env.GOOGLE_ADS_ACCOUNT_DELETE_MAX_CAMPAIGNS, 50, 1, 200),
    concurrency: parseBoundedInt(process.env.GOOGLE_ADS_ACCOUNT_DELETE_CONCURRENCY, 3, 1, 10),
    perCampaignTimeoutMs: parseBoundedInt(
      process.env.GOOGLE_ADS_ACCOUNT_DELETE_PER_CAMPAIGN_TIMEOUT_MS,
      45_000,
      5_000,
      120_000
    ),
    totalTimeoutMs: parseBoundedInt(
      process.env.GOOGLE_ADS_ACCOUNT_DELETE_TOTAL_TIMEOUT_MS,
      180_000,
      30_000,
      600_000
    ),
  }
}
