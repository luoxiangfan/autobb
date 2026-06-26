/**
 * 创意关键词上下文过滤：主流程
 */
import { logger } from '@/lib/common/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../planner/keyword-context-filter'
import { filterKeywordQuality } from '../keyword-quality-filter'

import type { CanonicalCreativeType } from '../../creatives/server'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import type { PoolKeywordData } from '../offer-pool'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
  supplementModelIntentKeywordsWithFallback,
} from '../../creatives/server'
import {
  resolveOfferPageTypeForKeywordContext,
  extractCategorySignalsForKeywordContext,
  extractStoreSignalsForKeywordQualityContext,
  buildKeywordQualityProductContext,
  resolveCreativeContextMaxWordCount,
  buildStoreIntentTighteningContext,
  normalizeContextToken,
  tokenizeContext,
  CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN,
  type OfferKeywordContext,
} from './creative-keyword-context-filter-utils'
import { buildProductPageIntentSpecificityContext } from './creative-keyword-context-filter-product'
import {
  buildIntentContextAnchorTokens,
  hasIntentContextAnchor,
  shouldKeepAfterIntentTightening,
  buildIntentTighteningRelaxedFallbackCandidates,
  buildIntentTighteningPermutationKey,
  resolveIntentTighteningPreferredFloor,
} from './creative-keyword-context-filter-intent'

function summarizeQualityFilterRemoved(removed: Array<{ reason: string }>): {
  contextMismatchRemovedCount: number
  forbiddenRemovedCount: number
  qualityRemovedCount: number
} {
  const contextMismatchRemovedCount = removed.filter((item) =>
    item.reason.includes('与商品无关')
  ).length
  const forbiddenRemovedCount = removed.filter((item) =>
    CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN.test(item.reason)
  ).length
  const qualityRemovedCount = Math.max(
    0,
    removed.length - contextMismatchRemovedCount - forbiddenRemovedCount
  )

  return {
    contextMismatchRemovedCount,
    forbiddenRemovedCount,
    qualityRemovedCount,
  }
}

function normalizeContextFilteredKeywordKey(keyword: string): string {
  return (
    normalizeGoogleAdsKeyword(keyword) ||
    String(keyword || '')
      .trim()
      .toLowerCase()
  )
}

function addBlockedKeywordKey(
  blockedKeywordKeys: Set<string>,
  keyword: string | null | undefined
): void {
  const normalized = normalizeContextFilteredKeywordKey(String(keyword || ''))
  if (normalized) blockedKeywordKeys.add(normalized)
}

export function normalizeCreativeKeywordCandidatesForContextFilter(
  keywordsWithVolume: unknown[],
  fallbackSource: string
): PoolKeywordData[] {
  return keywordsWithVolume
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const keyword = String((item as any).keyword || '').trim()
      if (!keyword) return null

      return {
        ...item,
        keyword,
        searchVolume:
          typeof (item as any).searchVolume === 'number'
            ? (item as any).searchVolume
            : Number((item as any).searchVolume) || 0,
        source:
          String((item as any).source || fallbackSource || 'KEYWORD_POOL').trim() || 'KEYWORD_POOL',
        matchType: ((item as any).matchType || 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD',
      } as PoolKeywordData
    })
    .filter((item): item is PoolKeywordData => item !== null)
}

export function filterCreativeKeywordsByOfferContextDetailed(params: {
  offer: OfferKeywordContext
  keywordsWithVolume: PoolKeywordData[]
  scopeLabel: string
  creativeType?: CanonicalCreativeType | null
}): {
  keywords: PoolKeywordData[]
  contextMismatchRemovedCount: number
  forbiddenRemovedCount: number
  qualityRemovedCount: number
  modelFamilyRemovedCount: number
  intentTighteningRemovedCount: number
  blockedKeywordKeys: string[]
} {
  const { offer, keywordsWithVolume, scopeLabel, creativeType } = params
  if (keywordsWithVolume.length === 0) {
    return {
      keywords: keywordsWithVolume,
      contextMismatchRemovedCount: 0,
      forbiddenRemovedCount: 0,
      qualityRemovedCount: 0,
      modelFamilyRemovedCount: 0,
      intentTighteningRemovedCount: 0,
      blockedKeywordKeys: [],
    }
  }

  const pageType = resolveOfferPageTypeForKeywordContext(offer)
  const storeKeywordContextSignals =
    pageType === 'store'
      ? extractStoreSignalsForKeywordQualityContext(offer.scraped_data || null)
      : []
  const baseMinContextTokenMatches = getMinContextTokenMatchesForKeywordQualityFilter({ pageType })
  const minContextTokenMatches =
    pageType === 'store' && storeKeywordContextSignals.length >= 3 ? 1 : baseMinContextTokenMatches
  const categorySignals = extractCategorySignalsForKeywordContext(offer.scraped_data || null)
  const categoryTexts = [offer.category, ...categorySignals]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const categoryContext = categoryTexts.join(' ')
  const keywordQualityProductContext =
    [String(offer.product_name || '').trim(), ...storeKeywordContextSignals]
      .filter(Boolean)
      .slice(0, 12)
      .join(' ') || buildKeywordQualityProductContext(offer, pageType)
  const productPageModelFamilyContext =
    pageType === 'product'
      ? buildProductModelFamilyContext({
          brand: offer.brand,
          product_name: offer.product_name,
          offer_name: offer.offer_name,
          scraped_data: offer.scraped_data || null,
          final_url: offer.final_url,
          url: offer.url,
        })
      : null

  const qualityFiltered = filterKeywordQuality(keywordsWithVolume, {
    brandName: offer.brand || '',
    category: categoryContext || undefined,
    productName: keywordQualityProductContext,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: resolveCreativeContextMaxWordCount(creativeType),
    mustContainBrand:
      creativeType === 'brand_intent' && String(offer.brand || '').trim().length > 0,
    minContextTokenMatches,
  })

  const { contextMismatchRemovedCount, forbiddenRemovedCount, qualityRemovedCount } =
    summarizeQualityFilterRemoved(qualityFiltered.removed)
  const blockedKeywordKeys = new Set<string>()
  for (const item of qualityFiltered.removed) {
    addBlockedKeywordKey(blockedKeywordKeys, item.keyword?.keyword)
  }
  if (qualityFiltered.removed.length > 0) {
    logger.debug(
      `🧹 创意关键词过滤(${scopeLabel}): ${keywordsWithVolume.length} → ${qualityFiltered.filtered.length} ` +
        `(移除 ${qualityFiltered.removed.length}，其中上下文不相关 ${contextMismatchRemovedCount})`
    )
  }

  let modelFamilyFilteredKeywords = qualityFiltered.filtered
  let modelFamilyRemovedCount = 0
  if (
    creativeType === 'model_intent' &&
    pageType === 'product' &&
    qualityFiltered.filtered.length > 0
  ) {
    const modelFamilyContext =
      productPageModelFamilyContext ||
      buildProductModelFamilyContext({
        brand: offer.brand,
        product_name: offer.product_name,
        offer_name: offer.offer_name,
        scraped_data: offer.scraped_data || null,
        final_url: offer.final_url,
        url: offer.url,
      })

    const modelFamilyFiltered = filterKeywordObjectsByProductModelFamily(
      qualityFiltered.filtered,
      modelFamilyContext
    )

    if (modelFamilyFiltered.removed.length > 0) {
      modelFamilyRemovedCount = modelFamilyFiltered.removed.length
      for (const item of modelFamilyFiltered.removed) {
        addBlockedKeywordKey(blockedKeywordKeys, item.item?.keyword)
      }
      logger.debug(
        `🧬 model_intent 型号族过滤(${scopeLabel}): ${qualityFiltered.filtered.length} → ${modelFamilyFiltered.filtered.length} ` +
          `(移除 ${modelFamilyFiltered.removed.length})`
      )
    }

    if (modelFamilyFiltered.filtered.length > 0) {
      modelFamilyFilteredKeywords = modelFamilyFiltered.filtered
    } else {
      const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
        context: modelFamilyContext,
        brandName: offer.brand,
      })

      if (fallbackKeywords.length > 0) {
        const seed = qualityFiltered.filtered[0]
        modelFamilyFilteredKeywords = fallbackKeywords.map((keyword) => ({
          ...seed,
          keyword,
          searchVolume: 0,
          source: 'MODEL_FAMILY_GUARD',
          sourceType: 'MODEL_FAMILY_GUARD',
          sourceSubtype: 'MODEL_FAMILY_GUARD',
          rawSource: 'DERIVED_RESCUE',
          derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
          matchType: 'EXACT',
        }))
        console.warn(
          `⚠️ model_intent 型号族过滤后无关键词，已注入 ${modelFamilyFilteredKeywords.length} 个兜底型号词 (${scopeLabel})`
        )
      }
    }

    if (
      modelFamilyFilteredKeywords.length > 0 &&
      modelFamilyFilteredKeywords.length < MODEL_INTENT_MIN_KEYWORD_FLOOR
    ) {
      const seed = modelFamilyFilteredKeywords[0]
      const supplemented = supplementModelIntentKeywordsWithFallback({
        items: modelFamilyFilteredKeywords,
        context: modelFamilyContext,
        brandName: offer.brand,
        minKeywords: MODEL_INTENT_MIN_KEYWORD_FLOOR,
        buildFallbackItem: (keyword) => ({
          ...seed,
          keyword,
          searchVolume: 0,
          source: 'MODEL_FAMILY_GUARD',
          sourceType: 'MODEL_FAMILY_GUARD',
          sourceSubtype: 'MODEL_FAMILY_GUARD',
          rawSource: 'DERIVED_RESCUE',
          derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
          matchType: 'EXACT' as const,
        }),
      })

      if (supplemented.addedKeywords.length > 0) {
        modelFamilyFilteredKeywords = supplemented.items
        logger.debug(
          `🧩 model_intent 关键词补足(${scopeLabel}): +${supplemented.addedKeywords.length} ` +
            `(总计 ${modelFamilyFilteredKeywords.length})`
        )
      }
    }
  }

  if (
    (creativeType === 'brand_intent' ||
      creativeType === 'model_intent' ||
      creativeType === 'product_intent') &&
    modelFamilyFilteredKeywords.length > 0
  ) {
    const storeIntentContext =
      pageType === 'store' && (creativeType === 'brand_intent' || creativeType === 'product_intent')
        ? buildStoreIntentTighteningContext({
            items: modelFamilyFilteredKeywords,
            brandName: offer.brand,
            categoryTexts,
          })
        : null
    const productPageIntentContext =
      pageType === 'product' &&
      (creativeType === 'brand_intent' ||
        creativeType === 'model_intent' ||
        creativeType === 'product_intent')
        ? buildProductPageIntentSpecificityContext({
            brandName: offer.brand,
            productName: offer.product_name,
            categoryTexts,
            modelFamilyContext: productPageModelFamilyContext,
          })
        : null
    const anchorTokens = buildIntentContextAnchorTokens({
      brandName: offer.brand,
      categoryContext,
      productName: offer.product_name,
      modelFamilyContext: productPageModelFamilyContext,
      creativeType,
    })

    if (anchorTokens.size > 0 || storeIntentContext !== null) {
      const minimumKeywordFloor = resolveCreativeKeywordMinimumOutputCount({
        creativeType,
        maxKeywords: 50,
      })
      const preferredKeywordFloor = resolveIntentTighteningPreferredFloor({
        creativeType,
        minimumKeywordFloor,
        candidateCount: modelFamilyFilteredKeywords.length,
      })
      const tightened = modelFamilyFilteredKeywords.filter((item) =>
        shouldKeepAfterIntentTightening({
          creativeType,
          keyword: item.keyword,
          searchVolume: item.searchVolume,
          brandName: offer.brand,
          anchorTokens,
          pageType,
          modelFamilyContext: productPageModelFamilyContext,
          storeIntentContext,
          productPageIntentContext,
        })
      )

      if (tightened.length > 0) {
        let tightenedResult = tightened
        if (creativeType === 'model_intent' && tightened.length < MODEL_INTENT_MIN_KEYWORD_FLOOR) {
          const tightenedNormalized = new Set(
            tightened.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
          )
          const tightenedPermutationKeys = new Set(
            tightened.map(
              (item) =>
                buildIntentTighteningPermutationKey(item.keyword) ||
                normalizeGoogleAdsKeyword(item.keyword) ||
                ''
            )
          )
          const underfillSupplement = buildIntentTighteningRelaxedFallbackCandidates({
            items: modelFamilyFilteredKeywords,
            creativeType,
            brandName: offer.brand,
            anchorTokens,
            pageType,
            modelFamilyContext: productPageModelFamilyContext,
            storeIntentContext,
            productPageIntentContext,
            limit: MODEL_INTENT_MIN_KEYWORD_FLOOR - tightened.length,
            excludeNormalized: tightenedNormalized,
            excludePermutationKeys: tightenedPermutationKeys,
          })
          if (underfillSupplement.length > 0) {
            tightenedResult = [...tightenedResult, ...underfillSupplement]
            logger.debug(
              `🧩 ${creativeType} 上下文收紧后补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
            )
          }

          if (tightenedResult.length < MODEL_INTENT_MIN_KEYWORD_FLOOR && pageType === 'product') {
            const modelFamilyContext =
              productPageModelFamilyContext ||
              buildProductModelFamilyContext({
                brand: offer.brand,
                product_name: offer.product_name,
                offer_name: offer.offer_name,
                scraped_data: offer.scraped_data || null,
                final_url: offer.final_url,
                url: offer.url,
              })
            const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
              context: modelFamilyContext,
              brandName: offer.brand,
            })
            if (fallbackKeywords.length > 0) {
              const currentNormalized = new Set(
                tightenedResult.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
              )
              const currentPermutationKeys = new Set(
                tightenedResult.map(
                  (item) =>
                    buildIntentTighteningPermutationKey(item.keyword) ||
                    normalizeGoogleAdsKeyword(item.keyword) ||
                    ''
                )
              )
              const seed = tightenedResult[0] || modelFamilyFilteredKeywords[0]
              const seen = new Set<string>()
              const guardFallbackCandidates: PoolKeywordData[] = []
              for (const keyword of fallbackKeywords) {
                const normalized = normalizeGoogleAdsKeyword(keyword)
                if (!normalized || seen.has(normalized) || currentNormalized.has(normalized))
                  continue
                const permutationKey = buildIntentTighteningPermutationKey(keyword) || normalized
                if (currentPermutationKeys.has(permutationKey)) continue
                seen.add(normalized)
                guardFallbackCandidates.push({
                  ...seed,
                  keyword,
                  searchVolume: 0,
                  source: 'MODEL_FAMILY_GUARD',
                  sourceType: 'MODEL_FAMILY_GUARD',
                  sourceSubtype: 'MODEL_FAMILY_GUARD',
                  rawSource: 'DERIVED_RESCUE',
                  derivedTags: Array.from(
                    new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])
                  ),
                  matchType: 'EXACT' as const,
                })
              }
              const guardSupplement = guardFallbackCandidates
                .filter((item) =>
                  shouldKeepAfterIntentTightening({
                    creativeType,
                    keyword: item.keyword,
                    searchVolume: item.searchVolume,
                    brandName: offer.brand,
                    anchorTokens,
                    pageType,
                    modelFamilyContext,
                    storeIntentContext,
                    productPageIntentContext,
                  })
                )
                .slice(0, MODEL_INTENT_MIN_KEYWORD_FLOOR - tightenedResult.length)
              if (guardSupplement.length > 0) {
                tightenedResult = [...tightenedResult, ...guardSupplement]
                logger.debug(
                  `🧩 ${creativeType} 收紧后安全补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
                )
              }
            }
          }
        }

        if (creativeType !== 'model_intent' && tightenedResult.length < preferredKeywordFloor) {
          const tightenedNormalized = new Set(
            tightenedResult.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
          )
          const tightenedPermutationKeys = new Set(
            tightenedResult.map(
              (item) =>
                buildIntentTighteningPermutationKey(item.keyword) ||
                normalizeGoogleAdsKeyword(item.keyword) ||
                ''
            )
          )
          const underfillSupplement = buildIntentTighteningRelaxedFallbackCandidates({
            items: modelFamilyFilteredKeywords,
            creativeType,
            brandName: offer.brand,
            anchorTokens,
            pageType,
            modelFamilyContext: productPageModelFamilyContext,
            storeIntentContext,
            productPageIntentContext,
            limit: preferredKeywordFloor - tightenedResult.length,
            excludeNormalized: tightenedNormalized,
            excludePermutationKeys: tightenedPermutationKeys,
          })
          if (underfillSupplement.length > 0) {
            tightenedResult = [...tightenedResult, ...underfillSupplement]
            logger.debug(
              `🧩 ${creativeType} 收紧后补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
            )
          }
        }

        const intentTighteningRemovedCount = Math.max(
          0,
          modelFamilyFilteredKeywords.length - tightenedResult.length
        )
        const tightenedResultKeys = new Set(
          tightenedResult.map((item) => normalizeContextFilteredKeywordKey(item.keyword))
        )
        for (const item of modelFamilyFilteredKeywords) {
          if (!tightenedResultKeys.has(normalizeContextFilteredKeywordKey(item.keyword))) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
        }
        if (intentTighteningRemovedCount > 0) {
          logger.debug(
            `🎯 ${creativeType} 上下文收紧(${scopeLabel}): ${modelFamilyFilteredKeywords.length} → ${tightenedResult.length}`
          )
        }

        return {
          keywords: tightenedResult,
          contextMismatchRemovedCount,
          forbiddenRemovedCount,
          qualityRemovedCount,
          modelFamilyRemovedCount,
          intentTighteningRemovedCount,
          blockedKeywordKeys: Array.from(blockedKeywordKeys),
        }
      }

      const relaxedFallbackLimit =
        creativeType === 'model_intent'
          ? Math.max(
              1,
              Math.min(
                MODEL_INTENT_MIN_KEYWORD_FLOOR + 1,
                Math.ceil(Math.max(1, modelFamilyFilteredKeywords.length * 0.35))
              )
            )
          : Math.max(1, preferredKeywordFloor)
      const relaxedFallback = buildIntentTighteningRelaxedFallbackCandidates({
        items: modelFamilyFilteredKeywords,
        creativeType,
        brandName: offer.brand,
        anchorTokens,
        pageType,
        modelFamilyContext: productPageModelFamilyContext,
        storeIntentContext,
        productPageIntentContext,
        limit: relaxedFallbackLimit,
      })
      if (relaxedFallback.length > 0) {
        const relaxedFallbackKeys = new Set(
          relaxedFallback.map((item) => normalizeContextFilteredKeywordKey(item.keyword))
        )
        for (const item of modelFamilyFilteredKeywords) {
          if (!relaxedFallbackKeys.has(normalizeContextFilteredKeywordKey(item.keyword))) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
        }
        console.warn(
          `⚠️ ${creativeType} 上下文收紧后触发软回退 (${scopeLabel}): ${modelFamilyFilteredKeywords.length} → ${relaxedFallback.length}`
        )
        return {
          keywords: relaxedFallback,
          contextMismatchRemovedCount,
          forbiddenRemovedCount,
          qualityRemovedCount,
          modelFamilyRemovedCount,
          intentTighteningRemovedCount: Math.max(
            0,
            modelFamilyFilteredKeywords.length - relaxedFallback.length
          ),
          blockedKeywordKeys: Array.from(blockedKeywordKeys),
        }
      }

      if (creativeType === 'model_intent' && pageType === 'product') {
        const modelFamilyContext =
          productPageModelFamilyContext ||
          buildProductModelFamilyContext({
            brand: offer.brand,
            product_name: offer.product_name,
            offer_name: offer.offer_name,
            scraped_data: offer.scraped_data || null,
            final_url: offer.final_url,
            url: offer.url,
          })
        const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
          context: modelFamilyContext,
          brandName: offer.brand,
        })
        const seed = modelFamilyFilteredKeywords[0]
        const seen = new Set<string>()
        const guardFallbackCandidates: PoolKeywordData[] = []
        for (const keyword of fallbackKeywords) {
          const normalized = normalizeGoogleAdsKeyword(keyword)
          if (!normalized || seen.has(normalized)) continue
          seen.add(normalized)
          guardFallbackCandidates.push({
            ...seed,
            keyword,
            searchVolume: 0,
            source: 'MODEL_FAMILY_GUARD',
            sourceType: 'MODEL_FAMILY_GUARD',
            sourceSubtype: 'MODEL_FAMILY_GUARD',
            rawSource: 'DERIVED_RESCUE',
            derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
            matchType: 'EXACT' as const,
          })
        }
        const guardFallback = guardFallbackCandidates
          .filter((item) =>
            shouldKeepAfterIntentTightening({
              creativeType,
              keyword: item.keyword,
              searchVolume: item.searchVolume,
              brandName: offer.brand,
              anchorTokens,
              pageType,
              modelFamilyContext,
              storeIntentContext,
              productPageIntentContext,
            })
          )
          .slice(0, MODEL_INTENT_MIN_KEYWORD_FLOOR)

        if (guardFallback.length > 0) {
          for (const item of modelFamilyFilteredKeywords) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
          console.warn(
            `⚠️ ${creativeType} 上下文收紧后仅剩硬阻断候选，已注入型号族安全回退 (${scopeLabel}): ${guardFallback.length}`
          )
          return {
            keywords: guardFallback,
            contextMismatchRemovedCount,
            forbiddenRemovedCount,
            qualityRemovedCount,
            modelFamilyRemovedCount,
            intentTighteningRemovedCount: Math.max(
              0,
              modelFamilyFilteredKeywords.length - guardFallback.length
            ),
            blockedKeywordKeys: Array.from(blockedKeywordKeys),
          }
        }
      }

      console.warn(
        `⚠️ ${creativeType} 上下文收紧后无可用关键词，交由上层 rescue (${modelFamilyFilteredKeywords.length})`
      )
      for (const item of modelFamilyFilteredKeywords) {
        addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
      }
      return {
        keywords: [],
        contextMismatchRemovedCount,
        forbiddenRemovedCount,
        qualityRemovedCount,
        modelFamilyRemovedCount,
        intentTighteningRemovedCount: modelFamilyFilteredKeywords.length,
        blockedKeywordKeys: Array.from(blockedKeywordKeys),
      }
    }
  }

  return {
    keywords: modelFamilyFilteredKeywords,
    contextMismatchRemovedCount,
    forbiddenRemovedCount,
    qualityRemovedCount,
    modelFamilyRemovedCount,
    intentTighteningRemovedCount: 0,
    blockedKeywordKeys: Array.from(blockedKeywordKeys),
  }
}

export const __testOnly = {
  normalizeContextToken,
  tokenizeContext,
  buildIntentContextAnchorTokens,
  hasIntentContextAnchor,
  shouldKeepAfterIntentTightening,
}
