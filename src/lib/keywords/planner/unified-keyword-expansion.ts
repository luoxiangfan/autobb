/**
 * Multi-round intent-aware keyword expansion.
 */
import { getKeywordIdeas } from '@/lib/google-ads/keyword/planner'
import { getKeywordPlannerSiteFilterUrlForOffer } from './keyword-planner-site-filter'
import { containsPureBrand, getPureBrandKeywords } from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  prepareKeywordPlannerSessionForServiceParams,
  keywordPlannerIdeasAuthFromSession,
  keywordPlannerIdeasBlockedReason,
  getKeywordSearchVolumesWithSessionAuth,
} from './unified-keyword-planner-session'
import { buildIntentAwareSeedPool } from './unified-keyword-seed-pool'
import { applySmartFilters, assignMatchTypes, filterByWhitelist } from './unified-keyword-filters'
import type { KeywordServiceParams, UnifiedKeywordData } from './unified-keyword-types'

export interface MultiRoundExpansionResult {
  /** 品牌商品锚点关键词 (legacy 桶A) */
  brandOrientedKeywords: UnifiedKeywordData[]
  /** 商品需求场景关键词 (legacy 桶B) */
  scenarioOrientedKeywords: UnifiedKeywordData[]
  /** 功能规格关键词 (legacy 桶C) */
  featureOrientedKeywords: UnifiedKeywordData[]
  /** 所有关键词（合并去重） */
  allKeywords: UnifiedKeywordData[]
  /** 识别到的竞品品牌 */
  competitorBrands: string[]
  /** 扩展统计 */
  stats: {
    round1Count: number // 品牌商品锚点
    round2Count: number // 商品需求场景
    round3Count: number // 功能规格/需求扩展
    totalBeforeDedup: number
    totalAfterDedup: number
  }
}

/**
 * 多轮意图感知关键词扩展 v2.0
 *
 * 三轮扩展策略：
 * - Round 1: 使用品牌商品锚点种子词 → 获取品牌+产品关键词
 * - Round 2: 使用商品需求场景种子词 → 获取使用场景关键词
 * - Round 3: 使用功能规格/需求扩展种子词 → 获取功能特性关键词
 *
 * @param params - 扩展参数
 * @returns 按意图分类的关键词结果
 */
export async function getMultiRoundIntentAwareKeywords(
  params: KeywordServiceParams
): Promise<MultiRoundExpansionResult> {
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
    serviceAccountId,
    plannerSession,
    minSearchVolume = 100, // 多轮扩展使用较低阈值
    maxKeywords = 500,
  } = params

  console.log('\n' + '='.repeat(60))
  console.log('🎯 多轮意图感知关键词扩展 v2.0')
  console.log('='.repeat(60))
  console.log(`品牌: ${offer.brand}`)
  console.log(`品类: ${offer.category || '未分类'}`)
  console.log(`国家: ${country}, 语言: ${language}`)
  console.log(`认证方式: ${authType}`)

  const pureBrandKeywords = getPureBrandKeywords(offer.brand)
  const plannerAuth = await prepareKeywordPlannerSessionForServiceParams(userId, {
    offerId,
    linkedServiceAccountId,
    serviceAccountId,
    plannerSession,
  })
  const volumeSession = plannerAuth?.ok ? plannerAuth.session : undefined
  const plannerIdeasBlocked = keywordPlannerIdeasBlockedReason(plannerAuth)
  const ideasAuth = keywordPlannerIdeasAuthFromSession(plannerAuth)

  // 1. 构建意图感知种子词池
  console.log('\n📍 Step 1: 构建意图感知种子词池')
  const intentSeeds = buildIntentAwareSeedPool(offer)

  const keywordMap = new Map<string, UnifiedKeywordData>()
  const competitorBrandsSet = new Set<string>()

  // 统计
  let round1Count = 0
  let round2Count = 0
  let round3Count = 0

  // 辅助函数：执行单轮扩展
  const runExpansionRound = async (
    roundName: string,
    roundSeeds: string[],
    roundNum: number
  ): Promise<UnifiedKeywordData[]> => {
    if (roundSeeds.length === 0) {
      console.log(`   ⚠️ ${roundName}: 无种子词，跳过`)
      return []
    }

    console.log(`\n📍 Round ${roundNum}: ${roundName}`)
    console.log(
      `   种子词: ${roundSeeds.slice(0, 5).join(', ')}${roundSeeds.length > 5 ? '...' : ''}`
    )

    const roundKeywords: UnifiedKeywordData[] = []

    if (customerId && userId) {
      if (plannerIdeasBlocked) {
        console.warn(`   ⚠️ 跳过 ${roundName} Keyword Planner: ${plannerIdeasBlocked}`)
      } else if (!ideasAuth) {
        console.warn(`   ⚠️ 跳过 ${roundName} Keyword Planner: session auth unavailable`)
      } else {
        try {
          const keywordIdeas = await getKeywordIdeas({
            customerId,
            seedKeywords: roundSeeds,
            pageUrl: getKeywordPlannerSiteFilterUrlForOffer({
              final_url: (offer as any).final_url || (offer as any).finalUrl || null,
              url: offer.url,
              extraction_metadata: (offer as any).extraction_metadata || null,
            }),
            targetCountry: country,
            targetLanguage: language,
            accountId,
            userId,
            authType: ideasAuth.authType,
            serviceAccountId: ideasAuth.serviceAccountId,
            preparedOAuth: ideasAuth.preparedOAuth,
          })

          console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个建议`)

          keywordIdeas.forEach((idea) => {
            roundKeywords.push({
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
          console.error(`   ❌ ${roundName} 扩展失败:`, error.message)
        }
      }
    }

    return roundKeywords
  }

  // 2. Round 1: 品牌导向扩展
  const brandKeywords = await runExpansionRound(
    '品牌商品锚点 (Brand Product Anchor)',
    intentSeeds.brandOrientedSeeds,
    1
  )
  round1Count = brandKeywords.length

  // 3. Round 2: 场景导向扩展
  const scenarioKeywords = await runExpansionRound(
    '商品需求场景 (Demand Scenario)',
    intentSeeds.scenarioOrientedSeeds,
    2
  )
  round2Count = scenarioKeywords.length

  // 4. Round 3: 功能导向扩展
  const featureKeywords = await runExpansionRound(
    '功能规格/需求扩展 (Feature / Demand Expansion)',
    intentSeeds.featureOrientedSeeds,
    3
  )
  round3Count = featureKeywords.length

  // 5. 合并去重
  console.log('\n📍 Step 5: 合并去重')
  const totalBeforeDedup = brandKeywords.length + scenarioKeywords.length + featureKeywords.length

  // 添加到 keywordMap（自动去重）
  const addToMap = (keywords: UnifiedKeywordData[], source: string) => {
    keywords.forEach((kw) => {
      const canonical = normalizeGoogleAdsKeyword(kw.keyword)
      if (!canonical) return
      if (!keywordMap.has(canonical)) {
        keywordMap.set(canonical, { ...kw, source: source as any })
      } else {
        // 如果已存在，保留搜索量更高的
        const existing = keywordMap.get(canonical)!
        if (kw.searchVolume > existing.searchVolume) {
          keywordMap.set(canonical, { ...kw, source: source as any })
        }
      }
    })
  }

  addToMap(brandKeywords, 'BRAND')
  addToMap(scenarioKeywords, 'CATEGORY')
  addToMap(featureKeywords, 'FEATURE')

  // 6. 白名单过滤
  console.log('\n📍 Step 6: 白名单过滤')
  let allKeywords = Array.from(keywordMap.values())
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  whitelistResult.competitorBrands.forEach((b) => competitorBrandsSet.add(b))

  // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
  // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
  console.log(`\n✅ 关键词过滤完成，共 ${allKeywords.length} 个关键词`)

  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = allKeywords.length
    allKeywords = allKeywords.filter((kw) => containsPureBrand(kw.keyword, pureBrandKeywords))
    console.log(`   🔒 品牌强制过滤: ${beforeBrandFilter} → ${allKeywords.length}`)
  }

  // 7. 按搜索量降序排序（关键修复：先排序再截取）
  console.log('\n📍 Step 7: 按搜索量降序排序')
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)
  console.log(
    `   📊 排序后搜索量范围: ${allKeywords[allKeywords.length - 1]?.searchVolume || 0} - ${allKeywords[0]?.searchVolume || 0}`
  )

  // 8. 获取精确搜索量（对搜索量最高的前1000个关键词）
  console.log('\n📍 Step 8: 获取精确搜索量（前1000个）')
  let disableSearchVolumeFilter = false
  let metricsAvailable = false
  try {
    if (!volumeSession) {
      throw new Error(plannerAuth && !plannerAuth.ok ? plannerAuth.message : 'userId is required')
    }
    const volumes = await getKeywordSearchVolumesWithSessionAuth(
      allKeywords.slice(0, 1000).map((kw) => kw.keyword),
      country,
      language,
      userId,
      volumeSession
    )

    disableSearchVolumeFilter = volumes.some(
      (vol: any) => vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )
    if (volumes.length > 0 && !disableSearchVolumeFilter) {
      metricsAvailable = true
    }

    volumes.forEach((vol) => {
      const canonical = normalizeGoogleAdsKeyword(vol.keyword)
      if (!canonical) return
      // 更新 keywordMap 中的搜索量
      allKeywords.forEach((kw, idx) => {
        if (normalizeGoogleAdsKeyword(kw.keyword) === canonical) {
          allKeywords[idx] = {
            ...kw,
            searchVolume: vol.avgMonthlySearches,
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            lowTopPageBid: vol.lowTopPageBid,
            highTopPageBid: vol.highTopPageBid,
          }
        }
      })
    })
    console.log(`   ✅ 更新 ${volumes.length} 个关键词的搜索量`)
  } catch (error: any) {
    console.error('   ❌ 获取搜索量失败:', error.message)
  }
  if (!metricsAvailable) {
    disableSearchVolumeFilter = true
  }

  // 9. 智能过滤 + 匹配类型分配
  console.log('\n📍 Step 9: 智能过滤')
  allKeywords = applySmartFilters(allKeywords, minSearchVolume, 30, {
    disableSearchVolumeFilter,
    pureBrandKeywords,
  })
  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // 10. 再次按搜索量排序（确保最终排序正确）
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  // 11. 限制数量
  allKeywords = allKeywords.slice(0, maxKeywords)

  // 11. 按意图重新分类（基于关键词内容）
  const classifyByIntent = (kw: UnifiedKeywordData): 'brand' | 'scenario' | 'feature' => {
    const kwLower = kw.keyword.toLowerCase()

    // 品牌商品锚点：包含品牌名
    if (containsPureBrand(kw.keyword, pureBrandKeywords)) {
      return 'brand'
    }

    // 功能规格：包含功能/规格词
    const featurePatterns = [
      'wireless',
      'night vision',
      '4k',
      '2k',
      '1080p',
      'solar',
      'battery',
      'motion',
      'detection',
      'audio',
      'storage',
      'waterproof',
      'ptz',
      'hd',
      'best',
      'top',
      'cheap',
      'affordable',
      'budget',
    ]
    if (featurePatterns.some((p) => kwLower.includes(p))) {
      return 'feature'
    }

    // 默认：商品需求场景
    return 'scenario'
  }

  const brandOrientedKeywords = allKeywords.filter((kw) => classifyByIntent(kw) === 'brand')
  const scenarioOrientedKeywords = allKeywords.filter((kw) => classifyByIntent(kw) === 'scenario')
  const featureOrientedKeywords = allKeywords.filter((kw) => classifyByIntent(kw) === 'feature')

  // 输出统计
  console.log('\n' + '='.repeat(60))
  console.log('✅ 多轮意图感知扩展完成')
  console.log('='.repeat(60))
  console.log(`📊 扩展统计:`)
  console.log(`   Round 1 (品牌商品锚点): ${round1Count} 个`)
  console.log(`   Round 2 (商品需求场景): ${round2Count} 个`)
  console.log(`   Round 3 (功能规格/需求扩展): ${round3Count} 个`)
  console.log(`   合并前总计: ${totalBeforeDedup} 个`)
  console.log(`   去重后总计: ${allKeywords.length} 个`)
  console.log(`\n📊 意图分类结果:`)
  console.log(`   🏷️ 品牌商品锚点: ${brandOrientedKeywords.length} 个`)
  console.log(`   🏠 商品需求场景: ${scenarioOrientedKeywords.length} 个`)
  console.log(`   ⚙️ 功能规格/需求扩展: ${featureOrientedKeywords.length} 个`)

  if (competitorBrandsSet.size > 0) {
    console.log(`\n🏷️ 识别竞品品牌: ${Array.from(competitorBrandsSet).join(', ')}`)
  }

  return {
    brandOrientedKeywords,
    scenarioOrientedKeywords,
    featureOrientedKeywords,
    allKeywords,
    competitorBrands: Array.from(competitorBrandsSet),
    stats: {
      round1Count,
      round2Count,
      round3Count,
      totalBeforeDedup,
      totalAfterDedup: allKeywords.length,
    },
  }
}
