import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findAdCreativeById, findAdCreativesByOfferId } from '@/lib/ad-creative'
import { createLaunchScore, findLatestLaunchScore } from '@/lib/launch-scores'
import { calculateLaunchScore } from '@/lib/scoring'

/**
 * POST /api/offers/:id/launch-score
 * 计算指定Offer和Creative的Launch Score
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { creativeId } = body

    if (!creativeId) {
      return NextResponse.json(
        {
          error: '请指定要评分的创意ID',
        },
        { status: 400 }
      )
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Offer已完成抓取
    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再计算Launch Score',
        },
        { status: 400 }
      )
    }

    // 验证Creative存在且属于当前Offer
    const creative = await findAdCreativeById(creativeId, parseInt(userId, 10))

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    if (creative.offer_id !== offer.id) {
      return NextResponse.json(
        {
          error: '该创意不属于此Offer',
        },
        { status: 400 }
      )
    }

    // 使用AI计算Launch Score
    const analysis = await calculateLaunchScore(offer, creative, parseInt(userId, 10))

    // 保存到数据库 - 使用scoreAnalysis字段
    const launchScore = await createLaunchScore(parseInt(userId, 10), offer.id, analysis.scoreAnalysis)

    return NextResponse.json({
      success: true,
      launchScore,
      analysis,
    })
  } catch (error: any) {
    console.error('计算Launch Score失败:', error)

    return NextResponse.json(
      {
        error: error.message || '计算Launch Score失败',
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/offers/:id/launch-score
 * 获取Offer的最新Launch Score
 * 支持 ?autoCalculate=true 参数自动计算
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const { searchParams } = new URL(request.url)
    const autoCalculate = searchParams.get('autoCalculate') === 'true'

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 获取最新的Launch Score
    let launchScore = await findLatestLaunchScore(offer.id, parseInt(userId, 10))

    // 如果没有Launch Score且启用自动计算
    if (!launchScore && autoCalculate) {
      // 检查Offer是否已完成抓取
      if (offer.scrape_status !== 'completed') {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先完成产品信息抓取后再计算Launch Score',
          canAutoCalculate: false,
        })
      }

      // 查找该Offer的最新创意
      const creatives = await findAdCreativesByOfferId(offer.id, parseInt(userId, 10))
      if (creatives.length === 0) {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先生成广告创意后再计算Launch Score',
          canAutoCalculate: false,
        })
      }

      // 使用评分最高的创意自动计算
      const bestCreative = creatives.reduce((best: any, current: any) =>
        (current.score || 0) > (best.score || 0) ? current : best
      )

      // 计算Launch Score
      const analysis = await calculateLaunchScore(offer, bestCreative, parseInt(userId, 10))
      launchScore = await createLaunchScore(parseInt(userId, 10), offer.id, analysis.scoreAnalysis)

      return NextResponse.json({
        success: true,
        launchScore,
        autoCalculated: true,
        usedCreativeId: bestCreative.id,
      })
    }

    if (!launchScore) {
      // 检查是否可以自动计算
      const creatives = await findAdCreativesByOfferId(offer.id, parseInt(userId, 10))
      const canAutoCalculate = offer.scrape_status === 'completed' && creatives.length > 0

      return NextResponse.json({
        success: true,
        launchScore: null,
        message: '暂无Launch Score，请先计算',
        canAutoCalculate,
        hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
      })
    }

    return NextResponse.json({
      success: true,
      launchScore,
    })
  } catch (error: any) {
    console.error('获取Launch Score失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Launch Score失败',
      },
      { status: 500 }
    )
  }
}
