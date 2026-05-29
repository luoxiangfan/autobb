import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import {
  findAdCreativeById,
  findAdCreativesByOfferId,
  type AdCreative,
} from '@/lib/ad-creative'
import { parseLaunchScoreAnalysis } from '@/lib/launch-scores'
import {
  ensureLaunchScoreForCreative,
  pickBestAdCreativeByScore,
  resolveLaunchScoreGetForCreative,
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
 * 获取 Launch Score；无 creativeId 时按最高分创意 + contentHash 读分
 * 支持 ?autoCalculate=true
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
        return NextResponse.json(
          { error: '创意不存在或无权访问' },
          { status: 404 }
        )
      }
    } else {
      const creatives = await findAdCreativesByOfferId(offer.id, userId)
      targetCreative = pickBestAdCreativeByScore(creatives)
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

    return NextResponse.json({
      success: true,
      ...resolved,
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
