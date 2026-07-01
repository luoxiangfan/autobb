/**
 * 统一关键词服务 v2.0 — orchestration entrypoints.
 */
import { logger } from '@/lib/common/server'
import { getKeywordIdeas } from '@/lib/google-ads/keyword/planner'
import { DEFAULTS } from '../keyword-constants'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  prepareKeywordPlannerSessionForServiceParams,
  keywordPlannerIdeasAuthFromSession,
  keywordPlannerIdeasBlockedReason,
  getKeywordSearchVolumesWithSessionAuth,
} from './unified-keyword-planner-session'
import { buildSmartSeedPool, expandWithoutKeywordPlanner } from './unified-keyword-seed-pool'
import { applySmartFilters, assignMatchTypes, filterByWhitelist } from './unified-keyword-filters'
import type {
  KeywordServiceParams,
  UnifiedKeywordData,
  UnifiedKeywordResult,
} from './unified-keyword-types'

export type {
  IntentAwareSeedPool,
  KeywordPlannerSessionAuth,
  KeywordPlannerSessionAuthResult,
  KeywordServiceParams,
  OfferData,
  UnifiedKeywordData,
  UnifiedKeywordResult,
  VerifiedKeywordSourcePool,
  WhitelistFilterResult,
} from './unified-keyword-types'

export {
  prepareKeywordPlannerSessionAuth,
  keywordPlannerIdeasAuthFromSession,
  keywordPlannerIdeasBlockedReason,
} from './unified-keyword-planner-session'

export {
  buildIntentAwareSeedPool,
  extractVerifiedKeywordSourcePool,
} from './unified-keyword-seed-pool'

export { applySmartFilters } from './unified-keyword-filters'

export type { MultiRoundExpansionResult } from './unified-keyword-expansion'
export { getMultiRoundIntentAwareKeywords } from './unified-keyword-expansion'

export {
  getKeywordVolumesForExisting,
  expandKeywordsWithSeeds,
  extractGenericHighValueKeywords,
} from './unified-keyword-volumes-expand'

export async function getUnifiedKeywordData(
  params: KeywordServiceParams
): Promise<UnifiedKeywordResult> {
  const {
    offer,
    country,
    language,
    customerId,
    accountId,
    userId,
    authType = 'oauth',
    offerId,
    linkedServiceAccountId,
    plannerSession,
    minSearchVolume = 500,
    maxKeywords = 500,
  } = params

  logger.debug('\n' + '='.repeat(60))
  logger.debug('🔄 统一关键词服务 v2.0 启动')
  logger.debug('='.repeat(60))
  logger.debug(`品牌: ${offer.brand}`)
  logger.debug(`国家: ${country}, 语言: ${language}`)
  logger.debug(`认证方式: ${authType}`)

  const pureBrandKeywords = getPureBrandKeywords(offer.brand)
  const plannerAuth = await prepareKeywordPlannerSessionForServiceParams(userId, {
    offerId,
    linkedServiceAccountId,
    plannerSession,
  })
  const volumeSession = plannerAuth?.ok ? plannerAuth.session : undefined
  const plannerIdeasBlocked = keywordPlannerIdeasBlockedReason(plannerAuth)
  const ideasAuth = keywordPlannerIdeasAuthFromSession(plannerAuth)

  const keywordMap = new Map<string, UnifiedKeywordData>()
  let disableSearchVolumeFilter = false
  let keywordPlannerAvailable = false
  let keywordPlannerMetricsAvailable = false

  const addToKeywordMap = (data: UnifiedKeywordData) => {
    const canonical = normalizeGoogleAdsKeyword(data.keyword)
    if (!canonical) return
    if (!keywordMap.has(canonical)) {
      keywordMap.set(canonical, { ...data, keyword: data.keyword })
    }
  }

  // Step 1: 构建智能种子词池

  logger.debug('\n📍 Step 1: 构建智能种子词池')
  const smartSeeds = buildSmartSeedPool(offer)
  const brandRelatedSeeds = smartSeeds.filter((seed) => containsPureBrand(seed, pureBrandKeywords))
  const seedKeywordsForPlanner = Array.from(new Set([...pureBrandKeywords, ...brandRelatedSeeds]))

  if (smartSeeds.length === 0) {
    logger.debug('   ⚠️ 无法构建种子词池，返回空结果')
    return { keywords: [], competitorBrands: [] }
  }

  // Step 2: Keyword Planner 查询

  logger.debug('\n📍 Step 2: Keyword Planner 查询')

  if (customerId && userId) {
    if (plannerIdeasBlocked) {
      console.warn(`   ⚠️ 跳过 Keyword Planner 查询: ${plannerIdeasBlocked}`)
    } else if (!ideasAuth) {
      console.warn('   ⚠️ 跳过 Keyword Planner 查询: session auth unavailable')
    } else {
      try {
        const keywordIdeas = await getKeywordIdeas({
          customerId,
          seedKeywords: seedKeywordsForPlanner,
          targetCountry: country,
          targetLanguage: language,
          accountId,
          userId,
          authType: ideasAuth.authType,
          serviceAccountId: ideasAuth.serviceAccountId,
          preparedOAuth: ideasAuth.preparedOAuth,
        })

        logger.debug(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)
        keywordPlannerAvailable = keywordIdeas.length > 0

        // 转换为统一格式
        keywordIdeas.forEach((idea) => {
          const canonical = normalizeGoogleAdsKeyword(idea.text)
          if (!canonical) return
          addToKeywordMap({
            keyword: idea.text,
            searchVolume: idea.avgMonthlySearches || 0,
            competition: idea.competition || 'UNKNOWN',
            competitionIndex: idea.competitionIndex || 0,
            lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
            highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
            source: 'EXPANSION',
            matchType: 'PHRASE',
          })
        })
      } catch (error: any) {
        console.error(`   ❌ Keyword Planner 查询失败:`, error.message)
      }
    }
  } else {
    logger.debug('   ⚠️ 缺少 Google Ads 凭证，跳过 Keyword Planner 查询')
  }

  if (!keywordPlannerAvailable) {
    const fallbackKeywords = await expandWithoutKeywordPlanner({
      offer,
      country,
      language,
      userId,
    })

    fallbackKeywords.forEach((kw) => addToKeywordMap(kw))
  }

  // 添加种子词本身（确保品牌词被包含）
  const seedKeywordsToAdd = keywordPlannerAvailable
    ? pureBrandKeywords
    : Array.from(new Set([...brandRelatedSeeds, ...pureBrandKeywords]))

  for (const seed of seedKeywordsToAdd) {
    const matchType = isPureBrandKeyword(seed, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
    addToKeywordMap({
      keyword: seed,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND',
      matchType,
    })
  }

  // Step 2.5: 按搜索量降序排序（关键先排序再截取）

  logger.debug('\n📍 Step 2.5: 按搜索量降序排序')

  let allKeywords = Array.from(keywordMap.values())
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  logger.debug(`   📊 Keyword Planner返回 ${allKeywords.length} 个关键词`)
  if (allKeywords.length > 0) {
    logger.debug(
      `   📊 排序后搜索量范围: ${allKeywords[allKeywords.length - 1]?.searchVolume || 0} - ${allKeywords[0]?.searchVolume || 0}`
    )
  }

  // Step 2.6: 获取精确搜索量（只对搜索量最高的前1000个）

  logger.debug('\n📍 Step 2.6: 获取精确搜索量（前1000个）')

  const topKeywordsForVolume = allKeywords.slice(0, 1000).map((kw) => kw.keyword)

  try {
    if (!volumeSession) {
      throw new Error(plannerAuth && !plannerAuth.ok ? plannerAuth.message : 'userId is required')
    }
    const volumes = await getKeywordSearchVolumesWithSessionAuth(
      topKeywordsForVolume,
      country,
      language,
      userId,
      volumeSession
    )

    disableSearchVolumeFilter = volumes.some(
      (vol: any) => vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )

    // 更新搜索量（只更新前1000个）
    volumes.forEach((vol) => {
      const canonical = normalizeGoogleAdsKeyword(vol.keyword)
      if (!canonical) return
      const existing = keywordMap.get(canonical)
      if (existing) {
        keywordMap.set(canonical, {
          ...existing,
          searchVolume: vol.avgMonthlySearches,
          competition: vol.competition,
          competitionIndex: vol.competitionIndex,
          lowTopPageBid: vol.lowTopPageBid,
          highTopPageBid: vol.highTopPageBid,
        })
      }
    })

    logger.debug(`   ✅ 更新 ${volumes.length} 个关键词的精确搜索量`)

    // 关键：重新从Map生成数组，确保更新后的搜索量生效
    allKeywords = Array.from(keywordMap.values())
  } catch (error: any) {
    console.error(`   ❌ 获取精确搜索量失败:`, error.message)
    // allKeywords已在Step 2.5生成，使用Keyword Planner的初始搜索量
  }

  const topKeywordSet = new Set(
    topKeywordsForVolume.map((kw) => normalizeGoogleAdsKeyword(kw)).filter(Boolean)
  )
  const brandSeedToQuery = pureBrandKeywords.filter((kw) => {
    const canonical = normalizeGoogleAdsKeyword(kw)
    return canonical && !topKeywordSet.has(canonical)
  })

  if (brandSeedToQuery.length > 0 && userId && volumeSession) {
    try {
      const volumes = await getKeywordSearchVolumesWithSessionAuth(
        brandSeedToQuery,
        country,
        language,
        userId,
        volumeSession
      )

      if (
        volumes.some((vol: any) => vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS')
      ) {
        disableSearchVolumeFilter = true
      }
      if (volumes.length > 0 && !disableSearchVolumeFilter) {
        keywordPlannerMetricsAvailable = true
      }

      volumes.forEach((vol) => {
        const canonical = normalizeGoogleAdsKeyword(vol.keyword)
        if (!canonical) return
        const existing = keywordMap.get(canonical)
        if (existing) {
          keywordMap.set(canonical, {
            ...existing,
            searchVolume: vol.avgMonthlySearches,
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            lowTopPageBid: vol.lowTopPageBid,
            highTopPageBid: vol.highTopPageBid,
          })
        }
      })
    } catch (error: any) {
      console.warn(`   ⚠️ 品牌词搜索量查询失败:`, error.message)
    }
  }

  // Step 3: 品牌词优先 + 按搜索量降序排序

  logger.debug('\n📍 Step 3: 品牌词优先排序')

  // 优化2: 品牌词优先排序
  // 排序规则：1. 品牌词优先 2. 按搜索量降序
  allKeywords.sort((a, b) => {
    const aIsBrand = containsPureBrand(a.keyword, pureBrandKeywords) ? 1 : 0
    const bIsBrand = containsPureBrand(b.keyword, pureBrandKeywords) ? 1 : 0

    // 品牌词优先
    if (aIsBrand !== bIsBrand) {
      return bIsBrand - aIsBrand
    }

    // 同类型内按搜索量降序
    return b.searchVolume - a.searchVolume
  })

  // 统计品牌词数量
  const brandKeywordCount = allKeywords.filter((kw) =>
    containsPureBrand(kw.keyword, pureBrandKeywords)
  ).length

  logger.debug(`   总关键词数: ${allKeywords.length}`)
  logger.debug(`   🏷️ 品牌词数量: ${brandKeywordCount}`)
  if (allKeywords.length > 0) {
    logger.debug(
      `   搜索量范围: ${allKeywords[allKeywords.length - 1].searchVolume} - ${allKeywords[0].searchVolume}`
    )
  }

  // Step 4: 白名单过滤

  logger.debug('\n📍 Step 4: 白名单过滤')

  // 提取竞品品牌用于否定关键词
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  const competitorBrands = whitelistResult.competitorBrands

  // 移除品类过滤 - 避免误杀有效关键词
  // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
  logger.debug(`\n✅ 关键词过滤完成，共 ${allKeywords.length} 个关键词`)

  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = allKeywords.length
    allKeywords = allKeywords.filter((kw) => containsPureBrand(kw.keyword, pureBrandKeywords))
    logger.debug(`   🔒 品牌强制过滤: ${beforeBrandFilter} → ${allKeywords.length}`)
  }

  if (!keywordPlannerMetricsAvailable) {
    disableSearchVolumeFilter = true
  }

  // Step 5: 智能过滤

  logger.debug('\n📍 Step 5: 智能过滤')

  allKeywords = applySmartFilters(allKeywords, minSearchVolume, DEFAULTS.minKeywordsTarget, {
    disableSearchVolumeFilter,
    pureBrandKeywords,
  })

  // Step 6: 智能匹配类型分配

  logger.debug('\n📍 Step 6: 智能匹配类型分配')

  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // 最终结果

  const finalKeywords = allKeywords.slice(0, maxKeywords)

  logger.debug('\n' + '='.repeat(60))
  logger.debug('✅ 统一关键词服务完成')
  logger.debug('='.repeat(60))
  logger.debug(`最终关键词数: ${finalKeywords.length}`)

  // 打印 Top 10
  logger.debug('\n📊 Top 10 关键词:')
  finalKeywords.slice(0, 10).forEach((kw, i) => {
    logger.debug(
      `   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月, ${kw.matchType})`
    )
  })

  // 统计匹配类型分布
  const matchTypeCounts = finalKeywords.reduce(
    (acc, kw) => {
      acc[kw.matchType] = (acc[kw.matchType] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  logger.debug('\n📊 匹配类型分布:')
  Object.entries(matchTypeCounts).forEach(([type, count]) => {
    logger.debug(`   ${type}: ${count}`)
  })

  // 输出识别到的竞品品牌
  if (competitorBrands.length > 0) {
    logger.debug(`\n🏷️ 识别竞品品牌 (${competitorBrands.length}个，可用作否定关键词):`)
    competitorBrands.forEach((brand) => {
      logger.debug(`   - ${brand}`)
    })
  }

  return {
    keywords: finalKeywords,
    competitorBrands,
  }
}
