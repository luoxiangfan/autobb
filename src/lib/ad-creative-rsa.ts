/** RSA 发布所需素材数量（与 Launch Step1 展示一致） */
export const REQUIRED_RSA_HEADLINE_COUNT = 15
export const REQUIRED_RSA_DESCRIPTION_COUNT = 4

export function hasRequiredRsaAssetCounts(creative: {
  headlines?: unknown
  descriptions?: unknown
}): boolean {
  const headlines = Array.isArray(creative?.headlines)
    ? creative.headlines.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
    : []
  const descriptions = Array.isArray(creative?.descriptions)
    ? creative.descriptions.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
    : []

  return (
    headlines.length === REQUIRED_RSA_HEADLINE_COUNT &&
    descriptions.length === REQUIRED_RSA_DESCRIPTION_COUNT
  )
}
