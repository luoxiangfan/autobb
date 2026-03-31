import { sanitizeKeywordObjectsForGoogleAdsPolicy } from '@/lib/google-ads-policy-guard'

export type CampaignKeywordConfigItem =
  | string
  | {
      text?: string
      keyword?: string
      [key: string]: unknown
    }

interface ResolveTaskKeywordParams {
  configuredKeywords: unknown
  configuredNegativeKeywords: unknown
  fallbackKeywords: CampaignKeywordConfigItem[]
  fallbackNegativeKeywords: string[]
}

interface ResolveTaskKeywordResult {
  keywords: CampaignKeywordConfigItem[]
  negativeKeywords: string[]
  usedKeywordFallback: boolean
  usedNegativeKeywordFallback: boolean
}

function hasNonEmptyKeywordText(item: unknown): boolean {
  if (typeof item === 'string') return item.trim().length > 0
  if (!item || typeof item !== 'object') return false
  const obj = item as Record<string, unknown>
  const candidate = typeof obj.text === 'string' ? obj.text : obj.keyword
  return typeof candidate === 'string' && candidate.trim().length > 0
}

function normalizeNegativeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function sanitizeKeywordItems(items: CampaignKeywordConfigItem[]): CampaignKeywordConfigItem[] {
  const normalizedItems = (items || [])
    .map((item) => {
      if (typeof item === 'string') {
        const keyword = item.trim()
        if (!keyword) return null
        return {
          keyword,
          source: item as CampaignKeywordConfigItem,
          sourceKey: 'string' as const,
        }
      }

      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const rawKeyword = typeof source.text === 'string' ? source.text : source.keyword
      const keyword = typeof rawKeyword === 'string' ? rawKeyword.trim() : ''
      if (!keyword) return null

      return {
        keyword,
        source: item as CampaignKeywordConfigItem,
        sourceKey: typeof source.text === 'string' ? ('text' as const) : ('keyword' as const),
      }
    })
    .filter((item): item is { keyword: string; source: CampaignKeywordConfigItem; sourceKey: 'string' | 'text' | 'keyword' } => Boolean(item))

  if (normalizedItems.length === 0) return []

  const sanitized = sanitizeKeywordObjectsForGoogleAdsPolicy(normalizedItems)

  return sanitized.items
    .map((item) => {
      if (item.sourceKey === 'string') return item.keyword

      const source = item.source as Record<string, unknown>
      if (item.sourceKey === 'text') {
        return {
          ...source,
          text: item.keyword,
        } as CampaignKeywordConfigItem
      }

      return {
        ...source,
        keyword: item.keyword,
      } as CampaignKeywordConfigItem
    })
    .filter((item) => hasNonEmptyKeywordText(item))
}

export function resolveTaskCampaignKeywords(
  params: ResolveTaskKeywordParams
): ResolveTaskKeywordResult {
  const hasConfiguredKeywords =
    Array.isArray(params.configuredKeywords)
    && params.configuredKeywords.some((item) => hasNonEmptyKeywordText(item))

  const normalizedConfiguredNegativeKeywords = normalizeNegativeKeywords(params.configuredNegativeKeywords)
  const hasConfiguredNegativeKeywords = normalizedConfiguredNegativeKeywords.length > 0

  const configuredKeywordItems = hasConfiguredKeywords
    ? sanitizeKeywordItems(params.configuredKeywords as CampaignKeywordConfigItem[])
    : []
  const fallbackKeywordItems = sanitizeKeywordItems(params.fallbackKeywords)

  const useConfiguredKeywords = configuredKeywordItems.length > 0
  const resolvedKeywords = useConfiguredKeywords ? configuredKeywordItems : fallbackKeywordItems

  return {
    keywords: resolvedKeywords,
    negativeKeywords: hasConfiguredNegativeKeywords
      ? normalizedConfiguredNegativeKeywords
      : params.fallbackNegativeKeywords,
    usedKeywordFallback: !useConfiguredKeywords,
    usedNegativeKeywordFallback: !hasConfiguredNegativeKeywords,
  }
}
