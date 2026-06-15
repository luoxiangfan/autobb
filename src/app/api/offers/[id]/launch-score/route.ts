import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findAdCreativeById, findAdCreativesByOfferId, type AdCreative } from '@/lib/creatives'
import { buildLaunchScorePerformanceApiPayload } from '@/lib/launch-score'
import { parseLaunchScoreAnalysis } from '@/lib/launch-score'
import {
  ensureLaunchScoreForCreative,
  pickBestCreativeForLaunchScoreRead,
  resolveLaunchScoreGetForCreative,
} from '@/lib/launch-score/launch-score-cache'
import {
  parseLaunchScoreHashCampaignConfig,
  parseLaunchScoreHashCampaignConfigFromSearchParams,
} from '@/lib/launch-score'
import { parsePositiveIntegerId, parsePositiveIntegerOfferId } from '@/lib/offers'

/**
 * POST /api/offers/:id/launch-score
 * 计算指定Offer和Creative的Launch Score
 *
 * Body 可选 campaignConfig、includePerformance、daysBack、avgOrderValue
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

    const body = await request.json()
    const hashCampaignConfig = parseLaunchScoreHashCampaignConfig(body.campaignConfig)
    const parsedCreativeId = parsePositiveIntegerId(body.creativeId)

    if (!parsedCreativeId) {
      return NextResponse.json(
        {
          error: '请指定有效的创意ID',
        },
        { status: 400 }
      )
    }

    const offer = await findOfferById(offerId, userId)

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再计算Launch Score',
        },
        { status: 400 }
      )
    }

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

    const { launchScore, fromCache } = await ensureLaunchScoreForCreative(
      userId,
      offer,
      creative,
      hashCampaignConfig
    )
    const scoreAnalysis = parseLaunchScoreAnalysis(launchScore)

    const includePerformance = body.includePerformance === true
    const postDaysBack = parseInt(String(body.daysBack ?? '30'), 10)
    const postAvgOrderValue = body.avgOrderValue != null ? Number(body.avgOrderValue) : undefined

    let performance = undefined
    if (includePerformance) {
      performance = await buildLaunchScorePerformanceApiPayload(
        launchScore,
        userId,
        Number.isFinite(postDaysBack) ? postDaysBack : 30,
        Number.isFinite(postAvgOrderValue) ? postAvgOrderValue : undefined
      )
    }

    return NextResponse.json({
      success: true,
      launchScore,
      launchScoreId: launchScore.id,
      analysis: scoreAnalysis,
      ...(fromCache ? { fromCache: true } : {}),
      ...(performance !== undefined ? { performance } : {}),
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
 * 获取 Launch Score；无 creativeId 时按最高分创意 + contentHash 读分
 * 支持 ?autoCalculate=true
 * 支持 ?includePerformance=true（与读分同请求返回 performance，避免二次读分）
 * 可选 campaignConfig（JSON）或 budgetAmount / maxCpcBid / targetCountry / targetLanguage
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }
    const { searchParams } = new URL(request.url)
    const autoCalculate = searchParams.get('autoCalculate') === 'true'
    const includePerformance = searchParams.get('includePerformance') === 'true'
    const daysBack = parseInt(searchParams.get('daysBack') || '30', 10)
    const avgOrderValue = searchParams.get('avgOrderValue')
      ? parseFloat(searchParams.get('avgOrderValue')!)
      : undefined
    const queryCreativeId = parsePositiveIntegerId(searchParams.get('creativeId'))
    const hashCampaignConfig = parseLaunchScoreHashCampaignConfigFromSearchParams(searchParams)

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const offer = await findOfferById(offerId, userId)

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    let targetCreative: AdCreative | null = null
    if (queryCreativeId != null) {
      targetCreative = await findAdCreativeById(queryCreativeId, userId)
      if (!targetCreative || targetCreative.offer_id !== offer.id) {
        return NextResponse.json({ error: '创意不存在或无权访问' }, { status: 404 })
      }
    } else {
      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      targetCreative = await pickBestCreativeForLaunchScoreRead(
        creatives,
        offer,
        userId,
        hashCampaignConfig
      )
      if (!targetCreative && autoCalculate) {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先生成广告创意后再计算Launch Score',
          canAutoCalculate: false,
        })
      }
      if (!targetCreative) {
        const canAutoCalculate = offer.scrape_status === 'completed' && creatives.length > 0
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '暂无Launch Score，请先计算',
          canAutoCalculate,
          hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
        })
      }
    }

    const resolved = await resolveLaunchScoreGetForCreative(
      userId,
      offer,
      targetCreative,
      hashCampaignConfig,
      autoCalculate
    )

    let performance = undefined
    if (includePerformance && resolved.launchScore) {
      performance = await buildLaunchScorePerformanceApiPayload(
        resolved.launchScore,
        userId,
        Number.isFinite(daysBack) ? daysBack : 30,
        avgOrderValue
      )
    }

    return NextResponse.json({
      success: true,
      ...resolved,
      ...(resolved.launchScore
        ? {
            launchScoreId: resolved.launchScore.id,
            analysis: parseLaunchScoreAnalysis(resolved.launchScore),
          }
        : {}),
      ...(performance !== undefined ? { performance } : {}),
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
