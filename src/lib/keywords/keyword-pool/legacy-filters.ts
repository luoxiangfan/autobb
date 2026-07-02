import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import { getPureBrandKeywords, containsPureBrand } from '@/lib/keywords/brand/brand-keyword-utils'
import { isBrandConcatenation } from '@/lib/keywords/keyword-quality-filter'
import {
  normalizePlannerNonBrandPolicy,
  plannerNonBrandPolicyEnabled,
  shouldAllowPlannerNonBrandKeyword,
  type PlannerNonBrandPolicy,
} from '@/lib/keywords/planner/planner-non-brand-policy'
import { isGeoMismatch } from './shared/geo-gates'

function filterKeywords(
  keywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry?: string,
  productName?: string | null,
  options?: {
    allowNonBrandFromPlanner?: boolean | PlannerNonBrandPolicy
    // KISS: 允许上层关闭重复品牌门禁，交给统一质量过滤器处理
    applyBrandGate?: boolean
  }
): PoolKeywordData[] {
  void category
  void productName

  // 获取纯品牌词列表
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const plannerNonBrandPolicy = normalizePlannerNonBrandPolicy(options?.allowNonBrandFromPlanner)
  const applyBrandGate = options?.applyBrandGate ?? true

  let geoFilteredCount = 0
  let nonBrandRemovedCount = 0
  let concatenatedBrandKept = 0
  let plannerNonBrandKept = 0

  const kept: PoolKeywordData[] = []

  for (const kw of keywords) {
    if (applyBrandGate) {
      // � 全量强制：只保留包含“纯品牌词”的关键词（不拼接造词）
      // 例外：店铺页允许 Keyword Planner 返回的非品牌词进入后续流程
      if (!containsPureBrand(kw.keyword, pureBrandKeywords)) {
        const isConcatenatedBrandWithVolume =
          (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)
        const allowPlannerNonBrand = shouldAllowPlannerNonBrandKeyword(kw, plannerNonBrandPolicy)
        if (!isConcatenatedBrandWithVolume && !allowPlannerNonBrand) {
          nonBrandRemovedCount++
          continue
        }
        if (isConcatenatedBrandWithVolume) {
          concatenatedBrandKept++
        } else if (allowPlannerNonBrand) {
          plannerNonBrandKept++
        }
      }
    }

    // 地理位置过滤（过滤非目标国家的关键词）
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoFilteredCount++
      continue
    }

    kept.push(kw)
  }

  logger.debug(`   过滤: ${keywords.length} → ${kept.length}`)
  logger.debug(`      移除非品牌: ${nonBrandRemovedCount}`)
  logger.debug(`      拼接品牌保留(有量): ${concatenatedBrandKept}`)
  if (plannerNonBrandKept > 0) {
    logger.debug(`      Keyword Planner 非品牌保留: ${plannerNonBrandKept}`)
  }
  logger.debug(`      地理过滤: ${geoFilteredCount}`)
  const plannerUseCases = [
    plannerNonBrandPolicy.allowNonBrandForPool ? 'pool' : null,
    plannerNonBrandPolicy.allowNonBrandForDemand ? 'demand' : null,
    plannerNonBrandPolicy.allowNonBrandForModelFamily ? 'model_family' : null,
  ].filter(Boolean)
  const strategyLabel = !applyBrandGate
    ? '仅地理预过滤（品牌门禁后置到统一质量过滤）'
    : plannerNonBrandPolicyEnabled(plannerNonBrandPolicy)
      ? `品牌包含 + Keyword Planner 例外(${plannerUseCases.join('/') || 'legacy'})`
      : '100%品牌包含'
  logger.debug(`      策略: ${strategyLabel}`)

  return kept
}

export { filterKeywords }
