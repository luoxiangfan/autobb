/**
 * Creative合规性检查API
 * POST /api/creatives/:id/check-compliance
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findAdCreativeById } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'
import { checkCompliance, type CreativeContent } from '@/lib/compliance-checker'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const creativeId = parseInt(params.id)
    if (isNaN(creativeId)) {
      return NextResponse.json(
        { error: 'Invalid creative ID' },
        { status: 400 }
      )
    }

    // 获取Creative信息
    const creative = await findAdCreativeById(creativeId, auth.user!.userId)
    if (!creative) {
      return NextResponse.json(
        { error: 'Creative not found' },
        { status: 404 }
      )
    }

    // 获取Offer信息（用于品牌名）
    const offer = await findOfferById(creative.offer_id, auth.user!.userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Associated offer not found' },
        { status: 404 }
      )
    }

    // 构建检查内容
    const content: CreativeContent = {
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      finalUrl: creative.final_url,
      brandName: offer.brand
    }

    // 执行合规性检查
    const result = checkCompliance(content)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Compliance check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
