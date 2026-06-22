import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { findOfferById, deleteOffer } from '@/lib/offers/server'
import { invalidateOfferCache } from '@/lib/common/server'
import { mapOfferToGetResponse } from '@/lib/offers/offer-display-mapper'
import { applyOfferUpdateFromBody, mapOfferToPutResponse } from '@/lib/offers/server'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

/**
 * GET /api/offers/:id
 * 获取单个Offer
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user, context) => {
  try {
    const offerId = parsePositiveIntegerOfferId(context?.params?.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const offer = await findOfferById(offerId, userId)

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      offer: mapOfferToGetResponse(offer),
    })
  } catch (error: any) {
    console.error('获取Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Offer失败',
      },
      { status: 500 }
    )
  }
})

/**
 * PUT /api/offers/:id
 * 更新Offer
 */
export const PUT = withAuth(async (request, user, context) => {
  try {
    const offerId = parsePositiveIntegerOfferId(context?.params?.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const userId = user.userId

    const userIdNum = userId
    const body = await request.json()

    const applyResult = await applyOfferUpdateFromBody(offerId, userIdNum, body)
    if ('error' in applyResult) {
      return NextResponse.json(
        {
          error: applyResult.error,
          ...(applyResult.status === 400 ? { details: applyResult.error } : {}),
        },
        { status: applyResult.status }
      )
    }

    return NextResponse.json({
      success: true,
      offer: mapOfferToPutResponse(applyResult.offer),
    })
  } catch (error: any) {
    console.error('更新Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新Offer失败',
      },
      { status: 500 }
    )
  }
})

/**
 * DELETE /api/offers/:id
 * 删除Offer
 *
 * Query参数：
 * - autoUnlink: boolean (可选) - 是否自动解除关联，默认false
 */
export const DELETE = withAuth(async (request, user, context) => {
  try {
    const offerId = parsePositiveIntegerOfferId(context?.params?.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const userId = user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const autoUnlink = searchParams.get('autoUnlink') === 'true'
    const removeGoogleAdsCampaigns = searchParams.get('removeGoogleAdsCampaigns') === 'true'

    // 执行删除操作
    const result = await deleteOffer(offerId, userId, autoUnlink, removeGoogleAdsCampaigns)

    // 使缓存失效
    invalidateOfferCache(userId, offerId)

    // 如果有关联账号且未自动解除，返回409状态码和详情
    if (!result.success && result.hasLinkedAccounts) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          hasLinkedAccounts: true,
          linkedAccounts: result.linkedAccounts,
          accountCount: result.accountCount,
          campaignCount: result.campaignCount,
        },
        { status: 409 } // 409 Conflict: 资源冲突，需要用户确认
      )
    }

    // 删除成功
    return NextResponse.json({
      success: true,
      message: result.message,
    })
  } catch (error: any) {
    console.error('删除Offer失败:', error)

    // 区分不同类型的错误，返回合适的HTTP状态码
    const errorMessage = error.message || '删除Offer失败'

    // 资源不存在或权限错误
    if (errorMessage.includes('Offer不存在或无权访问')) {
      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 404 } // 404 Not Found
      )
    }

    // 其他未知错误，视为服务器内部错误
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 }
    )
  }
})
