import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import type { Offer } from '@/lib/offers/server'
import {
  getPureBrandKeywords,
  containsPureBrand,
  isPureBrandKeyword,
} from '@/lib/keywords/brand/brand-keyword-utils'
import {
  filterLowIntentKeywords,
  filterMismatchedGeoKeywords,
  getBrandSearchSuggestions,
} from '@/lib/keywords/google-suggestions'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { inferBrandAwareMatchType } from './shared/brand-utils'
import { getGlobalKeywordCandidates, mergeGlobalCandidates } from './global-candidates'
import { qualityFilterServiceAccount } from './quality-gates'
import {
  getLanguageCode,
  extractFeaturesFromOffer,
  extractUseCasesFromOffer,
  extractAudienceFromOffer,
  extractCompetitorsFromOffer,
} from './offer-extractors'

interface ServiceAccountExpandParams {
  initialKeywords: PoolKeywordData[]
  brandName: string
  category: string
  targetCountry: string
  targetLanguage: string
  offer: Offer
  userId: number
  progress?: (info: {
    phase?:
      | 'seed-volume'
      | 'expand-round'
      | 'volume-batch'
      | 'service-step'
      | 'filter'
      | 'cluster'
      | 'save'
    message: string
    current?: number
    total?: number
  }) => Promise<void> | void
}

/**
 * 服务账号模式关键词扩展
 *
 * 策略
 * 1. Google下拉词
 * 2. 增强提取
 * 3. Google Trends扩展
 * 4. 质量过滤（无搜索量过滤）
 */
async function expandForServiceAccount(
  params: ServiceAccountExpandParams
): Promise<PoolKeywordData[]> {
  const {
    initialKeywords,
    brandName,
    category,
    targetCountry,
    targetLanguage,
    offer,
    userId,
    progress,
  } = params

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const allKeywords = new Map<string, PoolKeywordData>()

  try {
    // Seed pure-brand keywords (avoid empty brand bucket)
    for (const token of pureBrandKeywords) {
      const canonical = normalizeGoogleAdsKeyword(token)
      if (!canonical) continue
      if (allKeywords.has(canonical)) continue
      allKeywords.set(canonical, {
        keyword: canonical,
        searchVolume: 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        source: 'BRAND_SEED',
        matchType: 'EXACT',
        isPureBrand: true,
      })
    }

    for (const kw of initialKeywords) {
      const canonical = normalizeGoogleAdsKeyword(kw.keyword)
      if (!canonical) continue
      if (!containsPureBrand(canonical, pureBrandKeywords)) continue
      if (!allKeywords.has(canonical)) {
        allKeywords.set(canonical, {
          ...kw,
          keyword: canonical,
          source: kw.source || 'PROVIDED',
          matchType: kw.matchType || 'PHRASE',
          isPureBrand: kw.isPureBrand || isPureBrandKeyword(canonical, pureBrandKeywords),
        })
      }
    }

    // 阶段1: Google下拉词
    await progress?.({
      phase: 'service-step',
      current: 1,
      total: 3,
      message: '关键词池扩展：Google下拉词 (1/3)',
    })
    logger.debug(`\n   📊 阶段1: Google下拉词`)

    try {
      const googleSuggestKeywords = await getBrandSearchSuggestions({
        brand: brandName,
        country: targetCountry,
        language: getLanguageCode(targetLanguage),
        useProxy: true,
        productName: offer.product_name || offer.brand,
        category: offer.category || category,
      })

      // 过滤低意图和地理不匹配
      const filteredSuggest = filterLowIntentKeywords(
        filterMismatchedGeoKeywords(
          googleSuggestKeywords.map((kw) => kw.keyword),
          targetCountry
        )
      )

      logger.debug(`      Google下拉词: ${filteredSuggest.length} 个`)

      for (const text of filteredSuggest) {
        const canonical = normalizeGoogleAdsKeyword(text)
        if (!canonical) continue
        if (!containsPureBrand(canonical, pureBrandKeywords)) continue
        const matchType = inferBrandAwareMatchType(canonical, pureBrandKeywords)

        if (!allKeywords.has(canonical)) {
          allKeywords.set(canonical, {
            keyword: canonical,
            searchVolume: 0,
            competition: 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'GOOGLE_SUGGEST',
            matchType,
            isPureBrand: isPureBrandKeyword(canonical, pureBrandKeywords),
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Google下拉词获取失败: ${error.message}`)
    }

    // 阶段2: 增强提取
    await progress?.({
      phase: 'service-step',
      current: 2,
      total: 3,
      message: '关键词池扩展：增强提取 (2/3)',
    })
    logger.debug(`\n   📊 阶段2: 增强提取`)

    try {
      // 延迟导入避免循环依赖
      const { extractKeywordsEnhanced } = await import('@/lib/keywords/enhanced-keyword-extractor')

      const enhancedKeywords = await extractKeywordsEnhanced(
        {
          productName: offer.product_name || offer.brand,
          brandName: brandName,
          category: offer.category || category,
          description: offer.brand_description || '',
          features: extractFeaturesFromOffer(offer),
          useCases: extractUseCasesFromOffer(offer),
          targetAudience: extractAudienceFromOffer(offer).join(', '),
          competitors: extractCompetitorsFromOffer(offer),
          targetCountry: targetCountry,
          targetLanguage: targetLanguage,
          offerId: offer.id,
        },
        userId
      )

      logger.debug(`      增强提取: ${enhancedKeywords.length} 个`)

      for (const kw of enhancedKeywords) {
        const canonical = normalizeGoogleAdsKeyword(kw.keyword)
        if (!canonical) continue
        if (!containsPureBrand(canonical, pureBrandKeywords)) continue
        const matchType = inferBrandAwareMatchType(canonical, pureBrandKeywords)

        if (!allKeywords.has(canonical)) {
          allKeywords.set(canonical, {
            keyword: canonical,
            searchVolume: 0,
            competition: kw.competition || 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'ENHANCED_EXTRACT',
            matchType,
            isPureBrand: isPureBrandKeyword(canonical, pureBrandKeywords),
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 增强提取失败: ${error.message}`)
    }

    // 移除 Google Trends 关键词生成
    // 原因：Title/About补充 + 行业通用词（Scoring建议）已完全覆盖
    // TRENDS关键词质量不可控（品类识别错误、无意义组合、无搜索量验证）
    logger.debug(`\n   📊 阶段3: Google Trends扩展 [已移除，由Title/About补充+行业通用词替代]`)

    const globalCandidates = await getGlobalKeywordCandidates({
      brandName,
      targetCountry,
      targetLanguage,
      category: offer?.category || category,
    })

    if (globalCandidates.length > 0) {
      const merged = mergeGlobalCandidates({
        allKeywords,
        candidates: globalCandidates,
        pureBrandKeywords,
        brandName,
      })
      logger.debug(`      📦 全局关键词库补充: 新增 ${merged.added}, 更新 ${merged.updated}`)
    }

    logger.debug(`\n   📊 服务账号模式关键词收集完成: ${allKeywords.size} 个`)

    // 质量过滤（无搜索量过滤）
    logger.debug(`\n   📊 质量过滤`)
    const filtered = qualityFilterServiceAccount(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry,
      targetLanguage,
      offer.final_url || offer.url || undefined
    )

    logger.debug(`   过滤后: ${filtered.length} 个关键词`)

    return filtered
  } catch (error: any) {
    console.error(`   ⚠️ 服务账号模式关键词扩展失败: ${error.message}`)
    return initialKeywords
  }
}

export { expandForServiceAccount }
export type { ServiceAccountExpandParams }
