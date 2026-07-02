import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import { getPureBrandKeywords, isPureBrandKeyword } from '@/lib/keywords/brand/brand-keyword-utils'
import {
  isBrandVariant,
  isBrandIrrelevant,
  isBrandConcatenation,
  getTemplateGarbageReason,
} from '@/lib/keywords/keyword-quality-filter'
import { isLanguageScriptMismatch } from './shared/language-gates'
import { isGeoMismatch, shouldFilterSemanticKeyword } from './shared/geo-gates'
import { hasSearchVolumeUnavailableFlag } from './shared/brand-utils'

function qualityFilterOAuth(
  keywords: PoolKeywordData[],
  brandName: string,
  targetCountry?: string,
  targetLanguage?: string,
  productUrl?: string
): PoolKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const dynamicThreshold = calculateDynamicThreshold(keywords)
  const hasAnyVolume = keywords.some((kw) => kw.searchVolume > 0)
  const volumeUnavailable = hasSearchVolumeUnavailableFlag(keywords)

  logger.debug(`      动态搜索量阈值: ${dynamicThreshold}`)

  let brandKeptCount = 0
  let brandVariantRemoved = 0
  let templateRemoved = 0
  let semanticRemoved = 0
  let irrelevantRemoved = 0
  let lowIntentRemoved = 0
  let geoRemoved = 0
  let languageRemoved = 0
  let volumeRemoved = 0

  const filtered = keywords.filter((kw) => {
    const kwLower = kw.keyword.toLowerCase()
    const isPureBrand = isPureBrandKeyword(kw.keyword, pureBrandKeywords)
    const isConcatenatedBrandWithVolume =
      (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)

    // 1. 明显模板垃圾词过滤（重复词/交易词矩阵）
    if (getTemplateGarbageReason(kw.keyword)) {
      templateRemoved++
      return false
    }

    // 2. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName) && !isConcatenatedBrandWithVolume) {
      brandVariantRemoved++
      return false
    }

    // 3. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 4. 语义查询词过滤
    if (shouldFilterSemanticKeyword(kwLower, productUrl)) {
      semanticRemoved++
      return false
    }

    // 5. 地理过滤
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoRemoved++
      return false
    }

    // 6. 语言脚本过滤（例如DE/EN场景下移除西里尔字母关键词）
    if (targetLanguage && isLanguageScriptMismatch(kw.keyword, targetLanguage, pureBrandKeywords)) {
      languageRemoved++
      return false
    }

    // 7. 搜索量过滤（纯品牌词豁免）
    if (hasAnyVolume && !volumeUnavailable && !isPureBrand && kw.searchVolume < dynamicThreshold) {
      volumeRemoved++
      return false
    }

    if (isPureBrand) {
      kw.isPureBrand = true
      brandKeptCount++
    }

    return true
  })

  logger.debug(`      保留: ${filtered.length}`)
  logger.debug(`      纯品牌词: ${brandKeptCount}`)
  if (hasAnyVolume && volumeUnavailable) {
    logger.debug(`      ⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤`)
  }
  logger.debug(
    `      移除: 模板垃圾(${templateRemoved}) 品牌变体(${brandVariantRemoved}) 语义(${semanticRemoved}) 品牌无关(${irrelevantRemoved}) 低意图(${lowIntentRemoved}) 地理(${geoRemoved}) 语言脚本(${languageRemoved}) 搜索量(${volumeRemoved})`
  )

  return filtered
}

function qualityFilterServiceAccount(
  keywords: PoolKeywordData[],
  brandName: string,
  targetCountry?: string,
  targetLanguage?: string,
  productUrl?: string
): PoolKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  let brandKeptCount = 0
  let brandVariantRemoved = 0
  let templateRemoved = 0
  let semanticRemoved = 0
  let irrelevantRemoved = 0
  let geoRemoved = 0
  let languageRemoved = 0

  const filtered = keywords.filter((kw) => {
    const kwLower = kw.keyword.toLowerCase()
    const isPureBrand = isPureBrandKeyword(kw.keyword, pureBrandKeywords)
    const isConcatenatedBrandWithVolume =
      (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)

    // 1. 明显模板垃圾词过滤（重复词/交易词矩阵）
    if (getTemplateGarbageReason(kw.keyword)) {
      templateRemoved++
      return false
    }

    // 2. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName) && !isConcatenatedBrandWithVolume) {
      brandVariantRemoved++
      return false
    }

    // 3. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 4. 语义查询词过滤
    if (shouldFilterSemanticKeyword(kwLower, productUrl)) {
      semanticRemoved++
      return false
    }

    // 5. 地理过滤
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoRemoved++
      return false
    }

    // 6. 语言脚本过滤（例如DE/EN场景下移除西里尔字母关键词）
    if (targetLanguage && isLanguageScriptMismatch(kw.keyword, targetLanguage, pureBrandKeywords)) {
      languageRemoved++
      return false
    }

    // 无搜索量过滤（服务账号无法获取搜索量）

    if (isPureBrand) {
      kw.isPureBrand = true
      brandKeptCount++
    }

    return true
  })

  logger.debug(`      保留: ${filtered.length}`)
  logger.debug(`      纯品牌词: ${brandKeptCount}`)
  logger.debug(
    `      移除: 模板垃圾(${templateRemoved}) 品牌变体(${brandVariantRemoved}) 语义(${semanticRemoved}) 品牌无关(${irrelevantRemoved}) 地理(${geoRemoved}) 语言脚本(${languageRemoved})`
  )

  return filtered
}

function calculateDynamicThreshold(keywords: PoolKeywordData[]): number {
  const keywordsWithVolume = keywords.filter((kw) => kw.searchVolume > 0)

  if (keywordsWithVolume.length === 0) {
    return 100 // 默认阈值
  }

  const volumes = keywordsWithVolume.map((kw) => kw.searchVolume).sort((a, b) => a - b)

  const medianVolume = volumes[Math.floor(volumes.length / 2)]

  // 阈值设为中位数的10%，但不超过500，不低于100
  return Math.min(500, Math.max(100, Math.floor(medianVolume * 0.1)))
}

export { qualityFilterOAuth, qualityFilterServiceAccount, calculateDynamicThreshold }
