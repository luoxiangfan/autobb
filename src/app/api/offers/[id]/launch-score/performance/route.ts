import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findLatestLaunchScore } from '@/lib/launch-scores'
import { getPerformanceEnhancedAnalysis } from '@/lib/launch-score-performance'
import { findOfferById } from '@/lib/offers'

/**
 * GET /api/offers/:id/launch-score/performance
 *
 * 获取Launch Score预测与实际性能数据的对比分析
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 * - avgOrderValue: number (可选，用于ROI计算)
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const offerId = parseInt(params.id)

    // 2. 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 3. 获取查询参数
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')
    const avgOrderValue = searchParams.get('avgOrderValue')
      ? parseFloat(searchParams.get('avgOrderValue')!)
      : undefined

    // 4. 获取最新的Launch Score
    const launchScore = await findLatestLaunchScore(offerId, userId)

    if (!launchScore) {
      return NextResponse.json(
        {
          success: false,
          message: '暂无Launch Score记录，请先进行投放分析',
          hasLaunchScore: false,
          hasPerformanceData: false
        },
        { status: 200 }
      )
    }

    // 5. 获取性能增强的分析结果
    const enhancedAnalysis = await getPerformanceEnhancedAnalysis(
      launchScore,
      userId,
      daysBack,
      avgOrderValue
    )

    // 6. 返回结果（v4.0 - 4维度）
    return NextResponse.json({
      success: true,
      hasLaunchScore: true,
      hasPerformanceData: enhancedAnalysis.performanceData !== null,
      launchScore: {
        id: launchScore.id,
        totalScore: launchScore.totalScore,
        calculatedAt: launchScore.calculatedAt,
        dimensions: {
          launchViability: launchScore.launchViabilityScore,
          adQuality: launchScore.adQualityScore,
          keywordStrategy: launchScore.keywordStrategyScore,
          basicConfig: launchScore.basicConfigScore
        }
      },
      performanceData: enhancedAnalysis.performanceData,
      comparisons: enhancedAnalysis.comparisons,
      adjustedRecommendations: enhancedAnalysis.adjustedRecommendations,
      accuracyScore: enhancedAnalysis.accuracyScore,
      offer: {
        id: offer.id,
        offerName: offer.offer_name,
        brand: offer.brand
      }
    })
  } catch (error: any) {
    console.error('Get Launch Score performance comparison error:', error)
    return NextResponse.json(
      { error: error.message || '获取性能对比数据失败' },
      { status: 500 }
    )
  }
}
