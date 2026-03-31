import { NextRequest } from 'next/server'
import { findOfferById, markBucketGenerated } from '@/lib/offers'
import { generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  applyCreativeKeywordSetToCreative,
  buildPreGenerationCreativeKeywordSet,
  buildCreativeBrandKeywords,
  createCreativeAdStrengthPayload,
  createCreativeApiRetryHistory,
  createCreativeBucketSummaryPayload,
  createCreativeOptimizationPayload,
  createCreativeOfferSummaryPayload,
  createCreativePublishDecisionPayload,
  createCreativeQualityEvaluationInput,
  createCreativeQualityGatePayload,
  evaluateCreativePersistenceHardGate,
  createCreativeResponsePayload,
  createCreativeScoreBreakdown,
  mergeUsedKeywordsExcludingBrand,
  resolveCreativeKeywordAudit,
  resolveCreativeKeywordsForRetryExclusion,
} from '@/lib/creative-keyword-runtime'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import {
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'
import { isControllerOpen } from '@/lib/sse-helper'
import { getAvailableBuckets, getKeywordsByLinkTypeAndBucket } from '@/lib/offer-keyword-pool'
import { getThemeByBucket, type BucketType } from '@/lib/ad-creative-generator'
import {
  getCreativeTypeForBucketSlot,
} from '@/lib/creative-type'
import { resolveGeneratedBuckets } from '@/lib/creative-generated-buckets'
import { hasModelAnchorEvidenceFromOffer } from '@/lib/model-anchor-evidence'
import { normalizeSingleCreativeSelection } from '@/lib/creative-request-normalizer'

type CanonicalBucketSlot = 'A' | 'B' | 'D'

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function createCreativePersistenceGateError(params: {
  attempts: number
  details: ReturnType<typeof evaluateCreativePersistenceHardGate>
}) {
  const error = new Error(
    `创意落库门禁未通过: ${params.details.violations.map((item) => item.code).join(', ')}`
  ) as Error & {
    code?: string
    details?: Record<string, unknown>
  }
  error.code = 'CREATIVE_PERSISTENCE_GATE_FAILED'
  error.details = {
    attempts: params.attempts,
    ...params.details,
  }
  return error
}

/**
 * POST /api/offers/:id/generate-creatives-stream
 * 流式生成广告创意，通过SSE返回进度
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  // 从中间件注入的请求头中获取用户ID
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json()
  const {
    maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES,
    targetRating: requestedTargetRating = 'GOOD',
    bucket: explicitBucket,
    creativeType: explicitCreativeType,
  } = body
  const hardPersistenceGateEnabled = parseBooleanEnv(
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED,
    true
  )
  const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true
  const parsedOfferId = parseInt(id, 10)
  const parsedUserId = parseInt(userId, 10)
  const normalizedMaxRetries = Math.max(
    0,
    Math.min(
      AD_CREATIVE_MAX_AUTO_RETRIES,
      Number.isFinite(Number(maxRetries)) ? Math.floor(Number(maxRetries)) : AD_CREATIVE_MAX_AUTO_RETRIES
    )
  )
  const enforcedTargetRating = 'GOOD'

  // 验证Offer存在
  const offer = await findOfferById(parsedOfferId, parsedUserId)
  if (!offer) {
    return new Response(JSON.stringify({ error: 'Offer不存在或无权访问' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (offer.scrape_status === 'failed') {
    return new Response(JSON.stringify({ error: 'Offer信息抓取失败，请重新抓取' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const offerAny = offer as any
  const linkType = offer.page_type === 'store' ? 'store' : 'product'
  const availableBuckets = await getAvailableBuckets(parsedOfferId)
  const hasExplicitBucket = explicitBucket !== undefined && explicitBucket !== null && String(explicitBucket).trim() !== ''
  const hasExplicitCreativeType = explicitCreativeType !== undefined && explicitCreativeType !== null && String(explicitCreativeType).trim() !== ''
  const normalizedSelection = normalizeSingleCreativeSelection({
    creativeType: explicitCreativeType,
    bucket: explicitBucket,
    hasExplicitCreativeType,
    hasExplicitBucket,
    resolveLegacyModelIntent: () => hasModelAnchorEvidenceFromOffer(offer),
  })

  if (normalizedSelection.errorCode === 'invalid-creative-type') {
    return new Response(JSON.stringify({ error: 'creativeType 无效，仅支持 brand_intent/model_intent/product_intent 及兼容旧 key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (normalizedSelection.errorCode === 'invalid-bucket') {
    return new Response(JSON.stringify({ error: 'bucket 无效，仅支持 A/B/C/D/S' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (normalizedSelection.errorCode === 'creative-type-bucket-conflict') {
    return new Response(JSON.stringify({ error: 'creativeType 与 bucket 不一致，请传入同一创意类型对应的槽位' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const bucketSelection = normalizedSelection.bucketSelection
  let requestedBucket: CanonicalBucketSlot | null = normalizedSelection.requestedBucket
  if (normalizedSelection.legacyFallbackToProduct) {
    console.warn(
      `[GenerateCreativesStream] Offer ${parsedOfferId}: legacy bucket ${bucketSelection.rawBucket} fallback to D/product_intent because no verifiable model anchor evidence was found`
    )
  }
  if (availableBuckets.length === 0) {
    return new Response(JSON.stringify({ error: '该Offer已生成全部3种创意类型（A/B/D），请删除某个类型后再生成。' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (requestedBucket && !availableBuckets.includes(requestedBucket)) {
    return new Response(JSON.stringify({
      error: `该Offer已生成${requestedBucket}槽位创意。请先删除对应创意后再生成。`,
      availableBuckets,
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const selectedBucket = (requestedBucket || availableBuckets[0]) as CanonicalBucketSlot
  const creativeType = getCreativeTypeForBucketSlot(selectedBucket)
  const bucketIntent = getThemeByBucket(selectedBucket as BucketType, linkType)
  const bucketIntentEn = bucketIntent.split(' - ')[1] || bucketIntent

  let searchTermFeedbackHints: {
    hardNegativeTerms?: string[]
    softSuppressTerms?: string[]
    highPerformingTerms?: string[]
  } | undefined
  try {
    const hints = await getSearchTermFeedbackHints({
      offerId: parsedOfferId,
      userId: parsedUserId
    })
    searchTermFeedbackHints = {
      hardNegativeTerms: hints.hardNegativeTerms,
      softSuppressTerms: hints.softSuppressTerms,
      highPerformingTerms: hints.highPerformingTerms
    }
    console.log(
      `🔁 [SSE] 搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
    )
  } catch (hintError: any) {
    console.warn(`⚠️ [SSE] 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
  }

  // 创建SSE流
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // 🔥 安全的enqueue封装 - 处理竞态条件
      const safeEnqueue = (data: string): boolean => {
        try {
          if (!isControllerOpen(controller)) {
            return false
          }
          controller.enqueue(encoder.encode(data))
          return true
        } catch (error: any) {
          // 捕获 "Controller is already closed" 错误
          if (error?.code === 'ERR_INVALID_STATE' || error?.message?.includes('closed')) {
            console.warn('SSE Controller closed during enqueue (client disconnected)')
          } else {
            console.error('SSE enqueue error:', error)
          }
          return false
        }
      }

      // 发送进度更新的helper函数
      const sendProgress = (step: string, progress: number, message: string, details?: any) => {
        const data = JSON.stringify({ type: 'progress', step, progress, message, details })
        if (!safeEnqueue(`data: ${data}\n\n`)) {
          console.warn('SSE Controller already closed, skipping progress:', step)
        }
      }

      // 发送完成结果
      const sendResult = (data: any) => {
        if (!safeEnqueue(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`)) {
          console.warn('SSE Controller already closed, skipping result')
        }
      }

      // 发送错误
      const sendError = (error: string, details?: any, code?: string) => {
        const payload = {
          type: 'error',
          error,
          ...(code ? { code } : {}),
          ...(details !== undefined ? { details } : {}),
        }
        if (!safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`)) {
          console.warn('SSE Controller already closed, skipping error')
        }
      }

      // 耗时统计
      const timings: Record<string, number> = {}
      const startTimer = (name: string) => {
        timings[`${name}_start`] = Date.now()
      }
      const endTimer = (name: string): number => {
        const start = timings[`${name}_start`]
        if (start) {
          const elapsed = Date.now() - start
          timings[name] = elapsed
          return elapsed
        }
        return 0
      }

      try {
        const totalStartTime = Date.now()
        sendProgress('init', 5, '正在初始化生成任务...')
        if (forcePublishRequested) {
          sendProgress('compat_notice', 6, 'generate-creatives-stream 接口不再支持 forcePublish，参数已忽略')
        }
        if (String(requestedTargetRating || '').toUpperCase() !== enforcedTargetRating) {
          sendProgress('compat_notice', 7, `targetRating=${requestedTargetRating} 已忽略，统一使用 GOOD`)
        }
        sendProgress('slot_selected', 8, `已选择创意槽位 ${selectedBucket}（${creativeType}）`, {
          bucket: selectedBucket,
          creativeType,
          bucketIntent,
        })

        let usedKeywords: string[] = []
        const brandKeywords = buildCreativeBrandKeywords(offer.brand)
        const generateDurations = new Map<number, number>()
        let seedCandidates: Array<Record<string, any>> = []
        try {
          const bucketResult = await getKeywordsByLinkTypeAndBucket(
            parsedOfferId,
            linkType as 'product' | 'store',
            selectedBucket
          )
          seedCandidates = Array.isArray(bucketResult.keywords)
            ? bucketResult.keywords as Array<Record<string, any>>
            : []
        } catch (poolError: any) {
          console.warn(
            `⚠️ [generate-creatives-stream] 桶${selectedBucket}关键词同步失败: ${poolError?.message || poolError}`
          )
        }

        const precomputedKeywordSet = await buildPreGenerationCreativeKeywordSet({
          offer,
          userId: parsedUserId,
          creativeType,
          bucket: selectedBucket,
          scopeLabel: `sse-${selectedBucket || 'default'}`,
          seedCandidates,
          enableSupplementation: true,
          continueOnSupplementError: true,
        })

        const generationResult = await runCreativeGenerationQualityLoop<GeneratedAdCreativeData>({
          maxRetries: normalizedMaxRetries,
          delayMs: 1000,
          generate: async ({ attempt, retryFailureType }) => {
            const attemptBaseProgress = 10 + (attempt - 1) * 25
            sendProgress('generating', attemptBaseProgress,
              `第${attempt}次生成: AI正在创作广告文案...`,
              { attempt, maxRetries: normalizedMaxRetries }
            )

            startTimer(`generate_${attempt}`)
            const creative = await generateAdCreative(
              parsedOfferId,
              parsedUserId,
              {
                theme: bucketIntent,
                skipCache: attempt > 1,
                excludeKeywords: attempt > 1 ? usedKeywords : undefined,
                retryFailureType,
                searchTermFeedbackHints,
                bucket: selectedBucket,
                bucketIntent,
                bucketIntentEn,
                deferKeywordPostProcessingToBuilder: true,
                precomputedKeywordSet,
              }
            )

            applyCreativeKeywordSetToCreative(creative, {
              executableKeywords: precomputedKeywordSet.executableKeywords,
              keywordsWithVolume: precomputedKeywordSet.keywordsWithVolume,
              promptKeywords: precomputedKeywordSet.promptKeywords,
              keywordSupplementation: precomputedKeywordSet.keywordSupplementation,
              audit: precomputedKeywordSet.audit,
            })
            const generateTime = endTimer(`generate_${attempt}`)
            generateDurations.set(attempt, generateTime)

            sendProgress('evaluating', attemptBaseProgress + 10,
              `第${attempt}次生成: 评估创意质量... (生成耗时 ${(generateTime / 1000).toFixed(1)}s)`,
              { attempt, generateTime }
            )

            usedKeywords = mergeUsedKeywordsExcludingBrand({
              usedKeywords,
              candidateKeywords: resolveCreativeKeywordsForRetryExclusion(creative),
              brandKeywords,
            })

            return creative
          },
          evaluate: async (creative, { attempt }) => {
            startTimer(`evaluate_${attempt}`)
            const evaluation = await evaluateCreativeForQuality(createCreativeQualityEvaluationInput({
              creative,
              minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
              offer,
              userId: parsedUserId,
              bucket: selectedBucket,
              productNameFallback: offerAny.product_title || offerAny.name,
              productTitleFallback: offerAny.title,
            }))
            const evaluateTime = endTimer(`evaluate_${attempt}`)
            const attemptBaseProgress = 10 + (attempt - 1) * 25
            const generateTime = generateDurations.get(attempt) || 0

            sendProgress('evaluated', attemptBaseProgress + 18,
              `第${attempt}次生成: ${evaluation.adStrength.finalRating} (${evaluation.adStrength.finalScore}分) gate=${evaluation.passed ? 'PASS' : 'BLOCK'} [评估 ${(evaluateTime / 1000).toFixed(1)}s]`,
              {
                attempt,
                rating: evaluation.adStrength.finalRating,
                score: evaluation.adStrength.finalScore,
                gatePassed: evaluation.passed,
                failureType: evaluation.failureType,
                generateTime,
                evaluateTime,
                reasons: evaluation.reasons.slice(0, 3)
              }
            )

            if (evaluation.passed) {
              sendProgress('target_reached', attemptBaseProgress + 20,
                '达到目标评级 GOOD 且通过质量门禁！',
                {
                  rating: evaluation.adStrength.finalRating,
                  score: evaluation.adStrength.finalScore,
                  gatePassed: true
                }
              )
            } else if (attempt <= normalizedMaxRetries) {
              sendProgress('retry_prepare', attemptBaseProgress + 20,
                `未达到GOOD，准备第${attempt + 1}次优化...`,
                {
                  currentRating: evaluation.adStrength.finalRating,
                  gatePassed: false,
                  failureType: evaluation.failureType,
                  gateReasons: evaluation.reasons.slice(0, 2),
                  suggestions: evaluation.adStrength.combinedSuggestions.slice(0, 3)
                }
              )
            }

            return evaluation
          }
        })

        const attempts = generationResult.attempts
        const bestCreative = generationResult.selectedCreative
        const selectedEvaluation = generationResult.selectedEvaluation
        const bestEvaluation = selectedEvaluation.adStrength
        const bestCreativeAudit = resolveCreativeKeywordAudit(bestCreative)
        const qualityPassed = selectedEvaluation.passed
        const retryHistory = createCreativeApiRetryHistory(generationResult.history)

        if (!qualityPassed) {
          sendProgress('quality_warning', 84,
            '未达 GOOD 阈值，已保存重试中表现最佳的创意',
            {
              failureType: selectedEvaluation.failureType,
              gateReasons: selectedEvaluation.reasons
            }
          )
        }

        if (hardPersistenceGateEnabled) {
          const persistenceGateResult = evaluateCreativePersistenceHardGate({
            creative: bestCreative,
            bucket: selectedBucket,
            targetLanguage: offer.target_language,
            brandName: offer.brand,
          })
          if (!persistenceGateResult.passed) {
            throw createCreativePersistenceGateError({
              attempts,
              details: persistenceGateResult,
            })
          }
        }

        sendProgress('saving', 85, '正在保存创意到数据库...')

        // 保存到数据库
        startTimer('save')
        const savedCreative = await createAdCreative(parsedUserId, parsedOfferId, {
          headlines: bestCreative.headlines,
          descriptions: bestCreative.descriptions,
          keywords: bestCreative.keywords,
          keywordsWithVolume: bestCreative.keywordsWithVolume,
          negativeKeywords: bestCreative.negativeKeywords,  // 🎯 新增：传入否定关键词
          callouts: bestCreative.callouts,
          sitelinks: bestCreative.sitelinks,
          theme: bestCreative.theme,
          explanation: bestCreative.explanation,
          final_url: offer.final_url || offer.url,
          final_url_suffix: offer.final_url_suffix || undefined,
          score: bestEvaluation.finalScore,
          score_breakdown: createCreativeScoreBreakdown(bestEvaluation),
          generation_round: attempts,
          ai_model: bestCreative.ai_model, // 传入实际使用的AI模型
          creative_type: creativeType,
          keyword_bucket: selectedBucket,
          bucket_intent: bucketIntent,
          adStrength: createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit),
        })
        await markBucketGenerated(parsedOfferId, selectedBucket)
        endTimer('save')
        const totalTime = Date.now() - totalStartTime

        sendProgress('complete', 100, `生成完成！总耗时 ${(totalTime / 1000).toFixed(1)}s`)

        // 发送最终结果
        sendResult({
          success: true,
          ...createCreativePublishDecisionPayload(forcePublishRequested),
          qualityGate: createCreativeQualityGatePayload(selectedEvaluation),
          creative: createCreativeResponsePayload({
            id: savedCreative.id,
            creative: bestCreative,
            audit: bestCreativeAudit,
            includeNegativeKeywords: true,
          }),
          ...createCreativeBucketSummaryPayload({
            creativeType,
            bucket: selectedBucket,
            bucketIntent,
            generatedBuckets: resolveGeneratedBuckets({
              availableBuckets: availableBuckets as CanonicalBucketSlot[],
              selectedBucket,
            }),
          }),
          adStrength: createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit, {
            includeRsaQualityGate: true,
          }),
          optimization: createCreativeOptimizationPayload({
            attempts,
            targetRating: enforcedTargetRating,
            achieved: qualityPassed,
            qualityGatePassed: qualityPassed,
            history: retryHistory
          }),
          offer: createCreativeOfferSummaryPayload(offer)
        })

      } catch (error: any) {
        console.error('生成创意失败:', error)
        sendError(
          error?.message || '生成创意失败',
          error?.details,
          error?.code
        )
      } finally {
        // 只有在控制器仍然打开时才关闭
        if (isControllerOpen(controller)) {
          controller.close()
        }
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
