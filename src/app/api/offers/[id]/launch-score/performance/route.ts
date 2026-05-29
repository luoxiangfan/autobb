import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findAdCreativeById, findAdCreativesByOfferId } from '@/lib/ad-creative'
import { getPerformanceEnhancedAnalysis } from '@/lib/launch-score-performance'
import { findOfferById } from '@/lib/offers'
import {
  pickBestCreativeForLaunchScoreRead,
  readLaunchScoreForCreative,
} from '@/lib/launch-score-cache'
import {
  parseLaunchScoreHashCampaignConfigFromSearchParams,
} from '@/lib/launch-score-campaign-config'
import {
  parsePositiveIntegerId,
  parsePositiveIntegerOfferId,
} from '@/lib/parse-offer-id'

/**
 * GET /api/offers/:id/launch-score/performance
 *
 * Query Parameters:
 * - creativeId: number (可选；缺省时按最高分创意 + contentHash 读分)
 * - daysBack: number (可选，默认30天)
 * - avgOrderValue: number (可选，用于ROI计算)
 * - campaignConfig: JSON 或 budgetAmount / maxCpcBid / targetCountry / targetLanguage
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')
    const avgOrderValue = searchParams.get('avgOrderValue')
      ? parseFloat(searchParams.get('avgOrderValue')!)
      : undefined
    const queryCreativeId = parsePositiveIntegerId(searchParams.get('creativeId'))
    const hashCampaignConfig =
      parseLaunchScoreHashCampaignConfigFromSearchParams(searchParams)

    let launchScore = null
    let stale = false
    let resolvedCreativeId: number | undefined

    if (queryCreativeId != null) {
      const creative = await findAdCreativeById(queryCreativeId, userId)
      if (!creative || creative.offer_id !== offer.id) {
        return NextResponse.json(
          { error: '创意不存在或无权访问' },
          { status: 404 }
        )
      }

      const read = await readLaunchScoreForCreative(
        creative,
        offer,
        userId,
        hashCampaignConfig
      )
      launchScore = read.score
      stale = !read.score && read.staleScore != null
      resolvedCreativeId = creative.id
    } else {
      const creatives = await findAdCreativesByOfferId(offerId, userId)
      const bestCreative = await pickBestCreativeForLaunchScoreRead(
        creatives,
        offer,
        userId,
        hashCampaignConfig
      )
      if (bestCreative) {
        const read = await readLaunchScoreForCreative(
          bestCreative,
          offer,
          userId,
          hashCampaignConfig
        )
        launchScore = read.score
        stale = !read.score && read.staleScore != null
        resolvedCreativeId = bestCreative.id
      }
    }

    if (!launchScore) {
      return NextResponse.json(
        {
          success: false,
          message: stale
            ? '创意内容或投放配置已变更，当前 Launch Score 已过期，请重新计算'
            : '暂无Launch Score记录，请先进行投放分析',
          hasLaunchScore: false,
          hasPerformanceData: false,
          ...(stale ? { stale: true } : {}),
          ...(resolvedCreativeId != null ? { creativeId: resolvedCreativeId } : {}),
        },
        { status: 200 }
      )
    }

    const enhancedAnalysis = await getPerformanceEnhancedAnalysis(
      launchScore,
      userId,
      daysBack,
      avgOrderValue
    )

    return NextResponse.json({
      success: true,
      hasLaunchScore: true,
      hasPerformanceData: enhancedAnalysis.performanceData !== null,
      ...(resolvedCreativeId != null ? { creativeId: resolvedCreativeId } : {}),
      launchScore: {
        id: launchScore.id,
        totalScore: launchScore.totalScore,
        calculatedAt: launchScore.calculatedAt,
        adCreativeId: launchScore.adCreativeId,
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
