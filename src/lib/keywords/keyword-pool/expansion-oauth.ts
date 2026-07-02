import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import type { Offer } from '@/lib/offers/server'
import { expandKeywordsWithSeeds } from '@/lib/keywords/planner/unified-keyword-service'
import {
  getKeywordSearchVolumesForPlannerContext,
  resolveKeywordPlannerLinkedServiceAccountId,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { DEFAULTS } from '@/lib/keywords/keyword-constants'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  getPureBrandKeywords,
  containsPureBrand,
  isPureBrandKeyword,
} from '@/lib/keywords/brand/brand-keyword-utils'
import {
  createPlannerNonBrandPolicy,
  normalizePlannerNonBrandPolicy,
  plannerNonBrandPolicyAllows,
  plannerNonBrandPolicyEnabled,
  syncPlannerDecisionPolicy,
  type PlannerDecision,
  type PlannerNonBrandPolicy,
} from '@/lib/keywords/planner/planner-non-brand-policy'
import { buildProductModelFamilyContext } from '@/lib/creatives/server'
import { buildPlannerBrandKeywords, inferBrandAwareMatchType } from './shared/brand-utils'
import {
  mergeUniqueTags,
  buildOfferContextTokenSet,
  inferPlannerNonBrandUseCase,
  buildPlannerNonBrandMetadata,
  buildPlannerBrandRewriteMetadata,
} from './shared/planner-non-brand-helpers'
import { getGlobalKeywordCandidates, mergeGlobalCandidates } from './global-candidates'
import { qualityFilterOAuth } from './quality-gates'

interface OAuthExpandParams {
  initialKeywords: PoolKeywordData[]
  brandName: string
  category: string
  targetCountry: string
  targetLanguage: string
  pageUrl?: string
  offer?: Offer
  userId?: number
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
  minSearchVolume?: number
  allowNonBrandFromPlanner?: boolean | PlannerNonBrandPolicy
  plannerDecision?: PlannerDecision
  progress?: (info: {
    phase?:
      | 'seed-volume'
      | 'expand-round'
      | 'volume-batch'
      | 'service-step'
      | 'filter'
      | 'cluster'
      | 'save'
    message: string
    current?: number
    total?: number
  }) => Promise<void> | void
  linkedServiceAccountId?: string | null
  plannerSession?: KeywordPlannerPreparedSession
}

/**
 * OAuth模式关键词扩展：Keyword Planner迭代查询
 *
 * 策略
 * 1. 生成纯品牌词种子
 * 2. 迭代查询Keyword Planner（最多3轮，Top20）
 * 3. 质量过滤（品牌变体/语义/品牌无关/低意图）
 * 4. 搜索量过滤（纯品牌词豁免）
 */
async function expandForOAuth(params: OAuthExpandParams): Promise<PoolKeywordData[]> {
  const {
    initialKeywords,
    brandName,
    category,
    targetCountry,
    targetLanguage,
    pageUrl,
    offer,
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    minSearchVolume,
    allowNonBrandFromPlanner,
    plannerDecision,
    progress,
    linkedServiceAccountId: linkedSaFromParent,
    plannerSession,
  } = params

  const plannerLinkedServiceAccountId =
    plannerSession != null
      ? (linkedSaFromParent ?? null)
      : userId && offer?.id
        ? await resolveKeywordPlannerLinkedServiceAccountId({ userId, offerId: offer.id })
        : null

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const plannerBrandKeywords = buildPlannerBrandKeywords(brandName, category)
  const fullBrand = normalizeGoogleAdsKeyword(brandName)
  const fullBrandKeywords = fullBrand ? [fullBrand] : []
  const minFullBrandCount = DEFAULTS.minKeywordsTarget
  const pageType =
    allowNonBrandFromPlanner && typeof allowNonBrandFromPlanner === 'object'
      ? allowNonBrandFromPlanner.pageType || 'product'
      : 'product'
  let plannerNonBrandPolicy = normalizePlannerNonBrandPolicy(allowNonBrandFromPlanner, pageType)
  let allowNonBrand = plannerNonBrandPolicyEnabled(plannerNonBrandPolicy)
  let volumeUnavailableFromPlanner = false
  const allKeywords = new Map<string, PoolKeywordData>()
  const maxRounds = 3
  const topN = 20
  let keywordPlannerReturned = false
  let usedNoSiteFilterSupplement = false
  const modelFamilyContext =
    pageType === 'product' && offer ? buildProductModelFamilyContext(offer as any) : undefined
  const offerContextTokens = buildOfferContextTokenSet({
    brandName,
    category,
    offer,
    modelFamilyContext,
  })

  syncPlannerDecisionPolicy(plannerDecision, plannerNonBrandPolicy)

  const fallbackKeywords: PoolKeywordData[] = (() => {
    if (initialKeywords.length > 0) return initialKeywords
    if (pureBrandKeywords.length > 0) {
      return pureBrandKeywords.map((keyword) => ({
        keyword,
        searchVolume: 0,
        source: 'PROVIDED',
        matchType: inferBrandAwareMatchType(keyword, pureBrandKeywords),
        isPureBrand: true,
      }))
    }
    return []
  })()

  const expandFallback = async (): Promise<PoolKeywordData[]> => {
    if (offer && userId) {
      const { expandForServiceAccount } = await import('./expansion-service-account')
      return expandForServiceAccount({
        initialKeywords,
        brandName,
        category,
        targetCountry,
        targetLanguage,
        offer,
        userId,
        progress,
      })
    }
    return fallbackKeywords
  }

  // Always seed with the canonical pure-brand keyword to avoid empty brand bucket
  // when Keyword Planner doesn't return the seed itself (e.g. "Dr. Mercola" → "dr mercola").
  for (const token of pureBrandKeywords) {
    const canonical = normalizeGoogleAdsKeyword(token)
    if (!canonical) continue
    if (allKeywords.has(canonical)) continue
    allKeywords.set(canonical, {
      keyword: canonical,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND_SEED',
      matchType: 'EXACT',
      isPureBrand: true,
    })
  }

  // 兜底：缺少 OAuth 必要信息时，不生成“空关键词池”
  if (!customerId || !userId) {
    console.warn(
      `   ⚠️ 缺少 customerId 或 userId，跳过Keyword Planner查询，回退到初始关键词(${fallbackKeywords.length}个)`
    )
    return expandFallback()
  }

  // 初始化种子词：强制包含纯品牌词，避免种子漂移到通用品类词
  const initialBrandSeeds = initialKeywords
    .map((kw) => normalizeGoogleAdsKeyword(kw.keyword))
    .filter(Boolean)
    .filter((kw) => containsPureBrand(kw, pureBrandKeywords))
  const seedKeywordsSet = new Set<string>([...plannerBrandKeywords, ...initialBrandSeeds])
  let seedKeywords = Array.from(seedKeywordsSet)

  logger.debug(`   初始种子词: ${seedKeywords.length}个`)

  try {
    const enablePlannerNonBrand = (reason: string) => {
      plannerNonBrandPolicy = {
        ...createPlannerNonBrandPolicy({ pageType, enabled: true }),
        reason,
      }
      allowNonBrand = true
      syncPlannerDecisionPolicy(plannerDecision, plannerNonBrandPolicy)
    }

    // 迭代查询Keyword Planner
    for (let round = 1; round <= maxRounds; round++) {
      await progress?.({
        phase: 'expand-round',
        current: round,
        total: maxRounds,
        message: `关键词池扩展 Round ${round}/${maxRounds}`,
      })
      logger.debug(`\n   📊 Round ${round}/${maxRounds}: Keyword Planner 查询`)
      logger.debug(
        `      种子词: ${seedKeywords.slice(0, 5).join(', ')}${seedKeywords.length > 5 ? '...' : ''}`
      )

      const primaryResults = await expandKeywordsWithSeeds({
        expansionSeeds: seedKeywords,
        country: targetCountry,
        language: targetLanguage,
        userId,
        brandName,
        pageUrl,
        customerId,
        refreshToken,
        accountId,
        clientId,
        clientSecret,
        developerToken,
        offerId: offer?.id,
        linkedServiceAccountId: plannerLinkedServiceAccountId,
        plannerSession,
        maxKeywords: DEFAULTS.maxKeywords,
        minSearchVolume: minSearchVolume ?? DEFAULTS.minSearchVolume,
        onProgress: progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'volume-batch',
                current: info.current,
                total: info.total,
                message: `关键词池搜索量 Round ${round}/${maxRounds} · ${info.message}`,
              })
          : undefined,
      })

      let results = primaryResults
      if (
        primaryResults.some(
          (kw: any) => kw?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
        )
      ) {
        volumeUnavailableFromPlanner = true
        if (plannerDecision) plannerDecision.volumeUnavailableFromPlanner = true
      }

      const brandCountFromSiteFilter =
        fullBrandKeywords.length > 0
          ? primaryResults.filter((kw) => containsPureBrand(kw.keyword, fullBrandKeywords)).length
          : 0

      if (
        !usedNoSiteFilterSupplement &&
        pageUrl &&
        fullBrandKeywords.length > 0 &&
        brandCountFromSiteFilter < minFullBrandCount
      ) {
        logger.debug(
          `      ⚠️ 站点过滤命中品牌词较少(${brandCountFromSiteFilter}/${minFullBrandCount})，补充无站点过滤查询`
        )
        const supplementalResults = await expandKeywordsWithSeeds({
          expansionSeeds: seedKeywords,
          country: targetCountry,
          language: targetLanguage,
          userId,
          brandName,
          customerId,
          refreshToken,
          accountId,
          clientId,
          clientSecret,
          developerToken,
          offerId: offer?.id,
          linkedServiceAccountId: plannerLinkedServiceAccountId,
          plannerSession,
          maxKeywords: DEFAULTS.maxKeywords,
          minSearchVolume: minSearchVolume ?? DEFAULTS.minSearchVolume,
          onProgress: progress
            ? (info: { message: string; current?: number; total?: number }) =>
                progress({
                  phase: 'volume-batch',
                  current: info.current,
                  total: info.total,
                  message: `关键词池搜索量 Round ${round}/${maxRounds} · ${info.message}`,
                })
            : undefined,
        })

        const merged = new Map<string, (typeof supplementalResults)[number]>()
        for (const kw of primaryResults) {
          merged.set(kw.keyword.toLowerCase(), kw)
        }
        for (const kw of supplementalResults) {
          const key = kw.keyword.toLowerCase()
          const existing = merged.get(key)
          if (!existing || (kw.searchVolume || 0) > (existing.searchVolume || 0)) {
            merged.set(key, kw)
          }
        }
        results = Array.from(merged.values())
        if (
          supplementalResults.some(
            (kw: any) => kw?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
          )
        ) {
          volumeUnavailableFromPlanner = true
          if (plannerDecision) plannerDecision.volumeUnavailableFromPlanner = true
        }
        usedNoSiteFilterSupplement = true
        enablePlannerNonBrand('SITE_FILTER_LOW_BRAND_COVERAGE')
      }

      logger.debug(`      返回 ${results.length} 个关键词`)
      if (results.length > 0) {
        keywordPlannerReturned = true
      }

      if (!allowNonBrand && fullBrandKeywords.length > 0) {
        const fullBrandCount = results.filter((kw) =>
          containsPureBrand(kw.keyword, fullBrandKeywords)
        ).length
        if (fullBrandCount < minFullBrandCount) {
          enablePlannerNonBrand('FULL_BRAND_LOW_COVERAGE')
          logger.debug(
            `      ⚠️ 完整品牌词命中较少(${fullBrandCount}/${minFullBrandCount})，允许保留 Keyword Planner 非品牌词`
          )
        }
      }

      // 处理结果：品牌词直接保留，非品牌词品牌化后保留
      let newCount = 0
      let updatedCount = 0
      let brandRelatedAdded = 0
      let genericSkipped = 0
      let brandedFromGeneric = 0 // 统计品牌化的行业词

      for (const kw of results) {
        const keywordText = normalizeGoogleAdsKeyword(kw.keyword)
        if (!keywordText) continue

        let finalKeyword = keywordText
        let wasBranded = false
        let metadata:
          | ReturnType<typeof buildPlannerNonBrandMetadata>
          | ReturnType<typeof buildPlannerBrandRewriteMetadata>
          | undefined

        // 检查是否包含品牌词
        const isBrandRelated = containsPureBrand(keywordText, pureBrandKeywords)
        const plannerUseCase = !isBrandRelated
          ? inferPlannerNonBrandUseCase({
              keyword: keywordText,
              pageType,
              targetLanguage,
              offerContextTokens,
              modelFamilyContext,
            })
          : undefined
        const allowRawPlannerNonBrand = plannerNonBrandPolicyAllows(
          plannerNonBrandPolicy,
          plannerUseCase
        )

        if (!isBrandRelated) {
          if (allowRawPlannerNonBrand && plannerUseCase) {
            metadata = buildPlannerNonBrandMetadata(plannerUseCase)
          } else if (plannerUseCase && kw.searchVolume > 1000) {
            const { composeGlobalCoreBrandedKeyword } = await import('@/lib/keywords/offer-pool')
            const branded = composeGlobalCoreBrandedKeyword(keywordText, brandName, 5)

            if (branded) {
              finalKeyword = normalizeGoogleAdsKeyword(branded) || keywordText
              wasBranded = true
              metadata = buildPlannerBrandRewriteMetadata(plannerUseCase)
              brandedFromGeneric++
              logger.debug(
                `      🔄 品牌化: “${keywordText}” (${kw.searchVolume}) → “${finalKeyword}”`
              )
            } else {
              // 品牌化失败（超过5词），跳过
              genericSkipped++
              continue
            }
          } else {
            // 低搜索量的非品牌词，跳过
            genericSkipped++
            continue
          }
        }

        const existing = allKeywords.get(finalKeyword)
        const isPureBrand = isPureBrandKeyword(finalKeyword, pureBrandKeywords)
        const matchType = isPureBrand ? 'EXACT' : 'PHRASE'
        const baseSourceType = isBrandRelated ? 'KEYWORD_PLANNER_BRAND' : metadata?.sourceType
        const baseSourceSubtype = isBrandRelated ? 'KEYWORD_PLANNER_BRAND' : metadata?.sourceSubtype
        const baseRawSource = metadata?.rawSource || 'KEYWORD_PLANNER'

        if (!existing) {
          allKeywords.set(finalKeyword, {
            keyword: finalKeyword,
            searchVolume: kw.searchVolume,
            competition: kw.competition,
            competitionIndex: kw.competitionIndex,
            lowTopPageBid: kw.lowTopPageBid,
            highTopPageBid: kw.highTopPageBid,
            source: wasBranded ? 'BRANDED_INDUSTRY_TERM' : 'KEYWORD_PLANNER',
            sourceType: baseSourceType,
            sourceSubtype: baseSourceSubtype,
            rawSource: baseRawSource,
            derivedTags: metadata?.derivedTags,
            matchType,
            isPureBrand,
            volumeUnavailableReason: (kw as any).volumeUnavailableReason,
          })
          newCount++
          if (!wasBranded) brandRelatedAdded++
        } else if (kw.searchVolume > (existing.searchVolume || 0)) {
          allKeywords.set(finalKeyword, {
            ...existing,
            searchVolume: kw.searchVolume,
            competition: kw.competition,
            competitionIndex: kw.competitionIndex,
            lowTopPageBid: kw.lowTopPageBid,
            highTopPageBid: kw.highTopPageBid,
            sourceType: existing.sourceType || baseSourceType,
            sourceSubtype: existing.sourceSubtype || baseSourceSubtype,
            rawSource: existing.rawSource || baseRawSource,
            derivedTags: mergeUniqueTags(existing.derivedTags, metadata?.derivedTags),
            matchType,
            isPureBrand,
            volumeUnavailableReason:
              (kw as any).volumeUnavailableReason || existing.volumeUnavailableReason,
            source: existing.source === 'BRAND_SEED' ? 'KEYWORD_PLANNER' : existing.source,
          })
          updatedCount++
        }
      }

      logger.debug(
        `      新增 ${newCount} 个关键词 (品牌相关: ${brandRelatedAdded}, 品牌化行业词: ${brandedFromGeneric}, 跳过: ${genericSkipped}, 更新: ${updatedCount})`
      )

      if (newCount === 0) {
        logger.debug(`      本轮未新增关键词，结束迭代`)
        break
      }

      // 准备下一轮种子词：始终包含纯品牌词，并优先使用高搜索量的品牌相关词
      const brandCandidates = Array.from(allKeywords.values())
        .filter((kw) => containsPureBrand(kw.keyword, pureBrandKeywords))
        .sort((a, b) => b.searchVolume - a.searchVolume)

      const nextSeedSet = new Set<string>()
      for (const token of plannerBrandKeywords) {
        if (nextSeedSet.size >= topN) break
        nextSeedSet.add(token)
      }
      for (const kw of brandCandidates) {
        if (nextSeedSet.size >= topN) break
        nextSeedSet.add(kw.keyword)
      }

      const nextSeeds = Array.from(nextSeedSet)
      if (nextSeeds.length === 0) {
        logger.debug(`      种子词为空，结束迭代`)
        break
      }

      const currentSeedSet = new Set(seedKeywords)
      const seedsUnchanged =
        currentSeedSet.size === nextSeedSet.size && nextSeeds.every((s) => currentSeedSet.has(s))

      seedKeywords = nextSeeds

      if (seedsUnchanged) {
        logger.debug(`      种子词未变化，结束迭代`)
        break
      }
    }

    logger.debug(`\n   📊 Keyword Planner 迭代完成: ${allKeywords.size} 个关键词`)

    // 查询品牌词的真实搜索量
    // 品牌词以 BRAND_SEED 来源初始化时 searchVolume=0，需要查询真实搜索量
    const brandSeedKeywords = Array.from(allKeywords.values()).filter(
      (kw) => kw.source === 'BRAND_SEED' && kw.searchVolume === 0
    )

    if (brandSeedKeywords.length > 0 && userId) {
      logger.debug(`\n   📊 查询 ${brandSeedKeywords.length} 个品牌词的真实搜索量...`)
      try {
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId: offer?.id,
          keywords: brandSeedKeywords.map((kw) => kw.keyword),
          country: targetCountry,
          language: targetLanguage,
          plannerSession,
          onProgress: progress
            ? (info: { message: string; current?: number; total?: number }) =>
                progress({
                  phase: 'seed-volume',
                  current: info.current,
                  total: info.total,
                  message: `品牌词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
                })
            : undefined,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const brandVolumes = volumeResult.volumes

        // 更新品牌词搜索量
        let updatedCount = 0
        for (const vol of brandVolumes) {
          const canonical = normalizeGoogleAdsKeyword(vol.keyword)
          if (canonical && allKeywords.has(canonical)) {
            const existing = allKeywords.get(canonical)!
            if (vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS') {
              volumeUnavailableFromPlanner = true
              if (plannerDecision) plannerDecision.volumeUnavailableFromPlanner = true
              allKeywords.set(canonical, {
                ...existing,
                volumeUnavailableReason: vol.volumeUnavailableReason,
              })
            }
            if (vol.avgMonthlySearches > 0) {
              allKeywords.set(canonical, {
                ...existing,
                searchVolume: vol.avgMonthlySearches,
                competition: vol.competition || existing.competition,
                competitionIndex: vol.competitionIndex || existing.competitionIndex,
                lowTopPageBid: vol.lowTopPageBid || existing.lowTopPageBid,
                highTopPageBid: vol.highTopPageBid || existing.highTopPageBid,
                volumeUnavailableReason:
                  vol.volumeUnavailableReason || existing.volumeUnavailableReason,
              })
              updatedCount++
            }
          }
        }
        logger.debug(`      ✅ 更新了 ${updatedCount}/${brandSeedKeywords.length} 个品牌词的搜索量`)
      } catch (error: any) {
        console.warn(`      ⚠️ 品牌词搜索量查询失败: ${error.message}`)
      }
    }

    if (!keywordPlannerReturned) {
      const fallbackExpanded = await expandFallback()
      if (fallbackExpanded.length > 0) {
        for (const kw of fallbackExpanded) {
          const canonical = normalizeGoogleAdsKeyword(kw.keyword)
          if (!canonical || allKeywords.has(canonical)) continue
          allKeywords.set(canonical, {
            ...kw,
            keyword: canonical,
          })
        }
      }
    }

    if (plannerDecision && volumeUnavailableFromPlanner) {
      plannerDecision.volumeUnavailableFromPlanner = true
    }

    const globalCandidates = await getGlobalKeywordCandidates({
      brandName,
      targetCountry,
      targetLanguage,
      category: offer?.category || category,
    })

    if (globalCandidates.length > 0) {
      const merged = mergeGlobalCandidates({
        allKeywords,
        candidates: globalCandidates,
        pureBrandKeywords,
        brandName,
      })
      logger.debug(`      📦 全局关键词库补充: 新增 ${merged.added}, 更新 ${merged.updated}`)
    }

    if (allKeywords.size === 0) {
      console.warn(
        `   ⚠️ Keyword Planner 未返回可用关键词，回退到初始关键词(${fallbackKeywords.length}个)`
      )
      return fallbackKeywords
    }

    // 质量过滤
    logger.debug(`\n   📊 质量过滤`)
    const filtered = qualityFilterOAuth(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry,
      targetLanguage,
      pageUrl
    )

    logger.debug(`   过滤后: ${filtered.length} 个关键词`)

    return filtered.length > 0 ? filtered : fallbackKeywords
  } catch (error: any) {
    console.error(`   ⚠️ OAuth模式关键词扩展失败: ${error.message}`)
    return expandFallback()
  }
}

export { expandForOAuth }
export type { OAuthExpandParams }
