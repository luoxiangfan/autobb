import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  findLatestLaunchScore,
  findLatestLaunchScoresByCreativeIds,
  parseLaunchScoreAnalysis,
  resolveLaunchScoreForCreativeCompareFromMaps,
  type LaunchScore,
  type LaunchScoreCompareSource,
} from '@/lib/launch-scores'
import { findAdCreativeById } from '@/lib/ad-creative'
import type { AdCreative } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'
import type { Offer } from '@/lib/offers'
import {
  findCachedLaunchScoreForCreative,
  saveLaunchScoreWithContentCache,
} from '@/lib/launch-score-cache'
import {
  parsePositiveIntegerOfferId,
  parseUniquePositiveIntegerIds,
} from '@/lib/parse-offer-id'
import { calculateLaunchScoresForCreatives } from '@/lib/scoring'
import type { LaunchScoreResult } from '@/lib/scoring'

/**
 * POST /api/offers/[id]/launch-score/compare
 * 批量获取多个Creative的Launch Score用于对比 (v4.0 - 4维度)
 *
 * Body:
 * - creativeIds: number[]（最多 5，不可重复）
 * - autoCalculate?: boolean — 默认 true；为 true 时现场计算（共享 Planner expand），命中 contentHash 缓存则跳过 AI
 */
function buildCompareScoreFromStored(
  score: LaunchScore,
  options?: { scoreSource?: LaunchScoreCompareSource | null; fromCache?: boolean }
) {
  const analysis = parseLaunchScoreAnalysis(score)
  return {
    totalScore: score.totalScore,
    calculatedAt: score.calculatedAt,
    ...(options?.scoreSource ? { scoreSource: options.scoreSource } : {}),
    ...(options?.fromCache ? { fromCache: true } : {}),
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
  }
}

function buildCompareScoreFromCalculated(
  computed: LaunchScoreResult,
  options?: { fromCache?: boolean }
) {
  const analysis = computed.scoreAnalysis
  return {
    totalScore: computed.totalScore,
    calculatedAt: new Date().toISOString(),
    autoCalculated: true,
    ...(options?.fromCache ? { fromCache: true } : {}),
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
  }
}

function buildCreativeSummary(creative: AdCreative) {
  return {
    id: creative.id,
    version: creative.version,
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    score: creative.score,
  }
}

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
    const { creativeIds } = body
    const autoCalculate = body.autoCalculate !== false

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

    const parsedIds = parseUniquePositiveIntegerIds(creativeIds)
    if (!parsedIds.ok) {
      return NextResponse.json(
        {
          error:
            parsedIds.reason === 'duplicate'
              ? 'creativeIds 含重复 ID'
              : 'creativeIds 含无效 ID',
        },
        { status: 400 }
      )
    }
    const creativeIdList = parsedIds.ids

    const creatives: AdCreative[] = []
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

    let offer: Offer | null = null
    if (autoCalculate) {
      offer = await findOfferById(offerId, userId)
      if (!offer) {
        return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
      }
      if (offer.scrape_status !== 'completed') {
        return NextResponse.json(
          { error: '请先完成产品信息抓取后再计算Launch Score' },
          { status: 400 }
        )
      }
    }

    const computedByCreativeId = new Map<number, LaunchScoreResult>()
    const storedByCreativeId = new Map<number, LaunchScore>()
    const storedMetaByCreativeId = new Map<
      number,
      { scoreSource?: LaunchScoreCompareSource | null; fromCache?: boolean }
    >()

    if (autoCalculate && offer) {
      const creativesToCalculate: AdCreative[] = []

      for (const creative of creatives) {
        const cached = await findCachedLaunchScoreForCreative(creative, offer, userId)
        if (cached) {
          storedByCreativeId.set(creative.id, cached)
          storedMetaByCreativeId.set(creative.id, { fromCache: true })
          continue
        }
        creativesToCalculate.push(creative)
      }

      if (creativesToCalculate.length > 0) {
        const analyses = await calculateLaunchScoresForCreatives(
          offer,
          creativesToCalculate,
          userId
        )
        for (let index = 0; index < creativesToCalculate.length; index++) {
          const creative = creativesToCalculate[index]
          const computed = analyses[index]
          computedByCreativeId.set(creative.id, computed)

          await saveLaunchScoreWithContentCache(
            userId,
            offer.id,
            creative,
            offer,
            computed.scoreAnalysis
          )
        }
      }
    }

    const offerLatestScore = autoCalculate
      ? null
      : await findLatestLaunchScore(offerId, userId)
    const scoresByCreativeId = autoCalculate
      ? new Map<number, LaunchScore>()
      : await findLatestLaunchScoresByCreativeIds(
          creatives.map((c) => c.id),
          userId
        )
    const compareCreativeCount = creatives.length

    const comparisons = []

    for (const creative of creatives) {
      const computed = computedByCreativeId.get(creative.id)
      const stored = storedByCreativeId.get(creative.id)
      const storedMeta = storedMetaByCreativeId.get(creative.id)

      if (computed) {
        comparisons.push({
          creativeId: creative.id,
          creative: buildCreativeSummary(creative),
          score: buildCompareScoreFromCalculated(computed),
        })
        continue
      }

      if (stored) {
        comparisons.push({
          creativeId: creative.id,
          creative: buildCreativeSummary(creative),
          score: buildCompareScoreFromStored(stored, storedMeta),
        })
        continue
      }

      const { score, scoreSource } = resolveLaunchScoreForCreativeCompareFromMaps(
        creative.id,
        scoresByCreativeId,
        offerLatestScore,
        compareCreativeCount
      )

      if (score) {
        comparisons.push({
          creativeId: creative.id,
          creative: buildCreativeSummary(creative),
          score: buildCompareScoreFromStored(score, { scoreSource }),
        })
      } else {
        comparisons.push({
          creativeId: creative.id,
          creative: buildCreativeSummary(creative),
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
