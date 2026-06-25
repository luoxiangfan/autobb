import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  type PlatformProductStats,
  type ProductSortField,
  type ProductSortOrder,
} from '@/lib/affiliate/products'
import {
  buildProductListCacheHash,
  buildProductSummaryCacheHash,
  getCachedProductList,
  setCachedProductSummary,
  setLatestProductListQuery,
  setCachedProductList,
  parseCountryCodeQueryParam,
  parseNumericQueryParam,
  parseQueryBooleanParam,
  parseYmdSearchParam,
} from '@/lib/common/server'
import { repairOfferAffiliateLinksFromProducts } from '@/lib/offers/server'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/gateway/request-auth'

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'createdAt',
  'allowedCountries',
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'promoLink',
  'relatedOfferCount',
  'updatedAt',
  'recommendationScore', // 推荐指数排序
])

export const dynamic = 'force-dynamic'
const PRODUCT_PAGE_SIZE_MIN = 10
const PRODUCT_PAGE_SIZE_MAX = 1000

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const productManagementEnabled = await isProductManagementEnabledForUser(userId)
    if (!productManagementEnabled) {
      return NextResponse.json({ error: '商品管理功能未开启' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(
      PRODUCT_PAGE_SIZE_MAX,
      Math.max(PRODUCT_PAGE_SIZE_MIN, Number(searchParams.get('pageSize') || 20))
    )
    const search = (searchParams.get('search') || '').trim()
    const mid = (searchParams.get('mid') || '').trim()
    const sortByRaw = (searchParams.get('sortBy') || 'serial') as ProductSortField
    const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'
    const sortOrder =
      (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc'
        ? 'asc'
        : ('desc' as ProductSortOrder)
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

    const cachePayload = {
      page,
      pageSize,
      search,
      mid,
      sortBy,
      sortOrder,
      platform,
      landingPageType,
      targetCountry,
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
    const cacheHash = buildProductListCacheHash(cachePayload)
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
    await setLatestProductListQuery(userId, cachePayload)

    if (!shouldBypassReadCache) {
      const cached = await getCachedProductList<{
        success: true
        items: any[]
        total: number
        activeProductsCount: number
        invalidProductsCount: number
        syncMissingProductsCount: number
        unknownProductsCount: number
        blacklistedCount: number
        landingPageStats?: {
          productCount: number
          storeCount: number
          unknownCount: number
        }
        productsWithLinkCount: number
        platformStats: {
          yeahpromos: PlatformProductStats
          partnerboost: PlatformProductStats
        }
        page: number
        pageSize: number
      }>(userId, cacheHash)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const result = await listAffiliateProducts(userId, {
      page,
      pageSize,
      search,
      mid,
      sortBy,
      sortOrder,
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
      // 列表接口优先保证首屏速度；invalid 汇总由 /api/products/summary 完整计算。
      skipInvalidSummary: true,
      // 列表接口只做轻量统计，避免首屏被 landing page 分类重查询阻塞。
      fastSummary: true,
      lightweightSummary: true,
      // /products 列表分页与统计需基于全量准确结果，避免只显示首屏 pageSize 的近似总量。
      skipHeavySummary: false,
    })

    const listedProductIds = result.items
      .map((item: any) => Number(item?.id))
      .filter((id): id is number => Number.isInteger(id) && id > 0)
    if (listedProductIds.length > 0) {
      // 修复任务不影响本次列表展示，放到后台执行，避免阻塞筛选加载。
      void repairOfferAffiliateLinksFromProducts({
        userId,
        productIds: listedProductIds,
      }).catch((repairError: any) => {
        console.warn(
          `[GET /api/products] affiliate link repair skipped: ${repairError?.message || repairError}`
        )
      })
    }

    const responsePayload = {
      success: true as const,
      items: result.items,
      total: result.total,
      productsWithLinkCount: result.productsWithLinkCount,
      landingPageStats: result.landingPageStats,
      activeProductsCount: result.activeProductsCount,
      invalidProductsCount: result.invalidProductsCount,
      syncMissingProductsCount: result.syncMissingProductsCount,
      unknownProductsCount: result.unknownProductsCount,
      blacklistedCount: result.blacklistedCount,
      platformStats: result.platformStats,
      page: result.page,
      pageSize: result.pageSize,
    }

    if (shouldWriteCache) {
      await Promise.all([
        setCachedProductList(userId, cacheHash, responsePayload),
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
    console.error('[GET /api/products] failed:', error)
    return NextResponse.json({ error: error?.message || '获取商品列表失败' }, { status: 500 })
  }
})
