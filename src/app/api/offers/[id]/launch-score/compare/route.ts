import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findLatestLaunchScore, parseLaunchScoreAnalysis } from '@/lib/launch-scores'
import { findAdCreativeById } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'
import { calculateLaunchScoresForCreatives } from '@/lib/scoring'

/**
 * POST /api/offers/[id]/launch-score/compare
 * 批量获取多个Creative的Launch Score用于对比 (v4.0 - 4维度)
 *
 * Body:
 * - creativeIds: number[]（最多 5）
 * - autoCalculate?: boolean — 为 true 时对每条创意现场计算（共享一次 Planner expand prepare），不读库内最新一条
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 });
    }
    const userId = authResult.user.userId;
    if (!userId) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json(
        { error: 'Offer ID无效' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { creativeIds, autoCalculate = false } = body

    if (!Array.isArray(creativeIds) || creativeIds.length === 0) {
      return NextResponse.json(
        { error: 'creativeIds必须是非空数组' },
        { status: 400 }
      )
    }

    if (creativeIds.length > 5) {
      return NextResponse.json(
        { error: '最多对比5个Creative' },
        { status: 400 }
      )
    }

    const parsedCreativeIds = creativeIds.map((raw: unknown) => parsePositiveIntegerOfferId(raw))
    if (parsedCreativeIds.some((id) => id == null)) {
      return NextResponse.json({ error: 'creativeIds 含无效 ID' }, { status: 400 })
    }
    const creativeIdList = parsedCreativeIds as number[]

    const creatives = []
    for (const creativeId of creativeIdList) {
      const creative = await findAdCreativeById(creativeId, userId)
      if (!creative || creative.offer_id !== offerId) {
        return NextResponse.json(
          { error: `Creative ${creativeId} 不存在或无权访问` },
          { status: 404 }
        )
      }
      creatives.push(creative)
    }

    let computedByCreativeId = new Map<number, Awaited<ReturnType<typeof calculateLaunchScoresForCreatives>>[number]>()
    if (autoCalculate) {
      const offer = await findOfferById(offerId, userId)
      if (!offer) {
        return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
      }
      const analyses = await calculateLaunchScoresForCreatives(offer, creatives, userId)
      computedByCreativeId = new Map(
        creatives.map((creative, index) => [creative.id, analyses[index]])
      )
    }

    const comparisons = []

    for (const creative of creatives) {
      const computed = computedByCreativeId.get(creative.id)
      if (computed) {
        const analysis = computed.scoreAnalysis
        comparisons.push({
          creativeId: creative.id,
          creative: {
            id: creative.id,
            version: creative.version,
            headlines: creative.headlines,
            descriptions: creative.descriptions,
            score: creative.score,
          },
          score: {
            totalScore: computed.totalScore,
            calculatedAt: new Date().toISOString(),
            autoCalculated: true,
            dimensions: {
              launchViability: analysis.launchViability.score,
              adQuality: analysis.adQuality.score,
              keywordStrategy: analysis.keywordStrategy.score,
              basicConfig: analysis.basicConfig.score,
            },
            analysis: {
              launchViability: analysis.launchViability,
              adQuality: analysis.adQuality,
              keywordStrategy: analysis.keywordStrategy,
              basicConfig: analysis.basicConfig,
            },
          },
        })
        continue
      }

      const score = await findLatestLaunchScore(offerId, userId)

      if (score) {
        const analysis = parseLaunchScoreAnalysis(score)

        comparisons.push({
          creativeId: creative.id,
          creative: {
            id: creative.id,
            version: creative.version,
            headlines: creative.headlines,
            descriptions: creative.descriptions,
            score: creative.score,
          },
          score: {
            totalScore: score.totalScore,
            calculatedAt: score.calculatedAt,
            dimensions: {
              launchViability: score.launchViabilityScore,
              adQuality: score.adQualityScore,
              keywordStrategy: score.keywordStrategyScore,
              basicConfig: score.basicConfigScore,
            },
            analysis: {
              launchViability: analysis.launchViability,
              adQuality: analysis.adQuality,
              keywordStrategy: analysis.keywordStrategy,
              basicConfig: analysis.basicConfig,
            },
          },
        })
      } else {
        comparisons.push({
          creativeId: creative.id,
          creative: {
            id: creative.id,
            version: creative.version,
            headlines: creative.headlines,
            descriptions: creative.descriptions,
            score: creative.score,
          },
          score: null,
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        comparisons,
      },
    })

  } catch (error: any) {
    console.error('对比Creative评分失败:', error)
    return NextResponse.json(
      { error: error.message || '对比评分失败' },
      { status: 500 }
    )
  }
}
