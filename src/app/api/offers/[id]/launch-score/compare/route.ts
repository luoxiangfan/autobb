import { NextRequest, NextResponse } from 'next/server'
import { findLatestLaunchScore, parseLaunchScoreAnalysis } from '@/lib/launch-scores'
import { findAdCreativeById } from '@/lib/ad-creative'

/**
 * POST /api/offers/[id]/launch-score/compare
 * 批量获取多个Creative的Launch Score用于对比 (v4.0 - 4维度)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      )
    }

    const offerId = parseInt(params.id, 10)
    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: 'Offer ID无效' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { creativeIds } = body

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

    // 获取每个Creative的详细信息和最新评分
    const comparisons = []

    for (const creativeId of creativeIds) {
      // 验证Creative存在且属于该用户
      const creative = await findAdCreativeById(creativeId, parseInt(userId, 10))

      if (!creative || creative.offer_id !== offerId) {
        return NextResponse.json(
          { error: `Creative ${creativeId} 不存在或无权访问` },
          { status: 404 }
        )
      }

      // 获取该Creative的最新Launch Score
      // 注意：实际应用中可能需要根据creativeId查询，这里简化为使用offerId的最新评分
      const score = await findLatestLaunchScore(offerId, parseInt(userId, 10))

      if (score) {
        const analysis = parseLaunchScoreAnalysis(score)

        // v4.0 - 4维度
        comparisons.push({
          creativeId,
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
            }
          }
        })
      } else {
        // 如果没有评分，返回Creative信息但score为null
        comparisons.push({
          creativeId,
          creative: {
            id: creative.id,
            version: creative.version,
            headlines: creative.headlines,
            descriptions: creative.descriptions,
            score: creative.score,
          },
          score: null
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        comparisons,
      }
    })

  } catch (error: any) {
    console.error('对比Creative评分失败:', error)
    return NextResponse.json(
      { error: error.message || '对比评分失败' },
      { status: 500 }
    )
  }
}
