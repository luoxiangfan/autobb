/**
 * Map configured affiliate platform display names to URL substrings used in offer.affiliate_link.
 * Used by campaign performance and trends APIs when filtering by selected platform.
 */
export function getAffiliateDomainKeywords(platformName: string): string[] {
  const platformDomainMap: Record<string, string[]> = {
    Amazon: ['amzn.to', 'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr', 'amazon.co.jp'],
    LinkShare: ['click.linksynergy.com', 'linksynergy.com'],
    ShareASale: ['shareasale.com'],
    CJ: ['cj.dotomi.com', 'commissionjunction.com'],
    Skimlinks: ['go.redirectingat.com', 'redirectingat.com'],
    Awin: ['awin1.com'],
    'Google Affiliate': ['clickserve.dartsearch.net', 'affiliate.google.com'],
    TradeTracker: ['tp.media'],
    FlexOffers: ['flexlinks.com', 'flexoffers.com'],
    Impact: ['impact.com'],
    Rakuten: ['rakutenadvertising.com'],
    ClickBank: ['clickbank.net'],
    Digistore24: ['digistore24.com'],
    WarriorPlus: ['warriorplus.com'],
    JVZoo: ['jvzoo.com'],
    YeahPromos: ['yeahpromos.com'],
    PartnerBoost: ['partnerboost.com', 'app.partnerboost.com', 'pboost.me'],
  }

  return platformDomainMap[platformName] || [platformName.toLowerCase()]
}
