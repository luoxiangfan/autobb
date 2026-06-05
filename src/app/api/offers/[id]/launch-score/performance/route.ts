import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { buildLaunchScorePerformanceApiPayload } from '@/lib/launch-score-performance'
import { resolveLaunchScoreForPerformanceApi } from '@/lib/launch-score-cache'
import { findOfferById } from '@/lib/offers'
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
 * 独立性能对比。已有分数时请传 ?launchScoreId= 跳过 hash 读分。
 * Launch Score 页请用 GET /launch-score?includePerformance=true（与读分合并）。
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    const daysBack = parseInt(searchParams.get('daysBack') || '30', 10)
    const avgOrderValue = searchParams.get('avgOrderValue')
      ? parseFloat(searchParams.get('avgOrderValue')!)
      : undefined
    const launchScoreId = parsePositiveIntegerId(searchParams.get('launchScoreId'))
    const queryCreativeId = parsePositiveIntegerId(searchParams.get('creativeId'))
    const hashCampaignConfig =
      parseLaunchScoreHashCampaignConfigFromSearchParams(searchParams)

    if (launchScoreId != null) {
      const lookup = await resolveLaunchScoreForPerformanceApi(offer, userId, {
        launchScoreId,
      })
      if (!lookup.launchScore) {
        return NextResponse.json(
          { error: 'Launch Score 不存在或无权访问' },
          { status: 404 }
        )
      }
      const performance = await buildLaunchScorePerformanceApiPayload(
        lookup.launchScore,
        userId,
        Number.isFinite(daysBack) ? daysBack : 30,
        avgOrderValue
      )
      return NextResponse.json({
        success: true,
        hasLaunchScore: true,
        launchScoreId: lookup.launchScore.id,
        ...(lookup.resolvedCreativeId != null
          ? { creativeId: lookup.resolvedCreativeId }
          : {}),
        launchScore: {
          id: lookup.launchScore.id,
          totalScore: lookup.launchScore.totalScore,
          calculatedAt: lookup.launchScore.calculatedAt,
          adCreativeId: lookup.launchScore.adCreativeId,
          dimensions: {
            launchViability: lookup.launchScore.launchViabilityScore,
            adQuality: lookup.launchScore.adQualityScore,
            keywordStrategy: lookup.launchScore.keywordStrategyScore,
            basicConfig: lookup.launchScore.basicConfigScore,
          },
        },
        ...performance,
        offer: {
          id: offer.id,
          offerName: offer.offer_name,
          brand: offer.brand,
        },
      })
    }

    const lookup = await resolveLaunchScoreForPerformanceApi(offer, userId, {
      creativeId: queryCreativeId,
      hashCampaignConfig,
    })

    if (!lookup.launchScore) {
      return NextResponse.json(
        {
          success: false,
          message: lookup.stale
            ? '创意内容或投放配置已变更，当前 Launch Score 已过期，请重新计算'
            : '暂无Launch Score记录，请先进行投放分析',
          hasLaunchScore: false,
          hasPerformanceData: false,
          ...(lookup.stale ? { stale: true } : {}),
          ...(lookup.resolvedCreativeId != null
            ? { creativeId: lookup.resolvedCreativeId }
            : {}),
        },
        { status: 200 }
      )
    }

    const performance = await buildLaunchScorePerformanceApiPayload(
      lookup.launchScore,
      userId,
      Number.isFinite(daysBack) ? daysBack : 30,
      avgOrderValue
    )

    return NextResponse.json({
      success: true,
      hasLaunchScore: true,
      launchScoreId: lookup.launchScore.id,
      ...(lookup.resolvedCreativeId != null
        ? { creativeId: lookup.resolvedCreativeId }
        : {}),
      launchScore: {
        id: lookup.launchScore.id,
        totalScore: lookup.launchScore.totalScore,
        calculatedAt: lookup.launchScore.calculatedAt,
        adCreativeId: lookup.launchScore.adCreativeId,
        dimensions: {
          launchViability: lookup.launchScore.launchViabilityScore,
          adQuality: lookup.launchScore.adQualityScore,
          keywordStrategy: lookup.launchScore.keywordStrategyScore,
          basicConfig: lookup.launchScore.basicConfigScore,
        },
      },
      ...performance,
      offer: {
        id: offer.id,
        offerName: offer.offer_name,
        brand: offer.brand,
      },
    })
  } catch (error: any) {
    console.error('Get Launch Score performance comparison error:', error)
    return NextResponse.json(
      { error: error.message || '获取性能对比数据失败' },
      { status: 500 }
    )
  }
}
