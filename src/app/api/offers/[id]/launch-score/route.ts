import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import {
  findAdCreativeById,
  findAdCreativesByOfferId,
  type AdCreative,
} from '@/lib/ad-creative'
import {
  findLatestLaunchScore,
  parseLaunchScoreAnalysis,
  resolveLaunchScoreForCreativeCompare,
} from '@/lib/launch-scores'
import {
  findCachedLaunchScoreForCreative,
  saveLaunchScoreWithContentCache,
} from '@/lib/launch-score-cache'
import { calculateLaunchScore } from '@/lib/scoring'
import { parsePositiveIntegerId, parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

/**
 * POST /api/offers/:id/launch-score
 * 计算指定Offer和Creative的Launch Score
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const body = await request.json()
    const parsedCreativeId = parsePositiveIntegerId(body.creativeId)

    if (!parsedCreativeId) {
      return NextResponse.json(
        {
          error: '请指定有效的创意ID',
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
    const creative = await findAdCreativeById(parsedCreativeId, userId)

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

    const cached = await findCachedLaunchScoreForCreative(creative, offer, userId)
    if (cached) {
      const scoreAnalysis = parseLaunchScoreAnalysis(cached)
      return NextResponse.json({
        success: true,
        launchScore: cached,
        analysis: scoreAnalysis,
        fromCache: true,
      })
    }

    const analysis = await calculateLaunchScore(offer, creative, userId)
    const { launchScore } = await saveLaunchScoreWithContentCache(
      userId,
      offer.id,
      creative,
      offer,
      analysis.scoreAnalysis
    )

    return NextResponse.json({
      success: true,
      launchScore,
      analysis: analysis.scoreAnalysis,
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
    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }
    const { searchParams } = new URL(request.url)
    const autoCalculate = searchParams.get('autoCalculate') === 'true'
    const queryCreativeId = parsePositiveIntegerId(searchParams.get('creativeId'))

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

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

    let queryCreative: AdCreative | null = null
    if (queryCreativeId != null) {
      queryCreative = await findAdCreativeById(queryCreativeId, userId)
      if (!queryCreative || queryCreative.offer_id !== offer.id) {
        return NextResponse.json(
          { error: '创意不存在或无权访问' },
          { status: 404 }
        )
      }
    }

    let launchScore = queryCreativeId
      ? (
          await resolveLaunchScoreForCreativeCompare(
            queryCreativeId,
            userId,
            await findLatestLaunchScore(offer.id, userId),
            1
          )
        ).score
      : await findLatestLaunchScore(offer.id, userId)

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
      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      if (creatives.length === 0) {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先生成广告创意后再计算Launch Score',
          canAutoCalculate: false,
        })
      }

      const targetCreative =
        queryCreative ??
        creatives.reduce((best: any, current: any) =>
          (current.score || 0) > (best.score || 0) ? current : best
        )

      const cached = await findCachedLaunchScoreForCreative(targetCreative, offer, userId)
      if (cached) {
        launchScore = cached
      } else {
        const analysis = await calculateLaunchScore(offer, targetCreative, userId)
        const saved = await saveLaunchScoreWithContentCache(
          userId,
          offer.id,
          targetCreative,
          offer,
          analysis.scoreAnalysis
        )
        launchScore = saved.launchScore
      }

      return NextResponse.json({
        success: true,
        launchScore,
        autoCalculated: true,
        usedCreativeId: targetCreative.id,
      })
    }

    if (!launchScore) {
      // 检查是否可以自动计算
      const creatives = await findAdCreativesByOfferId(offer.id, userId)
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
