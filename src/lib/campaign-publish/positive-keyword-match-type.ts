import { normalizeGoogleAdsKeyword } from '@/lib/google-ads-keyword-normalizer'

export type PositiveKeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD'

function normalizeCompact(value: string): string {
  return value.replace(/\s+/g, '')
}

function isPureBrandKeyword(keyword: string, brandName: string): boolean {
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName)

  if (!normalizedKeyword || !normalizedBrand) return false
  if (normalizedKeyword === normalizedBrand) return true

  return normalizeCompact(normalizedKeyword) === normalizeCompact(normalizedBrand)
}

export function normalizePositiveKeywordMatchType(value: unknown): PositiveKeywordMatchType | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return null

  if (normalized === 'BROAD_MATCH_MODIFIER' || normalized === 'BMM') return 'BROAD'
  if (normalized === 'BROAD' || normalized === 'PHRASE' || normalized === 'EXACT') {
    return normalized as PositiveKeywordMatchType
  }
  return null
}

export function resolvePositiveKeywordMatchType(params: {
  keyword: string
  brandName?: string
  explicitMatchType?: unknown
  mappedMatchType?: unknown
}): PositiveKeywordMatchType {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return 'PHRASE'

  const isPureBrand = isPureBrandKeyword(keyword, String(params.brandName || ''))
  if (isPureBrand) return 'EXACT'

  const explicit = normalizePositiveKeywordMatchType(params.explicitMatchType)
  if (explicit) return explicit

  const mapped = normalizePositiveKeywordMatchType(params.mappedMatchType)
  if (mapped) return mapped

  return 'PHRASE'
}
