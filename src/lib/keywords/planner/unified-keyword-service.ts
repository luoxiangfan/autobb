/**
 * 统一关键词服务 v2.0 — orchestration entrypoints.
 */
import { getKeywordIdeas } from '@/lib/google-ads/keyword/planner'
import { DEFAULTS } from '../keyword-constants'
import { getKeywordPlannerSiteFilterUrlForOffer } from './keyword-planner-site-filter'
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
  getKeywordSearchVolumesWithPreparedAuth,
} from './unified-keyword-planner-session'
import {
  buildIntentAwareSeedPool,
  buildSmartSeedPool,
  expandWithoutKeywordPlanner,
} from './unified-keyword-seed-pool'
import {
  applySmartFilters,
  assignMatchTypes,
  filterByWhitelist,
  escapeRegex,
} from './unified-keyword-filters'
import { resolveKeywordPlannerLinkedServiceAccountId } from '@/lib/google-ads/accounts/auth/index'
import type {
  KeywordPlannerSessionAuth,
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

/**
 * 统一关键词数据获取服务 v2.0
 *
 * 流程：
 * 1. 构建智能种子词池
 * 2. Keyword Planner 查询（获取所有结果）
 * 3. 按搜索量降序排序
 * 4. 白名单过滤
 * 5. 智能过滤 + 匹配类型分配
 *
 * 调用方须传入 `offerId` 或 `linkedServiceAccountId`，并优先传入
 * `loadKeywordPoolExpandCredentialsForOffer` 的 `plannerSession`，避免重复 prepare/heal。
 * 生产入口：Launch 创意生成 / 发布流程（`getUnifiedKeywordData` 由 offer-keyword-pool 与发布链路调用）。
 */
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
    serviceAccountId,
    plannerSession,
    minSearchVolume = 500,
    maxKeywords = 500,
  } = params

  console.log('\n' + '='.repeat(60))
  console.log('🔄 统一关键词服务 v2.0 启动')
  console.log('='.repeat(60))
  console.log(`品牌: ${offer.brand}`)
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

  // ==========================================
  // Step 1: 构建智能种子词池
  // ==========================================
  console.log('\n📍 Step 1: 构建智能种子词池')
  const smartSeeds = buildSmartSeedPool(offer)
  const brandRelatedSeeds = smartSeeds.filter((seed) => containsPureBrand(seed, pureBrandKeywords))
  const seedKeywordsForPlanner = Array.from(new Set([...pureBrandKeywords, ...brandRelatedSeeds]))

  if (smartSeeds.length === 0) {
    console.log('   ⚠️ 无法构建种子词池，返回空结果')
    return { keywords: [], competitorBrands: [] }
  }

  // ==========================================
  // Step 2: Keyword Planner 查询
  // ==========================================
  console.log('\n📍 Step 2: Keyword Planner 查询')

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

        console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)
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
    console.log('   ⚠️ 缺少 Google Ads 凭证，跳过 Keyword Planner 查询')
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

  // ==========================================
  // Step 2.5: 按搜索量降序排序（关键修复：先排序再截取）
  // ==========================================
  console.log('\n📍 Step 2.5: 按搜索量降序排序')

  let allKeywords = Array.from(keywordMap.values())
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`   📊 Keyword Planner返回 ${allKeywords.length} 个关键词`)
  if (allKeywords.length > 0) {
    console.log(
      `   📊 排序后搜索量范围: ${allKeywords[allKeywords.length - 1]?.searchVolume || 0} - ${allKeywords[0]?.searchVolume || 0}`
    )
  }

  // ==========================================
  // Step 2.6: 获取精确搜索量（只对搜索量最高的前1000个）
  // ==========================================
  console.log('\n📍 Step 2.6: 获取精确搜索量（前1000个）')

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

    console.log(`   ✅ 更新 ${volumes.length} 个关键词的精确搜索量`)

    // 🔥 关键：重新从Map生成数组，确保更新后的搜索量生效
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

  // ==========================================
  // Step 3: 品牌词优先 + 按搜索量降序排序
  // ==========================================
  console.log('\n📍 Step 3: 品牌词优先排序')

  // 🆕 优化2: 品牌词优先排序
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

  console.log(`   总关键词数: ${allKeywords.length}`)
  console.log(`   🏷️ 品牌词数量: ${brandKeywordCount}`)
  if (allKeywords.length > 0) {
    console.log(
      `   搜索量范围: ${allKeywords[allKeywords.length - 1].searchVolume} - ${allKeywords[0].searchVolume}`
    )
  }

  // ==========================================
  // Step 4: 白名单过滤
  // ==========================================
  console.log('\n📍 Step 4: 白名单过滤')

  // 🆕 P0-2优化：提取竞品品牌用于否定关键词
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  const competitorBrands = whitelistResult.competitorBrands

  // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
  // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
  console.log(`\n✅ 关键词过滤完成，共 ${allKeywords.length} 个关键词`)

  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = allKeywords.length
    allKeywords = allKeywords.filter((kw) => containsPureBrand(kw.keyword, pureBrandKeywords))
    console.log(`   🔒 品牌强制过滤: ${beforeBrandFilter} → ${allKeywords.length}`)
  }

  if (!keywordPlannerMetricsAvailable) {
    disableSearchVolumeFilter = true
  }

  // ==========================================
  // Step 5: 智能过滤
  // ==========================================
  console.log('\n📍 Step 5: 智能过滤')

  allKeywords = applySmartFilters(allKeywords, minSearchVolume, DEFAULTS.minKeywordsTarget, {
    disableSearchVolumeFilter,
    pureBrandKeywords,
  })

  // ==========================================
  // Step 6: 智能匹配类型分配
  // ==========================================
  console.log('\n📍 Step 6: 智能匹配类型分配')

  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // ==========================================
  // 最终结果
  // ==========================================
  const finalKeywords = allKeywords.slice(0, maxKeywords)

  console.log('\n' + '='.repeat(60))
  console.log('✅ 统一关键词服务完成')
  console.log('='.repeat(60))
  console.log(`最终关键词数: ${finalKeywords.length}`)

  // 打印 Top 10
  console.log('\n📊 Top 10 关键词:')
  finalKeywords.slice(0, 10).forEach((kw, i) => {
    console.log(
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

  console.log('\n📊 匹配类型分布:')
  Object.entries(matchTypeCounts).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`)
  })

  // 🆕 P0-2优化：输出识别到的竞品品牌
  if (competitorBrands.length > 0) {
    console.log(`\n🏷️ 识别竞品品牌 (${competitorBrands.length}个，可用作否定关键词):`)
    competitorBrands.forEach((brand) => {
      console.log(`   - ${brand}`)
    })
  }

  return {
    keywords: finalKeywords,
    competitorBrands,
  }
}

// ============================================
// 向后兼容：获取现有关键词的搜索量
// ============================================

/**
 * 获取现有关键词列表的搜索量数据
 *
 * 用于 ad-creative-generator.ts 等场景，AI 已生成关键词列表，
 * 只需要获取这些关键词的搜索量数据。
 *
 * @param params.baseKeywords - 已有的关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（可选，用于匹配类型分配）
 */
export async function getKeywordVolumesForExisting(params: {
  baseKeywords: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  serviceAccountId?: string
  offerId?: number
}): Promise<UnifiedKeywordData[]> {
  const { baseKeywords, country, language, userId, brandName, serviceAccountId, offerId } = params

  if (!baseKeywords || baseKeywords.length === 0) {
    return []
  }

  console.log(`\n📊 获取 ${baseKeywords.length} 个关键词的搜索量数据`)

  try {
    const linkedSa = userId
      ? await resolveKeywordPlannerLinkedServiceAccountId({
          userId,
          offerId,
          serviceAccountId: serviceAccountId ?? null,
        })
      : null

    // 直接使用 Historical Metrics API 获取精确搜索量
    const volumes = await getKeywordSearchVolumesWithPreparedAuth(
      baseKeywords,
      country,
      language,
      userId,
      linkedSa
    )

    // 转换为 UnifiedKeywordData 格式
    const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []

    const results: UnifiedKeywordData[] = volumes.map((vol) => {
      // 智能分配匹配类型
      let matchType: 'EXACT' | 'PHRASE' | 'BROAD' = 'PHRASE'
      if (pureBrandKeywords.length > 0 && isPureBrandKeyword(vol.keyword, pureBrandKeywords)) {
        matchType = 'EXACT' // 纯品牌词用精准匹配
      } else if (
        pureBrandKeywords.length > 0 &&
        containsPureBrand(vol.keyword, pureBrandKeywords)
      ) {
        matchType = 'PHRASE' // 品牌相关词用词组匹配
      } else if (vol.keyword.split(/\s+/).length <= 3) {
        matchType = 'PHRASE' // 短词用词组匹配
      } else {
        matchType = 'PHRASE' // 长尾词默认词组匹配，避免兜底放量
      }

      return {
        keyword: vol.keyword,
        searchVolume: vol.avgMonthlySearches,
        competition: vol.competition,
        competitionIndex: vol.competitionIndex,
        lowTopPageBid: vol.lowTopPageBid,
        highTopPageBid: vol.highTopPageBid,
        volumeUnavailableReason: vol.volumeUnavailableReason,
        source: 'BRAND' as const,
        matchType,
      }
    })

    console.log(`✅ 获取搜索量完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 获取关键词搜索量失败:', error.message)
    // 返回带默认搜索量的结果
    return baseKeywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND' as const,
      matchType: 'PHRASE' as const,
    }))
  }
}

// ============================================
// 向后兼容：使用自定义种子词扩展关键词
// ============================================

/**
 * 使用自定义种子词扩展关键词
 *
 * 用于 ad-creative-generator.ts 多轮扩展场景，
 * 使用指定的种子词通过 Keyword Planner 获取扩展关键词。
 *
 * @param params.expansionSeeds - 种子关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（用于白名单过滤和匹配类型分配）
 */
export async function expandKeywordsWithSeeds(params: {
  expansionSeeds: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  pageUrl?: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
  // 认证类型（支持服务账号模式；日志用）
  authType?: 'oauth' | 'service_account'
  offerId?: number
  linkedServiceAccountId?: string | null
  /** @deprecated 请用 linkedServiceAccountId */
  serviceAccountId?: string
  /** 已由关键词池 expand 单次 prepare 时传入，避免每轮重复 heal */
  plannerSession?: KeywordPlannerSessionAuth
  minSearchVolume?: number
  maxKeywords?: number
  onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
}): Promise<UnifiedKeywordData[]> {
  const {
    expansionSeeds,
    country,
    language,
    userId,
    brandName,
    pageUrl,
    customerId,
    accountId,
    authType = 'oauth',
    offerId,
    linkedServiceAccountId,
    serviceAccountId,
    plannerSession: preloadedPlannerSession,
    minSearchVolume = 500,
    maxKeywords = 100,
    onProgress,
  } = params

  console.log(`认证方式: ${authType}`)

  if (!expansionSeeds || expansionSeeds.length === 0) {
    return []
  }

  // 🔧 优化(2025-12-26): 多词品牌名添加可用的短品牌词种子
  // 解决：当品牌名为"Wahl Professional"时，Keyword Planner只返回包含完整品牌名的关键词，
  // 无法获取"wahl detailer"、"wahl peanut"等只包含短品牌词的产品型号关键词
  let finalSeedKeywords = [...expansionSeeds]

  if (brandName && brandName.includes(' ')) {
    const pureBrandKeywords = getPureBrandKeywords(brandName)
    const shortBrand = pureBrandKeywords.find((kw) => kw.split(/\s+/).length === 1)

    if (shortBrand) {
      const brandWords = normalizeGoogleAdsKeyword(brandName).split(/\s+/).filter(Boolean)
      const firstWord = brandWords[0]
      const shortLower = shortBrand.toLowerCase()

      const additionalSeeds = [shortBrand, `${shortLower} products`]

      if (firstWord && firstWord === shortLower && brandWords.length > 1) {
        additionalSeeds.push(`${shortLower} ${brandWords.slice(1).join(' ')}`)
      }

      for (const seed of additionalSeeds) {
        if (!finalSeedKeywords.some((s) => s.toLowerCase() === seed.toLowerCase())) {
          finalSeedKeywords.push(seed)
          console.log(`   + 短品牌词种子: "${seed}"`)
        }
      }

      console.log(`   📊 种子词增强: ${expansionSeeds.length} → ${finalSeedKeywords.length} 个`)
    }
  }

  console.log(`\n🔄 使用 ${finalSeedKeywords.length} 个种子词扩展关键词`)
  finalSeedKeywords.forEach((seed, i) => console.log(`   ${i + 1}. "${seed}"`))

  const keywordMap = new Map<string, UnifiedKeywordData>()
  const plannerAuth = preloadedPlannerSession
    ? { ok: true as const, session: preloadedPlannerSession }
    : await prepareKeywordPlannerSessionForServiceParams(userId, {
        offerId,
        linkedServiceAccountId,
        serviceAccountId,
      })
  const volumeSession = plannerAuth?.ok ? plannerAuth.session : undefined
  const plannerIdeasBlocked = keywordPlannerIdeasBlockedReason(plannerAuth)
  const ideasAuth = keywordPlannerIdeasAuthFromSession(plannerAuth)

  try {
    // 1. 使用 Keyword Planner 获取扩展关键词
    if (customerId && userId) {
      if (plannerIdeasBlocked) {
        console.warn(`   ⚠️ 跳过 Keyword Planner 扩展: ${plannerIdeasBlocked}`)
      } else if (!ideasAuth) {
        console.warn('   ⚠️ 跳过 Keyword Planner 扩展: session auth unavailable')
      } else {
        const keywordIdeas = await getKeywordIdeas({
          customerId,
          seedKeywords: finalSeedKeywords, // 使用增强后的种子词
          pageUrl,
          targetCountry: country,
          targetLanguage: language,
          userId,
          accountId,
          authType: ideasAuth.authType,
          serviceAccountId: ideasAuth.serviceAccountId,
          preparedOAuth: ideasAuth.preparedOAuth,
        })

        console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)

        keywordIdeas.forEach((idea) => {
          const canonical = normalizeGoogleAdsKeyword(idea.text)
          if (!canonical) return
          if (!keywordMap.has(canonical)) {
            keywordMap.set(canonical, {
              keyword: idea.text,
              searchVolume: idea.avgMonthlySearches || 0,
              competition: idea.competition || 'UNKNOWN',
              competitionIndex: idea.competitionIndex || 0,
              lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
              highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
              source: 'EXPANSION',
              matchType: 'PHRASE',
            })
          }
        })
      }
    }

    // 2. 按搜索量降序排序（关键修复：先排序再截取）
    let results = Array.from(keywordMap.values())
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    console.log(`   📊 扩展关键词排序: ${results.length} 个`)
    if (results.length > 0) {
      console.log(
        `   📊 搜索量范围: ${results[results.length - 1]?.searchVolume || 0} - ${results[0]?.searchVolume || 0}`
      )
    }

    // 3. 获取精确搜索量（分批查询所有关键词）
    const BATCH_SIZE = 1000
    const totalKeywords = results.length
    console.log(`   📊 准备查询 ${totalKeywords} 个关键词的精确搜索量`)

    let disableSearchVolumeFilter = false
    // 🔧 修复(2026-01-22): 跟踪已验证的关键词，防止使用 Keyword Ideas 的估算值
    const verifiedKeywords = new Set<string>()

    if (totalKeywords > 0) {
      // 分批处理，每批最多1000个关键词
      const totalOuterBatches = Math.ceil(results.length / BATCH_SIZE)
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE)
        const batchKeywords = batch.map((kw) => kw.keyword)

        const outerBatchIndex = Math.floor(i / BATCH_SIZE) + 1
        try {
          await onProgress?.({
            message: `精确搜索量批次 ${outerBatchIndex}/${totalOuterBatches}`,
            current: outerBatchIndex,
            total: totalOuterBatches,
          })
        } catch {}

        console.log(
          `   📊 查询批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalKeywords / BATCH_SIZE)}: ${batchKeywords.length} 个关键词`
        )

        try {
          if (!volumeSession) {
            throw new Error(
              plannerAuth && !plannerAuth.ok ? plannerAuth.message : 'userId is required'
            )
          }
          const volumes = await getKeywordSearchVolumesWithSessionAuth(
            batchKeywords,
            country,
            language,
            userId,
            volumeSession,
            onProgress
              ? (info: { message: string; current?: number; total?: number }) =>
                  onProgress({
                    message: `精确搜索量 ${outerBatchIndex}/${totalOuterBatches} · ${info.message}`,
                    current: info.current,
                    total: info.total,
                  })
              : undefined
          )

          if (
            volumes.some(
              (vol: any) => vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
            )
          ) {
            disableSearchVolumeFilter = true
          }

          volumes.forEach((vol) => {
            const canonical = normalizeGoogleAdsKeyword(vol.keyword)
            if (!canonical) return
            const existing = keywordMap.get(canonical)
            if (existing) {
              // 🔧 修复(2026-01-22): 标记为已验证
              verifiedKeywords.add(canonical)
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
        } catch (batchError: any) {
          console.warn(
            `   ⚠️ 批次 ${Math.floor(i / BATCH_SIZE) + 1} 查询失败，继续处理下一批:`,
            batchError.message
          )
        }
      }

      console.log(`   ✅ 所有关键词搜索量查询完成`)

      // 🔧 修复(2026-01-22): 对于未被验证的关键词，将搜索量设为 0
      // 这些关键词使用的是 Keyword Ideas 的估算值，而非 Historical Metrics 的真实值
      if (!disableSearchVolumeFilter) {
        let unverifiedCount = 0
        for (const [canonical, kw] of keywordMap) {
          if (!verifiedKeywords.has(canonical) && kw.searchVolume > 0) {
            keywordMap.set(canonical, {
              ...kw,
              searchVolume: 0, // 重置为 0，因为没有真实搜索量数据
            })
            unverifiedCount++
          }
        }
        if (unverifiedCount > 0) {
          console.log(
            `   ⚠️ 重置了 ${unverifiedCount} 个未验证关键词的搜索量（Keyword Ideas 估算值 → 0）`
          )
        }
      }

      // 重新生成数组，确保更新后的搜索量生效
      results = Array.from(keywordMap.values())
    }

    // 4. 再次按搜索量降序排序
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    // 白名单过滤（如果有品牌名）
    if (brandName) {
      results = filterByWhitelist(results, brandName).filtered
    }

    // 搜索量过滤
    // 🔧 修复(2025-12-26): 搜索量不可用（服务账号 / developer token 无 Basic access）时跳过过滤
    if (disableSearchVolumeFilter) {
      console.log(
        '⚠️ 搜索量数据不可用（可能是服务账号或 developer token 无 Basic/Standard access），跳过搜索量过滤'
      )
    } else {
      const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []
      const hasAnyVolume = results.some((kw) => kw.searchVolume > 0)
      if (hasAnyVolume) {
        results = results.filter((kw) => {
          if (pureBrandKeywords.length > 0 && isPureBrandKeyword(kw.keyword, pureBrandKeywords)) {
            return true
          }
          return kw.searchVolume >= minSearchVolume
        })
      } else {
        console.log('⚠️ 所有关键词搜索量为0（可能是API未返回数据），跳过搜索量过滤')
      }
    }

    // 智能匹配类型分配
    if (brandName) {
      results = assignMatchTypes(results, brandName)
    }

    // 限制数量
    results = results.slice(0, maxKeywords)

    console.log(`✅ 扩展关键词完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 扩展关键词失败:', error.message)
    return []
  }
}

// ============================================
// 🆕 通用词提取（从已生成的关键词中提取）
// ============================================

/**
 * 从已生成的关键词中提取高价值通用词
 *
 * 用途：从Keyword Planner API返回的混合关键词中提取纯通用词（不含品牌名）
 * 策略：
 * 1. 过滤掉所有含品牌名的词（包括自身品牌和竞品）
 * 2. 只保留搜索量 > 10000 的高价值词
 * 3. 过滤掉信息查询词（review, tutorial等）
 * 4. 按搜索量排序
 *
 * 优势：
 * - 无需额外API调用，直接复用现有数据
 * - 通用方案，对所有品牌都适用
 * - 自动化提取，无需维护词库
 *
 * @param allKeywords Keyword Planner返回的所有关键词
 * @param brandName 自身品牌名
 * @param competitorBrands 已识别的竞品品牌
 * @returns 高价值通用词列表（搜索量>10000）
 */
export function extractGenericHighValueKeywords(
  allKeywords: any[], // Accept any keyword data with keyword and searchVolume properties
  brandName: string,
  competitorBrands: string[] = []
): any[] {
  console.log(`\n🆕 通用词提取 - 从已生成关键词中提取高价值通用词`)
  console.log(`================================`)

  // 步骤1：过滤掉所有含品牌名的词
  console.log(`📌 步骤1: 排除含品牌名的词`)

  const allBrands = [brandName, ...competitorBrands]
  const beforeBrandFilter = allKeywords.length

  let genericKeywords = allKeywords.filter((kw) => {
    const kwLower = kw.keyword.toLowerCase()
    // 检查是否含有任何品牌名（使用单词边界匹配）
    return !allBrands.some((brand) => {
      const brandPattern = new RegExp(`\\b${escapeRegex(brand.toLowerCase())}\\b`, 'i')
      return brandPattern.test(kwLower)
    })
  })

  const brandFiltered = beforeBrandFilter - genericKeywords.length
  console.log(`   排除的品牌词: ${brandFiltered}`)
  console.log(`   保留的非品牌词: ${genericKeywords.length}`)

  // 步骤2：只保留搜索量 > 10000 的高价值词
  console.log(`\n📌 步骤2: 高价值词过滤 (搜索量 > 10,000)`)

  const beforeVolumeFilter = genericKeywords.length
  // 🔧 修复(2025-12-26): 如果所有关键词搜索量都为0（服务账号模式），跳过搜索量过滤
  const hasAnyVolume = genericKeywords.some((kw) => kw.searchVolume > 0)
  if (hasAnyVolume) {
    genericKeywords = genericKeywords.filter((kw) => kw.searchVolume > 10000)
  } else {
    console.log('   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

  const volumeFiltered = beforeVolumeFilter - genericKeywords.length
  console.log(`   搜索量<10000的词: ${volumeFiltered}`)
  console.log(`   保留的高价值词: ${genericKeywords.length}`)

  if (genericKeywords.length === 0) {
    console.warn(`   ⚠️ 没有搜索量>10000的通用词`)
    return []
  }

  // 步骤3：过滤掉信息查询词
  console.log(`\n📌 步骤3: 排除低购买意图词`)

  const RESEARCH_INTENT_PATTERNS = [
    'review',
    'reviews',
    'rating',
    'vs',
    'versus',
    'comparison',
    'compare',
    'alternative',
    'alternatives',
    'how to',
    'what is',
    'guide',
    'tutorial',
    'reddit',
    'forum',
    'blog',
    'article',
    'repair',
    'troubleshoot',
    'corporation',
    'company',
    'official website',
    'headquarters',
    'about us',
    'contact',
    'customer service',
    'support',
  ]

  const beforeIntentFilter = genericKeywords.length
  genericKeywords = genericKeywords.filter((kw) => {
    const kwLower = kw.keyword.toLowerCase()
    return !RESEARCH_INTENT_PATTERNS.some((pattern) => kwLower.includes(pattern))
  })

  const intentFiltered = beforeIntentFilter - genericKeywords.length
  console.log(`   排除的低意图词: ${intentFiltered}`)
  console.log(`   保留的高意图词: ${genericKeywords.length}`)

  // 步骤4：按搜索量排序
  genericKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`\n✅ 通用词提取完成: ${genericKeywords.length} 个高价值词`)
  if (genericKeywords.length > 0) {
    console.log(`   Top 5:`)
    genericKeywords.slice(0, 5).forEach((kw, i) => {
      console.log(`   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
    })
  }

  return genericKeywords
}
