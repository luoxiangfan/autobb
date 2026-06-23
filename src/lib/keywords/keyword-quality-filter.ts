import type { PoolKeywordData } from './offer-pool'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getPureBrandKeywords, isPureBrandKeyword } from './brand/brand-keyword-utils'
import {
  normalizePlannerNonBrandPolicy,
  shouldAllowPlannerNonBrandKeyword,
} from './planner/planner-non-brand-policy'
import { isBrandConcatenation, shouldKeepByBrand } from './keyword-quality-filter-brand'
import {
  detectPlatformsInKeyword,
  extractPlatformFromUrl,
  isPlatformMismatch,
} from './keyword-quality-filter-platform'
import {
  getLowIntentSupportReason,
  getMatchedFilterPattern,
  isSemanticQuery,
} from './keyword-quality-filter-semantic'
import { resolveGeoMismatch } from './keyword-quality-filter-geo'
import {
  computeKeywordRelevanceScore,
  getBrandShortNumericFragmentReason,
  getHighPerformingHardBlockReason,
  getKeywordAnchorDistortionReason,
  getTemplateGarbageReason,
  getTrailingBridgeFragmentReason,
  getTrailingShortNumericFragmentReason,
  getWeakTrailingFragmentReason,
  hasCommercialContextSignal,
  inferQualityTier,
  isLanguageScriptMismatch,
  isRelevantToOfferContext,
  normalizeRelevanceTokens,
  resolveKeywordDataSourceTrustScore,
  shouldBlockContextRestore,
} from './keyword-quality-filter-relevance'
import {
  getMatchedIrrelevantPattern,
  isBrandIrrelevant,
  isBrandVariant,
} from './keyword-quality-filter-brand'
import type { KeywordQualityFilterOptions } from './keyword-quality-filter-types'

export type { KeywordQualityFilterOptions } from './keyword-quality-filter-types'
export {
  isBrandConcatenation,
  shouldUseExactMatch,
  isBrandVariant,
  isBrandIrrelevant,
} from './keyword-quality-filter-brand'
export { extractPlatformFromUrl, detectPlatformsInKeyword } from './keyword-quality-filter-platform'
export { isSemanticQuery, filterLowIntentKeywords } from './keyword-quality-filter-semantic'
export {
  filterMismatchedGeoKeywords,
  calculateSearchVolumeThreshold,
} from './keyword-quality-filter-geo'
export { getTemplateGarbageReason } from './keyword-quality-filter-relevance'

export function filterKeywordQuality(
  keywords: PoolKeywordData[],
  options: KeywordQualityFilterOptions
): {
  filtered: PoolKeywordData[]
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
} {
  const {
    brandName,
    category,
    productName,
    targetCountry,
    targetLanguage,
    minWordCount = 1,
    maxWordCount = 8,
    mustContainBrand = false,
    allowNonBrandFromPlanner = false,
    productUrl, // 🔥 新增：用于平台冲突检测
    minContextTokenMatches = 0,
    contextMismatchMode = 'hard',
  } = options

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const brandContextTokens = new Set(pureBrandKeywords.flatMap((b) => normalizeRelevanceTokens(b)))
  const plannerNonBrandPolicy = normalizePlannerNonBrandPolicy(allowNonBrandFromPlanner)
  const contextSupportTokenCounts = new Map<string, number>()
  const removed: Array<{ keyword: PoolKeywordData; reason: string }> = []
  const filtered: PoolKeywordData[] = []

  for (const kw of keywords) {
    const keywordData: PoolKeywordData =
      typeof kw === 'string' ? { keyword: kw, searchVolume: 0, source: 'FILTERED' } : kw
    const keyword = keywordData.keyword
    const searchVolume =
      typeof keywordData.searchVolume === 'number'
        ? keywordData.searchVolume
        : Number(keywordData.searchVolume) || 0
    const wordCount = keyword.trim().split(/\s+/).length
    const isConcatenatedBrandWithVolume =
      searchVolume > 0 && isBrandConcatenation(keyword, brandName)
    const allowPlannerNonBrand = shouldAllowPlannerNonBrandKeyword(
      keywordData,
      plannerNonBrandPolicy
    )

    // 🆕 高性能搜索词豁免：基于真实表现数据，跳过质量过滤
    const isHighPerformingSearchTerm =
      typeof keywordData.source === 'string' && keywordData.source === 'SEARCH_TERM_HIGH_PERFORMING'

    // 🆕 2026-03-13: 评分建议关键词豁免：基于AI评分分析识别的行业标准关键词
    const isScoringGapKeyword =
      typeof keywordData.source === 'string' && keywordData.source === 'SCORING_SUGGESTION'

    let removeReason: string | null = null

    // 高性能搜索词优先保留，但仍需通过硬风险门禁（防止劣化污染）
    if (isHighPerformingSearchTerm) {
      if (
        mustContainBrand &&
        !shouldKeepByBrand(keyword, pureBrandKeywords) &&
        !isConcatenatedBrandWithVolume
      ) {
        removeReason = `高表现Search Term不含品牌词: "${keyword}"`
      } else {
        const hardBlockReason = getHighPerformingHardBlockReason({
          keyword,
          brandName,
          pureBrandKeywords,
          productUrl,
          targetLanguage,
          source: keywordData.source,
          sourceType: keywordData.sourceType,
          sourceSubtype: keywordData.sourceSubtype,
        })
        if (!hardBlockReason) {
          filtered.push({
            ...keywordData,
            relevanceScore: 95,
            qualityTier: 'HIGH',
          })
          continue
        }
        removeReason = hardBlockReason
      }
    }

    // 🔥 修复(2026-03-13): 评分建议关键词保留品牌包含检查（防御性编程）
    // 虽然品牌化处理已确保包含品牌，但作为最后一道防线仍需检查
    if (isScoringGapKeyword) {
      // 🛡️ 防御性检查：确保品牌化处理成功
      if (mustContainBrand && !shouldKeepByBrand(keyword, pureBrandKeywords)) {
        removeReason = `SCORING_SUGGESTION 不含品牌词（品牌化失败）: "${keyword}"`
      } else if (isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
        removeReason = `SCORING_SUGGESTION 语言脚本错配: "${keyword}"`
      } else {
        // 通过品牌检查，豁免其他质量过滤
        const relevance = isRelevantToOfferContext({
          keyword,
          pureBrandKeywords,
          category,
          productName,
          minContextTokenMatches,
        })
        const relevanceScore = Math.max(
          80,
          computeKeywordRelevanceScore({
            keyword,
            source: keywordData.source,
            pureBrandKeywords,
            category,
            productName,
            relevance,
          })
        )
        filtered.push({
          ...keywordData,
          relevanceScore,
          qualityTier: inferQualityTier(relevanceScore),
        })
        continue
      }
    }

    const templateGarbageReason = getTemplateGarbageReason(keyword, {
      source: keywordData.source,
      sourceType: keywordData.sourceType,
      sourceSubtype: keywordData.sourceSubtype,
    })
    const geoMismatch = targetCountry
      ? resolveGeoMismatch({
          keyword,
          targetCountry,
        })
      : null

    // A. 仅硬过滤明显模板垃圾词（重复词 / 交易词矩阵）
    if (templateGarbageReason) {
      removeReason = templateGarbageReason
    }
    // 🔧 修复(2026-01-21): 过滤搜索量为0且来源为CLUSTERED的关键词
    // 这些是模板化生成的关键词，没有真实搜索量
    // 注意：isPureBrand 标记的纯品牌词豁免此过滤（品牌词可能搜索量为0但仍需保留）
    else if (
      keywordData.searchVolume === 0 &&
      keywordData.source === 'CLUSTERED' &&
      !keywordData.isPureBrand
    ) {
      removeReason = `无搜索量的模板化关键词: "${keyword}" (source: CLUSTERED)`
    }
    // 1. 检查是否必须包含纯品牌词（使用策略函数）
    // 🔥 2026-01-05 使用 shouldKeepByBrand 策略函数，明确用途
    else if (
      mustContainBrand &&
      !shouldKeepByBrand(keyword, pureBrandKeywords) &&
      !isConcatenatedBrandWithVolume &&
      !allowPlannerNonBrand
    ) {
      removeReason = `不含纯品牌词: "${keyword}"`
    }
    // 2. 检查品牌变体词
    else if (isBrandVariant(keyword, brandName) && !isConcatenatedBrandWithVolume) {
      removeReason = `品牌变体词: "${keyword}"`
    }
    // 3. 检查品牌无关词（🔥 2025-12-29 新增）
    else if (isBrandIrrelevant(keyword, brandName)) {
      const pattern = getMatchedIrrelevantPattern(keyword)
      removeReason = pattern
        ? `品牌无关词: "${keyword}" (包含: ${pattern})`
        : `品牌无关词: "${keyword}"`
    }
    // 4. 🔥 新增：检查平台冲突（2025-12-29）
    else if (productUrl && isPlatformMismatch(keyword, productUrl)) {
      const urlPlatform = extractPlatformFromUrl(productUrl)
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      removeReason = `平台冲突: "${keyword}" (包含 ${kwPlatforms.join('/')}，但URL是 ${urlPlatform})`
    }
    // 5. 目标国家不匹配（仅当关键词出现明确国家词时触发）
    else if (geoMismatch?.mismatch) {
      removeReason = `国家不匹配: "${keyword}" (包含 ${geoMismatch.detectedCountries.join('/')}，目标 ${geoMismatch.targetCountryCode})`
    }
    // 5. 检查语义查询词（🔥 2025-12-29 优化：如果关键词平台与URL平台匹配，允许通过）
    else if (isSemanticQuery(keyword)) {
      // 🔥 特殊处理：如果关键词包含的平台名与URL平台匹配，则不过滤
      // 例如：对于Amazon URL，"anker amazon"应该被保留而不是被语义查询词过滤
      const urlPlatform = productUrl ? extractPlatformFromUrl(productUrl) : null
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      const isMatchingPlatform =
        urlPlatform && kwPlatforms.length > 0 && kwPlatforms.includes(urlPlatform)

      if (!isMatchingPlatform) {
        const pattern = getMatchedFilterPattern(keyword)
        removeReason = pattern
          ? `语义查询词: "${keyword}" (包含: ${pattern})`
          : `语义查询词: "${keyword}"`
      }
    } else {
      const lowIntentSupportReason = getLowIntentSupportReason(keyword)
      if (lowIntentSupportReason) {
        removeReason = lowIntentSupportReason
      } else {
        const weakTrailingFragmentReason = getWeakTrailingFragmentReason(keyword, pureBrandKeywords)
        if (weakTrailingFragmentReason) {
          removeReason = weakTrailingFragmentReason
        } else {
          const trailingBridgeFragmentReason = getTrailingBridgeFragmentReason(keyword)
          if (trailingBridgeFragmentReason) {
            removeReason = trailingBridgeFragmentReason
          } else {
            const brandShortNumericFragmentReason = getBrandShortNumericFragmentReason({
              keyword,
              sourceType: keywordData.sourceType,
              pureBrandKeywords,
            })
            if (brandShortNumericFragmentReason) {
              removeReason = brandShortNumericFragmentReason
            } else {
              const trailingShortNumericFragmentReason = getTrailingShortNumericFragmentReason({
                keyword,
                sourceType: keywordData.sourceType,
              })
              if (trailingShortNumericFragmentReason) {
                removeReason = trailingShortNumericFragmentReason
              } else {
                const keywordAnchorDistortionReason = getKeywordAnchorDistortionReason({
                  keyword,
                  pureBrandKeywords,
                  productName,
                })
                if (keywordAnchorDistortionReason) {
                  removeReason = keywordAnchorDistortionReason
                }
              }
            }
          }
        }
      }
    }
    // 6. 语言脚本错配（避免非目标脚本关键词污染）
    if (!removeReason && isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
      removeReason = `语言脚本错配: "${keyword}"`
    }
    // 6. 检查单词数
    else if (!removeReason && (wordCount < minWordCount || wordCount > maxWordCount)) {
      removeReason = `单词数不匹配: ${wordCount} (范围: ${minWordCount}-${maxWordCount})`
    }
    // 7. 与商品/品类相关性过滤（可选，避免歧义品牌误入无关主题）
    else if (!removeReason) {
      const relevance = isRelevantToOfferContext({
        keyword,
        pureBrandKeywords,
        category,
        productName,
        minContextTokenMatches,
      })
      if (!relevance.ok && contextMismatchMode === 'hard') {
        removeReason = relevance.reason || `与商品无关: "${keyword}"`
      } else if (relevance.mode === 'context_match' && contextMismatchMode === 'hard') {
        const nonBrandTokens = (
          relevance.keywordTokens || normalizeRelevanceTokens(keyword)
        ).filter((token) => !brandContextTokens.has(token))
        for (const token of new Set(nonBrandTokens)) {
          contextSupportTokenCounts.set(token, (contextSupportTokenCounts.get(token) || 0) + 1)
        }
      }
    }

    if (removeReason) {
      removed.push({ keyword: keywordData, reason: removeReason })
    } else {
      const relevance = isRelevantToOfferContext({
        keyword,
        pureBrandKeywords,
        category,
        productName,
        minContextTokenMatches,
      })
      const relevanceScore = computeKeywordRelevanceScore({
        keyword,
        source: keywordData.source,
        pureBrandKeywords,
        category,
        productName,
        relevance,
      })
      filtered.push({
        ...keywordData,
        relevanceScore,
        qualityTier: inferQualityTier(relevanceScore),
      })
    }
  }

  if (
    contextMismatchMode === 'hard' &&
    minContextTokenMatches > 0 &&
    contextSupportTokenCounts.size > 0
  ) {
    const supportRestores = removed.filter((item) => {
      if (!item.reason.includes('与商品无关')) return false

      const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      if (
        !shouldKeepByBrand(text, pureBrandKeywords) ||
        isPureBrandKeyword(text, pureBrandKeywords)
      )
        return false
      if (shouldBlockContextRestore(text)) return false

      const nonBrandTokens = normalizeRelevanceTokens(text).filter(
        (token) => !brandContextTokens.has(token)
      )
      if (nonBrandTokens.length === 0 || nonBrandTokens.length > 2) return false

      if (nonBrandTokens.length === 1) {
        return (contextSupportTokenCounts.get(nonBrandTokens[0]) || 0) >= 2
      }

      return nonBrandTokens.every((token) => (contextSupportTokenCounts.get(token) || 0) >= 2)
    })

    supportRestores.sort((a, b) => {
      const aVol = typeof a.keyword === 'string' ? 0 : Number(a.keyword.searchVolume) || 0
      const bVol = typeof b.keyword === 'string' ? 0 : Number(b.keyword.searchVolume) || 0
      return bVol - aVol
    })

    for (const item of supportRestores) {
      const restoredKeyword =
        typeof item.keyword === 'string'
          ? { keyword: item.keyword, searchVolume: 0, source: 'FILTERED' }
          : item.keyword
      filtered.push(restoredKeyword)

      const index = removed.indexOf(item)
      if (index >= 0) removed.splice(index, 1)
    }
  }

  if (contextMismatchMode === 'hard' && minContextTokenMatches > 0) {
    let contextMismatchSafetyRestoreApplied = false
    const keptContextCandidates = filtered.filter(
      (item) =>
        shouldKeepByBrand(item.keyword, pureBrandKeywords) &&
        !isPureBrandKeyword(item.keyword, pureBrandKeywords)
    )
    const contextRemovedCandidates = removed.filter((item) => {
      const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      return (
        item.reason.includes('与商品无关') &&
        shouldKeepByBrand(text, pureBrandKeywords) &&
        !isPureBrandKeyword(text, pureBrandKeywords)
      )
    })

    const totalContextCandidates = keptContextCandidates.length + contextRemovedCandidates.length
    const removedRatio =
      totalContextCandidates > 0 ? contextRemovedCandidates.length / totalContextCandidates : 0

    // Safety net: if context gate removes almost all brand-containing candidates,
    // restore a tiny number of strongest commercial-intent terms.
    if (
      totalContextCandidates >= 4 &&
      keptContextCandidates.length === 0 &&
      contextRemovedCandidates.length >= 3 &&
      removedRatio >= 0.85
    ) {
      const restoreLimit = Math.min(
        2,
        Math.max(1, Math.floor(contextRemovedCandidates.length * 0.2))
      )
      const restoreCandidates = contextRemovedCandidates
        .filter((item) => {
          const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
          return hasCommercialContextSignal(text) && !shouldBlockContextRestore(text)
        })
        .sort((a, b) => {
          const aVol = typeof a.keyword === 'string' ? 0 : Number(a.keyword.searchVolume) || 0
          const bVol = typeof b.keyword === 'string' ? 0 : Number(b.keyword.searchVolume) || 0
          return bVol - aVol
        })
        .slice(0, restoreLimit)

      for (const item of restoreCandidates) {
        const restoredKeyword =
          typeof item.keyword === 'string'
            ? { keyword: item.keyword, searchVolume: 0, source: 'FILTERED' }
            : item.keyword
        filtered.push(restoredKeyword)

        const index = removed.indexOf(item)
        if (index >= 0) removed.splice(index, 1)
      }
      if (restoreCandidates.length > 0) {
        contextMismatchSafetyRestoreApplied = true
      }
    }

    const contextRemovedAllCandidates = removed.filter((item) => item.reason.includes('与商品无关'))
    const contextRemovedAllRatio =
      contextRemovedAllCandidates.length + filtered.length > 0
        ? contextRemovedAllCandidates.length /
          (contextRemovedAllCandidates.length + filtered.length)
        : 0
    if (
      !contextMismatchSafetyRestoreApplied &&
      contextRemovedAllCandidates.length >= 3 &&
      contextRemovedAllRatio >= 0.6
    ) {
      const existingFilteredKeys = new Set(
        filtered.map(
          (item) => normalizeGoogleAdsKeyword(item.keyword) || item.keyword.toLowerCase().trim()
        )
      )
      const trustedContextRestoreCandidates = contextRemovedAllCandidates
        .map((item) => {
          const keywordData =
            typeof item.keyword === 'string'
              ? ({ keyword: item.keyword, searchVolume: 0, source: 'FILTERED' } as PoolKeywordData)
              : item.keyword
          const text = keywordData.keyword
          if (shouldBlockContextRestore(text)) return null
          if (!hasCommercialContextSignal(text)) return null
          if (isPureBrandKeyword(text, pureBrandKeywords)) return null

          const sourceTrustScore = resolveKeywordDataSourceTrustScore(keywordData)
          if (sourceTrustScore < 12) return null

          return {
            item,
            keywordData,
            sourceTrustScore,
          }
        })
        .filter(
          (
            entry
          ): entry is {
            item: { keyword: PoolKeywordData; reason: string }
            keywordData: PoolKeywordData
            sourceTrustScore: number
          } => entry !== null
        )
        .sort((a, b) => {
          const trustDiff = b.sourceTrustScore - a.sourceTrustScore
          if (trustDiff !== 0) return trustDiff
          const aVol = Number(a.keywordData.searchVolume || 0)
          const bVol = Number(b.keywordData.searchVolume || 0)
          return bVol - aVol
        })

      const restoreLimit = Math.min(
        3,
        Math.max(1, Math.floor(trustedContextRestoreCandidates.length * 0.3))
      )
      for (const restoreCandidate of trustedContextRestoreCandidates.slice(0, restoreLimit)) {
        const restoreKey =
          normalizeGoogleAdsKeyword(restoreCandidate.keywordData.keyword) ||
          restoreCandidate.keywordData.keyword.toLowerCase().trim()
        if (!restoreKey || existingFilteredKeys.has(restoreKey)) continue

        filtered.push(restoreCandidate.keywordData)
        existingFilteredKeys.add(restoreKey)

        const index = removed.indexOf(restoreCandidate.item)
        if (index >= 0) removed.splice(index, 1)
      }
    }
  }

  return { filtered, removed }
}

// ============================================
// 统计报告
// ============================================

/**
 * 生成过滤统计报告
 */
export function generateFilterReport(
  originalCount: number,
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
): string {
  if (removed.length === 0) {
    return `✅ 所有 ${originalCount} 个关键词通过质量检查`
  }

  const filteredCount = originalCount - removed.length
  const removalRate = ((removed.length / originalCount) * 100).toFixed(1)

  // 按原因分组统计
  const reasonGroups: Record<string, number> = {}
  for (const item of removed) {
    // 提取主要原因类别
    let category = '其他'
    if (item.reason.includes('品牌变体词')) {
      category = '品牌变体词'
    } else if (item.reason.includes('语义查询词')) {
      category = '语义查询词'
    } else if (item.reason.includes('单词数')) {
      category = '单词数不匹配'
    }
    reasonGroups[category] = (reasonGroups[category] || 0) + 1
  }

  let report = `📊 关键词质量过滤报告:\n`
  report += `   原始: ${originalCount} 个 → 过滤后: ${filteredCount} 个\n`
  report += `   移除: ${removed.length} 个 (${removalRate}%)\n`

  for (const [category, count] of Object.entries(reasonGroups)) {
    report += `   - ${category}: ${count} 个\n`
  }

  // 显示被移除的关键词示例（最多5个）
  if (removed.length > 0) {
    const examples = removed.slice(0, 5).map((item) => {
      const keyword = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      return `     - "${keyword}": ${item.reason}`
    })
    report += `   示例:\n${examples.join('\n')}`
  }

  return report
}
