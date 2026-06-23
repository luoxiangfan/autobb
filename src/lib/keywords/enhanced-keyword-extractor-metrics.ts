/**
 * 增强关键词提取：搜索量与竞争度 enrichment
 */
import {
  getKeywordSearchVolumesForPlannerContext,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import type { EnhancedKeyword } from './enhanced-keyword-extractor-types'

export async function enrichKeywordsWithMetrics(
  keywords: Partial<EnhancedKeyword>[],
  targetCountry: string,
  targetLanguage: string,
  userId: number,
  offerId?: number,
  plannerSession?: KeywordPlannerPreparedSession
): Promise<EnhancedKeyword[]> {
  const keywordTexts = keywords.map((kw) => kw.keyword || '').filter(Boolean)

  try {
    const volumeResult = await getKeywordSearchVolumesForPlannerContext({
      userId,
      offerId,
      keywords: keywordTexts,
      country: targetCountry,
      language: targetLanguage,
      plannerSession,
    })
    if (!volumeResult.ok) {
      return keywords as EnhancedKeyword[]
    }
    const volumes = volumeResult.volumes
    const volumeMap = new Map(volumes.map((v) => [v.keyword.toLowerCase(), v]))

    return keywords.map((kw) => {
      const kwLower = (kw.keyword || '').toLowerCase()
      const volumeData = volumeMap.get(kwLower)

      const avgCpc = volumeData
        ? (volumeData.lowTopPageBid + volumeData.highTopPageBid) / 2 / 1000000
        : 1.0

      const competitionLevel = volumeData?.competition?.toLowerCase() || 'medium'
      const competition =
        competitionLevel === 'low' || competitionLevel === 'high'
          ? (competitionLevel as 'low' | 'high')
          : ('medium' as const)

      return {
        keyword: kw.keyword || '',
        searchVolume: volumeData?.avgMonthlySearches || 0,
        cpc: avgCpc,
        competition,
        priority: kw.priority || 'MEDIUM',
        category: kw.category || 'core',
        source: kw.source || 'unknown',
        variants: [],
        trend: 'stable' as const,
        seasonality: 0.5,
        confidence: volumeData ? 0.9 : 0.5,
        estimatedCTR: undefined,
        estimatedConversionRate: undefined,
      }
    })
  } catch (error) {
    console.warn('⚠️ 查询关键词指标失败，使用默认值:', error)
    return keywords.map((kw) => ({
      keyword: kw.keyword || '',
      searchVolume: 1000,
      cpc: 1.0,
      competition: 'medium' as const,
      priority: kw.priority || 'MEDIUM',
      category: kw.category || 'core',
      source: kw.source || 'unknown',
      variants: [],
      trend: 'stable' as const,
      seasonality: 0.5,
      confidence: 0.5,
    }))
  }
}
