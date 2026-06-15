import { getKeywordSearchVolumesForPlannerContext } from '@/lib/google-ads/accounts/auth/index'
import { clusterKeywordsByIntent } from '../offer-keyword-pool' // 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
import { calculateIntentScore, getIntentLevel } from '../keywords' // 🎯 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重
import { hasModelAnchorEvidence } from '../creatives'
import {
  getKeywordSourcePriorityScoreFromInput,
  inferKeywordDerivedTags,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
} from '../keywords'
import { isCreativeKeywordAiSourceSubtypeEnabled } from '../keywords'
import { containsPureBrand, getPureBrandKeywords } from '../keywords'
import { shouldUseExactMatch, isBrandConcatenation } from '../keywords' // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { classifyKeywordIntent } from '../keywords'
import {
  KEYWORD_POLICY,
  getRatioCappedCount,
  resolveNonBrandMinSearchVolumeByBrandKeywordCount,
} from '../keywords'

import {
  buildStoreProductCandidatesFromLinks,
  collectStoreProductEvidenceTexts,
  dedupeStoreProductNames,
  getStoreProductNameCandidate,
  normalizeCreativeBucketType,
} from './bucket'
import { countBrandContainingKeywords } from './prompt-keywords'
import { extractModelAnchorsForPrompt } from './prompts'
import type {
  IntentCategory,
  KeywordFinalizeInput,
  KeywordFinalizeOutput,
  KeywordWithVolume,
  MergeExtractedKeywordsInput,
  MergeExtractedKeywordsOutput,
  NormalizedCreativeBucket,
} from './types'
import { safeParseJson } from './utils'

export function evaluateStoreModelIntentReadiness(params: {
  bucket: NormalizedCreativeBucket
  linkType: 'store' | 'product'
  scrapedData?: unknown
  brandAnalysis?: unknown
  storeProductLinks?: unknown
}): {
  isReady: boolean
  verifiedHotProducts: string[]
  hotProductModelAnchors: string[]
  evidenceSources: string[]
  reason?: string
} {
  if (params.linkType !== 'store' || params.bucket !== 'B') {
    return {
      isReady: true,
      verifiedHotProducts: [],
      hotProductModelAnchors: [],
      evidenceSources: [],
    }
  }

  const scrapedData = safeParseJson(params.scrapedData, null)
  const brandAnalysis = safeParseJson(params.brandAnalysis, null)
  const evidenceSources: string[] = []
  const hotProductCandidates: string[] = []
  const hotProductEvidenceTexts: string[] = []

  const appendNames = (items: any[], source: string) => {
    if (!Array.isArray(items) || items.length === 0) return
    const names = items.map((item) => getStoreProductNameCandidate(item)).filter(Boolean)
    const evidenceTexts = items.flatMap((item) => collectStoreProductEvidenceTexts(item))
    if (names.length === 0 && evidenceTexts.length === 0) return
    hotProductCandidates.push(...names)
    hotProductEvidenceTexts.push(...evidenceTexts)
    evidenceSources.push(source)
  }

  appendNames(scrapedData?.deepScrapeResults?.topProducts, 'deepScrapeResults.topProducts')
  appendNames(brandAnalysis?.hotProducts, 'brandAnalysis.hotProducts')
  appendNames(scrapedData?.products, 'scrapedData.products')
  appendNames(scrapedData?.supplementalProducts, 'scrapedData.supplementalProducts')
  appendNames(
    buildStoreProductCandidatesFromLinks(params.storeProductLinks),
    'offer.store_product_links'
  )

  const verifiedHotProducts = dedupeStoreProductNames(hotProductCandidates, 3)
  if (verifiedHotProducts.length === 0) {
    return {
      isReady: false,
      verifiedHotProducts,
      hotProductModelAnchors: [],
      evidenceSources,
      reason:
        '店铺热门商品信息不足，无法生成商品型号/产品族意图创意：未获取到可验证的热门商品，请先重抓或补充店铺商品数据。',
    }
  }

  const hotProductModelAnchors = extractModelAnchorsForPrompt([
    ...verifiedHotProducts,
    ...hotProductEvidenceTexts,
  ])
  if (hotProductModelAnchors.length === 0) {
    return {
      isReady: false,
      verifiedHotProducts,
      hotProductModelAnchors,
      evidenceSources,
      reason:
        '店铺热门商品信息不足，无法生成商品型号/产品族意图创意：未提取到可验证的型号/产品族锚点，请先重抓或补充店铺商品数据。',
    }
  }

  return {
    isReady: true,
    verifiedHotProducts,
    hotProductModelAnchors,
    evidenceSources,
  }
}

export function shouldRunGapAnalysisForCreative(params: {
  bucket?: string | null
  isCoverageCreative?: boolean
  deferKeywordSupplementation?: boolean
}): boolean {
  if (params.isCoverageCreative) {
    return false
  }

  const normalizedBucket = normalizeCreativeBucketType(params.bucket || null)
  if (params.deferKeywordSupplementation) {
    // D 类型始终执行 Gap Analysis，避免 defer 覆盖。
    return normalizedBucket === 'D'
  }

  return normalizedBucket === null || normalizedBucket === 'D'
}

export function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  return reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

export function hasSearchVolumeUnavailableFlag(
  keywords: Array<{ volumeUnavailableReason?: unknown }>
): boolean {
  return keywords.some((kw) => isSearchVolumeUnavailableReason(kw?.volumeUnavailableReason))
}

export function isKeywordPlannerVolumePermissionError(error: unknown): boolean {
  const text = String((error as any)?.message || error || '').toUpperCase()
  if (!text) return false

  return (
    text.includes('DEV_TOKEN_INSUFFICIENT_ACCESS') ||
    text.includes('INSUFFICIENT') ||
    text.includes('EXPLORER') ||
    text.includes('PERMISSION_DENIED') ||
    text.includes('USER_PERMISSION_DENIED') ||
    text.includes('NOT AUTHORIZED')
  )
}

export function normalizeKeywordSourceTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = Array.from(
    new Set(
      value
        .map((item) =>
          String(item || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    )
  ).slice(0, 8)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeKeywordSourceAuditForGeneratorList(
  keywords: KeywordWithVolume[]
): KeywordWithVolume[] {
  const aiSourceSubtypeEnabled = isCreativeKeywordAiSourceSubtypeEnabled()
  return (keywords || []).map((item) => {
    const source = typeof item?.source === 'string' ? item.source.trim().toUpperCase() : undefined
    const explicitSourceType =
      typeof item?.sourceType === 'string' ? item.sourceType.trim().toUpperCase() : undefined
    const explicitSourceSubtype =
      typeof (item as any)?.sourceSubtype === 'string'
        ? (item as any).sourceSubtype.trim().toUpperCase()
        : undefined
    const sourceSubtype = aiSourceSubtypeEnabled
      ? explicitSourceSubtype ||
        explicitSourceType ||
        normalizeKeywordSourceSubtype({
          source,
          sourceType: explicitSourceType,
        })
      : normalizeKeywordSourceSubtype({ source })

    const rawSource =
      (typeof (item as any)?.rawSource === 'string'
        ? (item as any).rawSource.trim().toUpperCase()
        : undefined) ||
      inferKeywordRawSource({
        source,
        sourceType: sourceSubtype || item?.sourceType,
      })

    const derivedTags =
      normalizeKeywordSourceTags((item as any)?.derivedTags) ||
      inferKeywordDerivedTags({
        source,
        sourceType: sourceSubtype || item?.sourceType,
      })

    return {
      ...item,
      source: source || item.source,
      sourceType: explicitSourceType || sourceSubtype || source,
      sourceSubtype,
      rawSource,
      derivedTags,
    }
  })
}

export function normalizeSourceTypeFromLegacySource(input: {
  source?: string
  sourceType?: string
}): string | undefined {
  const sourceType = String(input.sourceType || '')
    .trim()
    .toUpperCase()
  if (sourceType) return sourceType

  const source = String(input.source || '')
    .trim()
    .toUpperCase()
  if (!source) return undefined

  if (source === 'AI_ENHANCED') return 'AI_ENHANCED_PERSISTED'
  if (source === 'AI_GENERATED') return 'AI_LLM_RAW'
  if (source === 'SCORING_SUGGESTION') return 'GAP_INDUSTRY_BRANDED'
  if (source === 'KEYWORD_POOL') return 'CANONICAL_BUCKET_VIEW'
  if (source === 'SEARCH_TERM') return 'SEARCH_TERM_HIGH_PERFORMING'
  return source
}

export function resolveCreativeTypeFromBucketForMerge(
  bucket: 'A' | 'B' | 'C' | 'D' | 'S' | null | undefined
): 'brand_intent' | 'model_intent' | 'product_intent' | null {
  if (bucket === 'A') return 'brand_intent'
  if (bucket === 'B' || bucket === 'C') return 'model_intent'
  if (bucket === 'D' || bucket === 'S') return 'product_intent'
  return null
}

export function shouldAllowZeroVolumeKeywordForMerge(input: {
  keyword: string
  source?: string
  sourceType?: string
  brandName: string
  language: string
  creativeType?: 'brand_intent' | 'model_intent' | 'product_intent' | null
  fallbackMode?: boolean
  volumeDataUnavailable?: boolean
}): boolean {
  const normalizedSource = String(
    normalizeSourceTypeFromLegacySource({
      source: input.source,
      sourceType: input.sourceType,
    }) || ''
  )
    .trim()
    .toUpperCase()
  if (!normalizedSource) return false

  // DERIVED_VIEW 来源永不放行 zero-volume（避免 KEYWORD_POOL 派生词直通）。
  if (normalizedSource === 'KEYWORD_POOL' || normalizedSource === 'CANONICAL_BUCKET_VIEW') {
    return false
  }

  const creativeType = input.creativeType || null
  const fallbackMode = Boolean(input.fallbackMode)
  const volumeDataUnavailable = Boolean(input.volumeDataUnavailable)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [input.keyword] })

  const pureBrandKeywords = getPureBrandKeywords(input.brandName || '')
  const isBrandKeywordCandidate =
    containsPureBrand(input.keyword, pureBrandKeywords) ||
    isBrandConcatenation(input.keyword, input.brandName)

  const intent = classifyKeywordIntent(input.keyword, { language: input.language })
  const isCommercialIntent = intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL'
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: input.source,
    sourceType: normalizedSource,
  })
  const isTrustedSourceInNoVolumeMode = sourceScore >= 62

  if (normalizedSource === 'GLOBAL_CATEGORY_BRANDED') {
    if (creativeType === 'model_intent' && !hasModelAnchor && !fallbackMode) return false
    return true
  }

  if (normalizedSource === 'SCORING_SUGGESTION' || normalizedSource === 'GAP_INDUSTRY_BRANDED') {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (!fallbackMode && !isBrandKeywordCandidate && !isCommercialIntent) return false
    return true
  }

  if (normalizedSource === 'AI_TITLE_ABOUT_SUPPLEMENT') {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (!isBrandKeywordCandidate && !isCommercialIntent && !fallbackMode) return false
    return true
  }

  if (normalizedSource === 'AI_ENHANCED' || normalizedSource === 'AI_ENHANCED_PERSISTED') {
    if (creativeType === 'model_intent' && !hasModelAnchor && !fallbackMode) return false
    return isBrandKeywordCandidate || isCommercialIntent || fallbackMode
  }

  // Explorer/Test 权限下 volume 不可用时，改用来源可信度+类型匹配门禁。
  if (volumeDataUnavailable) {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (isBrandKeywordCandidate || isCommercialIntent) return true
    return isTrustedSourceInNoVolumeMode && fallbackMode
  }

  // 低置信 AI 词仅在 fallback 或 product_intent 下放行，并保持品牌/商业意图门禁。
  if (
    normalizedSource === 'AI_GENERATED' ||
    normalizedSource === 'AI_LLM_RAW' ||
    normalizedSource === 'AI_FALLBACK_PLACEHOLDER'
  ) {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (creativeType !== 'product_intent' && !fallbackMode) return false
    return isBrandKeywordCandidate || isCommercialIntent
  }

  return false
}

export async function mergeExtractedKeywordsWithSingleExit(
  input: MergeExtractedKeywordsInput
): Promise<MergeExtractedKeywordsOutput> {
  const {
    keywordsWithVolume: baseKeywordsWithVolume,
    extractedKeywords,
    brandName,
    productCategory,
    userId,
    offerId,
    targetCountry,
    language,
    creativeType,
    fallbackMode,
  } = input

  const mergedKeywordsWithVolume = [...baseKeywordsWithVolume]
  let mergedCount = 0

  if (extractedKeywords.length > 0) {
    console.log(`\n🔗 合并extracted_keywords到关键词列表...`)

    const existingKeywordsLower = new Set(
      mergedKeywordsWithVolume.filter((k) => k.keyword).map((k) => k.keyword.toLowerCase())
    )
    const brandNameLowerForMerge = brandName?.toLowerCase() || ''
    const pureBrandKeywordsForMerge = getPureBrandKeywords(brandName || '')
    const brandKeywordCountForThreshold = countBrandContainingKeywords(
      mergedKeywordsWithVolume,
      brandName,
      pureBrandKeywordsForMerge
    )
    const dynamicNonBrandMinSearchVolume = resolveNonBrandMinSearchVolumeByBrandKeywordCount(
      brandKeywordCountForThreshold
    )
    console.log(
      `   🎚️ 动态非品牌搜索量阈值: >= ${dynamicNonBrandMinSearchVolume} (品牌相关词 ${brandKeywordCountForThreshold} 个)`
    )
    let volumeUnavailable = hasSearchVolumeUnavailableFlag(mergedKeywordsWithVolume)

    // 🐛 修复(2026-03-14): 排除 GLOBAL_CATEGORY_BRANDED 来源的关键词
    // 这些关键词是品牌前置生成的组合词，不需要查询 Keyword Planner
    const keywordsNeedVolume = extractedKeywords.filter(
      (kw) =>
        kw.keyword &&
        kw.searchVolume === 0 &&
        kw.source !== 'GLOBAL_CATEGORY_BRANDED' &&
        !existingKeywordsLower.has(kw.keyword.toLowerCase())
    )

    if (keywordsNeedVolume.length > 0) {
      console.log(`   📊 查询 ${keywordsNeedVolume.length} 个关键词的搜索量...`)
      try {
        const keywordsForVolumeLookup = keywordsNeedVolume
          .map((k) => k.keyword)
          .filter((keyword): keyword is string => Boolean(keyword))
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: keywordsForVolumeLookup,
          country: targetCountry,
          language,
          plannerSession: input.plannerSession,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        keywordsNeedVolume.forEach((kw) => {
          if (!kw.keyword) return
          const volumeData = volumes.find(
            (v: any) => v.keyword.toLowerCase() === kw.keyword?.toLowerCase()
          )
          if (volumeData) {
            kw.searchVolume = volumeData.avgMonthlySearches
            kw.volumeUnavailableReason = volumeData.volumeUnavailableReason
            if (isSearchVolumeUnavailableReason(volumeData.volumeUnavailableReason)) {
              volumeUnavailable = true
            }
          }
        })
        console.log(`   ✅ 搜索量查询完成`)
      } catch (volumeError) {
        console.warn(`   ⚠️ 搜索量查询失败，使用默认值0:`, volumeError)
        if (isKeywordPlannerVolumePermissionError(volumeError)) {
          volumeUnavailable = true
          console.warn(
            '   ⚠️ Keyword Planner 搜索量权限不足（Explorer/Test），切换 no-volume 语义门禁模式'
          )
        }
      }
    }

    if (volumeUnavailable) {
      console.log('   ℹ️ 搜索量不可用：使用 sourceType + creativeType + fallback 的匹配门禁')
    }

    const keywordsToMerge = extractedKeywords.filter((kw) => {
      if (!kw.keyword) return false
      const kwLower = kw.keyword.toLowerCase()
      if (existingKeywordsLower.has(kwLower)) return false

      if (kw.searchVolume === 0) {
        const allowZeroVolume = shouldAllowZeroVolumeKeywordForMerge({
          keyword: kw.keyword,
          source: kw.source,
          sourceType: kw.sourceType,
          brandName,
          language,
          creativeType,
          fallbackMode: fallbackMode || volumeUnavailable,
          volumeDataUnavailable: volumeUnavailable,
        })
        if (!allowZeroVolume) return false
        return true
      }

      const isBrandKeywordCandidate =
        containsPureBrand(kw.keyword, pureBrandKeywordsForMerge) ||
        isBrandConcatenation(kw.keyword, brandName)
      if (
        !volumeUnavailable &&
        !isBrandKeywordCandidate &&
        kw.searchVolume < dynamicNonBrandMinSearchVolume
      )
        return false
      return true
    })
    const skippedCount = extractedKeywords.length - keywordsToMerge.length

    if (keywordsToMerge.length === 0) {
      console.log(`   ℹ️ 无新关键词需要合并（全部重复或搜索量不足）`)
    } else {
      let intentMap = new Map<string, IntentCategory>()
      try {
        console.log(`   🤖 调用AI语义分类: ${keywordsToMerge.length} 个关键词`)
        const buckets = await clusterKeywordsByIntent(
          keywordsToMerge.map((k) => k.keyword).filter(Boolean) as string[],
          brandName || '',
          productCategory,
          userId,
          targetCountry,
          language,
          'product'
        )

        buckets.bucketA.keywords
          .filter(Boolean)
          .forEach((k) => intentMap.set(k.toLowerCase(), 'brand'))
        buckets.bucketB.keywords
          .filter(Boolean)
          .forEach((k) => intentMap.set(k.toLowerCase(), 'scenario'))
        buckets.bucketC.keywords
          .filter(Boolean)
          .forEach((k) => intentMap.set(k.toLowerCase(), 'function'))

        console.log(`   ✅ AI分类完成:`)
        console.log(`      品牌商品锚点: ${buckets.bucketA.keywords.length} 个`)
        console.log(`      商品需求场景: ${buckets.bucketB.keywords.length} 个`)
        console.log(`      功能规格/需求扩展: ${buckets.bucketC.keywords.length} 个`)
      } catch (clusterError: any) {
        console.warn(`   ⚠️ AI语义分类失败，使用默认分类: ${clusterError.message}`)
        keywordsToMerge.forEach((kw) => {
          if (kw.keyword) intentMap.set(kw.keyword.toLowerCase(), 'function')
        })
      }

      keywordsToMerge.forEach((kw) => {
        if (!kw.keyword) return
        const kwLower = kw.keyword.toLowerCase()
        const isBrandKeyword =
          kwLower === brandNameLowerForMerge || kwLower.startsWith(brandNameLowerForMerge + ' ')
        const wordCount = kw.keyword.split(' ').length
        let matchType: 'BROAD' | 'PHRASE' | 'EXACT'

        if (isBrandKeyword) {
          matchType = 'EXACT'
        } else if (wordCount >= 3) {
          matchType = 'PHRASE'
        } else {
          matchType = 'PHRASE'
        }

        mergedKeywordsWithVolume.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competition: kw.competition || 'MEDIUM',
          competitionIndex: kw.competitionIndex || 0.5,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          matchType,
          intentCategory: intentMap.get(kwLower) || 'function',
          source: 'MERGED',
          sourceType: normalizeSourceTypeFromLegacySource(kw),
        })
        existingKeywordsLower.add(kwLower)
        mergedCount++
      })

      console.log(
        `   ✅ 合并完成: 新增 ${mergedCount} 个关键词 (跳过 ${skippedCount} 个重复/低质量)`
      )
      console.log(`   📊 当前关键词总数: ${mergedKeywordsWithVolume.length} 个`)

      const brandCount = keywordsToMerge.filter(
        (k) => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'brand'
      ).length
      const scenarioCount = keywordsToMerge.filter(
        (k) => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'scenario'
      ).length
      const functionCount = keywordsToMerge.filter(
        (k) => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'function'
      ).length
      console.log(
        `   📊 意图分类: 品牌=${brandCount}, 场景=${scenarioCount}, 功能=${functionCount}`
      )
    }
  }

  return {
    keywordsWithVolume: mergedKeywordsWithVolume,
  }
}

export async function finalizeKeywordsWithSingleExit(
  input: KeywordFinalizeInput
): Promise<KeywordFinalizeOutput> {
  let keywordsWithVolume = [...input.keywordsWithVolume]
  const {
    offerBrand,
    brandName,
    canonicalBrandKeyword,
    pureBrandKeywordsList,
    brandTokensToMatch,
    mustContainBrand,
    targetCountry,
    targetLanguage,
    userId,
  } = input

  const brandKeywordLower = canonicalBrandKeyword || offerBrand.toLowerCase().trim()
  const containsBrand = (keyword: string, _searchVolume?: number): boolean => {
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    // 🔥 修复(2026-03-13): 品牌拼接词即使搜索量为 0 也应该保留（真实品牌词）
    // 移除搜索量依赖，避免真实品牌词被意外过滤
    if (isBrandConcatenation(keyword, offerBrand)) return true
    return false
  }

  // 🎯 最终关键词过滤：强制约束
  console.log('\n🔍 执行最终关键词过滤 (强制约束)...')
  const beforeFilterCount = keywordsWithVolume.length

  // 第1步：分离品牌词、品牌相关词和非品牌词
  const pureBrandKeywords: typeof keywordsWithVolume = []
  const brandRelatedKeywords: typeof keywordsWithVolume = []
  const nonBrandKeywords: typeof keywordsWithVolume = []

  keywordsWithVolume.forEach((kw) => {
    const isPureBrand = shouldUseExactMatch(kw.keyword, pureBrandKeywordsList)
    const isBrandRelated = !isPureBrand && containsBrand(kw.keyword, kw.searchVolume)

    if (isPureBrand) {
      pureBrandKeywords.push(kw)
    } else if (isBrandRelated) {
      brandRelatedKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  })

  console.log(
    `   📊 关键词分类结果 (使用纯品牌词列表: [${pureBrandKeywordsList.slice(0, 3).join(', ')}${pureBrandKeywordsList.length > 3 ? '...' : ''}])`
  )
  console.log(`      🏷️ 纯品牌词: ${pureBrandKeywords.length} 个`)
  console.log(`      🔗 品牌相关词: ${brandRelatedKeywords.length} 个`)
  console.log(`      📝 非品牌词: ${nonBrandKeywords.length} 个`)

  // 自动分配matchType（品牌词策略）
  console.log(`\n📌 自动分配matchType（品牌词策略）`)
  pureBrandKeywords.forEach((kw) => {
    kw.matchType = 'EXACT'
  })
  console.log(`   ✅ 纯品牌词(${pureBrandKeywords.length}个) → EXACT 精准匹配`)

  brandRelatedKeywords.forEach((kw) => {
    kw.matchType = 'PHRASE'
  })
  console.log(`   ✅ 品牌相关词(${brandRelatedKeywords.length}个) → PHRASE 词组匹配`)

  nonBrandKeywords.forEach((kw) => {
    kw.matchType = 'PHRASE'
  })
  console.log(`   ✅ 非品牌词(${nonBrandKeywords.length}个) → PHRASE 词组匹配（暂不使用BROAD）`)

  // 高价值通用词提取
  console.log(`\n📌 高价值通用词提取`)
  const { extractGenericHighValueKeywords } = await import('@/lib/keywords')
  const extractedGenericKeywords = extractGenericHighValueKeywords(
    keywordsWithVolume,
    offerBrand,
    []
  )
  extractedGenericKeywords.forEach((kw) => {
    if (!kw.matchType) kw.matchType = 'PHRASE'
  })
  console.log(`   🎯 提取到 ${extractedGenericKeywords.length} 个高价值通用词 (matchType=PHRASE)`)

  const volumeDataUnavailable = keywordsWithVolume.some(
    (kw) => kw.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  )
  if (volumeDataUnavailable) {
    console.log(`   ⚠️ 搜索量数据不可用（developer token 为 Test/Explorer 权限），跳过搜索量过滤`)
  }

  const dynamicNonBrandMinSearchVolume = resolveNonBrandMinSearchVolumeByBrandKeywordCount(
    pureBrandKeywords.length + brandRelatedKeywords.length
  )
  console.log(
    `   🎚️ 动态非品牌搜索量阈值: >= ${dynamicNonBrandMinSearchVolume} (品牌相关词 ${pureBrandKeywords.length + brandRelatedKeywords.length} 个)`
  )

  // 过滤非品牌词（按动态阈值保留）
  const hasAnyVolume = nonBrandKeywords.some((kw) => kw.searchVolume > 0)
  const canUseVolumeFilter = hasAnyVolume && !volumeDataUnavailable
  const filteredNonBrandKeywords = canUseVolumeFilter
    ? nonBrandKeywords.filter((kw) => kw.searchVolume >= dynamicNonBrandMinSearchVolume)
    : nonBrandKeywords

  const enhancedNonBrandKeywords = [...filteredNonBrandKeywords, ...extractedGenericKeywords]

  // 强制约束1：纯品牌词必须添加
  console.log(`\n📌 强制约束1: 纯品牌词 "${offerBrand}" 必须添加`)
  const existingPureBrand = pureBrandKeywords.find((kw) => kw.searchVolume > 0)

  if (existingPureBrand) {
    console.log(
      `   ✅ 纯品牌词已存在: "${existingPureBrand.keyword}" (${existingPureBrand.searchVolume}/月)`
    )
  } else {
    console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 需要查询搜索量...`)
    let brandSearchVolume = 0

    try {
      const { getDatabase } = await import('../db')
      const db = await getDatabase()
      const langCode = (targetLanguage || 'English').toLowerCase().substring(0, 2)

      const row = (await db.queryOne(
        `
        SELECT keyword, search_volume
        FROM global_keywords
        WHERE LOWER(keyword) = LOWER(?) AND country = ?
        ORDER BY search_volume DESC
        LIMIT 1
      `,
        [offerBrand, targetCountry]
      )) as { keyword: string; search_volume: number } | undefined

      if (row && row.search_volume > 0) {
        brandSearchVolume = row.search_volume
        console.log(`   ✅ 全局缓存查询到搜索量: ${brandSearchVolume}/月`)
      } else {
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId: input.offerId,
          keywords: [offerBrand],
          country: targetCountry,
          language: langCode,
          plannerSession: input.plannerSession,
        })
        if (volumeResult.ok) {
          const volumes = volumeResult.volumes
          if (volumes.length > 0 && volumes[0].avgMonthlySearches > 0) {
            brandSearchVolume = volumes[0].avgMonthlySearches
            console.log(`   ✅ Keyword Planner API查询到搜索量: ${brandSearchVolume}/月`)
          } else {
            console.log(`   ⚠️ Keyword Planner API未返回搜索量数据`)
          }
        } else {
          console.log(`   ⚠️ Google Ads 认证未配置，跳过品牌词搜索量 API 查询`)
        }
      }
    } catch (err: any) {
      console.warn(`   ⚠️ 查询纯品牌词搜索量失败: ${err.message}`)
    }

    pureBrandKeywords.push({
      keyword: offerBrand,
      searchVolume: brandSearchVolume,
      matchType: 'EXACT',
    })

    if (brandSearchVolume > 0) {
      console.log(`   ✅ 纯品牌词 "${offerBrand}" 已添加 (搜索量: ${brandSearchVolume}/月)`)
    } else {
      console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 已添加 (搜索量: 未知，建议手动验证)`)
    }
  }

  // 强制约束2：非品牌词阈值
  console.log(
    `\n📌 强制约束2: 非品牌词搜索量 >= ${dynamicNonBrandMinSearchVolume} 或来自高价值词提取`
  )
  console.log(`   - 搜索量达标的非品牌词: ${filteredNonBrandKeywords.length} 个`)
  console.log(`   - 提取的高价值词 (>10000): ${extractedGenericKeywords.length} 个`)
  console.log(`   - 合计非品牌词: ${enhancedNonBrandKeywords.length} 个`)

  const hasAnyVolumeBrand = brandRelatedKeywords.some((kw) => kw.searchVolume > 0)
  const shouldFilterBrandByVolume = hasAnyVolumeBrand && !volumeDataUnavailable
  const allBrandKeywords = [
    ...pureBrandKeywords,
    ...brandRelatedKeywords.filter((kw) =>
      shouldFilterBrandByVolume ? kw.searchVolume > 0 : true
    ),
  ]
  let finalKeywords = [...allBrandKeywords, ...enhancedNonBrandKeywords]
  console.log(
    `   📊 初始合并: ${allBrandKeywords.length} 品牌词 + ${enhancedNonBrandKeywords.length} 非品牌词 = ${finalKeywords.length} 个`
  )

  // 强制约束3：移除无搜索量关键词（纯品牌词豁免）
  console.log(`\n📌 强制约束3: 移除所有搜索量为0或null的关键词（品牌词除外）`)
  const beforeFinalFilter = finalKeywords.length
  const hasAnyVolumeData = finalKeywords.some((kw) => kw.searchVolume > 0)
  const pureBrandKeywordNormalized = new Set(
    pureBrandKeywords.map((kw) => normalizeGoogleAdsKeyword(kw.keyword)).filter(Boolean)
  )

  if (hasAnyVolumeData && !volumeDataUnavailable) {
    finalKeywords = finalKeywords.filter((kw) => {
      const kwNorm = normalizeGoogleAdsKeyword(kw.keyword)
      return kw.searchVolume > 0 || (kwNorm && pureBrandKeywordNormalized.has(kwNorm))
    })

    const removedZeroVolume = beforeFinalFilter - finalKeywords.length
    if (removedZeroVolume > 0) {
      console.log(`   ⚠️ 已移除 ${removedZeroVolume} 个搜索量为0的关键词（保留品牌词）`)
    }
  } else {
    if (volumeDataUnavailable) {
      console.log(
        `   ⚠️ 搜索量数据不可用（developer token 无 Basic/Standard access 或 服务账号限制），跳过搜索量过滤`
      )
    } else {
      console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
    }
  }
  console.log(`   ✅ 最终保留 ${finalKeywords.length} 个关键词（含搜索量数据或品牌词）`)

  const retainedBrandWithZeroVolume = finalKeywords.filter(
    (kw) =>
      kw.searchVolume === 0 && pureBrandKeywordNormalized.has(normalizeGoogleAdsKeyword(kw.keyword))
  )
  if (retainedBrandWithZeroVolume.length > 0) {
    console.log(`   ℹ️ 保留 ${retainedBrandWithZeroVolume.length} 个搜索量为0的品牌词:`)
    retainedBrandWithZeroVolume.forEach((kw) => {
      console.log(`      - "${kw.keyword}" (品牌词，搜索量未知)`)
    })
  }

  // 强制约束4：购买意图评分过滤
  console.log(`\n📌 强制约束4: 购买意图评分过滤（移除纯信息查询词）`)
  const MIN_INTENT_SCORE = KEYWORD_POLICY.creative.minIntentScore
  const EXPLORE_MIN_INTENT_SCORE = KEYWORD_POLICY.creative.explore.minIntentScore
  const EXPLORE_MAX_INTENT_SCORE = Math.min(
    MIN_INTENT_SCORE,
    KEYWORD_POLICY.creative.explore.maxIntentScoreExclusive
  )
  const beforeIntentFilter = finalKeywords.length

  const keywordsWithIntent = finalKeywords.map((kw) => ({
    ...kw,
    intentScore: calculateIntentScore(kw.keyword, brandName),
    intentLevel: getIntentLevel(calculateIntentScore(kw.keyword, brandName)),
  }))
  const isPureBrandInFinal = (kw: { keyword: string }) => {
    const normalized = normalizeGoogleAdsKeyword(kw.keyword)
    return normalized ? pureBrandKeywordNormalized.has(normalized) : false
  }

  const highIntentKws = keywordsWithIntent.filter((kw) => kw.intentScore >= 80)
  const mediumIntentKws = keywordsWithIntent.filter(
    (kw) => kw.intentScore >= 50 && kw.intentScore < 80
  )
  const lowIntentKws = keywordsWithIntent.filter(
    (kw) => kw.intentScore >= MIN_INTENT_SCORE && kw.intentScore < 50
  )
  const infoIntentKws = keywordsWithIntent.filter(
    (kw) => kw.intentScore < MIN_INTENT_SCORE && !isPureBrandInFinal(kw)
  )
  const exploreIntentCandidates = keywordsWithIntent
    .filter(
      (kw) =>
        kw.intentScore >= EXPLORE_MIN_INTENT_SCORE &&
        kw.intentScore < EXPLORE_MAX_INTENT_SCORE &&
        !isPureBrandInFinal(kw)
    )
    .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))

  console.log(`   📊 意图分布统计:`)
  console.log(`      🟢 高购买意图 (≥80): ${highIntentKws.length} 个`)
  console.log(`      🟡 中等意图 (50-79): ${mediumIntentKws.length} 个`)
  console.log(`      🟠 低购买意图 (20-49): ${lowIntentKws.length} 个`)
  console.log(`      ⚪ 信息查询 (<20): ${infoIntentKws.length} 个`)

  if (infoIntentKws.length > 0) {
    console.log(`\n   ⚠️ 将移除 ${infoIntentKws.length} 个信息查询类关键词:`)
    infoIntentKws.slice(0, 5).forEach((kw) => {
      console.log(`      - "${kw.keyword}" (意图分数: ${kw.intentScore}, ${kw.intentLevel.label})`)
    })
    if (infoIntentKws.length > 5) {
      console.log(`      ... 及其他 ${infoIntentKws.length - 5} 个`)
    }
  }

  const primaryKeywords = keywordsWithIntent
    .filter((kw) => isPureBrandInFinal(kw) || kw.intentScore >= MIN_INTENT_SCORE)
    .map(({ _intentScore, _intentLevel, ...rest }) => rest)

  const exploreQuota = getRatioCappedCount(
    primaryKeywords.length,
    KEYWORD_POLICY.creative.explore.maxRatio,
    KEYWORD_POLICY.creative.explore.maxCount
  )
  const primaryNormSet = new Set(
    primaryKeywords.map((kw) => normalizeGoogleAdsKeyword(kw.keyword)).filter(Boolean)
  )
  const exploreKeywords = exploreIntentCandidates
    .filter((kw) => {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      return norm ? !primaryNormSet.has(norm) : false
    })
    .slice(0, exploreQuota)
    .map(({ _intentScore, _intentLevel, ...rest }) => rest)

  finalKeywords = [...primaryKeywords, ...exploreKeywords]

  const removedByIntent = beforeIntentFilter - primaryKeywords.length
  console.log(
    `   ✅ 意图过滤完成: 主池保留 ${primaryKeywords.length} 个，移除 ${removedByIntent} 个低意图词`
  )
  if (exploreKeywords.length > 0) {
    console.log(
      `   ➕ 覆盖度补齐: 追加 ${exploreKeywords.length}/${exploreQuota} 个探索词 (intent ${EXPLORE_MIN_INTENT_SCORE}-${EXPLORE_MAX_INTENT_SCORE - 1})`
    )
  }

  if (mustContainBrand) {
    const preview = brandTokensToMatch.slice(0, 3).join(', ')
    console.log(
      `\n🔒 强制约束: 只保留包含纯品牌词的关键词 (tokens: [${preview}${brandTokensToMatch.length > 3 ? '...' : ''}])`
    )
    const before = finalKeywords.length
    finalKeywords = finalKeywords.filter((kw) => containsBrand(kw.keyword, kw.searchVolume))
    console.log(`   ✅ 品牌强制过滤完成: ${before} → ${finalKeywords.length}`)
  }

  console.log(`\n✅ 关键词收集完成，共 ${finalKeywords.length} 个关键词`)
  console.log(`\n📊 关键词排序规则: 100%品牌包含 + 搜索量优先`)
  finalKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  if (finalKeywords.length > 0) {
    console.log(`\n   🏷️ 品牌相关关键词 TOP 5:`)
    finalKeywords.slice(0, 5).forEach((kw, i) => {
      console.log(`      ${i + 1}. "${kw.keyword}" (${(kw.searchVolume || 0).toLocaleString()}/月)`)
    })
  }

  const afterFilterCount = finalKeywords.length
  const finalBrandCount = finalKeywords.filter((kw) =>
    containsBrand(kw.keyword, kw.searchVolume)
  ).length
  const brandRatio =
    afterFilterCount > 0 ? Math.round((finalBrandCount / afterFilterCount) * 100) : 0
  console.log(`\n✅ 过滤完成:`)
  console.log(`   原始关键词: ${beforeFilterCount} 个`)
  console.log(`   最终保留: ${afterFilterCount} 个`)
  console.log(`   - 品牌相关词: ${finalBrandCount} 个 (${brandRatio}%)`)
  console.log(`   - 通用词: ${afterFilterCount - finalBrandCount} 个 (${100 - brandRatio}%)`)

  // 单一出口前去重
  const beforeFinalDedupe = finalKeywords.length
  const seenForFinal = new Set<string>()
  finalKeywords = finalKeywords.filter((kw) => {
    const normalized = kw.keyword.toLowerCase().trim()
    if (seenForFinal.has(normalized)) return false
    seenForFinal.add(normalized)
    return true
  })
  if (beforeFinalDedupe !== finalKeywords.length) {
    console.warn(
      `⚠️ 最终关键词去重: ${beforeFinalDedupe} → ${finalKeywords.length} (移除 ${beforeFinalDedupe - finalKeywords.length} 个重复)`
    )
  }

  const keywordTexts = finalKeywords.map((kw) => kw.keyword)
  const finalKeywordCount = keywordTexts.length
  const allHaveVolume = finalKeywords.every((kw) => kw.searchVolume > 0)
  const hasBrandKeyword = canonicalBrandKeyword
    ? finalKeywords.some(
        (kw) =>
          normalizeGoogleAdsKeyword(kw.keyword) === canonicalBrandKeyword && kw.searchVolume > 0
      )
    : finalKeywords.some(
        (kw) => kw.keyword.toLowerCase() === brandKeywordLower && kw.searchVolume > 0
      )

  console.log(`\n🎯 最终验证:`)
  console.log(`   ✅ 关键词总数: ${finalKeywordCount} 个`)
  console.log(`   ${allHaveVolume ? '✅' : '❌'} 所有关键词都有搜索量数据 (searchVolume > 0)`)
  console.log(
    `   ${hasBrandKeyword ? '✅' : 'ℹ️'} 品牌词 "${offerBrand}" ${hasBrandKeyword ? '有搜索量' : '无搜索量数据，已排除'}`
  )

  if (!allHaveVolume) {
    const zeroVolumeKeywords = finalKeywords.filter((kw) => kw.searchVolume <= 0)
    console.warn(`⚠️ 警告: 仍有 ${zeroVolumeKeywords.length} 个关键词搜索量为0`)
    zeroVolumeKeywords.forEach((kw) => console.warn(`   - "${kw.keyword}"`))
  }
  if (finalKeywordCount < 5) {
    console.warn(`⚠️ 警告: 关键词数量 ${finalKeywordCount} < 5，可能影响广告效果`)
  }

  return {
    keywordsWithVolume: finalKeywords,
    keywords: keywordTexts,
  }
}
