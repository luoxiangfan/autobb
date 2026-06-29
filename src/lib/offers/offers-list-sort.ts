export const OFFERS_SERVER_SUPPORTED_SORTS = new Set([
  'offerName',
  'brand',
  'targetCountry',
  'targetLanguage',
  'scrapeStatus',
  'createdAt',
  'updatedAt',
  'linkedAccounts',
])

export function isOffersServerSortSupported(sortBy: string | undefined): sortBy is string {
  return Boolean(sortBy && OFFERS_SERVER_SUPPORTED_SORTS.has(sortBy))
}
