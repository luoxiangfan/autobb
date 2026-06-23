/**
 * 创意关键词运行时：重试排除与 audit 解析
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { CreativeKeywordSourceAudit } from './creative-keyword-set-builder'
import type {
  CreativeKeywordRuntimeCarrier,
  MergeUsedKeywordsExcludingBrandInput,
} from './creative-keyword-runtime-types'

export function resolveCreativeKeywordsForRetryExclusion(
  creative: CreativeKeywordRuntimeCarrier | null | undefined
): string[] {
  const candidateSources: unknown[] = [
    creative?.executableKeywords,
    creative?.keywords,
    Array.isArray(creative?.keywordsWithVolume)
      ? creative.keywordsWithVolume.map((item) => String((item as any)?.keyword || '').trim())
      : [],
  ]

  for (const source of candidateSources) {
    const keywords = Array.isArray(source)
      ? source
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : []
    if (keywords.length > 0) {
      return keywords
    }
  }

  return []
}

export function mergeUsedKeywordsExcludingBrand(
  input: MergeUsedKeywordsExcludingBrandInput
): string[] {
  const lowSignalSingleTokenSet = new Set([
    'buy',
    'price',
    'deal',
    'deals',
    'sale',
    'discount',
    'coupon',
    'offer',
    'promo',
    'shop',
    'store',
    'online',
    'official',
    'best',
    'review',
    'reviews',
  ])
  const normalizeKeyword = (value: unknown): string => String(value || '').trim()
  const buildPermutationKey = (keyword: string): string => {
    const normalized = normalizeGoogleAdsKeyword(keyword) || ''
    if (!normalized) return ''
    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.length <= 1) return normalized
    return tokens.slice().sort().join(' ')
  }
  const isUsefulCandidateKeywordForExclusion = (keyword: string): boolean => {
    const normalized = normalizeGoogleAdsKeyword(keyword) || ''
    if (!normalized) return false
    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.length >= 2) return true
    const [token] = tokens
    if (!token) return false
    if (/[a-z]*\d+[a-z0-9-]*/i.test(token)) return true
    return !lowSignalSingleTokenSet.has(token)
  }
  const buildDedupKey = (keyword: string): string => {
    const normalized =
      normalizeGoogleAdsKeyword(keyword) || keyword.toLowerCase().replace(/\s+/g, ' ').trim()
    const permutation = buildPermutationKey(keyword)
    if (permutation) return `perm:${permutation}`
    if (normalized) return `norm:${normalized}`
    return `raw:${keyword.toLowerCase()}`
  }

  const brandKeywords = Array.isArray(input.brandKeywords)
    ? input.brandKeywords
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    : []
  const nonBrandKeywords = (Array.isArray(input.candidateKeywords) ? input.candidateKeywords : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeKeyword(item))
    .filter(Boolean)
    .filter((keyword) => isUsefulCandidateKeywordForExclusion(keyword))
    .filter((keyword) => {
      const keywordLower = keyword.toLowerCase()
      return !brandKeywords.some(
        (brand) => keywordLower.includes(brand) || brand.includes(keywordLower)
      )
    })

  const mergedKeywords = [
    ...(Array.isArray(input.usedKeywords)
      ? input.usedKeywords.map((item) => normalizeKeyword(item))
      : []),
    ...nonBrandKeywords,
  ].filter(Boolean)
  const deduped = new Map<string, string>()
  for (const keyword of mergedKeywords) {
    const key = buildDedupKey(keyword)
    if (!deduped.has(key)) {
      deduped.set(key, keyword)
    }
  }

  return Array.from(deduped.values())
}

export function resolveCreativeKeywordAudit(
  creative: CreativeKeywordRuntimeCarrier | null | undefined
): CreativeKeywordSourceAudit | undefined {
  return (
    creative?.audit ||
    creative?.keywordSourceAudit ||
    creative?.adStrength?.audit ||
    creative?.adStrength?.keywordSourceAudit ||
    undefined
  )
}
