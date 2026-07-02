import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getPureBrandKeywords, isPureBrandKeyword } from '@/lib/keywords/brand/brand-keyword-utils'

export function buildPlannerBrandKeywords(brandName: string, _category: string): string[] {
  const normalizedFull = normalizeGoogleAdsKeyword(brandName)
  if (normalizedFull) return [normalizedFull]
  return getPureBrandKeywords(brandName)
}

export function buildBrandLikePattern(brand: string): string | null {
  const normalized = normalizeGoogleAdsKeyword(brand)
  if (!normalized) return null
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  return `%${tokens.join('%')}%`
}

export function inferBrandAwareMatchType(
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' {
  return isPureBrandKeyword(keyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
}

export function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  return reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

export function hasSearchVolumeUnavailableFlag(
  keywords: Array<{ volumeUnavailableReason?: unknown }>
): boolean {
  return keywords.some((kw) => isSearchVolumeUnavailableReason(kw?.volumeUnavailableReason))
}
