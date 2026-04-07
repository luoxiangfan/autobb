export type CampaignSearchCandidate = {
  campaignName?: string | null
  campaignId?: string | null
  adsAccountName?: string | null
  adsAccountCustomerId?: string | null
  googleAdsAccountId?: string | number | null
}

export function matchesCampaignSearch(
  searchQuery: string,
  campaign: CampaignSearchCandidate
): boolean {
  const normalizedSearch = String(searchQuery || '').trim().toLowerCase()
  if (!normalizedSearch) return true

  const searchableFields = [
    campaign.campaignName,
    campaign.campaignId,
    campaign.adsAccountName,
    campaign.adsAccountCustomerId,
    campaign.googleAdsAccountId,
  ]

  return searchableFields.some((field) => String(field ?? '').toLowerCase().includes(normalizedSearch))
}
