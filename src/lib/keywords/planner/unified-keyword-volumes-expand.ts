/**
 * Keyword volume lookup and seed-based expansion helpers.
 */
import { logger } from '@/lib/common/server'
import { getKeywordIdeas } from '@/lib/google-ads/keyword/planner'
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
  getKeywordSearchVolumesWithPreparedAuth,
  getKeywordSearchVolumesWithSessionAuth,
} from './unified-keyword-planner-session'
import { assignMatchTypes, filterByWhitelist, escapeRegex } from './unified-keyword-filters'
import { resolveKeywordPlannerLinkedServiceAccountId } from '@/lib/google-ads/accounts/auth/index'
import type { KeywordPlannerSessionAuth, UnifiedKeywordData } from './unified-keyword-types'

export async function getKeywordVolumesForExisting(params: {
  baseKeywords: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  offerId?: number
  linkedServiceAccountId?: string | null
}): Promise<UnifiedKeywordData[]> {
  const { baseKeywords, country, language, userId, brandName, offerId, linkedServiceAccountId } =
    params

  if (!baseKeywords || baseKeywords.length === 0) {
    return []
  }

  logger.debug(`\n📊 获取 ${baseKeywords.length} 个关键词的搜索量数据`)

  try {
    const linkedSa = userId
      ? await resolveKeywordPlannerLinkedServiceAccountId({
          userId,
          offerId,
          linkedServiceAccountId,
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

    logger.debug(`✅ 获取搜索量完成: ${results.length} 个关键词`)

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

// 向后兼容：使用自定义种子词扩展关键词

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
  /* * 已由关键词池 expand 单次 prepare 时传入，避免每轮重复 heal */
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
    plannerSession: preloadedPlannerSession,
    minSearchVolume = 500,
    maxKeywords = 100,
    onProgress,
  } = params

  logger.debug(`认证方式: ${authType}`)

  if (!expansionSeeds || expansionSeeds.length === 0) {
    return []
  }

  // 多词品牌名添加可用的短品牌词种子
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
          logger.debug(`   + 短品牌词种子: "${seed}"`)
        }
      }

      logger.debug(`   📊 种子词增强: ${expansionSeeds.length} → ${finalSeedKeywords.length} 个`)
    }
  }

  logger.debug(`\n🔄 使用 ${finalSeedKeywords.length} 个种子词扩展关键词`)
  finalSeedKeywords.forEach((seed, i) => logger.debug(`   ${i + 1}. "${seed}"`))

  const keywordMap = new Map<string, UnifiedKeywordData>()
  const plannerAuth = preloadedPlannerSession
    ? { ok: true as const, session: preloadedPlannerSession }
    : await prepareKeywordPlannerSessionForServiceParams(userId, {
        offerId,
        linkedServiceAccountId,
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

        logger.debug(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)

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

    // 2. 按搜索量降序排序（关键先排序再截取）
    let results = Array.from(keywordMap.values())
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    logger.debug(`   📊 扩展关键词排序: ${results.length} 个`)
    if (results.length > 0) {
      logger.debug(
        `   📊 搜索量范围: ${results[results.length - 1]?.searchVolume || 0} - ${results[0]?.searchVolume || 0}`
      )
    }

    // 3. 获取精确搜索量（分批查询所有关键词）
    const BATCH_SIZE = 1000
    const totalKeywords = results.length
    logger.debug(`   📊 准备查询 ${totalKeywords} 个关键词的精确搜索量`)

    let disableSearchVolumeFilter = false
    // 跟踪已验证的关键词，防止使用 Keyword Ideas 的估算值
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

        logger.debug(
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
              // 标记为已验证
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

      logger.debug(`   ✅ 所有关键词搜索量查询完成`)

      // 对于未被验证的关键词，将搜索量设为 0
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
          logger.debug(
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
    // 搜索量不可用（服务账号 / developer token 无 Basic access）时跳过过滤
    if (disableSearchVolumeFilter) {
      logger.debug(
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
        logger.debug('⚠️ 所有关键词搜索量为0（可能是API未返回数据），跳过搜索量过滤')
      }
    }

    // 智能匹配类型分配
    if (brandName) {
      results = assignMatchTypes(results, brandName)
    }

    // 限制数量
    results = results.slice(0, maxKeywords)

    logger.debug(`✅ 扩展关键词完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 扩展关键词失败:', error.message)
    return []
  }
}

// 通用词提取（从已生成的关键词中提取）

/**
 * 从已生成的关键词中提取高价值通用词
 *
 * 用途：从Keyword Planner API返回的混合关键词中提取纯通用词（不含品牌名）
 * 策略
 * 1. 过滤掉所有含品牌名的词（包括自身品牌和竞品）
 * 2. 只保留搜索量 > 10000 的高价值词
 * 3. 过滤掉信息查询词（review, tutorial等）
 * 4. 按搜索量排序
 *
 * 优势
 * 无需额外API调用，直接复用现有数据
 * 通用方案，对所有品牌都适用
 * 自动化提取，无需维护词库
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
  logger.debug(`\n🆕 通用词提取 - 从已生成关键词中提取高价值通用词`)
  logger.debug(`================================`)

  // 步骤1：过滤掉所有含品牌名的词
  logger.debug(`📌 步骤1: 排除含品牌名的词`)

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
  logger.debug(`   排除的品牌词: ${brandFiltered}`)
  logger.debug(`   保留的非品牌词: ${genericKeywords.length}`)

  // 步骤2：只保留搜索量 > 10000 的高价值词
  logger.debug(`\n📌 步骤2: 高价值词过滤 (搜索量 > 10,000)`)

  const beforeVolumeFilter = genericKeywords.length
  // 如果所有关键词搜索量都为0（服务账号模式），跳过搜索量过滤
  const hasAnyVolume = genericKeywords.some((kw) => kw.searchVolume > 0)
  if (hasAnyVolume) {
    genericKeywords = genericKeywords.filter((kw) => kw.searchVolume > 10000)
  } else {
    logger.debug('   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

  const volumeFiltered = beforeVolumeFilter - genericKeywords.length
  logger.debug(`   搜索量<10000的词: ${volumeFiltered}`)
  logger.debug(`   保留的高价值词: ${genericKeywords.length}`)

  if (genericKeywords.length === 0) {
    console.warn(`   ⚠️ 没有搜索量>10000的通用词`)
    return []
  }

  // 步骤3：过滤掉信息查询词
  logger.debug(`\n📌 步骤3: 排除低购买意图词`)

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
  logger.debug(`   排除的低意图词: ${intentFiltered}`)
  logger.debug(`   保留的高意图词: ${genericKeywords.length}`)

  // 步骤4：按搜索量排序
  genericKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  logger.debug(`\n✅ 通用词提取完成: ${genericKeywords.length} 个高价值词`)
  if (genericKeywords.length > 0) {
    logger.debug(`   Top 5:`)
    genericKeywords.slice(0, 5).forEach((kw, i) => {
      logger.debug(`   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
    })
  }

  return genericKeywords
}
