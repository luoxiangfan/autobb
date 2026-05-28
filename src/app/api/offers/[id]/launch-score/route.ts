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
} from '@/lib/launch-scores'
import {
  ensureLaunchScoreForCreative,
  readLaunchScoreForCreative,
} from '@/lib/launch-score-cache'
import {
  parseLaunchScoreHashCampaignConfig,
  parseLaunchScoreHashCampaignConfigFromSearchParams,
} from '@/lib/launch-score-campaign-config'
import { parsePositiveIntegerId, parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

/**
 * POST /api/offers/:id/launch-score
 * 计算指定Offer和Creative的Launch Score
 *
 * Body 可选 campaignConfig: { budgetAmount?, maxCpcBid?, targetCountry?, targetLanguage? }
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

    const { launchScore, fromCache } = await ensureLaunchScoreForCreative(
      userId,
      offer,
      creative,
      hashCampaignConfig
    )
    const scoreAnalysis = parseLaunchScoreAnalysis(launchScore)

    return NextResponse.json({
      success: true,
      launchScore,
      analysis: scoreAnalysis,
      ...(fromCache ? { fromCache: true } : {}),
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
 * 可选 campaignConfig（JSON）或 budgetAmount / maxCpcBid / targetCountry / targetLanguage
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
    const hashCampaignConfig =
      parseLaunchScoreHashCampaignConfigFromSearchParams(searchParams)

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

    if (queryCreative) {
      const read = await readLaunchScoreForCreative(
        queryCreative,
        offer,
        userId,
        hashCampaignConfig
      )
      if (read.score) {
        return NextResponse.json({
          success: true,
          launchScore: read.score,
        })
      }

      if (autoCalculate) {
        if (offer.scrape_status !== 'completed') {
          return NextResponse.json({
            success: true,
            launchScore: null,
            message: '请先完成产品信息抓取后再计算Launch Score',
            canAutoCalculate: false,
          })
        }

        const { launchScore, fromCache } = await ensureLaunchScoreForCreative(
          userId,
          offer,
          queryCreative
        )
        return NextResponse.json({
          success: true,
          launchScore,
          autoCalculated: true,
          usedCreativeId: queryCreative.id,
          ...(fromCache ? { fromCache: true } : {}),
        })
      }

      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      const canAutoCalculate =
        offer.scrape_status === 'completed' && creatives.length > 0

      if (read.staleScore) {
        return NextResponse.json({
          success: true,
          launchScore: null,
          stale: true,
          staleLaunchScoreId: read.staleScore.id,
          message: '创意内容已变更，当前 Launch Score 已过期，请重新计算',
          canAutoCalculate,
          hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
        })
      }

      return NextResponse.json({
        success: true,
        launchScore: null,
        message: '暂无 Launch Score，请先计算',
        canAutoCalculate,
        hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
      })
    }

    let launchScore = await findLatestLaunchScore(offer.id, userId)

    if (!launchScore && autoCalculate) {
      if (offer.scrape_status !== 'completed') {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先完成产品信息抓取后再计算Launch Score',
          canAutoCalculate: false,
        })
      }

      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      if (creatives.length === 0) {
        return NextResponse.json({
          success: true,
          launchScore: null,
          message: '请先生成广告创意后再计算Launch Score',
          canAutoCalculate: false,
        })
      }

      const targetCreative = creatives.reduce((best, current) =>
        (current.score || 0) > (best.score || 0) ? current : best
      )

      const ensured = await ensureLaunchScoreForCreative(
        userId,
        offer,
        targetCreative,
        hashCampaignConfig
      )
      launchScore = ensured.launchScore

      return NextResponse.json({
        success: true,
        launchScore,
        autoCalculated: true,
        usedCreativeId: targetCreative.id,
        ...(ensured.fromCache ? { fromCache: true } : {}),
      })
    }

    if (!launchScore) {
      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      const canAutoCalculate =
        offer.scrape_status === 'completed' && creatives.length > 0

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
