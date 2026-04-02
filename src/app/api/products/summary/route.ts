import { NextRequest, NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  type ProductListOptions,
} from '@/lib/affiliate-products'
import { getDatabase } from '@/lib/db'
import {
  buildProductSummaryCacheHash,
  buildProductSummaryRouteCacheHash,
  setCachedProductSummary,
  getCachedProductSummaryRoute,
  setCachedProductSummaryRoute,
  type ProductSummaryRouteCachePayload,
} from '@/lib/products-cache'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

function parseNumericFilter(searchParams: URLSearchParams, key: string): number | null {
  const raw = (searchParams.get(key) || '').trim()
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function parseDateFilter(searchParams: URLSearchParams, key: string): string | null {
  const raw = (searchParams.get(key) || '').trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null

  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.toISOString().slice(0, 10) !== raw) return null
  return raw
}

function parseCountryFilter(searchParams: URLSearchParams, key: string): string {
  const raw = (searchParams.get(key) || '').trim().toUpperCase()
  if (!raw || raw === 'ALL') return 'all'
  if (!/^[A-Z]{2,3}$/.test(raw)) return 'all'
  return raw
}

function parseBooleanParam(value: string | null): boolean {
  if (value === null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

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

export async function GET(request: NextRequest) {
  try {
    const userIdRaw = request.headers.get('x-user-id')
    if (!userIdRaw) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const userId = Number(userIdRaw)
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const search = (searchParams.get('search') || '').trim()
    const mid = (searchParams.get('mid') || '').trim()
    const platform = normalizeAffiliatePlatform(searchParams.get('platform')) || 'all'
    const landingPageType = normalizeAffiliateLandingPageTypeFilter(searchParams.get('landingPageType'))
    const targetCountry = parseCountryFilter(searchParams, 'targetCountry')
    const status = normalizeAffiliateProductStatusFilter(searchParams.get('status'))

    const reviewCountMin = parseNumericFilter(searchParams, 'reviewCountMin')
    const reviewCountMax = parseNumericFilter(searchParams, 'reviewCountMax')
    const priceAmountMin = parseNumericFilter(searchParams, 'priceAmountMin')
    const priceAmountMax = parseNumericFilter(searchParams, 'priceAmountMax')
    const commissionRateMin = parseNumericFilter(searchParams, 'commissionRateMin')
    const commissionRateMax = parseNumericFilter(searchParams, 'commissionRateMax')
    const commissionAmountMin = parseNumericFilter(searchParams, 'commissionAmountMin')
    const commissionAmountMax = parseNumericFilter(searchParams, 'commissionAmountMax')
    const recommendationScoreMin = parseNumericFilter(searchParams, 'recommendationScoreMin')
    const recommendationScoreMax = parseNumericFilter(searchParams, 'recommendationScoreMax')
    const createdAtFrom = parseDateFilter(searchParams, 'createdAtFrom')
    const createdAtTo = parseDateFilter(searchParams, 'createdAtTo')
    const refresh = parseBooleanParam(searchParams.get('refresh'))
    const noCache = parseBooleanParam(searchParams.get('noCache'))
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
      const cached = await getCachedProductSummaryRoute<ProductSummaryResponsePayload>(userId, summaryRouteCacheHash)
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
    const effectiveRecommendationScoreMin = recommendationScoreMin === null
      ? 1
      : Math.max(1, recommendationScoreMin)
    const db = await getDatabase()
    const scoreStillValidSql = db.type === 'postgres'
      ? `(p.score_calculated_at >= (NOW() - INTERVAL '${PRODUCT_SCORE_VALIDITY_DAYS} days'))`
      : `(datetime(p.score_calculated_at) >= datetime('now', '-${PRODUCT_SCORE_VALIDITY_DAYS} days'))`

    const hasScopedFilters = (
      search.length > 0
      || mid.length > 0
      || platform !== 'all'
      || landingPageType !== 'all'
      || targetCountry !== 'all'
      || status !== 'all'
      || reviewCountMin !== null
      || reviewCountMax !== null
      || priceAmountMin !== null
      || priceAmountMax !== null
      || commissionRateMin !== null
      || commissionRateMax !== null
      || commissionAmountMin !== null
      || commissionAmountMax !== null
      || recommendationScoreMin !== null
      || recommendationScoreMax !== null
      || createdAtFrom !== null
      || createdAtTo !== null
    )

    const recommendationEffectiveCountPromise: Promise<number> = (() => {
      if (db.type === 'postgres' && !hasScopedFilters) {
        return db.queryOne<{ effective_count: number }>(
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
        ).then((row) => Number(row?.effective_count || 0))
      }

      return listAffiliateProducts(userId, {
        ...baseListOptions,
        recommendationScoreMin: effectiveRecommendationScoreMin,
        recommendationScoreFreshOnly: true,
      }).then((recommendationScoreResult) => Number(recommendationScoreResult.total || 0))
    })()

    const [result, recommendationEffectiveCount, recommendationScoreTimestampRow] = await Promise.all([
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
    return NextResponse.json(
      { error: error?.message || '获取商品统计失败' },
      { status: 500 }
    )
  }
}
