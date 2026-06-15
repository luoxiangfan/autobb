import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { resolveAffiliateLink, getProxyPool } from '@/lib/scraping' // 🔥 使用新的增强版API
import { findOfferById } from '@/lib/offers'
import { getAllProxyUrls } from '@/lib/common'
import { parsePositiveIntegerOfferId } from '@/lib/offers'

/**
 * POST /api/offers/:id/resolve-url
 * 解析Offer的推广链接，获取Final URL和Final URL suffix
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, userId)

    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
    }

    // 🔥 加载代理池配置（使用新的增强版API）
    const userIdNum = userId
    const targetCountry = offer.target_country || 'US'

    const proxySettings = await getAllProxyUrls(userIdNum)
    if (!proxySettings || proxySettings.length === 0) {
      return NextResponse.json({ error: '未配置代理，无法解析推广链接' }, { status: 400 })
    }

    // 加载代理到代理池
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p: any, index: number) => ({
      url: p.url,
      country: p.country,
      is_default: index === proxySettings.length - 1, // 最后一个作为默认代理
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    if (!offer.affiliate_link) {
      return NextResponse.json({ error: 'Offer没有配置推广链接' }, { status: 400 })
    }

    console.log(`解析推广链接: ${offer.affiliate_link}`)
    console.log(`目标国家: ${targetCountry}`)
    console.log(`🔥 强制跳过缓存，确保获取最新重定向数据`)

    // 🔥 使用新的增强版API，强制skipCache确保获取最新数据
    const resolved = await resolveAffiliateLink(offer.affiliate_link, {
      targetCountry,
      userId: userId,
      skipCache: true, // 🔥 关键：强制跳过缓存
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
        method: resolved.resolveMethod, // 'http' or 'playwright' or 'cache'
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
}
