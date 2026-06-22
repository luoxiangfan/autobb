/**
 * Offer 级关键词池生成主流程
 */

import { findOfferById, type Offer } from '../../offers/server'

import {
  getKeywordSearchVolumesForPlannerContext,
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPoolExpandLoadResult,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'

import { getPureBrandKeywords, isPureBrandKeyword } from '../server'
import {
  filterKeywordQuality,
  generateFilterReport,
  detectPlatformsInKeyword,
  extractPlatformFromUrl,
} from '../server'
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../server'

import { DEFAULTS } from '../server'
import {
  createPlannerNonBrandPolicy,
  type PlannerDecision,
  type PlannerNonBrandPolicy,
} from '../server'

import {
  type KeywordBuckets,
  type KeywordPoolProgressReporter,
  type OfferKeywordPool,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

import {
  clusterKeywordsByIntent,
  ensureMinimumBucketKeywords,
  hasCommercialIntentForProductRelaxedRetention,
  hasSearchVolumeUnavailableFlag,
  KEYWORD_CLUSTERING_INPUT_LIMIT,
  MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET,
  MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET,
  prioritizeBrandKeywordsFirst,
  prioritizeBucketKeywords,
  prioritizeKeywordsForClustering,
  resolveOfferPageType,
  SEED_INFO_QUERY_PATTERNS,
  SEED_MAX_WORD_COUNT,
} from './keyword-clustering'

import {
  composeGlobalCoreBrandedKeyword,
  injectGlobalCoreKeywordsForProduct,
  injectGlobalCoreKeywordsForStore,
} from './offer-pool-global-core'
import { separateBrandKeywords, inferDefaultKeywordMatchType } from './offer-pool-brand-utils'
import { saveKeywordPoolWithData } from './offer-pool-storage'
import {
  buildVerifiedSourceKeywordData,
  appendVerifiedKeywordsToBucket,
} from './offer-pool-verified-source'
import { buildExistingKeywordNormSet } from './offer-pool-global-core'
import { extractCategorySignalsFromScrapedData } from './offer-pool-scraped-signals'
import { extractKeywordsFromOffer } from './offer-pool-keyword-extract'
// ============================================
// 主要流程
// ============================================

/**
 * 生成 Offer 级关键词池（主入口）
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param allKeywords - 所有关键词列表（可选，如不提供则从现有创意提取）
 * @returns 关键词池
 */
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  allKeywords?: string[],
  progress?: KeywordPoolProgressReporter,
  preparedExpand?: KeywordPoolExpandLoadResult
): Promise<OfferKeywordPool> {
  console.log(`\n📦 开始生成 Offer #${offerId} 的关键词池`)
  await progress?.({ phase: 'seed-volume', message: '开始生成关键词池' })

  // 1. 获取 Offer 信息
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error(`Offer #${offerId} 不存在`)
  }
  const pureBrandKeywordsForOffer = getPureBrandKeywords(offer.brand || '')
  const pageType = resolveOfferPageType(offer)
  const verifiedSourceKeywords = await buildVerifiedSourceKeywordData(offer, userId)
  let allowPlannerNonBrand = false
  let plannerNonBrandPolicy: PlannerNonBrandPolicy = createPlannerNonBrandPolicy({
    pageType,
    enabled: allowPlannerNonBrand,
  })
  const plannerMinSearchVolume = pageType === 'store' ? DEFAULTS.minSearchVolume : undefined

  // 单次 prepare：关键词池扩展与搜索量查询共用
  let customerId: string | undefined
  let refreshToken: string | undefined
  let accountId: number | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined
  let developerToken: string | undefined
  let authType: 'oauth' | 'service_account' = 'oauth'
  let plannerSession: KeywordPlannerPreparedSession | undefined
  let linkedServiceAccountId: string | null | undefined

  if (preparedExpand?.ok) {
    authType = preparedExpand.creds.authType
    customerId = preparedExpand.creds.customerId
    refreshToken = preparedExpand.creds.refreshToken
    accountId = preparedExpand.creds.accountId
    clientId = preparedExpand.creds.clientId
    clientSecret = preparedExpand.creds.clientSecret
    developerToken = preparedExpand.creds.developerToken
    linkedServiceAccountId = preparedExpand.creds.linkedServiceAccountId
    plannerSession = preparedExpand.plannerSession
  } else {
    try {
      const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offer.id)
      if (!expandLoad.ok) {
        console.warn(
          `⚠️ Keyword Planner 扩展认证不可用（prepare 失败），将回退初始种子词 (offerId=${offer.id}, userId=${userId})`
        )
      } else {
        authType = expandLoad.creds.authType
        customerId = expandLoad.creds.customerId
        refreshToken = expandLoad.creds.refreshToken
        accountId = expandLoad.creds.accountId
        clientId = expandLoad.creds.clientId
        clientSecret = expandLoad.creds.clientSecret
        developerToken = expandLoad.creds.developerToken
        linkedServiceAccountId = expandLoad.creds.linkedServiceAccountId
        plannerSession = expandLoad.plannerSession
      }
    } catch (error) {
      console.warn('⚠️ 无法获取Google Ads凭证，跳过关键词扩展:', (error as Error).message)
    }
  }

  // 1.5 Marketplace场景：尽量补全“品牌官网”，用于Keyword Planner的站点过滤（best-effort）
  try {
    const { ensureOfferBrandOfficialSite } = await import('../../offers/offer-official-site')
    const official = await ensureOfferBrandOfficialSite({
      offerId: offer.id,
      userId,
      brand: offer.brand,
      targetCountry: offer.target_country,
      finalUrl: offer.final_url,
      url: offer.url,
      category: offer.category,
      productName: offer.product_name,
      extractionMetadata: offer.extraction_metadata,
    })

    if (official?.origin) {
      const existing = (() => {
        try {
          return offer.extraction_metadata ? JSON.parse(offer.extraction_metadata) : {}
        } catch {
          return {}
        }
      })()
      offer.extraction_metadata = JSON.stringify({ ...existing, brandOfficialSite: official })
      console.log(`🌐 已补全品牌官网(origin): ${official.origin}`)
    }
  } catch (e: any) {
    console.warn(`⚠️ 品牌官网补全失败（不影响关键词池生成）: ${e?.message || String(e)}`)
  }

  // 2. 提取初始关键词（保留 searchVolume）
  let initialKeywords: PoolKeywordData[]
  if (allKeywords) {
    // 🔧 修复(2026-01-21): 如果提供了关键词列表，查询搜索量而不是硬编码为 0
    console.log(`📊 查询 ${allKeywords.length} 个提供的关键词的搜索量...`)

    try {
      await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })
      const volumeProgress = progress
        ? (info: { message: string; current?: number; total?: number }) =>
            progress({
              phase: 'seed-volume',
              current: info.current,
              total: info.total,
              message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
            })
        : undefined

      const volumeResult = await getKeywordSearchVolumesForPlannerContext({
        userId,
        offerId,
        keywords: allKeywords,
        country: offer.target_country,
        language: offer.target_language || 'en',
        plannerSession,
        onProgress: volumeProgress,
      })
      if (!volumeResult.ok) {
        throw new Error(volumeResult.message)
      }
      const volumes = volumeResult.volumes

      initialKeywords = volumes.map((v) => ({
        keyword: v.keyword,
        searchVolume: v.avgMonthlySearches || 0,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid,
        highTopPageBid: v.highTopPageBid,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(v.keyword, pureBrandKeywordsForOffer),
      }))

      const withVolume = initialKeywords.filter((kw) => kw.searchVolume > 0).length
      console.log(`✅ 搜索量查询完成: ${withVolume}/${allKeywords.length} 个关键词有搜索量`)
    } catch (error) {
      console.warn(`⚠️ 搜索量查询失败，使用默认值 0: ${error}`)
      // 降级处理：使用默认值
      initialKeywords = allKeywords.map((kw) => ({
        keyword: kw,
        searchVolume: 0,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(kw, pureBrandKeywordsForOffer),
      }))
    }
  } else {
    initialKeywords = await extractKeywordsFromOffer(offerId, userId, progress, plannerSession)
  }

  if (initialKeywords.length === 0) {
    throw new Error('无可用关键词，请先生成关键词')
  }

  console.log(`📝 初始关键词数: ${initialKeywords.length}`)

  // 2.5 🔧 修复(2025-12-24): 优化种子词过滤策略
  // 核心问题: 52→12个种子词过滤率太高，导致关键词扩展不足
  const beforeFilterCount = initialKeywords.length
  const offerPlatform = extractPlatformFromUrl(offer.final_url || offer.url || '')

  // 🆕 先提取长尾种子词中的有价值短语
  const extractedSeeds: PoolKeywordData[] = []
  for (const kw of initialKeywords) {
    const wordCount = kw.keyword.trim().split(/\s+/).length
    if (wordCount > SEED_MAX_WORD_COUNT) {
      // 从长尾词中提取2-4个单词的短语
      const words = kw.keyword.trim().split(/\s+/)
      const brand = offer.brand.toLowerCase()

      for (let i = 0; i < words.length - 1; i++) {
        for (let len = 2; len <= Math.min(4, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ')
          const phraseLower = phrase.toLowerCase()

          // 只提取包含品牌名的短语
          if (phraseLower.includes(brand)) {
            extractedSeeds.push({
              ...kw,
              keyword: phrase,
            })
          }
        }
      }
    }
  }

  // 应用过滤条件
  initialKeywords = initialKeywords.filter((kw) => {
    const keyword = kw.keyword.trim()
    const wordCount = keyword.split(/\s+/).length

    // 过滤条件1：长度限制（与最终质量过滤对齐，≤8个单词）
    if (wordCount > SEED_MAX_WORD_COUNT) {
      console.log(
        `   ⊗ 种子词长度过滤: "${keyword}" (${wordCount}个单词, 限制≤${SEED_MAX_WORD_COUNT})`
      )
      return false
    }

    // 过滤条件2：排除低质量词
    // 🔥 2025-12-24优化: 只过滤明确的低质量词，保留高转化词
    const invalidPatterns = [
      // 购买渠道（保留store/shop/amazon/ebay，因为这些是正常购买渠道）
      'near me',
      'official',
      // 低转化查询类
      'history',
      'tracker',
      'locator',
      'review',
      'compare',
      // 过时年份
      '2023',
      '2022',
      '2021',
      'black friday',
      'prime day',
      // ✅ 保留: 'store', 'shop', 'amazon', 'ebay' - 店铺/销售渠道词
      // ✅ 保留: 'discount', 'sale', 'deal', 'code', 'coupon' - 商品需求扩展词
      // ✅ 保留: 'price', 'cost', 'cheap', 'affordable', 'budget' - 高转化词
      // ✅ 保留: '2024', '2025' - 当前年份
    ]
    const keywordLower = keyword.toLowerCase()
    const hasInvalidPattern = invalidPatterns.some((pattern) => keywordLower.includes(pattern))
    if (hasInvalidPattern) {
      const matchedPattern = invalidPatterns.find((p) => keywordLower.includes(p))
      console.log(`   ⊗ 种子词无效模式过滤: "${keyword}" (包含: ${matchedPattern})`)
      return false
    }

    // 过滤条件3：明显信息查询/素材查询词（高概率低转化）
    const matchedInfoPattern = SEED_INFO_QUERY_PATTERNS.find((pattern) =>
      keywordLower.includes(pattern)
    )
    if (matchedInfoPattern) {
      console.log(`   ⊗ 种子词信息查询过滤: "${keyword}" (包含: ${matchedInfoPattern})`)
      return false
    }

    // 过滤条件4：跨平台噪音词（关键词平台与目标落地页平台不一致）
    if (offerPlatform) {
      const keywordPlatforms = detectPlatformsInKeyword(keywordLower)
      const mismatchedPlatforms = keywordPlatforms.filter((platform) => platform !== offerPlatform)
      if (mismatchedPlatforms.length > 0) {
        console.log(
          `   ⊗ 种子词平台冲突过滤: "${keyword}" (关键词平台: ${mismatchedPlatforms.join('/')}, 目标平台: ${offerPlatform})`
        )
        return false
      }
    }

    return true
  })

  // 合并提取的短语种子词（去重）
  const seenPhrases = new Set(initialKeywords.map((k) => k.keyword.toLowerCase()))
  let addedCount = 0
  extractedSeeds.forEach((seed) => {
    if (!seenPhrases.has(seed.keyword.toLowerCase())) {
      initialKeywords.push(seed)
      seenPhrases.add(seed.keyword.toLowerCase())
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`   ✅ 从长尾种子词中提取: ${addedCount} 个短语种子词`)
  }

  if (beforeFilterCount !== initialKeywords.length) {
    console.log(`📊 种子词质量过滤: ${beforeFilterCount} → ${initialKeywords.length}`)
  }

  // 3. 🆕 全量扩展（v2.0：根据认证类型分发）
  const { expandAllKeywords, filterKeywords } = await import('../server')

  const plannerDecision: PlannerDecision = {
    allowNonBrandFromPlanner: allowPlannerNonBrand,
    volumeUnavailableFromPlanner: false,
    nonBrandPolicy: plannerNonBrandPolicy,
  }
  const expandedKeywords = await expandAllKeywords(
    initialKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country,
    offer.target_language || 'en',
    authType, // 🔥 2025-12-29 新增：认证类型
    offer, // 🔥 2025-12-29 新增：Offer信息（服务账号模式需要）
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    progress,
    plannerMinSearchVolume,
    plannerNonBrandPolicy,
    plannerDecision,
    linkedServiceAccountId,
    plannerSession
  )
  plannerNonBrandPolicy = plannerDecision.nonBrandPolicy || plannerNonBrandPolicy
  allowPlannerNonBrand = plannerDecision.allowNonBrandFromPlanner ?? allowPlannerNonBrand

  // 4. 🆕 智能过滤（竞品+品类+搜索量+地理位置）
  const filteredKeywords = filterKeywords(
    expandedKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country, // 🔧 修复(2025-12-17): 传递目标国家进行地理过滤
    offer.product_name,
    {
      allowNonBrandFromPlanner: plannerNonBrandPolicy,
      // KISS: 品牌门禁统一交给 filterKeywordQuality，预过滤阶段只做轻量裁剪
      applyBrandGate: false,
    }
  )

  console.log(`📝 第一次过滤后关键词数: ${filteredKeywords.length}`)

  // 🆕 2025-12-27: 关键词质量过滤
  // 过滤品牌变体词（如 eurekaddl）和语义查询词（如 significato）
  const pageTypeForContextFilter = resolveOfferPageType(offer)
  const pureBrandKeywordsForFilter = getPureBrandKeywords(offer.brand || '')
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const categoryContext = [offer.category, ...categorySignals].filter(Boolean).join(' ')
  const baseContextMatches = getMinContextTokenMatchesForKeywordQualityFilter({
    pageType: pageTypeForContextFilter,
  })
  const effectiveContextMatches = baseContextMatches

  const qualityFiltered = filterKeywordQuality(filteredKeywords, {
    brandName: offer.brand,
    category: categoryContext || undefined,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    // 🔒 全量强制：最终关键词必须包含“纯品牌词”（不拼接造词）
    mustContainBrand: pureBrandKeywordsForFilter.length > 0,
    allowNonBrandFromPlanner: plannerNonBrandPolicy,
    // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
    minContextTokenMatches: effectiveContextMatches,
    contextMismatchMode: 'soft',
  })

  // 生成过滤报告
  const filterReport = generateFilterReport(filteredKeywords.length, qualityFiltered.removed)
  console.log(filterReport)

  // 使用过滤后的关键词
  let finalFilteredKeywords = qualityFiltered.filtered

  // 产品页放宽策略（仅在严格过滤导致词池接近“纯品牌词独占”时触发）：
  // 在保持上下文/语义过滤前提下，回补少量高意图非纯品牌词，避免关键词池坍缩为单词。
  if (pageTypeForContextFilter === 'product' && pureBrandKeywordsForFilter.length > 0) {
    const strictNonPureCount = finalFilteredKeywords.filter(
      (kw) => !isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)
    ).length

    if (strictNonPureCount < 3) {
      const relaxedQualityFiltered = filterKeywordQuality(filteredKeywords, {
        brandName: offer.brand,
        category: categoryContext || undefined,
        productName: offer.product_name || undefined,
        targetCountry: offer.target_country || undefined,
        targetLanguage: offer.target_language || undefined,
        productUrl: offer.final_url || offer.url || undefined,
        minWordCount: 1,
        maxWordCount: 8,
        mustContainBrand: false,
        allowNonBrandFromPlanner: plannerNonBrandPolicy,
        minContextTokenMatches: effectiveContextMatches,
        contextMismatchMode: 'soft',
      })

      const existingNormSet = new Set(
        finalFilteredKeywords.map((item) => normalizeGoogleAdsKeyword(item.keyword)).filter(Boolean)
      )

      const relaxedSeenSet = new Set<string>()
      const relaxedCandidates = prioritizeKeywordsForClustering(
        relaxedQualityFiltered.filtered
          .map((kw): PoolKeywordData | null => {
            if (isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)) return null
            if (
              !hasCommercialIntentForProductRelaxedRetention(
                kw.keyword,
                offer.target_language || 'en'
              )
            ) {
              return null
            }

            // 参考 title/about 补词：把高意图非品牌词统一改写为“品牌前置”形式，避免品牌词重复并限制词长。
            const brandedKeyword = composeGlobalCoreBrandedKeyword(kw.keyword, offer.brand || '', 5)
            if (!brandedKeyword) return null

            const norm = normalizeGoogleAdsKeyword(brandedKeyword)
            if (!norm || existingNormSet.has(norm) || relaxedSeenSet.has(norm)) return null
            relaxedSeenSet.add(norm)

            return {
              ...kw,
              keyword: brandedKeyword,
              source: 'PRODUCT_RELAX_BRANDED',
              sourceType: 'PRODUCT_RELAX_BRANDED',
              sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE',
              rawSource:
                String(
                  (kw as any).rawSource ||
                    (kw as any).sourceSubtype ||
                    (kw as any).sourceType ||
                    kw.source ||
                    'KEYWORD_POOL'
                ).trim() || 'KEYWORD_POOL',
              derivedTags: Array.from(
                new Set([
                  ...(((kw as any).derivedTags || []) as string[]),
                  'PRODUCT_RELAX_BRANDED',
                  'PURE_BRAND_PREFIX_REWRITE',
                ])
              ),
              matchType: 'PHRASE',
            }
          })
          .filter((kw): kw is PoolKeywordData => kw !== null)
      )

      const rescueLimit = Math.max(8, Math.min(30, Math.floor(filteredKeywords.length * 0.2)))
      const rescuedKeywords = relaxedCandidates.slice(0, rescueLimit)

      if (rescuedKeywords.length > 0) {
        finalFilteredKeywords = [...finalFilteredKeywords, ...rescuedKeywords]
        console.log(
          `🧩 product页放宽补齐: +${rescuedKeywords.length} 个高意图词(品牌前置改写) ` +
            `(strict_non_pure=${strictNonPureCount}, relaxed_candidates=${relaxedCandidates.length})`
        )
      } else {
        console.log(`ℹ️ product页放宽补齐未命中可用词 (strict_non_pure=${strictNonPureCount})`)
      }
    }
  }

  // 🔒 有真实搜索量数据时，移除非纯品牌的0搜索量关键词
  const hasAnyVolume = finalFilteredKeywords.some((kw) => kw.searchVolume > 0)
  const volumeUnavailable =
    plannerDecision.volumeUnavailableFromPlanner ||
    hasSearchVolumeUnavailableFlag(finalFilteredKeywords)
  if (hasAnyVolume && !volumeUnavailable) {
    const beforeVolumeFilter = finalFilteredKeywords.length
    finalFilteredKeywords = finalFilteredKeywords.filter(
      (kw) => kw.searchVolume > 0 || isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)
    )
    if (beforeVolumeFilter !== finalFilteredKeywords.length) {
      console.log(
        `📉 搜索量过滤(保留纯品牌): ${beforeVolumeFilter} → ${finalFilteredKeywords.length}`
      )
    }
  } else if (hasAnyVolume && volumeUnavailable) {
    console.log('⚠️ 搜索量数据不可用（Planner 权限受限），跳过非纯品牌 0 搜索量关键词强制移除')
  }

  // 约束：最终关键词顺序始终前置纯品牌词，避免后续截断时品牌词被挤压
  finalFilteredKeywords = prioritizeBrandKeywordsFirst(
    finalFilteredKeywords,
    pureBrandKeywordsForFilter
  )

  console.log(`📝 最终过滤后关键词数: ${finalFilteredKeywords.length}`)
  await progress?.({ phase: 'filter', message: '关键词过滤完成' })

  // 5. 分离纯品牌词和非品牌词
  const keywordStrings = finalFilteredKeywords.map((kw) => kw.keyword)
  let { brandKeywords: brandKwStrings, nonBrandKeywords: nonBrandKwStrings } =
    separateBrandKeywords(keywordStrings, offer.brand)

  // ✅ 确保所有纯品牌词都被纳入（如 "dr mercola" + "mercola"）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKwNormalized = new Set(
      brandKwStrings.map((k) => normalizeGoogleAdsKeyword(k)).filter(Boolean)
    )
    const missingPureBrands = pureBrandKeywordsForFilter.filter((kw) => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      return normalized && !brandKwNormalized.has(normalized)
    })

    if (missingPureBrands.length > 0) {
      brandKwStrings.push(...missingPureBrands)
      const missingNormalized = new Set(
        missingPureBrands.map((k) => normalizeGoogleAdsKeyword(k)).filter(Boolean)
      )
      nonBrandKwStrings = nonBrandKwStrings.filter((k) => {
        const normalized = normalizeGoogleAdsKeyword(k)
        return normalized ? !missingNormalized.has(normalized) : true
      })
      console.log(`✅ 补充纯品牌词: ${missingPureBrands.join(', ')}`)
    }
  }

  // 🔧 防御性兜底：如果未识别到任何纯品牌词，强制注入标准化后的品牌词
  // 典型场景：Keyword Planner 不返回 seed 本身，且品牌含标点（如 "Dr. Mercola" → "dr mercola"）
  if (brandKwStrings.length === 0) {
    const canonicalBrand = normalizeGoogleAdsKeyword(offer.brand || '')
    if (canonicalBrand) {
      console.warn(`⚠️ 未识别到纯品牌词，自动注入: "${canonicalBrand}"`)
      brandKwStrings = [canonicalBrand]
      nonBrandKwStrings = nonBrandKwStrings.filter(
        (k) => normalizeGoogleAdsKeyword(k) !== canonicalBrand
      )
    }
  }

  // 转换回 PoolKeywordData[]
  let brandKeywordsData = finalFilteredKeywords.filter((kw) => brandKwStrings.includes(kw.keyword))
  let nonBrandKeywordsData = finalFilteredKeywords.filter((kw) =>
    nonBrandKwStrings.includes(kw.keyword)
  )

  // 如果注入的品牌词不在 finalFilteredKeywords 中，补一个最小元数据对象，保证 brand_keywords 不为空
  if (brandKeywordsData.length === 0 && brandKwStrings.length > 0) {
    brandKeywordsData = brandKwStrings.map((keyword) => ({
      keyword,
      searchVolume: 0,
      source: 'BRAND_SEED',
      matchType: 'EXACT' as const,
      isPureBrand: true,
    }))
  }

  // 🆕 聚类输入硬上限：按来源优先级 + 搜索量 选 Top N
  if (nonBrandKeywordsData.length > KEYWORD_CLUSTERING_INPUT_LIMIT) {
    const prioritized = prioritizeKeywordsForClustering(nonBrandKeywordsData)
    const capped = prioritized.slice(0, KEYWORD_CLUSTERING_INPUT_LIMIT)
    const cappedSet = new Set(capped.map((item) => item.keyword))
    nonBrandKeywordsData = nonBrandKeywordsData.filter((item) => cappedSet.has(item.keyword))
    nonBrandKwStrings = capped.map((item) => item.keyword)
    console.log(
      `✂️ 聚类输入裁剪: ${prioritized.length} → ${capped.length} (Top ${KEYWORD_CLUSTERING_INPUT_LIMIT} by source+volume)`
    )
  }

  // 🔧 强化：补齐/更新纯品牌词的真实搜索量（优先使用缓存/Keyword Planner）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKeywordMap = new Map<string, PoolKeywordData>()
    for (const kw of brandKeywordsData) {
      const normalized = normalizeGoogleAdsKeyword(kw.keyword)
      if (!normalized) continue
      brandKeywordMap.set(normalized, kw)
    }

    const needsBrandVolume = pureBrandKeywordsForFilter.some((kw) => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) return false
      const existing = brandKeywordMap.get(normalized)
      return !existing || (existing.searchVolume || 0) === 0
    })

    if (needsBrandVolume) {
      try {
        await progress?.({ phase: 'seed-volume', message: '品牌词搜索量查询中' })
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `品牌词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
              })
          : undefined
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: pureBrandKeywordsForFilter,
          country: offer.target_country,
          language: offer.target_language || 'en',
          plannerSession,
          onProgress: volumeProgress,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        volumes.forEach((vol) => {
          const normalized = normalizeGoogleAdsKeyword(vol.keyword)
          if (!normalized) return
          const existing = brandKeywordMap.get(normalized)
          const nextVolume =
            vol.avgMonthlySearches > 0 ? vol.avgMonthlySearches : existing?.searchVolume || 0

          brandKeywordMap.set(normalized, {
            keyword: normalized,
            searchVolume: nextVolume,
            competition: vol.competition || existing?.competition || 'UNKNOWN',
            competitionIndex: vol.competitionIndex || existing?.competitionIndex || 0,
            lowTopPageBid: vol.lowTopPageBid || existing?.lowTopPageBid || 0,
            highTopPageBid: vol.highTopPageBid || existing?.highTopPageBid || 0,
            source: existing?.source || 'BRAND_SEED',
            matchType: 'EXACT',
            isPureBrand: true,
          })
        })
      } catch (error: any) {
        console.warn(`⚠️ 纯品牌词搜索量查询失败: ${error.message}`)
      }
    }

    // 确保缺失的纯品牌词也被注入（即使搜索量未知）
    for (const kw of pureBrandKeywordsForFilter) {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) continue
      if (!brandKeywordMap.has(normalized)) {
        brandKeywordMap.set(normalized, {
          keyword: normalized,
          searchVolume: 0,
          source: 'BRAND_SEED',
          matchType: 'EXACT',
          isPureBrand: true,
        })
      }
    }

    brandKeywordsData = Array.from(brandKeywordMap.values())
  }

  // 🆕 v4.16: 确定页面类型
  console.log(`📊 页面类型: ${pageType}`)

  // 6. AI 语义聚类（传递国家和语言参数用于查询商品需求扩展词搜索量）
  // 🆕 v4.16: 传递 pageType 参数
  await progress?.({ phase: 'cluster', message: '语义聚类准备中' })
  const buckets = await clusterKeywordsByIntent(
    nonBrandKwStrings,
    offer.brand,
    offer.category,
    userId,
    offer.target_country, // 🔥 2025-12-23 新增：传递目标国家
    offer.target_language || 'en', // 🔥 2025-12-23 新增：传递目标语言
    pageType, // 🆕 v4.16: 传递页面类型
    progress
  )

  // 🆕 v4.16: 根据页面类型处理不同的桶结构
  if (pageType === 'store') {
    // 店铺链接：处理5个桶
    const storeBuckets = buckets as StoreKeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map((kw) => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let storeBucketAData = mapAndFilterKeywords(storeBuckets.bucketA.keywords)
    let storeBucketBData = mapAndFilterKeywords(storeBuckets.bucketB.keywords)
    let storeBucketCData = mapAndFilterKeywords(storeBuckets.bucketC.keywords)
    let storeBucketDData = mapAndFilterKeywords(storeBuckets.bucketD.keywords)
    let storeBucketSData = mapAndFilterKeywords(storeBuckets.bucketS.keywords)
    const mappedStoreCount =
      storeBucketAData.length +
      storeBucketBData.length +
      storeBucketCData.length +
      storeBucketDData.length +
      storeBucketSData.length

    const storeUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      storeBucketAData,
      storeBucketBData,
      storeBucketCData,
      storeBucketDData,
      storeBucketSData,
    ])
    storeBucketAData = appendVerifiedKeywordsToBucket({
      current: storeBucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketCData = appendVerifiedKeywordsToBucket({
      current: storeBucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: storeUsedNorms,
    })
    storeBucketBData = appendVerifiedKeywordsToBucket({
      current: storeBucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketSData = appendVerifiedKeywordsToBucket({
      current: storeBucketSData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    const verifiedStoreAdds =
      storeBucketAData.length +
      storeBucketBData.length +
      storeBucketCData.length +
      storeBucketDData.length +
      storeBucketSData.length -
      mappedStoreCount

    // 记录过滤掉的关键词数量
    const originalCount =
      storeBuckets.bucketA.keywords.length +
      storeBuckets.bucketB.keywords.length +
      storeBuckets.bucketC.keywords.length +
      storeBuckets.bucketD.keywords.length +
      storeBuckets.bucketS.keywords.length
    const filteredCount = mappedStoreCount
    if (originalCount !== filteredCount) {
      console.log(
        `ℹ️ 店铺关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`
      )
    }
    if (verifiedStoreAdds > 0) {
      console.log(
        `🧩 店铺真实来源补词: +${verifiedStoreAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`
      )
    }

    const storeBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: storeBucketAData },
        { name: 'B', keywords: storeBucketBData },
        { name: 'C', keywords: storeBucketCData },
        { name: 'D', keywords: storeBucketDData },
        { name: 'S', keywords: storeBucketSData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET,
    })
    const totalStoreRetainAdds = Object.values(storeBucketMinRetainAdds).reduce(
      (sum, value) => sum + value,
      0
    )
    if (totalStoreRetainAdds > 0) {
      console.log(
        `🛟 店铺桶最小保留补齐: +${totalStoreRetainAdds} (A:${storeBucketMinRetainAdds.A || 0}, B:${storeBucketMinRetainAdds.B || 0}, C:${storeBucketMinRetainAdds.C || 0}, D:${storeBucketMinRetainAdds.D || 0}, S:${storeBucketMinRetainAdds.S || 0})`
      )
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedStore = await injectGlobalCoreKeywordsForStore({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      storeBuckets,
      bucketAData: storeBucketAData,
      bucketBData: storeBucketBData,
      bucketCData: storeBucketCData,
      bucketDData: storeBucketDData,
      bucketSData: storeBucketSData,
    })

    storeBucketAData = injectedStore.bucketAData
    storeBucketBData = injectedStore.bucketBData
    storeBucketCData = injectedStore.bucketCData
    storeBucketDData = injectedStore.bucketDData
    storeBucketSData = injectedStore.bucketSData

    // 9. 保存到数据库（包含店铺分桶）
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: storeBuckets.bucketA.intent, keywords: storeBucketAData },
        bucketB: { intent: storeBuckets.bucketB.intent, keywords: storeBucketBData },
        bucketC: { intent: storeBuckets.bucketC.intent, keywords: storeBucketCData },
        bucketD: { intent: storeBuckets.bucketD.intent, keywords: storeBucketDData },
        statistics: storeBuckets.statistics,
      },
      pageType, // 🆕 v4.16: 传递页面类型
      storeBuckets, // 🆕 v4.16: 传递店铺桶数据
      {
        bucketA: storeBucketAData,
        bucketB: storeBucketBData,
        bucketC: storeBucketCData,
        bucketD: storeBucketDData,
        bucketS: storeBucketSData,
      }
    )

    return pool
  } else {
    // 产品链接：处理4个桶（原逻辑）
    const productBuckets = buckets as KeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    // 避免保留 AI 生成但无真实搜索量的模板化关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map((kw) => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let bucketAData = mapAndFilterKeywords(productBuckets.bucketA.keywords)
    let bucketBData = mapAndFilterKeywords(productBuckets.bucketB.keywords)
    let bucketCData = mapAndFilterKeywords(productBuckets.bucketC.keywords)
    let bucketDData = mapAndFilterKeywords(productBuckets.bucketD.keywords)
    const mappedProductCount =
      bucketAData.length + bucketBData.length + bucketCData.length + bucketDData.length

    const productUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
    ])
    bucketAData = appendVerifiedKeywordsToBucket({
      current: bucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketCData = appendVerifiedKeywordsToBucket({
      current: bucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: productUsedNorms,
    })
    bucketBData = appendVerifiedKeywordsToBucket({
      current: bucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketDData = appendVerifiedKeywordsToBucket({
      current: bucketDData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    const verifiedProductAdds =
      bucketAData.length +
      bucketBData.length +
      bucketCData.length +
      bucketDData.length -
      mappedProductCount

    // 记录过滤掉的关键词数量
    const originalCount =
      productBuckets.bucketA.keywords.length +
      productBuckets.bucketB.keywords.length +
      productBuckets.bucketC.keywords.length +
      productBuckets.bucketD.keywords.length
    const filteredCount = mappedProductCount
    if (originalCount !== filteredCount) {
      console.log(
        `ℹ️ 关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`
      )
    }
    if (verifiedProductAdds > 0) {
      console.log(
        `🧩 产品真实来源补词: +${verifiedProductAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`
      )
    }

    const productBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: bucketAData },
        { name: 'B', keywords: bucketBData },
        { name: 'C', keywords: bucketCData },
        { name: 'D', keywords: bucketDData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET,
    })
    const totalProductRetainAdds = Object.values(productBucketMinRetainAdds).reduce(
      (sum, value) => sum + value,
      0
    )
    if (totalProductRetainAdds > 0) {
      console.log(
        `🛟 产品桶最小保留补齐: +${totalProductRetainAdds} (A:${productBucketMinRetainAdds.A || 0}, B:${productBucketMinRetainAdds.B || 0}, C:${productBucketMinRetainAdds.C || 0}, D:${productBucketMinRetainAdds.D || 0})`
      )
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedProduct = await injectGlobalCoreKeywordsForProduct({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      statistics: productBuckets.statistics,
    })

    bucketAData = injectedProduct.bucketAData
    bucketBData = injectedProduct.bucketBData
    bucketCData = injectedProduct.bucketCData
    bucketDData = injectedProduct.bucketDData

    // 9. 保存到数据库
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: productBuckets.bucketA.intent, keywords: bucketAData },
        bucketB: { intent: productBuckets.bucketB.intent, keywords: bucketBData },
        bucketC: { intent: productBuckets.bucketC.intent, keywords: bucketCData },
        bucketD: { intent: productBuckets.bucketD.intent, keywords: bucketDData },
        statistics: injectedProduct.statistics,
      },
      pageType // 🆕 v4.16: 传递页面类型
    )

    return pool
  }
}
