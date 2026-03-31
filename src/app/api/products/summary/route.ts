import { NextRequest, NextResponse } from 'next/server'
import {
  listAffiliateProducts,
  normalizeAffiliateLandingPageTypeFilter,
  normalizeAffiliatePlatform,
  normalizeAffiliateProductStatusFilter,
} from '@/lib/affiliate-products'
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

export const dynamic = 'force-dynamic'

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

    const result = await listAffiliateProducts(userId, {
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
    })

    return NextResponse.json({
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
    })
  } catch (error: any) {
    console.error('[GET /api/products/summary] failed:', error)
    return NextResponse.json(
      { error: error?.message || '获取商品统计失败' },
      { status: 500 }
    )
  }
}
