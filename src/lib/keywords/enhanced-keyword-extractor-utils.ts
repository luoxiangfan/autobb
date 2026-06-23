/**
 * 增强关键词提取：归一化、去重、过滤与变体
 */
import type { EnhancedKeyword } from './enhanced-keyword-extractor-types'

export function normalizeEvidencePhrase(raw: string, maxTokens = 4): string | null {
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return null

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 2 || /\d/.test(token))
    .filter(
      (token) =>
        !/^(with|for|and|the|a|an|in|on|of|to|by|from|new|best|top|sale|deal|discount|shop|buy)$/i.test(
          token
        )
    )
    .slice(0, maxTokens)

  if (tokens.length === 0) return null
  return tokens.join(' ')
}

export function deduplicateKeywords(
  keywords: Partial<EnhancedKeyword>[]
): Partial<EnhancedKeyword>[] {
  const seen = new Set<string>()
  return keywords.filter((kw) => {
    const lower = (kw.keyword || '').toLowerCase()
    if (seen.has(lower)) {
      return false
    }
    seen.add(lower)
    return true
  })
}

export function filterAndRankKeywords(
  keywords: EnhancedKeyword[],
  options: {
    minSearchVolume?: number
    maxCPC?: number
  }
): EnhancedKeyword[] {
  const { minSearchVolume = 100, maxCPC = 50 } = options
  const hasAnyVolume = keywords.some((kw) => kw.searchVolume > 0)

  return keywords
    .filter((kw) => {
      if (!hasAnyVolume) return kw.cpc <= maxCPC
      return kw.searchVolume >= minSearchVolume && kw.cpc <= maxCPC
    })
    .sort((a, b) => {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
      if (priorityDiff !== 0) return priorityDiff
      return b.searchVolume - a.searchVolume
    })
}

export async function generateKeywordVariants(
  keywords: EnhancedKeyword[],
  targetLanguage: string
): Promise<EnhancedKeyword[]> {
  if (targetLanguage === 'en') {
    return keywords
  }

  return keywords.map((kw) => ({
    ...kw,
    variants: [kw.keyword],
  }))
}
