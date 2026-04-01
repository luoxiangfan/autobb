import { NextRequest, NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
  type PlatformProductStats,
  type ProductSortField,
  type ProductSortOrder,
} from '@/lib/affiliate-products'
import {
  buildProductListCacheHash,
  getCachedProductList,
  setLatestProductListQuery,
  setCachedProductList,
} from '@/lib/products-cache'
import { repairOfferAffiliateLinksFromProducts } from '@/lib/offer-affiliate-link-repair'
import { isProductManagementEnabledForUser } from '@/lib/openclaw/request-auth'

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
  'recommendationScore', // 新增: 推荐指数排序
])

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
const PRODUCT_PAGE_SIZE_MIN = 10
const PRODUCT_PAGE_SIZE_MAX = 1000

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
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const pageSize = Math.min(
      PRODUCT_PAGE_SIZE_MAX,
      Math.max(PRODUCT_PAGE_SIZE_MIN, Number(searchParams.get('pageSize') || 20))
    )
    const search = (searchParams.get('search') || '').trim()
    const mid = (searchParams.get('mid') || '').trim()
    const sortByRaw = (searchParams.get('sortBy') || 'serial') as ProductSortField
    const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'
    const sortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc'
      ? 'asc'
      : 'desc' as ProductSortOrder
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
    })

    const listedProductIds = result.items
      .map((item: any) => Number(item?.id))
      .filter((id): id is number => Number.isInteger(id) && id > 0)
    if (listedProductIds.length > 0) {
      try {
        await repairOfferAffiliateLinksFromProducts({
          userId,
          productIds: listedProductIds,
        })
      } catch (repairError: any) {
        console.warn(`[GET /api/products] affiliate link repair skipped: ${repairError?.message || repairError}`)
      }
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
      await setCachedProductList(userId, cacheHash, responsePayload)
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('[GET /api/products] failed:', error)
    return NextResponse.json(
      { error: error?.message || '获取商品列表失败' },
      { status: 500 }
    )
  }
}
