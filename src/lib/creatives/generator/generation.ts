import { getDatabase } from '../../db'
import type { GeneratedAdCreativeData } from '..'
import type { Offer } from '../../offers'
import { creativeCache, generateCreativeCacheKey } from '../../common'
import {
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPlannerPreparedSession,
  type KeywordPoolExpandLoadResult,
} from '@/lib/google-ads/accounts/auth/index'
import { type OfferKeywordPool } from '../../offer-keyword-pool' // 🔥 AI语义分类
import { generateContent, getGeminiMode } from '../../ai'
import { generateNegativeKeywords } from '../../keywords' // 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分
import {
  normalizeGoogleAdsKeyword,
  deduplicateKeywordsWithPriority,
  logDuplicateKeywords,
} from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重
import { getKeywordSourcePriorityScoreFromInput } from '../../keywords'

import { containsPureBrand, getPureBrandKeywords } from '../../keywords'
import { filterKeywordQuality, generateFilterReport, isBrandConcatenation } from '../../keywords' // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../../keywords'
import { normalizeLanguageCode } from '../../common'

import {
  type GoogleAdsPolicyGuardMode,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeKeywordListForGoogleAdsPolicy,
  sanitizeKeywordObjectsForGoogleAdsPolicy,
} from '@/lib/google-ads/policy/policy-guard'

import { normalizeCreativeBucketType, resolveCreativeBucketPoolKeywords } from './bucket'
import {
  AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE,
  AD_CREATIVE_RESPONSE_SCHEMA,
  AD_CREATIVE_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS,
  TOP_HEADLINE_SLOT_COUNT,
  TOP_HEADLINE_SLOT_START_INDEX,
  annotateCopyIntentMetadata,
  buildCreativeKeywordUsagePlan,
  enforceEmotionBoundaryByBucket,
  enforceFinalCreativeContract,
  enforceHeadlineComplementarity,
  enforceKeywordEmbedding,
  enforceRetainedKeywordSlotCoverage,
  enforceTitlePriorityTopHeadlines,
  filterModelIntentGeneratedKeywords,
  parseAIResponse,
  recordAdCreativeOperationTokenUsage,
  resolveAdCreativeRetryPlan,
  resolveEffectiveKeywordUsagePlan,
  softlyReinforceTypeCopy,
  validateGeneratedAdCreativeBusinessLimits,
} from './contract'
import {
  evaluateStoreModelIntentReadiness,
  finalizeKeywordsWithSingleExit,
  mergeExtractedKeywordsWithSingleExit,
  normalizeKeywordSourceAuditForGeneratorList,
  normalizeSourceTypeFromLegacySource,
  resolveCreativeTypeFromBucketForMerge,
  shouldRunGapAnalysisForCreative,
} from './keyword-audit'
import { applyKeywordSupplementationOnce } from './keyword-supplement'
import {
  enforceLanguageCtas,
  enforceLanguagePurityGate,
  resolveCreativeTargetLanguage,
  resolveSoftCopyLanguage,
} from './language'
import {
  buildAdCreativePrompt,
  buildDkiFirstHeadline,
  buildEmergencyAdCreativeRetryPrompt,
  buildSimplifiedAdCreativeRetryPrompt,
  normalizeLocalizationPayload,
  validateOfferDataQuality,
} from './prompts'
import type {
  AdCreativeRetryMode,
  KeywordSupplementationReport,
  KeywordWithVolume,
  NormalizedCreativeBucket,
  PrecomputedCreativeKeywordSet,
  RetryFailureType,
  SearchTermFeedbackHintsInput,
} from './types'
import { deriveLinkTypeFromScrapedData, safeParseJson } from './utils'

export async function runAdCreativeModelAttempt(params: {
  userId: number
  prompt: string
  policyGuardMode: GoogleAdsPolicyGuardMode
  retryMode?: AdCreativeRetryMode
  bucket: NormalizedCreativeBucket
}): Promise<{
  aiResponse: Awaited<ReturnType<typeof generateContent>>
  result: GeneratedAdCreativeData
}> {
  const retryMode = params.retryMode
  const isSimplified = retryMode === 'simplified'
  const isEmergency = retryMode === 'emergency'
  const aiResponse = await generateContent(
    {
      operationType: 'ad_creative_generation_main',
      prompt: params.prompt,
      temperature: isEmergency ? AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE : 0.7,
      maxOutputTokens: retryMode ? AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS : 16384,
      responseSchema: isEmergency
        ? AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA
        : isSimplified
          ? AD_CREATIVE_RETRY_RESPONSE_SCHEMA
          : AD_CREATIVE_RESPONSE_SCHEMA,
      responseMimeType: 'application/json',
    },
    params.userId
  )

  await recordAdCreativeOperationTokenUsage({
    userId: params.userId,
    operationType: isEmergency
      ? 'ad_creative_generation_retry_emergency'
      : isSimplified
        ? 'ad_creative_generation_retry_simplified'
        : 'ad_creative_generation_main',
    aiResponse,
  })

  const parsed = parseAIResponse(aiResponse.text, { policyGuardMode: params.policyGuardMode })
  const modelFiltered = filterModelIntentGeneratedKeywords(parsed, params.bucket)
  const result = validateGeneratedAdCreativeBusinessLimits(modelFiltered)

  return { aiResponse, result }
}

/**
 * 主函数：生成广告创意（带缓存）
 *
 * ✅ 安全修复：userId改为必需参数，确保用户只能访问自己的Offer
 */

export async function generateAdCreative(
  offerId: number,
  userId: number, // ✅ 修复：改为必需参数
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[] // 需要排除的关键词（用于多次生成时避免重复）
    retryFailureType?: RetryFailureType
    searchTermFeedbackHints?: SearchTermFeedbackHintsInput
    policyGuardMode?: GoogleAdsPolicyGuardMode
    // 🆕 v4.10: 关键词池参数
    keywordPool?: any // OfferKeywordPool
    bucket?: 'A' | 'B' | 'C' | 'S' | 'D' // 🔥 2025-12-22: 添加D（高购买意图）桶支持
    bucketKeywords?: string[]
    bucketIntent?: string
    bucketIntentEn?: string
    deferKeywordSupplementation?: boolean
    deferKeywordPostProcessingToBuilder?: boolean
    precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
    // 内部 coverage 模式兼容参数（不代表第4种创意类型）
    isCoverageCreative?: boolean
    isSyntheticCreative?: boolean
    coverageKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>
    syntheticKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>
    /** 上游已 prepare 时传入，避免重复 loadKeywordPoolExpandCredentialsForOffer */
    plannerSession?: KeywordPlannerPreparedSession
    preparedExpand?: KeywordPoolExpandLoadResult
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  const isCoverageCreative = Boolean(options?.isCoverageCreative || options?.isSyntheticCreative)

  // 生成缓存键
  const cacheKey = generateCreativeCacheKey(offerId, options)

  // 检查缓存（除非显式跳过）
  if (!options?.skipCache) {
    const cached = creativeCache.get(cacheKey)
    if (cached) {
      console.log('✅ 使用缓存的广告创意')
      console.log(`   - Cache Key: ${cacheKey}`)
      console.log(`   - Headlines: ${cached.headlines.length}个`)
      console.log(`   - Descriptions: ${cached.descriptions.length}个`)
      return cached
    }
  }

  const db = await getDatabase()

  // ✅ 安全修复：获取Offer数据时验证user_id，防止跨用户访问
  const offer = await db.queryOne(
    `
    SELECT * FROM offers WHERE id = ? AND user_id = ?
  `,
    [offerId, userId]
  )

  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 🔒 前置数据质量校验（2026-01-26）：防止使用错误数据生成创意
  const preGenerationValidation = validateOfferDataQuality(offer as any)
  if (!preGenerationValidation.isValid) {
    console.error(`[generateAdCreative] ❌ 前置校验失败，阻止创意生成:`)
    preGenerationValidation.issues.forEach((issue) => console.error(`   - ${issue}`))
    throw new Error(`创意生成前置校验失败: ${preGenerationValidation.issues.join('; ')}`)
  }

  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(options?.policyGuardMode)
  console.log(`[PolicyGuard] 当前策略模式: ${policyGuardMode}`)
  const scrapedDataForOffer = safeParseJson((offer as any).scraped_data, null)
  const derivedOfferLinkType = deriveLinkTypeFromScrapedData(scrapedDataForOffer)
  const effectiveLinkType = (() => {
    const explicit = (offer as any).page_type as 'product' | 'store' | null
    if (explicit === 'store') return 'store'
    if (explicit === 'product') return derivedOfferLinkType === 'store' ? 'store' : 'product'
    return derivedOfferLinkType || 'product'
  })()
  const normalizedBucket = normalizeCreativeBucketType(options?.bucket || null)

  const offerBrand = (offer as { brand?: string }).brand || 'Unknown'
  const canonicalBrandKeyword = normalizeGoogleAdsKeyword(offerBrand)
  const pureBrandKeywordsList = getPureBrandKeywords(offerBrand)
  const brandTokensToMatch =
    pureBrandKeywordsList.length > 0
      ? pureBrandKeywordsList
      : canonicalBrandKeyword
        ? [canonicalBrandKeyword]
        : []
  const mustContainBrand = brandTokensToMatch.length > 0

  const containsBrand = (keyword: string, _searchVolume?: number): boolean => {
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    // 🔥 修复(2026-03-13): 品牌拼接词即使搜索量为 0 也应该保留（真实品牌词）
    // 移除搜索量依赖，避免真实品牌词被意外过滤
    if (isBrandConcatenation(keyword, offerBrand)) return true
    return false
  }

  // 🎯 需求34: 读取已提取的广告元素（从爬虫阶段保存的数据）
  let extractedElements: {
    keywords?: Array<{
      keyword: string
      searchVolume: number
      source: string
      sourceType?: string
      priority: string
    }>
    headlines?: string[]
    descriptions?: string[]
  } = {}

  // 🎯 P0/P1/P2/P3优化: 读取AI增强的提取数据
  let enhancedData: {
    keywords?: Array<{ keyword: string; volume: number; competition: string; score: number }>
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    qualityScore?: number
    headlines?: string[]
    descriptions?: string[]
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
  } = {}

  try {
    // 🔥 修复(2025-12-26): 优先从关键词池获取关键词，而非使用旧的extracted_keywords
    // 关键词池已经过Keyword Planner扩展验证，包含高质量关键词
    const { getKeywordPoolByOfferId } = await import('../../offer-keyword-pool')
    const keywordPool =
      (options?.keywordPool as OfferKeywordPool | undefined) ||
      (await getKeywordPoolByOfferId(offer.id))

    if (keywordPool && keywordPool.totalKeywords > 0) {
      // 统一走 canonical creative bucket 视图：
      // A=brand_intent, B/C=model_intent, D/S=product_intent
      const poolKeywords = resolveCreativeBucketPoolKeywords(keywordPool, normalizedBucket, 'A')

      // 转换为extractedElements格式
      // 🔧 修复(2026-01-21): 保留原始 source 字段，用于后续过滤 CLUSTERED 关键词
      extractedElements.keywords = poolKeywords.map((kw) => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: kw.source || 'KEYWORD_POOL', // 保留原始 source（CLUSTERED/KEYWORD_PLANNER）
        sourceType: normalizeSourceTypeFromLegacySource({
          source: kw.source || 'KEYWORD_POOL',
          sourceType: (kw as any).sourceType,
        }),
        priority: 'HIGH' as const,
        isPureBrand: kw.isPureBrand, // 🔧 保留纯品牌词标记
      }))

      // 🔥 2025-12-28: 关键词质量过滤
      // 从关键词池获取关键词后再次过滤，确保移除品牌变体词和语义查询词
      // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
      const keywordFilterResult = filterKeywordQuality(extractedElements.keywords, {
        brandName: offerBrand,
        category: offer.category || undefined,
        productName: (offer as any).product_name || undefined,
        targetCountry: offer.target_country || undefined,
        targetLanguage: offer.target_language || undefined,
        productUrl: offer.final_url || offer.url || undefined,
        minWordCount: 1,
        maxWordCount: 8,
        mustContainBrand,
        // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
        minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
          pageType: (offer as any).page_type || null,
        }),
      })

      // 生成过滤报告
      const filterReport = generateFilterReport(
        extractedElements.keywords.length,
        keywordFilterResult.removed
      )
      console.log(filterReport)

      // 将 PoolKeywordData[] 转换为标准关键词格式并赋值
      extractedElements.keywords = keywordFilterResult.filtered.map((kw) => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: kw.source || 'KEYWORD_POOL',
        sourceType: normalizeSourceTypeFromLegacySource({
          source: kw.source || 'KEYWORD_POOL',
          sourceType: (kw as any).sourceType,
        }),
        priority: 'HIGH' as const,
      }))
      console.log(
        `🎯 从关键词池#${keywordPool.id} 获取 ${poolKeywords.length} 个关键词，过滤后剩余 ${extractedElements.keywords.length} 个 (bucket ${normalizedBucket || 'A'})`
      )
    } else if ((offer as any).extracted_keywords) {
      // Fallback: 关键词池不存在时，使用旧的extracted_keywords
      const rawKeywords = JSON.parse((offer as any).extracted_keywords)

      // 🔧 修复(2025-12-17): 兼容两种数据格式
      // 格式1: 字符串数组 ["Reolink", "reolink camera", ...]
      // 格式2: 对象数组 [{keyword: "Reolink", searchVolume: 90500}, ...]
      if (Array.isArray(rawKeywords) && rawKeywords.length > 0) {
        if (typeof rawKeywords[0] === 'string') {
          // 字符串数组 → 转换为对象数组（searchVolume设为0，后续会查询真实数据）
          extractedElements.keywords = rawKeywords.map((kw) => ({
            keyword: kw,
            searchVolume: 0,
            source: 'EXTRACTED',
            sourceType: normalizeSourceTypeFromLegacySource({ source: 'EXTRACTED' }),
            priority: 'MEDIUM',
          }))
          console.log(
            `📦 读取到 ${extractedElements.keywords?.length || 0} 个提取的关键词（字符串格式，待查询搜索量）`
          )
        } else if (rawKeywords[0]?.keyword !== undefined) {
          // 对象数组 → 直接使用
          extractedElements.keywords = rawKeywords
          console.log(`📦 读取到 ${extractedElements.keywords.length} 个提取的关键词（对象格式）`)
        } else {
          console.warn(`⚠️ extracted_keywords格式未知，跳过`)
        }

        // 🔥 2025-12-28: 关键词质量过滤（Fallback路径也需要过滤）
        // 只有当 keywords 存在且非空时才进行过滤
        // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
        if (extractedElements.keywords && extractedElements.keywords.length > 0) {
          const keywordFilterResult = filterKeywordQuality(extractedElements.keywords, {
            brandName: offerBrand,
            category: offer.category || undefined,
            productName: (offer as any).product_name || undefined,
            targetCountry: offer.target_country || undefined,
            targetLanguage: offer.target_language || undefined,
            productUrl: offer.final_url || offer.url || undefined,
            minWordCount: 1,
            maxWordCount: 8,
            mustContainBrand,
            minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
              pageType: (offer as any).page_type || null,
            }),
          })
          const filterReport = generateFilterReport(
            extractedElements.keywords.length,
            keywordFilterResult.removed
          )
          console.log(filterReport)
          // 将 PoolKeywordData[] 转换为标准关键词格式
          extractedElements.keywords = keywordFilterResult.filtered.map((kw) => ({
            keyword: kw.keyword,
            searchVolume: kw.searchVolume || 0,
            source: kw.source || 'EXTRACTED',
            sourceType: normalizeSourceTypeFromLegacySource({
              source: kw.source || 'EXTRACTED',
              sourceType: (kw as any).sourceType,
            }),
            priority: 'MEDIUM' as const,
          }))
        }
      }
    }
    if ((offer as any).extracted_headlines) {
      extractedElements.headlines = JSON.parse((offer as any).extracted_headlines)
      console.log(`📦 读取到 ${extractedElements.headlines?.length || 0} 个提取的标题`)
    }
    if ((offer as any).extracted_descriptions) {
      extractedElements.descriptions = JSON.parse((offer as any).extracted_descriptions)
      console.log(`📦 读取到 ${extractedElements.descriptions?.length || 0} 个提取的描述`)
    }

    // 🎯 读取增强数据（优先使用，因为质量更高）
    if ((offer as any).enhanced_keywords) {
      let rawKeywords: Array<{
        keyword: string
        volume?: number
        competition?: string
        score?: number
      }> = JSON.parse((offer as any).enhanced_keywords)
      console.log(`✨ 读取到 ${rawKeywords?.length || 0} 个增强关键词`)

      // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
      // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
      // 保留其他过滤机制：竞品品牌、品牌变体、语义查询、搜索量过滤
      enhancedData.keywords = rawKeywords.map((kw) => ({
        keyword: kw.keyword,
        volume: (kw as any).volume || 0,
        competition: (kw as any).competition || '',
        score: (kw as any).score || 0,
      }))
      console.log(`✅ 关键词处理完成，共 ${enhancedData.keywords?.length || 0} 个增强关键词`)
    }
    if ((offer as any).enhanced_product_info) {
      enhancedData.productInfo = JSON.parse((offer as any).enhanced_product_info)
      console.log(`✨ 读取到增强产品信息`)
    }
    if ((offer as any).enhanced_review_analysis) {
      enhancedData.reviewAnalysis = JSON.parse((offer as any).enhanced_review_analysis)
      console.log(`✨ 读取到增强评论分析`)
    }
    if ((offer as any).extraction_quality_score) {
      enhancedData.qualityScore = (offer as any).extraction_quality_score
      console.log(`✨ 提取质量评分: ${enhancedData.qualityScore}/100`)
    }
    if ((offer as any).enhanced_headlines) {
      enhancedData.headlines = JSON.parse((offer as any).enhanced_headlines)
      console.log(`✨ 读取到 ${enhancedData.headlines?.length || 0} 个增强标题`)
    }
    if ((offer as any).enhanced_descriptions) {
      enhancedData.descriptions = JSON.parse((offer as any).enhanced_descriptions)
      console.log(`✨ 读取到 ${enhancedData.descriptions?.length || 0} 个增强描述`)
    }
    if ((offer as any).localization_adapt) {
      const rawLocalization = JSON.parse((offer as any).localization_adapt)
      enhancedData.localization = normalizeLocalizationPayload(rawLocalization)
      console.log(
        `✨ 读取到本地化适配数据${enhancedData.localization ? '（已标准化）' : '（结构不兼容，跳过）'}`
      )
    }
    if ((offer as any).brand_analysis) {
      enhancedData.brandAnalysis = JSON.parse((offer as any).brand_analysis)
      console.log(`✨ 读取到品牌分析数据`)
    }
  } catch (parseError: any) {
    console.warn('⚠️ 解析提取的广告元素失败，将使用AI全新生成:', parseError.message)
  }

  // 🎯 合并数据：将enhanced和extracted数据合并（去重）
  // 统一关键词格式为extracted格式（因为buildAdCreativePrompt期望这个格式）
  let normalizedEnhancedKeywords = (enhancedData.keywords || []).map((kw) => ({
    keyword: kw.keyword,
    searchVolume: kw.volume || 0,
    source: 'AI_ENHANCED',
    sourceType: 'AI_ENHANCED_PERSISTED',
    priority: kw.score > 80 ? 'HIGH' : kw.score > 60 ? 'MEDIUM' : 'LOW',
  }))
  const policySafeEnhancedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(
    normalizedEnhancedKeywords,
    { mode: policyGuardMode }
  )
  if (policySafeEnhancedKeywords.changedCount > 0 || policySafeEnhancedKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 增强关键词净化: 替换${policySafeEnhancedKeywords.changedCount}个, 丢弃${policySafeEnhancedKeywords.droppedCount}个`
    )
  }
  normalizedEnhancedKeywords = policySafeEnhancedKeywords.items

  // 🆕 v4.10: 如果传入了桶关键词，将其作为最高优先级关键词
  let bucketKeywordsNormalized: Array<{
    keyword: string
    searchVolume: number
    source: string
    priority: string
  }> = []

  // 🆕 v4.16: 如果没有传入桶关键词，根据链接类型和bucket自动获取
  if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
    bucketKeywordsNormalized = options.bucketKeywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0, // 搜索量会在后续步骤中填充
      source: 'KEYWORD_POOL',
      sourceType: 'CANONICAL_BUCKET_VIEW',
      priority: 'HIGH', // 桶关键词优先级最高
    }))
    console.log(
      `📦 v4.10 关键词池: 使用桶 ${options.bucket} (${options.bucketIntent}) 的 ${bucketKeywordsNormalized.length} 个关键词`
    )
  } else if (options?.bucket) {
    // 🆕 v4.16: 自动根据链接类型和bucket获取关键词
    const { getKeywordsByLinkTypeAndBucket } = await import('../../offer-keyword-pool')

    const bucketType = options.bucket as 'A' | 'B' | 'C' | 'D' | 'S'

    const keywordResult = await getKeywordsByLinkTypeAndBucket(
      offerId,
      effectiveLinkType,
      bucketType
    )

    if (keywordResult.keywords.length > 0) {
      bucketKeywordsNormalized = keywordResult.keywords.map((kw) => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        priority: 'HIGH',
      }))
      console.log(
        `📦 v4.16 关键词池: ${effectiveLinkType}链接 - 桶 ${bucketType} (${keywordResult.intent}) 的 ${bucketKeywordsNormalized.length} 个关键词`
      )
    } else {
      console.log(
        `📦 v4.16 关键词池: ${effectiveLinkType}链接 - 桶 ${bucketType} 暂无关键词，将使用默认关键词`
      )
    }
  }
  const policySafeBucketKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(
    bucketKeywordsNormalized,
    { mode: policyGuardMode }
  )
  if (policySafeBucketKeywords.changedCount > 0 || policySafeBucketKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 桶关键词净化: 替换${policySafeBucketKeywords.changedCount}个, 丢弃${policySafeBucketKeywords.droppedCount}个`
    )
  }
  bucketKeywordsNormalized = policySafeBucketKeywords.items

  // 🔥 2025-12-16修复：统一extracted关键词格式（可能是字符串数组或对象数组）
  let normalizedExtractedKeywords = (extractedElements.keywords || [])
    .map((kw: any) => {
      // 如果是字符串，转换为对象格式
      if (typeof kw === 'string') {
        return {
          keyword: kw,
          searchVolume: 0,
          source: 'EXTRACTED',
          sourceType: normalizeSourceTypeFromLegacySource({ source: 'EXTRACTED' }),
          priority: 'MEDIUM',
        }
      }
      // 已经是对象格式
      return {
        keyword: String(kw.keyword || ''),
        searchVolume: kw.searchVolume || kw.volume || 0,
        source: kw.source || 'EXTRACTED',
        sourceType: normalizeSourceTypeFromLegacySource({
          source: kw.source || 'EXTRACTED',
          sourceType: kw.sourceType,
        }),
        priority: kw.priority || 'MEDIUM',
      }
    })
    .filter((kw: { keyword: string }) => kw.keyword.length > 0)
  const policySafeExtractedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(
    normalizedExtractedKeywords,
    { mode: policyGuardMode }
  )
  if (
    policySafeExtractedKeywords.changedCount > 0 ||
    policySafeExtractedKeywords.droppedCount > 0
  ) {
    console.log(
      `[PolicyGuard] 提取关键词净化: 替换${policySafeExtractedKeywords.changedCount}个, 丢弃${policySafeExtractedKeywords.droppedCount}个`
    )
  }
  normalizedExtractedKeywords = policySafeExtractedKeywords.items

  // 🆕 处理高性能搜索词（从实际广告表现中学习）
  let searchTermKeywords: Array<{
    keyword: string
    searchVolume: number
    source: string
    priority: string
  }> = []
  if (
    options?.searchTermFeedbackHints?.highPerformingTerms &&
    options.searchTermFeedbackHints.highPerformingTerms.length > 0
  ) {
    searchTermKeywords = options.searchTermFeedbackHints.highPerformingTerms.map((term) => ({
      keyword: term,
      searchVolume: 0, // 搜索词没有预估搜索量，但有真实表现数据
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      priority: 'HIGH', // 高性能搜索词优先级高
    }))
    console.log(`🔍 添加 ${searchTermKeywords.length} 个高性能搜索词作为关键词候选`)
  }

  // 🆕 v4.10: 桶关键词优先，然后是高性能搜索词，增强关键词，最后是基础关键词
  // 🔥 优化(2025-12-22): 使用Google Ads标准化规则去重
  let mergedKeywords = [
    ...bucketKeywordsNormalized,
    ...searchTermKeywords,
    ...normalizedEnhancedKeywords,
    ...normalizedExtractedKeywords,
  ]
  const policySafeMergedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(mergedKeywords, {
    mode: policyGuardMode,
  })
  if (policySafeMergedKeywords.changedCount > 0 || policySafeMergedKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 合并关键词兜底净化: 替换${policySafeMergedKeywords.changedCount}个, 丢弃${policySafeMergedKeywords.droppedCount}个`
    )
  }
  mergedKeywords = policySafeMergedKeywords.items

  // 🆕 2026-03-13: 关键词缺口分析 - 在创意生成前识别缺失的行业标准关键词
  if (
    shouldRunGapAnalysisForCreative({
      bucket: normalizedBucket,
      isCoverageCreative,
      deferKeywordSupplementation: options?.deferKeywordSupplementation,
    })
  ) {
    try {
      console.log('[Gap Analysis] 开始关键词缺口分析...')
      const { analyzeKeywordGapsPreGeneration } = await import('../../launch-score')

      const gapAnalysis = await analyzeKeywordGapsPreGeneration({
        offer: offer as any,
        existingKeywords: mergedKeywords,
        brandName: offerBrand,
        userId,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language,
      })

      if (gapAnalysis.suggestedKeywords.length > 0) {
        console.log(
          `[Gap Analysis] 发现 ${gapAnalysis.suggestedKeywords.length} 个建议关键词（最多添加10个）`
        )

        // 应用品牌前缀
        const { composeGlobalCoreBrandedKeyword } = await import('../../offer-keyword-pool')
        const { normalizeGoogleAdsKeyword } = await import('@/lib/google-ads/keyword/normalizer')
        const brandedGapKeywords: string[] = []

        // 构建现有关键词的标准化集合（用于去重）
        const existingKeywordsNormalized = new Set(
          mergedKeywords.map((kw) => normalizeGoogleAdsKeyword(kw.keyword))
        )

        let skippedExistingCount = 0
        let brandingFailedCount = 0
        for (const keyword of gapAnalysis.suggestedKeywords) {
          const brandedKeyword = composeGlobalCoreBrandedKeyword(keyword, offerBrand, 5)
          const finalKeyword = brandedKeyword || keyword

          // 🔥 关键修复：检查品牌化后的关键词是否已存在
          const normalizedFinal = normalizeGoogleAdsKeyword(finalKeyword)
          if (existingKeywordsNormalized.has(normalizedFinal)) {
            console.log(`[Gap Analysis] ⏭️ 跳过已存在的关键词: ${finalKeyword}`)
            skippedExistingCount++
            continue
          }

          if (brandedKeyword) {
            brandedGapKeywords.push(brandedKeyword)
            console.log(`[Gap Analysis] ✅ 品牌化关键词: ${keyword} → ${brandedKeyword}`)
          } else {
            // 🔥 修复(2026-03-13): 品牌化失败时丢弃关键词，确保所有SCORING_SUGGESTION关键词都包含品牌
            console.log(`[Gap Analysis] ❌ 品牌化失败（超过5词），丢弃关键词: ${keyword}`)
            brandingFailedCount++
            // 不添加到 brandedGapKeywords，避免不含品牌的行业词进入关键词池
          }
        }

        if (skippedExistingCount > 0) {
          console.log(`[Gap Analysis] 跳过了 ${skippedExistingCount} 个已存在的关键词`)
        }

        if (brandingFailedCount > 0) {
          console.log(
            `[Gap Analysis] 丢弃了 ${brandingFailedCount} 个品牌化失败的关键词（品牌化后超过5词）`
          )
        }

        // 添加到关键词池，标记为SCORING_SUGGESTION源
        const gapKeywordsNormalized = brandedGapKeywords.map((kw) => ({
          keyword: kw,
          searchVolume: 0, // 绕过搜索量过滤
          source: 'SCORING_SUGGESTION',
          sourceType: 'GAP_INDUSTRY_BRANDED',
          priority: 'HIGH',
          matchType: 'PHRASE' as const, // 🎯 需求：默认词组匹配
        }))

        // 合并到现有关键词
        mergedKeywords.push(...gapKeywordsNormalized)
        console.log(
          `[Gap Analysis] ✅ 最终添加 ${gapKeywordsNormalized.length} 个缺口关键词到关键词池`
        )
      } else {
        console.log('[Gap Analysis] 未发现关键词缺口')
      }
    } catch (gapError: any) {
      console.warn('[Gap Analysis] 缺口分析失败，继续正常流程:', gapError.message)
    }
  }

  // 🔥 优化：使用Google Ads标准化进行去重，保留最高优先级的关键词
  const uniqueKeywords = deduplicateKeywordsWithPriority(
    mergedKeywords,
    (kw) => kw.keyword,
    (kw) => {
      // 统一来源优先级：使用共享配置，避免多处硬编码冲突。
      const sourceScore = getKeywordSourcePriorityScoreFromInput({
        source: kw.source,
        sourceType: (kw as any).sourceType,
      })
      return sourceScore > 0 ? sourceScore : 10
    }
  )

  // 🔥 2025-12-28: 最终关键词质量过滤
  // 确保所有来源的关键词都经过过滤，移除品牌变体词和语义查询词
  // 🔒 强制：最终只保留包含“纯品牌词”的关键词（不拼接造词）
  const finalKeywordFilter = filterKeywordQuality(uniqueKeywords, {
    brandName: offerBrand,
    category: offer.category || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand,
  })

  if (finalKeywordFilter.removed.length > 0) {
    console.log(`🧹 最终关键词过滤: 移除 ${finalKeywordFilter.removed.length} 个低质量关键词`)
    finalKeywordFilter.removed.slice(0, 5).forEach((item) => {
      const kw = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      console.log(`   - "${kw}": ${item.reason}`)
    })
  }

  // 将 PoolKeywordData[] 转换为标准关键词格式
  const filteredKeywords = finalKeywordFilter.filtered.map((kw) => ({
    keyword: kw.keyword,
    searchVolume: kw.searchVolume || 0,
    source: kw.source || 'FILTERED',
    sourceType: (kw as any).sourceType,
    priority: 'MEDIUM' as const,
  }))

  // 🔥 调试：打印去重信息
  logDuplicateKeywords(
    mergedKeywords.map((kw) => kw.keyword),
    '合并前关键词'
  )

  // 标题和描述合并
  const mergedHeadlines = [
    ...(enhancedData.headlines || []),
    ...(extractedElements.headlines || []),
  ]
  const mergedDescriptions = [
    ...(enhancedData.descriptions || []),
    ...(extractedElements.descriptions || []),
  ]

  // 标题和描述去重
  const uniqueHeadlines = [...new Set(mergedHeadlines)]
  const uniqueDescriptions = [...new Set(mergedDescriptions)]

  const mergedData = {
    keywords: filteredKeywords,
    headlines: uniqueHeadlines,
    descriptions: uniqueDescriptions,
    productInfo: enhancedData.productInfo,
    reviewAnalysis: enhancedData.reviewAnalysis,
    localization: enhancedData.localization,
    brandAnalysis: enhancedData.brandAnalysis,
    qualityScore: enhancedData.qualityScore,
    // 🆕 v4.10: 添加桶信息到合并数据中
    bucketInfo: options?.bucket
      ? {
          bucket: options.bucket,
          intent: options.bucketIntent,
          intentEn: options.bucketIntentEn,
          keywordCount: bucketKeywordsNormalized.length,
        }
      : undefined,
  }

  const storeModelIntentReadiness = evaluateStoreModelIntentReadiness({
    bucket: normalizedBucket,
    linkType: effectiveLinkType,
    scrapedData: (offer as any).scraped_data,
    brandAnalysis: mergedData.brandAnalysis,
    storeProductLinks: (offer as any).store_product_links,
  })
  if (!storeModelIntentReadiness.isReady) {
    console.error(`[generateAdCreative] ❌ ${storeModelIntentReadiness.reason}`)
    if (storeModelIntentReadiness.evidenceSources.length > 0) {
      console.error(`   已检查来源: ${storeModelIntentReadiness.evidenceSources.join(', ')}`)
    }
    throw new Error(storeModelIntentReadiness.reason)
  }
  if (effectiveLinkType === 'store' && normalizedBucket === 'B') {
    console.log(
      `[generateAdCreative] ✅ 店铺型号意图校验通过: hotProducts=${storeModelIntentReadiness.verifiedHotProducts.length}, modelAnchors=${storeModelIntentReadiness.hotProductModelAnchors.join(', ')}`
    )
  }

  console.log('📊 合并后的数据:')
  if (options?.bucket) {
    console.log(`   - 🆕 关键词池桶: ${options.bucket} (${options.bucketIntent})`)
    console.log(
      `   - 关键词: ${mergedData.keywords?.length || 0}个 (桶${bucketKeywordsNormalized.length} + 增强${enhancedData.keywords?.length || 0} + 基础${extractedElements.keywords?.length || 0})`
    )
  } else {
    console.log(
      `   - 关键词: ${mergedData.keywords?.length || 0}个 (基础${extractedElements.keywords?.length || 0} + 增强${enhancedData.keywords?.length || 0})`
    )
  }
  console.log(
    `   - 标题: ${mergedData.headlines?.length || 0}个 (基础${extractedElements.headlines?.length || 0} + 增强${enhancedData.headlines?.length || 0})`
  )
  console.log(
    `   - 描述: ${mergedData.descriptions?.length || 0}个 (基础${extractedElements.descriptions?.length || 0} + 增强${enhancedData.descriptions?.length || 0})`
  )
  console.log(`   - 产品信息: ${mergedData.productInfo ? '有✨' : '无'}`)
  console.log(`   - 本地化: ${mergedData.localization ? '有✨' : '无'}`)
  console.log(`   - 品牌分析: ${mergedData.brandAnalysis ? '有✨' : '无'}`)

  const precomputedKeywordSet = options?.precomputedKeywordSet || null
  const initialKeywordUsagePlan = buildCreativeKeywordUsagePlan({
    brandName: offerBrand,
    precomputedKeywordSet,
  })

  // 构建Prompt（传入合并后的数据）
  const { prompt, promptKeywords } = await buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance,
    options?.excludeKeywords,
    mergedData, // 🎯 传入合并后的增强数据
    {
      retryFailureType: options?.retryFailureType,
      searchTermFeedbackHints: options?.searchTermFeedbackHints,
      policyGuardMode,
      precomputedKeywordSet,
    }
  )

  // 使用统一AI入口（优先Vertex AI，自动降级到Gemini API）
  if (!userId) {
    throw new Error('生成广告创意需要用户ID，请确保已登录')
  }
  const aiMode = await getGeminiMode(userId)
  console.log(`🤖 使用统一AI入口生成广告创意 (${aiMode})...`)

  const timerLabel = `⏱️ AI生成创意 ${offerId}-${userId}-${Date.now()}`
  console.time(timerLabel)
  let aiResponse!: Awaited<ReturnType<typeof generateContent>>
  let result!: GeneratedAdCreativeData
  try {
    try {
      const attempt = await runAdCreativeModelAttempt({
        userId,
        prompt,
        policyGuardMode,
        bucket: normalizedBucket,
      })
      aiResponse = attempt.aiResponse
      result = attempt.result
    } catch (error: any) {
      const retryPlan = resolveAdCreativeRetryPlan(error, false)
      if (!retryPlan) {
        throw error
      }

      console.warn(
        `[AdCreative] 标准尝试失败，开始 ${retryPlan.mode} retry: ` +
          `${error?.code || 'UNKNOWN'} ${String(error?.message || '')} (reason=${retryPlan.reason})`
      )
      const retryPrompt =
        retryPlan.mode === 'emergency'
          ? buildEmergencyAdCreativeRetryPrompt(prompt)
          : buildSimplifiedAdCreativeRetryPrompt(prompt)
      const retryAttempt = await runAdCreativeModelAttempt({
        userId,
        prompt: retryPrompt,
        policyGuardMode,
        retryMode: retryPlan.mode,
        bucket: normalizedBucket,
      })
      aiResponse = retryAttempt.aiResponse
      result = retryAttempt.result
    }
  } finally {
    console.timeEnd(timerLabel)
  }
  const aiModel = `${aiMode}:${aiResponse.model}`
  result.promptKeywords = promptKeywords
  result.keywordUsagePlan = initialKeywordUsagePlan

  // 🔧 修复(2025-12-27): 对AI生成的关键词进行质量过滤（移除品牌变体词和语义查询词）
  const brandName = offerBrand || 'Brand'
  if (result.keywords && result.keywords.length > 0) {
    const policySafeGeneratedKeywords = sanitizeKeywordListForGoogleAdsPolicy(result.keywords, {
      mode: policyGuardMode,
    })
    if (
      policySafeGeneratedKeywords.changedCount > 0 ||
      policySafeGeneratedKeywords.droppedCount > 0
    ) {
      console.log(
        `[PolicyGuard] AI生成关键词净化: 替换${policySafeGeneratedKeywords.changedCount}个, 丢弃${policySafeGeneratedKeywords.droppedCount}个`
      )
    }
    result.keywords = policySafeGeneratedKeywords.items

    const { filterKeywordQuality } = await import('../../keywords')
    const keywordData = result.keywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      source: 'AI_GENERATED' as const,
      sourceType: 'AI_LLM_RAW',
    }))
    const filtered = filterKeywordQuality(keywordData, {
      brandName,
      minWordCount: 1,
      maxWordCount: 8,
      // 🔒 强制：AI生成关键词也必须包含纯品牌词（不拼接造词）
      mustContainBrand,
    })

    if (filtered.removed.length > 0) {
      console.warn(`⚠️ 关键词质量过滤: 移除 ${filtered.removed.length} 个低质量关键词`)
      filtered.removed.slice(0, 5).forEach((item) => {
        console.warn(`   - "${item.keyword.keyword}": ${item.reason}`)
      })
    }

    result.keywords = filtered.filtered.map((kw) => kw.keyword)

    // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
    // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
    console.log(`✅ 关键词质量过滤完成，共 ${result.keywords.length} 个关键词`)

    // 🔧 修复(2025-12-27): 添加Google Ads标准化去重，消除AI生成的重复关键词
    const { deduplicateKeywordsWithPriority } = await import('@/lib/google-ads/keyword/normalizer')
    const keywordsAfterDedup = deduplicateKeywordsWithPriority(
      result.keywords,
      (kw) => kw,
      () => 0 // 所有AI生成关键词优先级相同
    )

    const removedDuplicates = result.keywords.length - keywordsAfterDedup.length
    if (removedDuplicates > 0) {
      console.warn(`⚠️ 关键词去重: 移除 ${removedDuplicates} 个重复关键词`)
    }
    result.keywords = keywordsAfterDedup
    console.log(`📝 关键词去重后: ${result.keywords.length} 个唯一关键词`)
  }

  // 🔥 强制第一个headline为DKI品牌格式（自动处理30字符限制）
  const HEADLINE_MAX_LENGTH = 30
  const targetCountryRaw = (offer as { target_country?: string }).target_country || 'US'
  const resolvedCreativeLanguage = resolveCreativeTargetLanguage(
    (offer as { target_language?: string }).target_language || null,
    targetCountryRaw
  )
  const targetCountry = resolvedCreativeLanguage.targetCountry
  const targetLanguage = resolvedCreativeLanguage.languageName
  const titlePriorityProductTitle = (() => {
    const scrapedTitle =
      scrapedDataForOffer && typeof scrapedDataForOffer === 'object'
        ? typeof (scrapedDataForOffer as any).productName === 'string'
          ? (scrapedDataForOffer as any).productName
          : typeof (scrapedDataForOffer as any).title === 'string'
            ? (scrapedDataForOffer as any).title
            : ''
        : ''
    return String(
      scrapedTitle ||
        (offer as any).product_title ||
        (offer as any).product_name ||
        (offer as any).name ||
        ''
    ).trim()
  })()
  const titlePriorityAboutItems = (() => {
    const scrapedAbout = Array.isArray((scrapedDataForOffer as any)?.aboutThisItem)
      ? (scrapedDataForOffer as any).aboutThisItem
      : []
    const scrapedFeatures = Array.isArray((scrapedDataForOffer as any)?.features)
      ? (scrapedDataForOffer as any).features
      : []
    const enhancedFeatures = Array.isArray(mergedData.productInfo?.features)
      ? mergedData.productInfo.features
      : []
    const enhancedBenefits = Array.isArray(mergedData.productInfo?.benefits)
      ? mergedData.productInfo.benefits
      : []
    const primary =
      scrapedAbout.length > 0
        ? scrapedAbout
        : scrapedFeatures.length > 0
          ? scrapedFeatures
          : enhancedFeatures
    return Array.from(
      new Set(
        [...primary, ...enhancedBenefits]
          .map((item: any) => String(item || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 12)
  })()

  const finalFirstHeadline = buildDkiFirstHeadline(brandName, HEADLINE_MAX_LENGTH, {
    targetLanguage,
    targetCountry,
  })

  if (result.headlines.length > 0) {
    // 检查第一个headline是否符合要求
    if (result.headlines[0] !== finalFirstHeadline) {
      // 说明：DKI token 本身不计入字符数，因此这里不使用 finalFirstHeadline.length 做判断
      console.log(`🔧 强制第一个headline: "${result.headlines[0]}" → "${finalFirstHeadline}"`)
      result.headlines[0] = finalFirstHeadline
      if (result.headlinesWithMetadata && result.headlinesWithMetadata.length > 0) {
        result.headlinesWithMetadata[0] = {
          ...result.headlinesWithMetadata[0],
          text: finalFirstHeadline,
          length: finalFirstHeadline.length,
        }
      }
    } else {
      console.log(`✅ 第一个headline已符合要求: "${finalFirstHeadline}"`)
    }
  }

  const titlePriorityPreFix = enforceTitlePriorityTopHeadlines(result, {
    brandName,
    brandTokensToMatch,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    targetLanguage,
    slotStartIndex: TOP_HEADLINE_SLOT_START_INDEX,
    slotCount: TOP_HEADLINE_SLOT_COUNT,
    maxLength: HEADLINE_MAX_LENGTH,
  })
  if (titlePriorityPreFix.selected.length > 0) {
    console.log(
      `🔧 Title优先Top3补强(预处理): 替换${titlePriorityPreFix.replaced}条 (title=${titlePriorityPreFix.titleCount}, about=${titlePriorityPreFix.aboutCount})`
    )
  }

  // 🔧 v4.36: 移除强制Headline #2使用DKI格式的限制
  // 原因：效果不佳，让AI自由生成更多样化的标题
  // 保留Headline #1的品牌DKI格式不变

  console.log('✅ 广告创意生成成功')
  console.log(`   - Headlines: ${result.headlines.length}个`)
  console.log(`   - Descriptions: ${result.descriptions.length}个`)
  console.log(`   - Keywords: ${result.keywords.length}个`)

  // 🔄 使用统一关键词服务获取精确搜索量
  console.time('⏱️ 获取关键词搜索量')
  let keywordsWithVolume: KeywordWithVolume[] = []

  // 🔧 修复(2025-12-24): 提取到外层作用域，供后续clusterKeywordsByIntent使用
  const resolvedTargetLanguage = targetLanguage
  const language = resolvedCreativeLanguage.languageCode

  try {
    console.log(
      `🔍 获取关键词精确搜索量: ${result.keywords.length}个关键词, 国家=${targetCountry}, 语言=${language} (${resolvedTargetLanguage})`
    )

    // 🎯 使用统一服务：确保所有搜索量来自Historical Metrics API（精确匹配）
    const { getKeywordVolumesForExisting } = await import('@/lib/keywords')
    const unifiedData = await getKeywordVolumesForExisting({
      baseKeywords: result.keywords,
      country: targetCountry,
      language,
      userId,
      brandName,
    })

    // 🎯 修复：添加matchType字段（智能分配）+ lowTopPageBid/highTopPageBid竞价数据
    // 注意：这里仅做初始化，会在v4.16优化逻辑（行~2730）中根据品牌/非品牌/品牌相关分类重新分配
    keywordsWithVolume = unifiedData.map((v) => {
      // 🔥 修复(2025-12-18): 不在初始阶段做复杂的品牌分类，改为统一使用PHRASE
      // 这样可以在v4.16优化阶段（行2708-2758）准确地重新分配matchType
      // 纯品牌词 → EXACT
      // 品牌相关词 → PHRASE
      // 非品牌词 → PHRASE
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE' // 默认PHRASE，后续会根据品牌分类重新分配

      return {
        keyword: v.keyword,
        searchVolume: v.searchVolume,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid || 0, // 🆕 添加页首最低出价
        highTopPageBid: v.highTopPageBid || 0, // 🆕 添加页首最高出价
        volumeUnavailableReason: v.volumeUnavailableReason,
        matchType,
      }
    })
    console.log(`✅ 关键词精确搜索量获取完成（来源: Historical Metrics API）`)
  } catch (error) {
    console.warn('⚠️ 获取关键词搜索量失败，使用默认值:', error)
    // 🎯 修复：即使失败也要添加matchType和竞价数据
    keywordsWithVolume = result.keywords.map((kw) => {
      // 🔥 修复(2025-12-18): 同上，初始化时统一使用PHRASE，让v4.16优化逻辑处理分类
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE'

      return {
        keyword: kw,
        searchVolume: 0,
        lowTopPageBid: 0, // 🆕 默认为0
        highTopPageBid: 0, // 🆕 默认为0
        matchType,
      }
    })
  }
  console.timeEnd('⏱️ 获取关键词搜索量')

  // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
  const originalKeywordCount = keywordsWithVolume.length
  const validKeywords = keywordsWithVolume.filter((kw) =>
    containsBrand(kw.keyword, kw.searchVolume)
  )

  // 更新关键词列表
  const removedCount = originalKeywordCount - validKeywords.length

  if (removedCount > 0) {
    console.log(`🔧 已过滤 ${removedCount} 个不含纯品牌词的关键词`)
    console.log(`📊 剩余关键词: ${validKeywords.length}/${originalKeywordCount}`)
  }

  // 按搜索量从高到低排序
  validKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  result.keywords = validKeywords.map((kw) => kw.keyword)
  keywordsWithVolume = validKeywords

  // 🎯 通过Keyword Planner扩展高搜索量关键词（多角度3轮查询策略）
  // 策略: 使用不同角度的种子词进行3轮查询，最大化获取高搜索量关键词提示
  let plannerSessionForCreative: KeywordPlannerPreparedSession | undefined = options?.plannerSession
  try {
    if (brandName && userId && offer?.id) {
      console.log(`🔍 启动Keyword Planner多角度3轮查询策略`)
      console.time('⏱️ Keyword Planner扩展')

      let preparedExpandForPool: KeywordPoolExpandLoadResult | undefined = options?.preparedExpand
      if (!plannerSessionForCreative) {
        const expandLoad =
          preparedExpandForPool ??
          (await loadKeywordPoolExpandCredentialsForOffer(userId, offer.id))
        if (expandLoad.ok) {
          plannerSessionForCreative = expandLoad.plannerSession
          preparedExpandForPool = expandLoad
        }
      } else if (preparedExpandForPool?.ok) {
        // plannerSession 已传入，保留 preparedExpand 供建池复用
      } else if (options?.preparedExpand?.ok) {
        preparedExpandForPool = options.preparedExpand
      }

      if (plannerSessionForCreative) {
        const country = (offer as { target_country?: string }).target_country || 'US'
        const plannerLanguage = resolveCreativeTargetLanguage(
          (offer as { target_language?: string }).target_language || null,
          country
        )
        const targetLanguage = plannerLanguage.languageName
        const language = plannerLanguage.languageCode

        console.log(`🌍 Keyword Planner 查询语言: ${language} (${targetLanguage})`)

        // 🔧 2025-12-17: 如果已传入特定桶的关键词，跳过从关键词池获取所有关键词
        // 这确保差异化创意只使用对应桶的关键词，而不是所有桶的关键词混合
        if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
          console.log(
            `📦 已有桶 ${options.bucket} (${options.bucketIntent}) 的 ${options.bucketKeywords.length} 个关键词，跳过关键词池合并`
          )
        } else {
          // 🔥 统一架构(2025-12-16): 使用关键词池替代3轮Keyword Planner扩展
          console.log(`\n🔍 从关键词池获取关键词...`)
          const { getOrCreateKeywordPool } = await import('@/lib/offer-keyword-pool')

          const keywordPool =
            (options?.keywordPool as OfferKeywordPool | undefined) ||
            (await getOrCreateKeywordPool(
              offer.id,
              userId,
              false,
              undefined,
              preparedExpandForPool?.ok ? preparedExpandForPool : undefined
            ))

          if (keywordPool) {
            const poolKeywords = resolveCreativeBucketPoolKeywords(
              keywordPool,
              normalizedBucket,
              'D'
            )

            // 🔥 优化(2025-12-22): 使用Google Ads标准化去重
            const existingKeywordsSet = new Set(
              result.keywords.map((kw) => normalizeGoogleAdsKeyword(kw))
            )
            const newKeywords = poolKeywords.filter(
              (kw) => !existingKeywordsSet.has(normalizeGoogleAdsKeyword(kw.keyword))
            )

            console.log(
              `📊 关键词池去重: ${poolKeywords.length} → ${newKeywords.length} (过滤掉 ${poolKeywords.length - newKeywords.length} 个重复)`
            )

            keywordsWithVolume = [
              ...keywordsWithVolume,
              ...newKeywords.map((kw) => ({
                keyword: kw.keyword,
                searchVolume: kw.searchVolume,
                competition: kw.competition,
                competitionIndex: kw.competitionIndex,
                source:
                  kw.source === 'AI_GENERATED' ||
                  kw.source === 'KEYWORD_EXPANSION' ||
                  kw.source === 'MERGED'
                    ? (kw.source as 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED')
                    : undefined,
                sourceType: (kw as any).sourceType,
                matchType: kw.matchType,
              })),
            ]

            result.keywords = [...result.keywords, ...newKeywords.map((kw) => kw.keyword)]
            console.log(`   ✅ 从关键词池获取 ${newKeywords.length} 个新关键词`)
            console.log(`   📊 当前关键词总数: ${keywordsWithVolume.length} 个`)
          } else {
            console.warn('   ⚠️ 关键词池不存在，跳过关键词扩展')
          }
        } // 闭合 bucketKeywords 条件检查的 else 块
      } else {
        console.warn('⚠️ Google Ads 认证不可用，跳过 Keyword Planner 扩展')
      }

      console.timeEnd('⏱️ Keyword Planner扩展')
    } else {
      if (!brandName || !userId) {
        console.log('ℹ️ Offer缺少品牌名或userId，跳过Keyword Planner扩展')
      } else if (!offer?.id) {
        console.log('ℹ️ Offer缺少 id，跳过Keyword Planner扩展')
      }
    }
  } catch (plannerError: any) {
    // Keyword Planner扩展失败不影响主流程
    console.warn('⚠️ Keyword Planner扩展失败（非致命错误）:', plannerError.message)
  }

  let keywordSupplementationReport: KeywordSupplementationReport | undefined
  if (options?.deferKeywordPostProcessingToBuilder) {
    console.log('[KeywordPipeline] defer legacy keyword post-processing to builder')
    keywordsWithVolume = normalizeKeywordSourceAuditForGeneratorList(keywordsWithVolume)
    result.keywords = keywordsWithVolume.map((kw) => kw.keyword)
  } else {
    // 🔥 方案A优化(2025-12-16): 合并extracted_keywords到最终关键词列表
    // 原问题：31个高质量Google下拉词仅作为prompt参考，未直接使用
    // 解决方案：将已验证搜索量的extracted_keywords直接合并，确保100%利用
    // 🔥 优化(2025-12-16): 使用AI语义分类（keyword_intent_clustering prompt）
    const extractedMergeResult = await mergeExtractedKeywordsWithSingleExit({
      keywordsWithVolume,
      extractedKeywords: extractedElements.keywords || [],
      brandName,
      productCategory: (offer as { category?: string }).category || '未分类',
      userId,
      offerId: offer.id,
      plannerSession: plannerSessionForCreative,
      targetCountry,
      language,
      creativeType: resolveCreativeTypeFromBucketForMerge(normalizedBucket),
      fallbackMode: Boolean(isCoverageCreative),
    })
    keywordsWithVolume = extractedMergeResult.keywordsWithVolume

    const finalizedKeywords = await finalizeKeywordsWithSingleExit({
      keywordsWithVolume,
      offerBrand,
      brandName,
      canonicalBrandKeyword,
      pureBrandKeywordsList,
      brandTokensToMatch,
      mustContainBrand,
      targetCountry,
      targetLanguage: resolvedTargetLanguage,
      userId,
      offerId: offer.id,
      plannerSession: plannerSessionForCreative,
    })
    keywordsWithVolume = finalizedKeywords.keywordsWithVolume
    result.keywords = finalizedKeywords.keywords

    if (!options?.deferKeywordSupplementation) {
      const supplemented = await applyKeywordSupplementationOnce({
        offer,
        userId,
        brandName,
        targetLanguage: resolvedTargetLanguage,
        keywordsWithVolume,
        poolCandidates: Array.isArray(options?.bucketKeywords) ? options.bucketKeywords : undefined,
        bucket: options?.bucket || null, // 🔥 优化(2026-03-13): 传递 bucket 用于意图一致性检查
      })
      keywordsWithVolume = supplemented.keywordsWithVolume
      result.keywords = supplemented.keywords
      keywordSupplementationReport = supplemented.keywordSupplementation
      result.keywordSupplementation = keywordSupplementationReport
    }

    const policySafeFinalKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(keywordsWithVolume, {
      mode: policyGuardMode,
    })
    if (policySafeFinalKeywords.changedCount > 0 || policySafeFinalKeywords.droppedCount > 0) {
      console.log(
        `[PolicyGuard] 最终关键词兜底净化: 替换${policySafeFinalKeywords.changedCount}个, 丢弃${policySafeFinalKeywords.droppedCount}个`
      )
    }
    keywordsWithVolume = normalizeKeywordSourceAuditForGeneratorList(policySafeFinalKeywords.items)
    result.keywords = keywordsWithVolume.map((kw) => kw.keyword)
  }

  const effectiveKeywordUsagePlan = resolveEffectiveKeywordUsagePlan({
    brandName: offerBrand,
    precomputedKeywordSet,
    generatedKeywords: result.keywords,
    keywordsWithVolume,
  })
  result.keywordUsagePlan = effectiveKeywordUsagePlan

  // ✅ 基础约束修复：CTA（多语言软补强）与关键词嵌入率（English）
  const resolvedLanguage = normalizeLanguageCode(targetLanguage)
  const resolvedSoftLanguage = resolveSoftCopyLanguage(targetLanguage || resolvedLanguage)
  if (resolvedSoftLanguage) {
    const ctaFix = enforceLanguageCtas(result.descriptions, 2, 90, resolvedSoftLanguage)
    if (ctaFix.fixed > 0) {
      console.log(`🔧 CTA补强: 修复 ${ctaFix.fixed} 条描述`)
      result.descriptions = ctaFix.updated
      if (result.descriptionsWithMetadata) {
        result.descriptionsWithMetadata = result.descriptionsWithMetadata.map((d, idx) => ({
          ...d,
          text: result.descriptions[idx],
          length: result.descriptions[idx]?.length || d.length,
        }))
      }
    }
  }

  if (resolvedSoftLanguage === 'en') {
    const embedFix = enforceKeywordEmbedding(result.headlines, result.keywords, 8, 30, [0])
    if (embedFix.fixed > 0) {
      console.log(`🔧 关键词嵌入率补强: 修复 ${embedFix.fixed} 个标题`)
      result.headlines = embedFix.updated
      if (result.headlinesWithMetadata) {
        result.headlinesWithMetadata = result.headlinesWithMetadata.map((h, idx) => ({
          ...h,
          text: result.headlines[idx],
          length: result.headlines[idx]?.length || h.length,
        }))
      }
    }
  }

  // 🆕 非破坏式A/B/D文案补强：仅调整标题/描述表达，不修改关键词策略
  const softFix = softlyReinforceTypeCopy(
    result,
    normalizedBucket,
    targetLanguage || resolvedLanguage,
    brandName
  )
  if (softFix.headlineFixes > 0 || softFix.descriptionFixes > 0) {
    console.log(
      `🔧 类型化文案补强: headlines ${softFix.headlineFixes} 条, descriptions ${softFix.descriptionFixes} 条`
    )
  }

  const emotionFix = enforceEmotionBoundaryByBucket(
    result,
    normalizedBucket,
    targetLanguage || resolvedLanguage
  )
  if (emotionFix.fixes > 0) {
    console.log(`🔧 情绪边界补强: 中和强负面表达 ${emotionFix.fixes} 处`)
  }

  const complementarityFix = enforceHeadlineComplementarity(
    result,
    targetLanguage || resolvedLanguage,
    brandName,
    normalizedBucket
  )
  if (complementarityFix.fixes > 0) {
    console.log(
      `🔧 标题互补性补强: ${complementarityFix.fixes} 条 (brand=${complementarityFix.brandCount}, scenario=${complementarityFix.scenarioCount}, transactional=${complementarityFix.transactionalCount})`
    )
  }

  const titlePriorityPostFix = enforceTitlePriorityTopHeadlines(result, {
    brandName,
    brandTokensToMatch,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    targetLanguage,
    slotStartIndex: TOP_HEADLINE_SLOT_START_INDEX,
    slotCount: TOP_HEADLINE_SLOT_COUNT,
    maxLength: HEADLINE_MAX_LENGTH,
  })
  if (titlePriorityPostFix.replaced > 0) {
    console.log(
      `🔧 Title优先Top3补强(后处理): 替换${titlePriorityPostFix.replaced}条 (title=${titlePriorityPostFix.titleCount}, about=${titlePriorityPostFix.aboutCount})`
    )
  }

  if (effectiveKeywordUsagePlan.retainedNonBrandKeywords.length > 0) {
    const retainedSlotFix = enforceRetainedKeywordSlotCoverage(
      result,
      effectiveKeywordUsagePlan,
      resolvedSoftLanguage || resolvedLanguage,
      brandName
    )
    if (retainedSlotFix.headlineFixes > 0 || retainedSlotFix.descriptionFixes > 0) {
      console.log(
        `🔧 Retained关键词slot补强: headlines ${retainedSlotFix.headlineFixes} 条, descriptions ${retainedSlotFix.descriptionFixes} 条`
      )
    }
  }

  const purityFix = enforceLanguagePurityGate(
    result,
    normalizedBucket,
    targetLanguage || resolvedLanguage,
    brandName
  )
  if (purityFix.headlineFixes > 0 || purityFix.descriptionFixes > 0) {
    console.log(
      `🔧 语言纯度门控: headlines ${purityFix.headlineFixes} 条, descriptions ${purityFix.descriptionFixes} 条`
    )
  }

  const finalContractFix = enforceFinalCreativeContract(result, {
    bucket: normalizedBucket,
    languageCode: targetLanguage || resolvedLanguage,
    brandName,
    brandTokensToMatch,
    dkiHeadline: finalFirstHeadline,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    usagePlan: effectiveKeywordUsagePlan,
  })
  if (
    finalContractFix.headlineFixes > 0 ||
    finalContractFix.descriptionFixes > 0 ||
    finalContractFix.titleFixes > 0 ||
    finalContractFix.retainedFixes.headlineFixes > 0 ||
    finalContractFix.retainedFixes.descriptionFixes > 0 ||
    finalContractFix.languageFixes.headlineFixes > 0 ||
    finalContractFix.languageFixes.descriptionFixes > 0 ||
    finalContractFix.uniquenessFixes > 0
  ) {
    console.log(
      `🔧 最终硬约束收敛: ` +
        `headline=${finalContractFix.headlineFixes}, ` +
        `description=${finalContractFix.descriptionFixes}, ` +
        `title=${finalContractFix.titleFixes}, ` +
        `retained(h=${finalContractFix.retainedFixes.headlineFixes},d=${finalContractFix.retainedFixes.descriptionFixes}), ` +
        `purity(h=${finalContractFix.languageFixes.headlineFixes},d=${finalContractFix.languageFixes.descriptionFixes}), ` +
        `dedupe=${finalContractFix.uniquenessFixes}`
    )
  }

  // 🆕 添加只读意图元数据（向后兼容，不影响关键词和发布）
  annotateCopyIntentMetadata(result, resolvedLanguage, result.keywords || [])

  // 修正 sitelinks URL 为真实的 offer URL
  // 需求优化：所有sitelinks统一使用offer的主URL，避免虚构的子路径
  if (result.sitelinks && result.sitelinks.length > 0) {
    // 优先使用final_url（推广链接解析后的真实URL），否则使用url
    // 🔧 修复：验证final_url是否为有效URL，排除"null/"等无效值
    const rawFinalUrl = (offer as { final_url?: string; url?: string }).final_url
    const offerUrlRaw = (offer as { url?: string }).url
    // 只有当final_url是有效的URL时才使用，否则fallback到url字段
    const isFinalUrlValid =
      rawFinalUrl &&
      rawFinalUrl !== 'null' &&
      rawFinalUrl !== 'null/' &&
      rawFinalUrl !== 'undefined'
    const offerUrl = isFinalUrlValid ? rawFinalUrl : offerUrlRaw
    if (offerUrl) {
      result.sitelinks = result.sitelinks.map((link) => {
        // 所有sitelinks统一使用offer的主URL（不拼接子路径）
        // 这确保所有链接都是真实可访问的
        return {
          ...link,
          url: offerUrl, // 优先使用final_url，避免推广链接
        }
      })

      console.log(
        `🔗 修正 ${result.sitelinks.length} 个附加链接URL为真实offer URL (${offerUrl.substring(0, 50)}...)`
      )
    }
  }

  // 🎯 生成否定关键词（排除不相关流量）
  let negativeKeywords: string[] = []
  try {
    console.log('🔍 生成否定关键词...')
    console.time('⏱️ 否定关键词生成')
    negativeKeywords = await generateNegativeKeywords(offer as Offer, userId)
    console.timeEnd('⏱️ 否定关键词生成')
    console.log(
      `✅ 生成${negativeKeywords.length}个否定关键词:`,
      negativeKeywords.slice(0, 5).join(', '),
      '...'
    )
  } catch (negError: any) {
    // 否定关键词生成失败不影响主流程
    console.warn('⚠️ 否定关键词生成失败（非致命错误）:', negError.message)
  }

  const fullResult = {
    ...result,
    keywordsWithVolume,
    negativeKeywords, // 🎯 新增：添加否定关键词到结果
    keywordSupplementation: keywordSupplementationReport,
    ai_model: aiModel,
  }

  // 缓存结果（1小时TTL）
  creativeCache.set(cacheKey, fullResult)
  console.log(`💾 已缓存广告创意: ${cacheKey}`)

  return fullResult
}

/**
 * 计算两个文本的相似度 (0-1)
 * 使用加权多算法
 */
