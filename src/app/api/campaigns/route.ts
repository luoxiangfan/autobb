import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import {
  createCampaign,
  findCampaignsByUserId,
  findCampaignsByOfferId,
} from '@/lib/campaign/server'
import { findOfferById } from '@/lib/offers/server'
import { findGoogleAdsAccountById } from '@/lib/google-ads/accounts/accounts'
import { invalidateOfferCache } from '@/lib/common/server'

/**
 * GET /api/campaigns?offerId=:id
 * 获取广告系列列表
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const { searchParams } = new URL(request.url)
    const offerIdParam = searchParams.get('offerId')
    const limitParam = searchParams.get('limit')

    let campaigns

    if (offerIdParam) {
      // 按Offer ID过滤
      const offerId = parseInt(offerIdParam, 10)
      if (isNaN(offerId)) {
        return NextResponse.json({ error: 'offerId必须是数字' }, { status: 400 })
      }

      campaigns = await findCampaignsByOfferId(offerId, userId)
    } else {
      // 获取用户的所有广告系列
      const limit = limitParam ? parseInt(limitParam, 10) : undefined
      campaigns = await findCampaignsByUserId(userId, limit)
    }

    return NextResponse.json({
      success: true,
      campaigns,
      count: campaigns.length,
    })
  } catch (error: any) {
    console.error('获取广告系列列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告系列列表失败',
      },
      { status: 500 }
    )
  }
})

/**
 * POST /api/campaigns
 * 创建广告系列
 */
export const POST = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const body = await request.json()
    const {
      offerId,
      googleAdsAccountId,
      campaignName,
      budgetAmount,
      budgetType,
      targetCpa,
      maxCpc,
      status,
      startDate,
      endDate,
    } = body

    // 验证必填字段
    if (!offerId || !googleAdsAccountId || !campaignName || !budgetAmount) {
      return NextResponse.json(
        {
          error: '缺少必填字段：offerId, googleAdsAccountId, campaignName, budgetAmount',
        },
        { status: 400 }
      )
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Google Ads账号存在且属于当前用户
    const googleAdsAccount = await findGoogleAdsAccountById(googleAdsAccountId, userId)
    if (!googleAdsAccount) {
      return NextResponse.json(
        {
          error: 'Google Ads账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 创建广告系列
    const campaign = await createCampaign({
      userId: userId,
      offerId,
      googleAdsAccountId,
      campaignName,
      budgetAmount,
      budgetType,
      targetCpa,
      maxCpc,
      status,
      startDate,
      endDate,
    })

    invalidateOfferCache(userId, offerId)

    return NextResponse.json({
      success: true,
      campaign,
    })
  } catch (error: any) {
    console.error('创建广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '创建广告系列失败',
      },
      { status: 500 }
    )
  }
})
