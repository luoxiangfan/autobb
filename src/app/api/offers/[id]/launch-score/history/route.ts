import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findLaunchScoresByOfferId, parseLaunchScoreAnalysis } from '@/lib/launch-scores'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

/**
 * GET /api/offers/[id]/launch-score/history
 * 获取Offer的历史Launch Score记录 (v4.0 - 4维度)
 */
export const dynamic = 'force-dynamic'

export async function GET(
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

    // 获取所有历史评分
    const scores = await findLaunchScoresByOfferId(offerId, userId)

    // 转换为前端需要的格式 (v4.0 - 4维度)
    const history = scores.map(score => {
      const analysis = parseLaunchScoreAnalysis(score)

      return {
        id: score.id,
        totalScore: score.totalScore,
        calculatedAt: score.calculatedAt,
        dimensions: {
          launchViability: score.launchViabilityScore,
          adQuality: score.adQualityScore,
          keywordStrategy: score.keywordStrategyScore,
          basicConfig: score.basicConfigScore,
        },
        // 完整分析数据
        analysis: {
          launchViability: analysis.launchViability,
          adQuality: analysis.adQuality,
          keywordStrategy: analysis.keywordStrategy,
          basicConfig: analysis.basicConfig,
          overallRecommendations: analysis.overallRecommendations,
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        total: history.length,
        history,
      }
    })

  } catch (error: any) {
    console.error('获取历史评分失败:', error)
    return NextResponse.json(
      { error: error.message || '获取历史评分失败' },
      { status: 500 }
    )
  }
}
