import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { parseLaunchScoreAnalysis, type LaunchScore } from '@/lib/launch-score/server'
import { findAdCreativeById } from '@/lib/creatives'
import type { AdCreative } from '@/lib/creatives'
import { findOfferById } from '@/lib/offers/server'
import type { Offer } from '@/lib/offers/server'
import {
  enrichCreativeForLaunchScore,
  findCachedLaunchScoresForCreatives,
  readLaunchScoresForCreatives,
  saveLaunchScoreWithContentCache,
} from '@/lib/launch-score/launch-score-cache'
import {
  parseLaunchScoreHashCampaignConfig,
  toLaunchScoreScoringCampaignConfig,
} from '@/lib/launch-score/server'
import { parsePositiveIntegerOfferId, parseUniquePositiveIntegerIds } from '@/lib/offers/server'
import { calculateLaunchScoresForCreatives } from '@/lib/launch-score/server'
import type { LaunchScoreResult } from '@/lib/launch-score/server'

/**
 * POST /api/offers/[id]/launch-score/compare
 * 批量获取多个Creative的Launch Score用于对比 (v4.0 - 4维度)
 *
 * Body:
 * - creativeIds: number[]（最多 5，不可重复）
 * - autoCalculate?: boolean — 默认 true；为 true 时现场计算（共享 Planner expand），命中 contentHash 缓存则跳过 AI
 * - campaignConfig?: { budgetAmount?, maxCpcBid?, targetCountry?, targetLanguage? } — 与 hash/计分一致
 */
function buildCompareScoreFromStored(score: LaunchScore, options?: { fromCache?: boolean }) {
  const analysis = parseLaunchScoreAnalysis(score)
  return {
    totalScore: score.totalScore,
    calculatedAt: score.calculatedAt,
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

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId
    if (!userId) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }

    const body = await request.json()
    const { creativeIds } = body
    const autoCalculate = body.autoCalculate !== false
    const hashCampaignConfig = parseLaunchScoreHashCampaignConfig(body.campaignConfig)

    if (!Array.isArray(creativeIds) || creativeIds.length === 0) {
      return NextResponse.json({ error: 'creativeIds必须是非空数组' }, { status: 400 })
    }

    if (creativeIds.length > 5) {
      return NextResponse.json({ error: '最多对比5个Creative' }, { status: 400 })
    }

    const parsedIds = parseUniquePositiveIntegerIds(creativeIds)
    if (!parsedIds.ok) {
      return NextResponse.json(
        {
          error:
            parsedIds.reason === 'duplicate' ? 'creativeIds 含重复 ID' : 'creativeIds 含无效 ID',
        },
        { status: 400 }
      )
    }
    const creativeIdList = parsedIds.ids

    const loaded = await Promise.all(
      creativeIdList.map((creativeId) => findAdCreativeById(creativeId, userId))
    )
    const creatives: AdCreative[] = []
    for (let i = 0; i < creativeIdList.length; i++) {
      const creative = loaded[i]
      const creativeId = creativeIdList[i]
      if (!creative || creative.offer_id !== offerId) {
        return NextResponse.json(
          { error: `Creative ${creativeId} 不存在或无权访问` },
          { status: 404 }
        )
      }
      creatives.push(creative)
    }

    let offer: Offer | null = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json({ error: 'Offer不存在或无权访问' }, { status: 404 })
    }

    if (autoCalculate && offer.scrape_status !== 'completed') {
      return NextResponse.json(
        { error: '请先完成产品信息抓取后再计算Launch Score' },
        { status: 400 }
      )
    }

    const computedByCreativeId = new Map<number, LaunchScoreResult>()
    const storedByCreativeId = new Map<number, LaunchScore>()
    const staleCreativeIds = new Set<number>()

    const storedMetaByCreativeId = new Map<number, { fromCache?: boolean }>()

    if (autoCalculate) {
      const cachedById = await findCachedLaunchScoresForCreatives(
        creatives,
        offer,
        userId,
        hashCampaignConfig
      )
      const creativesToCalculate: AdCreative[] = []

      for (const creative of creatives) {
        const cached = cachedById.get(creative.id)
        if (cached) {
          storedByCreativeId.set(creative.id, cached)
          storedMetaByCreativeId.set(creative.id, { fromCache: true })
        } else {
          creativesToCalculate.push(creative)
        }
      }

      if (creativesToCalculate.length > 0) {
        const scoringConfig = toLaunchScoreScoringCampaignConfig(hashCampaignConfig, offer)
        const enrichedToCalculate = creativesToCalculate.map((c) =>
          enrichCreativeForLaunchScore(c, offer, hashCampaignConfig)
        )
        const analyses = await calculateLaunchScoresForCreatives(
          offer,
          enrichedToCalculate,
          userId,
          scoringConfig
        )
        await Promise.all(
          creativesToCalculate.map(async (creative, index) => {
            const computed = analyses[index]
            computedByCreativeId.set(creative.id, computed)
            await saveLaunchScoreWithContentCache(
              userId,
              offer!.id,
              creative,
              offer!,
              computed.scoreAnalysis,
              { campaignConfig: hashCampaignConfig }
            )
          })
        )
      }
    } else {
      const readsById = await readLaunchScoresForCreatives(
        creatives,
        offer,
        userId,
        hashCampaignConfig
      )
      for (const creative of creatives) {
        const read = readsById.get(creative.id)
        if (!read) {
          continue
        }
        if (read.score) {
          storedByCreativeId.set(creative.id, read.score)
          storedMetaByCreativeId.set(creative.id, { fromCache: true })
        } else if (read.staleScore) {
          staleCreativeIds.add(creative.id)
        }
      }
    }

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

      if (staleCreativeIds.has(creative.id)) {
        comparisons.push({
          creativeId: creative.id,
          creative: buildCreativeSummary(creative),
          score: null,
          stale: true,
          message: '创意内容或投放配置已变更，请重新计算',
        })
        continue
      }

      comparisons.push({
        creativeId: creative.id,
        creative: buildCreativeSummary(creative),
        score: null,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        comparisons,
        ...(hashCampaignConfig ? { campaignConfig: hashCampaignConfig } : {}),
      },
    })
  } catch (error: any) {
    console.error('对比Creative评分失败:', error)
    return NextResponse.json({ error: error.message || '对比评分失败' }, { status: 500 })
  }
}
