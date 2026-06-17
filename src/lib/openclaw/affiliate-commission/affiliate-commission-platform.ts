export type AffiliatePlatform = 'partnerboost' | 'yeahpromos'

export type AffiliateCommissionReportViewMode = 'brand' | 'date'

export type AffiliateCommissionReportPlatformFilter = AffiliatePlatform | 'all'

/** Display names from /api/campaigns/affiliate-platforms mapped to raw sync platform slugs. */
export const AFFILIATE_DISPLAY_TO_RAW_PLATFORM = {
  YeahPromos: 'yeahpromos',
  PartnerBoost: 'partnerboost' } as const satisfies Record<string, AffiliatePlatform>

export function resolveAffiliateCommissionPlatformFilter(
  value: string | null | undefined
): AffiliateCommissionReportPlatformFilter {
  const normalized = String(value || 'all').trim()
  if (!normalized || normalized.toLowerCase() === 'all') return 'all'
  if (normalized === 'yeahpromos' || normalized === 'partnerboost') {
    return normalized
  }
  const mapped = AFFILIATE_DISPLAY_TO_RAW_PLATFORM[
    normalized as keyof typeof AFFILIATE_DISPLAY_TO_RAW_PLATFORM
  ]
  return mapped || 'all'
}

export function filterAffiliatesWithRawCommissionSupport<T extends { name: string }>(
  affiliates: T[]
): T[] {
  return affiliates.filter((affiliate) =>
    Boolean(AFFILIATE_DISPLAY_TO_RAW_PLATFORM[
      affiliate.name as keyof typeof AFFILIATE_DISPLAY_TO_RAW_PLATFORM
    ])
  )
}

export function getAffiliatePlatformDisplayName(platform: AffiliatePlatform): string {
  for (const [displayName, slug] of Object.entries(AFFILIATE_DISPLAY_TO_RAW_PLATFORM)) {
    if (slug === platform) return displayName
  }
  return platform
}
