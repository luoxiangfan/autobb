import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { evaluateAdStrength } from '@/lib/ad-strength/evaluate'
import type { HeadlineAsset, DescriptionAsset } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'
import {
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'
import { mapWithConcurrency, resolveBatchEvaluateConcurrency } from '@/lib/run-with-concurrency'

const BATCH_EVALUATE_CONCURRENCY = resolveBatchEvaluateConcurrency(
  process.env.BATCH_EVALUATE_CONCURRENCY
)

type OfferPlannerPreload = {
  sessionByOfferId: Map<number, KeywordPlannerPreparedSession>
  validatedOfferIds: Set<number>
  expandFailedOfferIds: Set<number>
}

async function preloadPlannerSessionsByOfferId(
  userId: number,
  creatives: Array<{ offerId?: unknown }>
): Promise<OfferPlannerPreload> {
  const offerIds = [
    ...new Set(
      creatives
        .map((creative) => parsePositiveIntegerOfferId(creative.offerId))
        .filter((offerId): offerId is number => offerId != null)
    ),
  ]

  const sessionByOfferId = new Map<number, KeywordPlannerPreparedSession>()
  const validatedOfferIds = new Set<number>()
  const expandFailedOfferIds = new Set<number>()
  await mapWithConcurrency(offerIds, BATCH_EVALUATE_CONCURRENCY, async (offerId) => {
    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return
    }
    validatedOfferIds.add(offerId)
    const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
    if (expandLoad.ok) {
      sessionByOfferId.set(offerId, expandLoad.plannerSession)
    } else {
      expandFailedOfferIds.add(offerId)
    }
  })
  return { sessionByOfferId, validatedOfferIds, expandFailedOfferIds }
}

function computeAverageEvaluationScore(
  evaluations: Array<{ success?: boolean; evaluation?: { score?: number } }>
): number | null {
  const scored = evaluations.filter((entry) => entry.success && entry.evaluation)
  if (scored.length === 0) {
    return null
  }
  const total = scored.reduce((sum, entry) => sum + (entry.evaluation?.score || 0), 0)
  return total / scored.length
}

/**
 * POST /api/ad-strength/batch-evaluate
 * 批量评估多个广告创意的Ad Strength
 *
 * 用途：
 * 1. A/B测试：一次评估多个创意变体
 * 2. 批量筛选：从大量创意中筛选最优
 * 3. 历史回测：评估历史创意质量
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    const body = await request.json()
    const { creatives, returnBestOnly = false } = body

    // 验证输入
    if (!creatives || !Array.isArray(creatives) || creatives.length === 0) {
      return NextResponse.json({ error: 'creatives必须是非空数组' }, { status: 400 })
    }

    if (creatives.length > 50) {
      return NextResponse.json({ error: '单次最多评估50个创意' }, { status: 400 })
    }

    console.log(`📊 开始批量评估 ${creatives.length} 个创意...`)

    const { sessionByOfferId, validatedOfferIds, expandFailedOfferIds } =
      await preloadPlannerSessionsByOfferId(userId, creatives)
    if (sessionByOfferId.size > 0) {
      console.log(`🔑 已预加载 ${sessionByOfferId.size} 个 Offer 的 Keyword Planner session`)
    }

    // 批量评估（有界并发，避免 50 路同时打 Planner / AI）
    const evaluations = await mapWithConcurrency(
      creatives,
      BATCH_EVALUATE_CONCURRENCY,
      async (creative, index) => {
        try {
          // 验证创意格式
          if (!creative.headlines || !creative.descriptions || !creative.keywords) {
            throw new Error(`创意 ${index + 1} 缺少必要字段`)
          }

          // 转换为标准格式
          const headlines: HeadlineAsset[] =
            creative.headlinesWithMetadata ||
            creative.headlines.map((text: string) => ({ text, length: text.length }))

          const descriptions: DescriptionAsset[] =
            creative.descriptionsWithMetadata ||
            creative.descriptions.map((text: string) => ({ text, length: text.length }))

          const offerId = parsePositiveIntegerOfferId(creative.offerId)
          const evaluationOfferId =
            offerId != null && validatedOfferIds.has(offerId) ? offerId : undefined
          const plannerSession = offerId != null ? sessionByOfferId.get(offerId) : undefined
          const skipKeywordPoolExpandLoad = offerId != null && expandFailedOfferIds.has(offerId)

          // 评估
          const evaluation = await evaluateAdStrength(headlines, descriptions, creative.keywords, {
            brandName: creative.brandName,
            targetCountry: creative.targetCountry || 'US',
            targetLanguage: creative.targetLanguage || 'en',
            userId: userId ?? undefined,
            offerId: evaluationOfferId,
            plannerSession,
            skipKeywordPoolExpandLoad,
            sitelinks: creative.sitelinks,
            callouts: creative.callouts,
            keywordsWithVolume: creative.keywordsWithVolume,
          })

          return {
            id: creative.id || `creative_${index + 1}`,
            index: index + 1,
            creative: {
              headlines: creative.headlines,
              descriptions: creative.descriptions,
            },
            evaluation: {
              rating: evaluation.rating,
              score: evaluation.overallScore,
              isExcellent: evaluation.rating === 'EXCELLENT',
              dimensions: evaluation.dimensions,
              suggestions: evaluation.suggestions,
            },
            success: true,
          }
        } catch (error: any) {
          console.error(`评估创意 ${index + 1} 失败:`, error)
          return {
            id: creative.id || `creative_${index + 1}`,
            index: index + 1,
            success: false,
            error: error.message,
          }
        }
      }
    )

    // 统计结果
    const successCount = evaluations.filter((e) => e.success).length
    const failCount = evaluations.filter((e) => !e.success).length

    // 统计评级分布
    const ratingDistribution = {
      EXCELLENT: 0,
      GOOD: 0,
      AVERAGE: 0,
      POOR: 0,
      PENDING: 0,
    }

    evaluations.forEach((e) => {
      if (e.success && e.evaluation) {
        ratingDistribution[e.evaluation.rating as keyof typeof ratingDistribution]++
      }
    })

    // 找到最佳创意
    const bestCreative = evaluations
      .filter((e) => e.success && e.evaluation)
      .sort((a, b) => (b.evaluation?.score || 0) - (a.evaluation?.score || 0))[0]

    console.log(`✅ 批量评估完成: ${successCount}成功, ${failCount}失败`)
    console.log(`🏆 最佳创意: ${bestCreative?.id} (${bestCreative?.evaluation?.score}分)`)

    // 返回结果
    if (returnBestOnly) {
      // 仅返回最佳创意
      return NextResponse.json({
        success: true,
        bestCreative,
        summary: {
          totalCount: creatives.length,
          successCount,
          failCount,
          allFailed: successCount === 0,
          ratingDistribution,
          averageScore: computeAverageEvaluationScore(evaluations),
        },
      })
    } else {
      // 返回所有评估结果
      return NextResponse.json({
        success: true,
        evaluations,
        bestCreative,
        summary: {
          totalCount: creatives.length,
          successCount,
          failCount,
          allFailed: successCount === 0,
          ratingDistribution,
          averageScore: computeAverageEvaluationScore(evaluations),
        },
      })
    }
  } catch (error: any) {
    console.error('批量评估失败:', error)
    return NextResponse.json({ error: error.message || '批量评估失败' }, { status: 500 })
  }
}

/**
 * GET /api/ad-strength/batch-evaluate
 * 获取批量评估使用说明
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/ad-strength/batch-evaluate',
    method: 'POST',
    description: '批量评估多个广告创意的Ad Strength',
    requestBody: {
      creatives: [
        {
          id: 'optional_creative_id',
          headlines: ['string[]', '15 headlines'],
          descriptions: ['string[]', '4 descriptions'],
          keywords: ['string[]'],
          // [NEW] 关键词搜索量数据（用于品牌关键词搜索量评分）
          keywordsWithVolume: 'optional [{ keyword, searchVolume }]',
          offerId:
            'optional positive integer or numeric string — 用于按 Offer 拉取品牌搜索量（Keyword Planner）',
          brandName: 'optional 品牌名称',
          targetCountry: 'optional 默认 US',
          targetLanguage: 'optional 默认 en',
          sitelinks: 'optional Array',
          callouts: 'optional Array[]',
          headlinesWithMetadata: 'optional HeadlineAsset[]',
          descriptionsWithMetadata: 'optional DescriptionAsset[]',
        },
      ],
      returnBestOnly: 'boolean (default: false) - 仅返回最佳创意',
    },
    limits: {
      maxCreatives: 50,
      rateLimit: '100 requests/hour',
      evaluateConcurrency:
        'BATCH_EVALUATE_CONCURRENCY (1-20, default 8) — 评估与按 offer 预加载 expand 共用',
    },
    responseFormat: {
      success: true,
      evaluations: [
        {
          id: 'creative_id',
          index: 1,
          creative: { headlines: [], descriptions: [] },
          evaluation: {
            rating: 'EXCELLENT | GOOD | AVERAGE | POOR',
            score: 92,
            isExcellent: true,
            dimensions: {},
            suggestions: [],
          },
          success: true,
        },
      ],
      bestCreative: {},
      summary: {
        totalCount: 10,
        successCount: 10,
        failCount: 0,
        ratingDistribution: {
          EXCELLENT: 5,
          GOOD: 3,
          AVERAGE: 2,
          POOR: 0,
        },
        averageScore: 85.5,
        allFailed: false,
      },
    },
  })
}
