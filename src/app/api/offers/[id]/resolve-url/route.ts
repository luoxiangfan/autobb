import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { resolveAffiliateLink } from '@/lib/scraping'
import {
  findOfferById,
  initializeProxyPool,
  parsePositiveIntegerOfferId,
} from '@/lib/offers/server'

/**
 * POST /api/offers/:id/resolve-url
 * 解析Offer的推广链接，获取Final URL和Final URL suffix
 */
export const POST = withAuth(async (request, user, context) => {
  try {
    const offerId = parsePositiveIntegerOfferId(context?.params?.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const userId = user.userId

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, userId)

    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
    }

    const targetCountry = offer.target_country || 'US'

    try {
      await initializeProxyPool(userId, targetCountry)
    } catch (error: any) {
      if (error?.code === 'PROXY_NOT_CONFIGURED') {
        return NextResponse.json({ error: '未配置代理，无法解析推广链接' }, { status: 400 })
      }
      throw error
    }

    if (!offer.affiliate_link) {
      return NextResponse.json({ error: 'Offer没有配置推广链接' }, { status: 400 })
    }

    console.log(`解析推广链接: ${offer.affiliate_link}`)
    console.log(`目标国家: ${targetCountry}`)
    console.log(`🔥 强制跳过缓存，确保获取最新重定向数据`)

    const resolved = await resolveAffiliateLink(offer.affiliate_link, {
      targetCountry,
      userId: userId,
      skipCache: true,
    })

    return NextResponse.json({
      success: true,
      data: {
        offerId: offer.id,
        offerName: offer.offer_name,
        affiliateLink: offer.affiliate_link,
        finalUrl: resolved.finalUrl,
        finalUrlSuffix: resolved.finalUrlSuffix,
        redirectCount: resolved.redirectCount,
        redirectChain: resolved.redirectChain,
        proxyUsed: resolved.proxyUsed,
        method: resolved.resolveMethod,
        pageTitle: resolved.pageTitle || null,
      },
    })
  } catch (error: any) {
    console.error('解析URL失败:', error)

    return NextResponse.json(
      {
        error: error.message || '解析URL失败',
        details: error.stack || '',
      },
      { status: 500 }
    )
  }
})
