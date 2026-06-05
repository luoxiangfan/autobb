/**
 * POST /api/offers/extract — 创建新建 Offer 提取任务（入队 offer-extraction）
 */

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { createOfferExtractionTaskForNewOffer } from '@/lib/offer-extraction-task'
import { OfferExtractRequestError, parseNewOfferExtractRequest } from '@/lib/offer-extract-request'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const parentRequestId = req.headers.get('x-request-id') || undefined

  try {
    const authResult = await verifyAuth(req)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized', message: '请先登录' }, { status: 401 })
    }
    const userIdNum = authResult.user.userId

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request', message: '请求体必须是有效的 JSON' },
        { status: 400 }
      )
    }

    const parsed = parseNewOfferExtractRequest(rawBody)

    const taskId = await createOfferExtractionTaskForNewOffer({
      userId: userIdNum,
      affiliateLink: parsed.affiliateLink,
      targetCountry: parsed.targetCountry,
      productPrice: parsed.productPrice,
      commissionPayout: parsed.commissionPayout,
      commissionType: parsed.commissionType,
      commissionValue: parsed.commissionValue,
      commissionCurrency: parsed.commissionCurrency,
      brandName: parsed.brandName,
      pageType: parsed.pageType,
      storeProductLinks: parsed.storeProductLinks,
      skipCache: parsed.skipCache,
      skipWarmup: parsed.skipWarmup,
      extractionMode: parsed.extractionMode,
      parentRequestId,
      priority: 'normal',
      maxRetries: 2,
    })

    return NextResponse.json({
      success: true,
      taskId,
      message: '任务已创建，开始处理',
    })
  } catch (error: unknown) {
    if (error instanceof OfferExtractRequestError) {
      return NextResponse.json(
        { error: 'Invalid request', message: error.message },
        { status: error.status }
      )
    }

    console.error('❌ Create offer extraction task failed:', error)
    const message = error instanceof Error ? error.message : '创建任务失败'

    if (message.includes('队列已满')) {
      return NextResponse.json(
        { error: '系统繁忙', message: '系统繁忙，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 })
  }
}
