/**
 * 增强的关键词提取器 (P0优化)
 */
import {
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import type { EnhancedKeyword, KeywordExtractionInput } from './enhanced-keyword-extractor-types'
import {
  extractBrandKeywords,
  extractCompetitorKeywords,
  extractCoreKeywords,
  extractIntentKeywords,
  extractLongtailKeywords,
} from './enhanced-keyword-extractor-layers'
import { enrichKeywordsWithMetrics } from './enhanced-keyword-extractor-metrics'
import {
  deduplicateKeywords,
  filterAndRankKeywords,
  generateKeywordVariants,
} from './enhanced-keyword-extractor-utils'

export type { EnhancedKeyword, KeywordExtractionInput } from './enhanced-keyword-extractor-types'

export async function extractKeywordsEnhanced(
  input: KeywordExtractionInput,
  userId: number
): Promise<EnhancedKeyword[]> {
  const {
    productName,
    brandName,
    category,
    features,
    useCases,
    targetAudience,
    competitors,
    targetCountry,
    targetLanguage,
  } = input

  console.log('🔍 开始增强的关键词提取...')

  try {
    console.log('📌 提取品牌关键词...')
    const brandKeywords = await extractBrandKeywords(
      brandName,
      category,
      targetCountry,
      targetLanguage
    )

    console.log('📌 提取产品核心词...')
    const coreKeywords = await extractCoreKeywords(
      productName,
      category,
      features,
      targetCountry,
      targetLanguage
    )

    console.log('📌 提取购买意图词...')
    const intentKeywords = await extractIntentKeywords(
      category,
      targetCountry,
      targetLanguage,
      brandName
    )

    console.log('📌 提取长尾精准词...')
    const longtailKeywords = await extractLongtailKeywords(
      features,
      useCases,
      targetAudience,
      targetCountry,
      targetLanguage
    )

    console.log('📌 提取竞争对手词...')
    const competitorKeywords = await extractCompetitorKeywords(
      competitors,
      targetCountry,
      targetLanguage
    )

    let allKeywords = [
      ...brandKeywords,
      ...coreKeywords,
      ...intentKeywords,
      ...longtailKeywords,
      ...competitorKeywords,
    ]

    console.log('🔄 执行关键词去重...')
    allKeywords = deduplicateKeywords(allKeywords)

    console.log('📊 查询关键词指标...')
    let plannerSession: KeywordPlannerPreparedSession | undefined
    if (input.offerId) {
      const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, input.offerId)
      if (expandLoad.ok) {
        plannerSession = expandLoad.plannerSession
      }
    }
    const withMetrics = await enrichKeywordsWithMetrics(
      allKeywords,
      targetCountry,
      targetLanguage,
      userId,
      input.offerId,
      plannerSession
    )

    console.log('⚙️ 过滤和排序关键词...')
    const filtered = filterAndRankKeywords(withMetrics, {
      minSearchVolume: 100,
      maxCPC: 50,
    })

    console.log('🌍 生成多语言变体...')
    const withVariants = await generateKeywordVariants(filtered, targetLanguage)

    console.log(`✅ 关键词提取完成，共${withVariants.length}个关键词`)
    return withVariants
  } catch (error) {
    console.error('❌ 关键词提取失败:', error)
    throw error
  }
}
