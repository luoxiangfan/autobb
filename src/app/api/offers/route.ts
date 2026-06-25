import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { listOffers } from '@/lib/offers/server'
import { getDatabase } from '@/lib/db'
import { boolCondition } from '@/lib/db'
import { toNumber } from '@/lib/common/server'
import { apiCache, generateCacheKey, parseQueryBooleanParam } from '@/lib/common/server'
import { withPerformanceMonitoring } from '@/lib/common/server'
import { parsePositiveIntegerOfferIdList } from '@/lib/offers/server'
import { isOffersServerSortSupported } from '@/lib/offers/offers-list-sort'

/**
 * GET /api/offers
 * GET /api/offers?limit=10&offset=0&isActive=true&targetCountry=US&search=brand
 * 获取Offer列表
 */
const get = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const idsParam = searchParams.get('ids') // 批量查询特定ID的Offers
    const summary = searchParams.get('summary') === 'true' // Dashboard等轻量场景仅需概要统计
    const refresh = parseQueryBooleanParam(searchParams.get('refresh'))
    const noCache = parseQueryBooleanParam(searchParams.get('noCache'))
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined
    const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : undefined
    const limit =
      Number.isFinite(parsedLimit) && (parsedLimit as number) > 0 ? parsedLimit : undefined
    const offset =
      Number.isFinite(parsedOffset) && (parsedOffset as number) >= 0 ? parsedOffset : undefined
    const isActive =
      searchParams.get('isActive') === 'true'
        ? true
        : searchParams.get('isActive') === 'false'
          ? false
          : undefined
    const targetCountry = searchParams.get('targetCountry') || undefined
    const searchQuery = searchParams.get('search') || undefined
    const scrapeStatus = searchParams.get('scrapeStatus') || undefined
    const needsCompletion =
      searchParams.get('needsCompletion') === 'true'
        ? true
        : searchParams.get('needsCompletion') === 'false'
          ? false
          : undefined
    const hasAffiliateLink =
      searchParams.get('hasAffiliateLink') === 'true'
        ? true
        : searchParams.get('hasAffiliateLink') === 'false'
          ? false
          : undefined
    const requestedSortBy = searchParams.get('sortBy') || undefined
    const sortBy = isOffersServerSortSupported(requestedSortBy) ? requestedSortBy : undefined
    const sortOrderParam = searchParams.get('sortOrder')
    const sortOrder =
      sortOrderParam === 'asc' || sortOrderParam === 'desc' ? sortOrderParam : undefined

    // 如果提供了ids参数，直接查询特定的Offers（用于批量上传进度显示）
    if (idsParam) {
      const ids = parsePositiveIntegerOfferIdList(idsParam)

      if (ids.length === 0) {
        return NextResponse.json({ error: '无效的IDs参数' }, { status: 400 })
      }

      // 批量查询不使用缓存，确保获取最新状态
      const { offers } = await listOffers(userId, {
        ids, // 传递IDs参数
        limit: ids.length, // 限制返回数量
      })

      return NextResponse.json({
        success: true,
        offers: offers.map((offer) => ({
          id: offer.id,
          brand: offer.brand,
          scrapeStatus: offer.scrape_status,
          needsCompletion: offer.needs_completion,
          scrapeError: offer.scrape_error,
          affiliateLink: offer.affiliate_link,
          targetCountry: offer.target_country,
        })),
        total: offers.length,
      })
    }

    // Dashboard等场景：只需要概要统计，避免拉取完整Offer列表
    if (summary) {
      const db = await getDatabase()
      const userIdNum = userId
      const notDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'
      const isActiveCondition = boolCondition('is_active', true)

      const row = await db.queryOne<{
        total: number
        active: number
        pendingScrape: number
      }>(
        `
          SELECT
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN ${isActiveCondition} THEN 1 ELSE 0 END), 0) as active,
            COALESCE(SUM(CASE WHEN scrape_status = 'pending' THEN 1 ELSE 0 END), 0) as pendingScrape
          FROM offers
          WHERE user_id = ?
            AND ${notDeletedCondition}
        `,
        [userIdNum]
      )

      return NextResponse.json({
        success: true,
        summary: {
          total: toNumber(row?.total),
          active: toNumber(row?.active),
          pendingScrape: toNumber(row?.pendingScrape),
        },
      })
    }

    // 缓存键
    const cacheKey = generateCacheKey('offers', userId, {
      limit,
      offset,
      isActive,
      targetCountry,
      searchQuery,
      scrapeStatus,
      needsCompletion,
      hasAffiliateLink,
      sortBy: requestedSortBy,
      sortOrder,
    })

    const buildResult = async () => {
      const { offers, total } = await listOffers(userId, {
        limit,
        offset,
        isActive,
        targetCountry,
        searchQuery,
        scrapeStatus,
        needsCompletion,
        hasAffiliateLink,
        sortBy,
        sortOrder,
      })

      return {
        success: true,
        offers: offers.map((offer) => ({
          id: offer.id,
          url: offer.url,
          brand: offer.brand,
          category: offer.category,
          targetCountry: offer.target_country,
          affiliateLink: offer.affiliate_link,
          brandDescription: offer.brand_description,
          uniqueSellingPoints: offer.unique_selling_points,
          productHighlights: offer.product_highlights,
          targetAudience: offer.target_audience,
          // Final URL字段
          finalUrl: offer.final_url,
          finalUrlSuffix: offer.final_url_suffix,
          scrapeStatus: offer.scrape_status,
          needsCompletion: offer.needs_completion,
          scrapeError: offer.scrape_error,
          scrapedAt: offer.scraped_at,
          isActive: offer.is_active === true || offer.is_active === 1,
          createdAt: offer.created_at,
          updatedAt: offer.updated_at,
          // 新增字段（需求1和需求5）
          offerName: offer.offer_name,
          targetLanguage: offer.target_language,
          // 需求28：产品价格和佣金比例
          productPrice: offer.product_price,
          commissionPayout: offer.commission_payout,
          commissionType: offer.commission_type,
          commissionValue: offer.commission_value,
          commissionCurrency: offer.commission_currency,
          // P1-11: 关联的Google Ads账号
          linkedAccounts: offer.linked_accounts || [],
          // 黑名单标记
          isBlacklisted: offer.is_blacklisted || false,
          // 添加 campaignId 字段
          campaignId: offer.campaign_id || null,
          googleAdsCampaignId: offer.google_ads_campaign_id || null,
        })),
        total,
        limit,
        offset,
      }
    }

    if (!shouldBypassReadCache) {
      const result = await apiCache.getOrSet(cacheKey, buildResult, 2 * 60 * 1000)
      return NextResponse.json(result)
    }

    const result = await buildResult()
    if (shouldWriteCache) {
      apiCache.set(cacheKey, result, 2 * 60 * 1000)
    }
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('获取Offer列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Offer列表失败',
      },
      { status: 500 }
    )
  }
})

export const GET = withPerformanceMonitoring<any>(get as any, { path: '/api/offers' })
