/**
 * Pick the first non-empty trimmed URL from `campaign_config.finalUrls`
 * (Google Ads payloads may include leading blanks or empty leading entries).
 */
export function firstNonEmptyFinalUrlFromCampaignConfig(
  campaignConfig?: { finalUrls?: string[] } | null
): string {
  const raw = campaignConfig?.finalUrls
  if (!Array.isArray(raw)) return ''
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}
