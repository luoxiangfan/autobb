import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  type ProductListOptions,
} from '@/lib/affiliate/products'
import { getDatabase } from '@/lib/db'
import {
  buildProductSummaryCacheHash,
  buildProductSummaryRouteCacheHash,
  setCachedProductSummary,
  getCachedProductSummaryRoute,
  setCachedProductSummaryRoute,
  type ProductSummaryRouteCachePayload,
  parseCountryCodeQueryParam,
  parseNumericQueryParam,
  parseQueryBooleanParam,
  parseYmdSearchParam,
} from '@/lib/common/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

export const dynamic = 'force-dynamic'
const PRODUCT_SCORE_VALIDITY_DAYS = 30
const POSTGRES_RECOMMENDATION_COUNT_STATEMENT_TIMEOUT_MS = 15000
const POSTGRES_RECOMMENDATION_COUNT_MAX_PARALLEL = 8

type ProductSummaryResponsePayload = {
  success: true
  total: number
  landingPageStats: unknown
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
  platformStats: unknown
  recommendationScoreSummary: {
    effectiveCount: number
    lastCalculatedAt: string | null
  }
}

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const search = (searchParams.get('search') || '').trim()
    const mid = (searchParams.get('mid') || '').trim()
    const platform = normalizeAffiliatePlatform(searchParams.get('platform')) || 'all'
    const landingPageType = normalizeAffiliateLandingPageTypeFilter(
      searchParams.get('landingPageType')
    )
    const targetCountry = parseCountryCodeQueryParam(searchParams, 'targetCountry')
    const status = normalizeAffiliateProductStatusFilter(searchParams.get('status'))

    const reviewCountMin = parseNumericQueryParam(searchParams, 'reviewCountMin')
    const reviewCountMax = parseNumericQueryParam(searchParams, 'reviewCountMax')
    const priceAmountMin = parseNumericQueryParam(searchParams, 'priceAmountMin')
    const priceAmountMax = parseNumericQueryParam(searchParams, 'priceAmountMax')
    const commissionRateMin = parseNumericQueryParam(searchParams, 'commissionRateMin')
    const commissionRateMax = parseNumericQueryParam(searchParams, 'commissionRateMax')
    const commissionAmountMin = parseNumericQueryParam(searchParams, 'commissionAmountMin')
    const commissionAmountMax = parseNumericQueryParam(searchParams, 'commissionAmountMax')
    const recommendationScoreMin = parseNumericQueryParam(searchParams, 'recommendationScoreMin')
    const recommendationScoreMax = parseNumericQueryParam(searchParams, 'recommendationScoreMax')
    const createdAtFrom = parseYmdSearchParam(searchParams, 'createdAtFrom')
    const createdAtTo = parseYmdSearchParam(searchParams, 'createdAtTo')
    const refresh = parseQueryBooleanParam(searchParams.get('refresh'))
    const noCache = parseQueryBooleanParam(searchParams.get('noCache'))
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache

    const summaryRouteCachePayload: ProductSummaryRouteCachePayload = {
      search,
      mid,
      platform,
      targetCountry,
      landingPageType,
      status,
      reviewCountMin,
      reviewCountMax,
      priceAmountMin,
      priceAmountMax,
      commissionRateMin,
      commissionRateMax,
      commissionAmountMin,
      commissionAmountMax,
      recommendationScoreMin,
      recommendationScoreMax,
      createdAtFrom,
      createdAtTo,
    }
    const summaryRouteCacheHash = buildProductSummaryRouteCacheHash(summaryRouteCachePayload)
    const summaryCacheHash = buildProductSummaryCacheHash({
      search: search.toLowerCase(),
      mid: mid.toLowerCase(),
      platform,
      targetCountry,
      landingPageType,
      status,
      reviewCountMin,
      reviewCountMax,
      priceAmountMin,
      priceAmountMax,
      commissionRateMin,
      commissionRateMax,
      commissionAmountMin,
      commissionAmountMax,
      recommendationScoreMin,
      recommendationScoreMax,
      createdAtFrom,
      createdAtTo,
    })

    if (!shouldBypassReadCache) {
      const cached = await getCachedProductSummaryRoute<ProductSummaryResponsePayload>(
        userId,
        summaryRouteCacheHash
      )
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const baseListOptions: ProductListOptions = {
      page: 1,
      pageSize: 10,
      search,
      mid,
      platform,
      landingPageType,
      targetCountry: targetCountry === 'all' ? undefined : targetCountry,
      status,
      reviewCountMin: reviewCountMin ?? undefined,
      reviewCountMax: reviewCountMax ?? undefined,
      priceAmountMin: priceAmountMin ?? undefined,
      priceAmountMax: priceAmountMax ?? undefined,
      commissionRateMin: commissionRateMin ?? undefined,
      commissionRateMax: commissionRateMax ?? undefined,
      commissionAmountMin: commissionAmountMin ?? undefined,
      commissionAmountMax: commissionAmountMax ?? undefined,
      recommendationScoreMin: recommendationScoreMin ?? undefined,
      recommendationScoreMax: recommendationScoreMax ?? undefined,
      createdAtFrom: createdAtFrom ?? undefined,
      createdAtTo: createdAtTo ?? undefined,
      skipItems: true,
      // summary 仅用于页面头部统计，优先快速返回，避免重统计阻塞首屏体验。
      fastSummary: true,
      // summary 场景优先稳定与可用性，避免 URL 模式分类聚合导致慢查询。
      lightweightSummary: true,
    }
    const effectiveRecommendationScoreMin =
      recommendationScoreMin === null ? 1 : Math.max(1, recommendationScoreMin)
    const effectiveRecommendationScoreMax =
      recommendationScoreMax === null ? null : recommendationScoreMax
    const db = await getDatabase()
    const scoreStillValidSql = `(p.score_calculated_at >= (NOW() - INTERVAL '${PRODUCT_SCORE_VALIDITY_DAYS} days'))`

    const hasScopedFilters =
      search.length > 0 ||
      mid.length > 0 ||
      platform !== 'all' ||
      landingPageType !== 'all' ||
      targetCountry !== 'all' ||
      status !== 'all' ||
      reviewCountMin !== null ||
      reviewCountMax !== null ||
      priceAmountMin !== null ||
      priceAmountMax !== null ||
      commissionRateMin !== null ||
      commissionRateMax !== null ||
      commissionAmountMin !== null ||
      commissionAmountMax !== null ||
      recommendationScoreMin !== null ||
      recommendationScoreMax !== null ||
      createdAtFrom !== null ||
      createdAtTo !== null

    const recommendationEffectiveCountPromise: Promise<number> = (() => {
      if (effectiveRecommendationScoreMax !== null && effectiveRecommendationScoreMax < 1) {
        return Promise.resolve(0)
      }

      if (!hasScopedFilters) {
        return db
          .queryOne<{ effective_count: number }>(
            `
            WITH __cfg AS (
              SELECT
                set_config('enable_seqscan', 'off', true) AS enable_seqscan_cfg,
                set_config('max_parallel_workers_per_gather', '${POSTGRES_RECOMMENDATION_COUNT_MAX_PARALLEL}', true) AS parallel_cfg,
                set_config('statement_timeout', '${POSTGRES_RECOMMENDATION_COUNT_STATEMENT_TIMEOUT_MS}', true) AS statement_timeout_cfg
            )
            SELECT COUNT(*) AS effective_count
            FROM affiliate_products p
            CROSS JOIN __cfg
            WHERE p.user_id = ?
              AND p.recommendation_score IS NOT NULL
              AND p.recommendation_score >= ?
              AND p.score_calculated_at IS NOT NULL
              AND ${scoreStillValidSql}
          `,
            [userId, effectiveRecommendationScoreMin]
          )
          .then((row) => Number(row?.effective_count || 0))
      }

      return listAffiliateProducts(userId, {
        ...baseListOptions,
        recommendationScoreMin: effectiveRecommendationScoreMin,
        recommendationScoreMax: effectiveRecommendationScoreMax ?? undefined,
        recommendationScoreFreshOnly: true,
      }).then((recommendationScoreResult) => Number(recommendationScoreResult.total || 0))
    })()

    const [result, recommendationEffectiveCount, recommendationScoreTimestampRow] =
      await Promise.all([
        listAffiliateProducts(userId, baseListOptions),
        recommendationEffectiveCountPromise,
        db.queryOne<{ last_score_calculated_at: string | null }>(
          `
          SELECT MAX(p.score_calculated_at) AS last_score_calculated_at
          FROM affiliate_products p
          WHERE p.user_id = ?
            AND p.recommendation_score IS NOT NULL
            AND p.score_calculated_at IS NOT NULL
        `,
          [userId]
        ),
      ])

    const responsePayload: ProductSummaryResponsePayload = {
      success: true,
      total: result.total,
      productsWithLinkCount: result.productsWithLinkCount,
      landingPageStats: result.landingPageStats,
      activeProductsCount: result.activeProductsCount,
      invalidProductsCount: result.invalidProductsCount,
      syncMissingProductsCount: result.syncMissingProductsCount,
      unknownProductsCount: result.unknownProductsCount,
      blacklistedCount: result.blacklistedCount,
      platformStats: result.platformStats,
      recommendationScoreSummary: {
        effectiveCount: recommendationEffectiveCount,
        lastCalculatedAt: recommendationScoreTimestampRow?.last_score_calculated_at || null,
      },
    }

    if (shouldWriteCache) {
      await Promise.all([
        setCachedProductSummaryRoute(userId, summaryRouteCacheHash, responsePayload),
        setCachedProductSummary(userId, summaryCacheHash, {
          total: result.total,
          productsWithLinkCount: result.productsWithLinkCount,
          activeProductsCount: result.activeProductsCount,
          invalidProductsCount: result.invalidProductsCount,
          syncMissingProductsCount: result.syncMissingProductsCount,
          unknownProductsCount: result.unknownProductsCount,
          blacklistedCount: result.blacklistedCount,
          landingPageStats: result.landingPageStats,
          platformStats: result.platformStats,
        }),
      ])
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('[GET /api/products/summary] failed:', error)
    return NextResponse.json({ error: error?.message || '获取商品统计失败' }, { status: 500 })
  }
})
