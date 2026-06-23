/**
 * 增强关键词提取：五层候选构建
 */
import { getHighIntentKeywords } from './google-suggestions'
import type { EnhancedKeyword } from './enhanced-keyword-extractor-types'
import { normalizeEvidencePhrase } from './enhanced-keyword-extractor-utils'

export async function extractBrandKeywords(
  brandName: string,
  category: string,
  _targetCountry: string,
  _targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const normalizedBrand = normalizeEvidencePhrase(brandName, 3)
  if (!normalizedBrand) return []

  const output: Partial<EnhancedKeyword>[] = [
    {
      keyword: normalizedBrand,
      category: 'brand',
      source: 'brand_name',
      priority: 'HIGH',
    },
  ]

  const categoryPhrase = normalizeEvidencePhrase(category, 3)
  if (categoryPhrase && categoryPhrase !== normalizedBrand) {
    output.push({
      keyword: `${normalizedBrand} ${categoryPhrase}`,
      category: 'brand',
      source: 'brand_category',
      priority: 'HIGH',
    })
  }

  return output
}

export async function extractCoreKeywords(
  productName: string,
  category: string,
  features: string[],
  _targetCountry: string,
  _targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const keywords: Partial<EnhancedKeyword>[] = []
  const categoryPhrase = normalizeEvidencePhrase(category, 4)
  if (categoryPhrase) {
    keywords.push({
      keyword: categoryPhrase,
      category: 'core',
      source: 'category',
      priority: 'HIGH',
    })
  }
  const productPhrase = normalizeEvidencePhrase(productName, 5)
  if (productPhrase) {
    keywords.push({
      keyword: productPhrase,
      category: 'core',
      source: 'product_name',
      priority: 'HIGH',
    })
  }

  const featurePhrase = normalizeEvidencePhrase(features?.[0] || '', 4)
  if (featurePhrase) {
    keywords.push({
      keyword: featurePhrase,
      category: 'core',
      source: 'feature_phrase',
      priority: 'MEDIUM',
    })
  }

  return keywords
}

export async function extractIntentKeywords(
  category: string,
  targetCountry: string,
  targetLanguage: string,
  brandName?: string
): Promise<Partial<EnhancedKeyword>[]> {
  const normalizedBrand = normalizeEvidencePhrase(brandName || '', 3)
  if (!normalizedBrand) return []

  const categoryTokens = new Set(
    (normalizeEvidencePhrase(category, 3) || '').split(/\s+/).filter(Boolean)
  )
  const brandTokenSet = new Set(normalizedBrand.split(/\s+/).filter(Boolean))

  try {
    const candidates = await getHighIntentKeywords({
      brand: normalizedBrand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true,
    })

    const results = new Map<string, Partial<EnhancedKeyword>>()
    for (const rawKeyword of candidates) {
      const normalized = normalizeEvidencePhrase(rawKeyword, 6)
      if (!normalized) continue
      const tokens = normalized.split(/\s+/).filter(Boolean)
      const hasBrandAnchor = tokens.some((token) => brandTokenSet.has(token))
      const hasCategoryAnchor = tokens.some((token) => categoryTokens.has(token))
      if (!hasBrandAnchor && !hasCategoryAnchor) continue

      results.set(normalized, {
        keyword: normalized,
        category: 'intent',
        source: 'intent_google_suggest',
        priority: hasBrandAnchor ? 'HIGH' : 'MEDIUM',
      })
    }

    return Array.from(results.values()).slice(0, 8)
  } catch (error) {
    console.warn('⚠️ 意图词扩展失败，跳过建议词:', error)
    return []
  }
}

export async function extractLongtailKeywords(
  features: string[],
  useCases: string[],
  targetAudience: string,
  _targetCountry: string,
  _targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const keywords: Partial<EnhancedKeyword>[] = []

  const featurePhrase = normalizeEvidencePhrase(features?.[0] || '', 5)
  if (featurePhrase) {
    keywords.push({
      keyword: featurePhrase,
      category: 'longtail',
      source: 'feature_longtail_phrase',
      priority: 'LOW',
    })
  }

  const useCasePhrase = normalizeEvidencePhrase(useCases?.[0] || '', 5)
  if (useCasePhrase) {
    keywords.push({
      keyword: useCasePhrase,
      category: 'longtail',
      source: 'usecase_phrase',
      priority: 'LOW',
    })
  }

  const audiencePhrase = normalizeEvidencePhrase(targetAudience || '', 5)
  if (audiencePhrase) {
    keywords.push({
      keyword: audiencePhrase,
      category: 'longtail',
      source: 'audience_phrase',
      priority: 'LOW',
    })
  }

  return keywords
}

export async function extractCompetitorKeywords(
  competitors: string[],
  _targetCountry: string,
  _targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  if (!competitors || competitors.length === 0) {
    return []
  }

  return competitors
    .map((competitor) => normalizeEvidencePhrase(competitor, 4))
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, 3)
    .map((keyword) => ({
      keyword,
      category: 'competitor' as const,
      source: 'competitor_name',
      priority: 'LOW' as const,
    }))
}
