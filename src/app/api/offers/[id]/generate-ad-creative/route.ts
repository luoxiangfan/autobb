import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findOfferById, markBucketGenerated } from '@/lib/offers'
import { generateAdCreative, generateAdCreativesBatch } from '@/lib/ad-creative-gen'
import { createAdCreative, listAdCreativesByOffer } from '@/lib/ad-creative'
import { createError, AppError } from '@/lib/errors'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import {
  buildPreGenerationCreativeKeywordSet,
  buildCreativeBrandKeywords,
  createCreativeAdStrengthPayload,
  createCreativeApiRetryHistory,
  createCreativeBucketSummaryPayload,
  createCreativeOptimizationPayload,
  createCreativePublishDecisionPayload,
  createCreativeQualityEvaluationInput,
  createCreativeQualityGatePayload,
  createCreativeScoreBreakdown,
  evaluateCreativePersistenceHardGate,
  finalizeCreativeKeywordSet,
  mergeUsedKeywordsExcludingBrand,
  resolveCreativeKeywordAudit,
  resolveCreativeKeywordsForRetryExclusion,
} from '@/lib/creative-keyword-runtime'
import {
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'
import { getThemeByBucket, BucketType } from '@/lib/ad-creative-generator'
import { getAvailableBuckets, getKeywordsByLinkTypeAndBucket } from '@/lib/offer-keyword-pool'
import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
} from '@/lib/creative-type'
import { resolveGeneratedBuckets } from '@/lib/creative-generated-buckets'
import { hasModelAnchorEvidenceFromOffer } from '@/lib/model-anchor-evidence'
import { normalizeSingleCreativeSelection } from '@/lib/creative-request-normalizer'

/**
 * 🔧 转换 AdCreative 为 API 响应格式 (camelCase)
 */
function transformCreativeToApiResponse(creative: any) {
  const creativeType = deriveCanonicalCreativeType({
    creativeType: creative.creative_type,
    keywordBucket: creative.keyword_bucket,
    keywords: creative.keywords,
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    theme: creative.theme,
    bucketIntent: creative.bucket_intent,
  })

  const creativeAudit = resolveCreativeKeywordAudit(creative)
  const normalizedAdStrength = creative?.adStrength && typeof creative.adStrength === 'object'
    ? {
      ...creative.adStrength,
      audit: creativeAudit,
      keywordSourceAudit: creativeAudit,
    }
    : creative.adStrength

  return {
    ...creative,
    offerId: creative.offer_id,
    userId: creative.user_id,
    finalUrl: creative.final_url,
    finalUrlSuffix: creative.final_url_suffix,
    path1: creative.path_1,
    path2: creative.path_2,
    scoreBreakdown: creative.score_breakdown,
    scoreExplanation: creative.score_explanation,
    generationRound: creative.generation_round,
    generationPrompt: creative.generation_prompt,
    creationStatus: creative.creation_status,
    creationError: creative.creation_error,
    googleAdId: creative.google_ad_id,
    googleAdGroupId: creative.google_ad_group_id,
    lastSyncAt: creative.last_sync_at,
    createdAt: creative.created_at,
    updatedAt: creative.updated_at,
    // 🔧 修复：确保 adStrength 数据被正确传递（用于雷达图显示）
    adStrength: normalizedAdStrength,
    audit: creativeAudit,
    keywordSourceAudit: creativeAudit,
    // 🆕 v4.10: 关键词分桶字段
    keywordBucket: creative.keyword_bucket,
    creativeType,
    bucketIntent: creative.bucket_intent,
    keywordPoolId: creative.keyword_pool_id,
  }
}

type CanonicalBucketSlot = 'A' | 'B' | 'D'
const REQUIRED_RSA_HEADLINE_COUNT = 15
const REQUIRED_RSA_DESCRIPTION_COUNT = 4

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function hasRequiredRsaAssetCounts(creative: any): boolean {
  const headlines = Array.isArray(creative?.headlines)
    ? creative.headlines.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
    : []
  const descriptions = Array.isArray(creative?.descriptions)
    ? creative.descriptions.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
    : []

  return (
    headlines.length === REQUIRED_RSA_HEADLINE_COUNT &&
    descriptions.length === REQUIRED_RSA_DESCRIPTION_COUNT
  )
}

function createCreativeQualityGateError(params: {
  bucket: string
  attempts: number
  finalRating: string
  finalScore: number
  reasons: string[]
  failureType: string | null
  requiredMinimumScore: number
  batchIndex?: number
}) {
  const error = new Error(
    `创意质量门禁未通过: ${params.finalRating} (${params.finalScore})`
  ) as Error & {
    code?: string
    details?: Record<string, unknown>
  }
  error.code = 'CREATIVE_QUALITY_GATE_FAILED'
  error.details = {
    bucket: params.bucket,
    attempts: params.attempts,
    finalRating: params.finalRating,
    finalScore: params.finalScore,
    reasons: params.reasons,
    failureType: params.failureType,
    requiredMinimumScore: params.requiredMinimumScore,
    ...(params.batchIndex !== undefined ? { batchIndex: params.batchIndex } : {}),
  }
  return error
}

function createCreativePersistenceGateError(params: {
  attempts: number
  details: ReturnType<typeof evaluateCreativePersistenceHardGate>
  batchIndex?: number
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
    ...(params.batchIndex !== undefined ? { batchIndex: params.batchIndex } : {}),
  }
  return error
}

/**
 * POST /api/offers/[id]/generate-ad-creative
 * 为指定Offer生成广告创意
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const offerId = parseInt(params.id)
    if (isNaN(offerId)) {
      const error = createError.invalidParameter({ field: 'id', value: params.id })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, authResult.user.userId)
    if (!offer) {
      const error = createError.offerNotFound({ offerId, userId: authResult.user.userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 检查Offer是否已抓取数据
    if (offer.scrape_status !== 'completed') {
      const error = createError.offerNotReady({
        offerId,
        currentStatus: offer.scrape_status,
        requiredStatus: 'completed'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // ⚠️ 品牌验证：如果品牌为Unknown，拒绝生成创意
    if (!offer.brand || offer.brand === 'Unknown' || offer.brand.trim() === '') {
      const error = createError.requiredField('brand (有效品牌名称)')
      return NextResponse.json({
        ...error.toJSON(),
        message: '品牌名称缺失或无效。品牌词对于生成高质量关键词和广告创意至关重要。请重新抓取Offer或手动设置品牌名称。'
      }, { status: error.httpStatus })
    }

    // 解析请求参数
    const body = await request.json()
    const {
      theme,
      generation_round = 1,
      reference_performance,
      count = 1,  // 新增：批量生成数量，默认1个
      batch = false,  // 新增：是否批量生成模式
      // 🆕 v4.16: 支持手动指定bucket（用于补生成或重生成）
      bucket: explicitBucket,
      creativeType: explicitCreativeType
    } = body
    const hardQualityGateEnabled = parseBooleanEnv(
      process.env.AD_CREATIVE_HARD_QUALITY_GATE_ENABLED,
      true
    )
    const hardPersistenceGateEnabled = parseBooleanEnv(
      process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED,
      true
    )
    const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true

    // 🆕 v4.16: 使用智能选择机制确定bucket
    // 如果用户指定了bucket，则使用指定的bucket；否则自动选择
    const linkType = offer.page_type || 'product'
    let bucket: BucketType
    let bucketIntent: string
    const availableBuckets = await getAvailableBuckets(offerId)

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
      const error = createError.invalidParameter({
        field: 'creativeType',
        value: explicitCreativeType
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (normalizedSelection.errorCode === 'invalid-bucket') {
      const error = createError.invalidParameter({
        field: 'bucket',
        value: explicitBucket
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (normalizedSelection.errorCode === 'creative-type-bucket-conflict') {
      const error = createError.invalidParameter({
        field: 'creativeType',
        value: explicitCreativeType
      })
      return NextResponse.json({
        ...error.toJSON(),
        message: 'creativeType 与 bucket 不一致，请传入同一创意类型对应的槽位。'
      }, { status: error.httpStatus })
    }

    const explicitCreativeTypeNormalized = normalizedSelection.normalizedCreativeType
    const bucketSelection = normalizedSelection.bucketSelection
    let requestedBucket: BucketType | null = normalizedSelection.requestedBucket
    if (normalizedSelection.legacyFallbackToProduct) {
      console.warn(
        `[GenerateAdCreative] Offer ${offerId}: legacy bucket ${bucketSelection.rawBucket} fallback to D/product_intent because no verifiable model anchor evidence was found`
      )
    }

    if (requestedBucket) {
      const normalized = requestedBucket
      if (!availableBuckets.includes(normalized)) {
        const error = createError.creativeQuotaExceeded({
          round: generation_round,
          current: 3 - availableBuckets.length,
          limit: 3
        })
        return NextResponse.json({
          ...error.toJSON(),
          message: `该Offer已生成${normalized}槽位创意。请先删除对应创意后再生成。`,
          availableBuckets,
        }, { status: error.httpStatus })
      }
      bucket = normalized
      bucketIntent = getThemeByBucket(bucket, linkType as 'product' | 'store')
      console.log(`   🆕 Bucket: ${bucket} (用户指定/已归一化)`)
    } else {
      if (availableBuckets.length === 0) {
        const error = createError.creativeQuotaExceeded({
          round: generation_round,
          current: 3,
          limit: 3
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
      bucket = availableBuckets[0]
      bucketIntent = getThemeByBucket(bucket, linkType as 'product' | 'store')
      console.log(`   🆕 Bucket: ${bucket} (实时可用槽位选择)`)
    }

    const remainingQuota = availableBuckets.length
    const actualCount = batch ? Math.min(count, remainingQuota) : 1
    const creativeType = getCreativeTypeForBucketSlot(bucket as 'A' | 'B' | 'D')

    console.log(`🎨 开始为Offer #${offerId} 生成广告创意...`)
    console.log(`   品牌: ${offer.brand}`)
    console.log(`   国家: ${offer.target_country}`)
    console.log(`   链接类型: ${linkType}`)
    console.log(`   轮次: ${generation_round}`)
    console.log(`   生成数量: ${actualCount}`)
    console.log(`   主题: ${bucketIntent}`)
    if (theme) {
      console.log(`   自定义主题: ${theme}`)
    }
    console.log(`   生成接口 forcePublish 参数: ${forcePublishRequested ? '已传入（本接口忽略）' : '未传入'}`)
    if (forcePublishRequested) {
      console.warn('⚠️ generate-ad-creative 接口已忽略 forcePublish 参数；最终阻断仅在发布阶段执行')
    }

    // 批量生成或单个生成
    const userId = authResult.user!.userId  // Already verified above
    let searchTermFeedbackHints: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
      highPerformingTerms?: string[]
    } | undefined

    try {
      const hints = await getSearchTermFeedbackHints({
        offerId,
        userId
      })
      searchTermFeedbackHints = {
        hardNegativeTerms: hints.hardNegativeTerms,
        softSuppressTerms: hints.softSuppressTerms,
        highPerformingTerms: hints.highPerformingTerms
      }
      console.log(
        `🔁 搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
      )
    } catch (hintError: any) {
      console.warn(`⚠️ 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
    }

    const normalizedMaxRetries = AD_CREATIVE_MAX_AUTO_RETRIES
    console.log(`   质量策略: 低于 GOOD 不保存，自动重试最多 ${normalizedMaxRetries} 次，失败后保存最佳`)
    const offerAny = offer as any

    if (batch && actualCount > 1) {
      let batchSeedCandidates: Array<Record<string, any>> = []
      try {
        const bucketResult = await getKeywordsByLinkTypeAndBucket(
          offerId,
          linkType as 'product' | 'store',
          bucket
        )
        batchSeedCandidates = Array.isArray(bucketResult.keywords)
          ? bucketResult.keywords as Array<Record<string, any>>
          : []
      } catch (poolError: any) {
        console.warn(
          `⚠️ [generate-ad-creative-batch] 桶${bucket}关键词同步失败: ${poolError?.message || poolError}`
        )
      }

      const batchPrecomputedKeywordSet = await buildPreGenerationCreativeKeywordSet({
        offer,
        userId,
        creativeType,
        bucket,
        scopeLabel: `generate-ad-creative-batch-${bucket}`,
        seedCandidates: batchSeedCandidates,
        enableSupplementation: true,
        continueOnSupplementError: true,
      })

      const initialCreatives = await generateAdCreativesBatch(offerId, userId, actualCount, {
        theme: bucketIntent,
        referencePerformance: reference_performance,
        skipCache: true,
        searchTermFeedbackHints,
        deferKeywordPostProcessingToBuilder: true,
        precomputedKeywordSet: batchPrecomputedKeywordSet,
      })

      const batchResults = await Promise.all(initialCreatives.map(async (initialCreative, index) => {
        let usedKeywords: string[] = []
        const brandKeywords = buildCreativeBrandKeywords(offer.brand)

        const loopResult = await runCreativeGenerationQualityLoop({
          maxRetries: normalizedMaxRetries,
          delayMs: 1000,
          generate: async ({ attempt, retryFailureType }) => {
            const creative = attempt === 1
              ? initialCreative
              : await generateAdCreative(offerId, userId, {
                theme: bucketIntent,
                referencePerformance: reference_performance,
                skipCache: true,
                excludeKeywords: usedKeywords,
                retryFailureType,
                searchTermFeedbackHints,
                bucket,
                bucketIntent,
                bucketIntentEn: getThemeByBucket(bucket, linkType as 'product' | 'store').split(' - ')[1] || bucketIntent,
                deferKeywordPostProcessingToBuilder: true,
                precomputedKeywordSet: batchPrecomputedKeywordSet,
              })

            await finalizeCreativeKeywordSet({
              offer,
              userId,
              creative,
              creativeType,
              bucket,
              scopeLabel: `generate-ad-creative-batch-final-${bucket}-${index + 1}`,
              seedCandidates: batchSeedCandidates,
              includeKeywordSupplementation: false,
            })

            usedKeywords = mergeUsedKeywordsExcludingBrand({
              usedKeywords,
              candidateKeywords: resolveCreativeKeywordsForRetryExclusion(creative),
              brandKeywords,
            })
            return creative
          },
          evaluate: async (creative) => evaluateCreativeForQuality(createCreativeQualityEvaluationInput({
            creative,
            minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
            offer,
            userId,
            bucket,
            keywords: creative.keywords || [],
            productNameFallback: offerAny.product_title || offerAny.name,
            productTitleFallback: offerAny.title,
          }))
        })

        const bestCreative = loopResult.selectedCreative
        const selectedEvaluation = loopResult.selectedEvaluation
        const bestEvaluation = selectedEvaluation.adStrength
        const bestCreativeAudit = resolveCreativeKeywordAudit(bestCreative)

        if (hardQualityGateEnabled && !selectedEvaluation.passed) {
          throw createCreativeQualityGateError({
            bucket,
            attempts: loopResult.attempts,
            finalRating: bestEvaluation.finalRating,
            finalScore: bestEvaluation.finalScore,
            reasons: selectedEvaluation.reasons || [],
            failureType: selectedEvaluation.failureType || null,
            requiredMinimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
            batchIndex: index + 1,
          })
        }

        if (hardPersistenceGateEnabled) {
          const persistenceGateResult = evaluateCreativePersistenceHardGate({
            creative: bestCreative,
            bucket,
            targetLanguage: offer.target_language,
            brandName: offer.brand,
          })
          if (!persistenceGateResult.passed) {
            throw createCreativePersistenceGateError({
              attempts: loopResult.attempts,
              details: persistenceGateResult,
              batchIndex: index + 1,
            })
          }
        }

        const saved = await createAdCreative(userId, offerId, {
          ...bestCreative,
          final_url: offer.final_url || offer.url,
          final_url_suffix: offer.final_url_suffix || undefined,
          generation_round,
          creative_type: creativeType,
          keyword_bucket: bucket,
          bucket_intent: bucketIntent,
          score: bestEvaluation.finalScore,
          score_breakdown: createCreativeScoreBreakdown(bestEvaluation),
          adStrength: createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit),
        })

        return {
          saved,
          keywordSupplementation: bestCreative.keywordSupplementation || null,
          audit: bestCreativeAudit,
          keywordSourceAudit: bestCreativeAudit,
          qualityWarning: !selectedEvaluation.passed ? {
            index: index + 1,
            score: bestEvaluation.finalScore,
            rating: bestEvaluation.finalRating,
            failureType: selectedEvaluation.failureType,
            gateReasons: selectedEvaluation.reasons,
            rsaQualityGate: bestEvaluation.rsaQualityGate,
            ruleGate: selectedEvaluation.ruleGate
          } : null
        }
      }))

      const savedCreatives = batchResults.map(item => item.saved)
      const qualityWarnings = batchResults.flatMap(item => item.qualityWarning ? [item.qualityWarning] : [])
      const keywordSupplementations = batchResults.map(item => item.keywordSupplementation)
      const audits = batchResults.map(item => item.audit)
      const keywordSourceAudits = audits

      return NextResponse.json({
        success: true,
        ...createCreativePublishDecisionPayload(forcePublishRequested),
        creatives: savedCreatives.map(transformCreativeToApiResponse),
        keywordSupplementations,
        audits,
        keywordSourceAudits,
        count: savedCreatives.length,
        qualityWarningCount: qualityWarnings.length,
        qualityWarnings,
        message: `成功生成 ${savedCreatives.length} 个广告创意`
      })
    } else {
      let seedCandidates: Array<Record<string, any>> = []
      try {
        const bucketResult = await getKeywordsByLinkTypeAndBucket(
          offerId,
          linkType as 'product' | 'store',
          bucket
        )
        seedCandidates = Array.isArray(bucketResult.keywords)
          ? bucketResult.keywords as Array<Record<string, any>>
          : []
      } catch (error: any) {
        console.warn(`⚠️ 桶${bucket}全量关键词同步失败: ${error?.message || error}`)
      }

      const precomputedKeywordSet = await buildPreGenerationCreativeKeywordSet({
        offer,
        userId,
        creativeType,
        bucket,
        scopeLabel: `generate-ad-creative-single-${bucket}`,
        seedCandidates,
        enableSupplementation: true,
        continueOnSupplementError: true,
      })

      let usedKeywords: string[] = []
      const brandKeywords = buildCreativeBrandKeywords(offer.brand)

      const generationResult = await runCreativeGenerationQualityLoop({
        maxRetries: normalizedMaxRetries,
        delayMs: 1000,
        generate: async ({ attempt, retryFailureType }) => {
          const generatedData = await generateAdCreative(offerId, userId, {
            theme: bucketIntent,
            referencePerformance: reference_performance,
            skipCache: true,
            excludeKeywords: attempt > 1 ? usedKeywords : undefined,
            retryFailureType,
            searchTermFeedbackHints,
            bucket: bucket,
            bucketIntent: bucketIntent,
            bucketIntentEn: getThemeByBucket(bucket, linkType as 'product' | 'store').split(' - ')[1] || bucketIntent,
            deferKeywordPostProcessingToBuilder: true,
            precomputedKeywordSet,
          })

          await finalizeCreativeKeywordSet({
            offer,
            userId,
            creative: generatedData,
            creativeType,
            bucket,
            scopeLabel: `generate-ad-creative-single-final-${bucket}`,
            seedCandidates,
          })

          usedKeywords = mergeUsedKeywordsExcludingBrand({
            usedKeywords,
            candidateKeywords: resolveCreativeKeywordsForRetryExclusion(generatedData),
            brandKeywords,
          })

          return generatedData
        },
        evaluate: async (creative) => evaluateCreativeForQuality(createCreativeQualityEvaluationInput({
          creative,
          minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
          offer,
          userId,
          bucket,
          keywords: creative.keywords || [],
          productNameFallback: offerAny.product_title || offerAny.name,
          productTitleFallback: offerAny.title,
        }))
      })

      const generatedData = generationResult.selectedCreative
      const selectedEvaluation = generationResult.selectedEvaluation
      const evaluation = selectedEvaluation.adStrength
      const generatedDataAudit = resolveCreativeKeywordAudit(generatedData)
      const retryHistory = createCreativeApiRetryHistory(generationResult.history)

      if (hardQualityGateEnabled && !selectedEvaluation.passed) {
        throw createCreativeQualityGateError({
          bucket,
          attempts: generationResult.attempts,
          finalRating: evaluation.finalRating,
          finalScore: evaluation.finalScore,
          reasons: selectedEvaluation.reasons || [],
          failureType: selectedEvaluation.failureType || null,
          requiredMinimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
        })
      }

      if (hardPersistenceGateEnabled) {
        const persistenceGateResult = evaluateCreativePersistenceHardGate({
          creative: generatedData,
          bucket,
          targetLanguage: offer.target_language,
          brandName: offer.brand,
        })
        if (!persistenceGateResult.passed) {
          throw createCreativePersistenceGateError({
            attempts: generationResult.attempts,
            details: persistenceGateResult,
          })
        }
      }

      const adCreative = await createAdCreative(userId, offerId, {
        ...generatedData,
        final_url: offer.final_url || offer.url,
        final_url_suffix: offer.final_url_suffix || undefined,
        generation_round,
        creative_type: creativeType,
        keyword_bucket: bucket,
        bucket_intent: bucketIntent,
        score: evaluation.finalScore,
        score_breakdown: createCreativeScoreBreakdown(evaluation),
        adStrength: createCreativeAdStrengthPayload(evaluation, generatedDataAudit),
      })

      if (!selectedEvaluation.passed) {
        console.warn(
          `⚠️ 创意未达 GOOD 阈值，已保存最佳结果: rating=${evaluation.finalRating}, score=${evaluation.finalScore}`
        )
      }

      await markBucketGenerated(offerId, bucket)
      const updatedGeneratedBuckets = resolveGeneratedBuckets({
        availableBuckets: availableBuckets as CanonicalBucketSlot[],
        selectedBucket: bucket as CanonicalBucketSlot,
      })

      return NextResponse.json({
        success: true,
        ...createCreativePublishDecisionPayload(forcePublishRequested),
        creative: transformCreativeToApiResponse(adCreative),
        qualityGate: createCreativeQualityGatePayload(selectedEvaluation),
        optimization: createCreativeOptimizationPayload({
          attempts: generationResult.attempts,
          targetRating: 'GOOD',
          achieved: selectedEvaluation.passed,
          qualityGatePassed: selectedEvaluation.passed,
          history: retryHistory,
        }),
        keywordSupplementation: generatedData.keywordSupplementation || null,
        audit: generatedDataAudit,
        keywordSourceAudit: generatedDataAudit,
        ...createCreativeBucketSummaryPayload({
          creativeType,
          bucket,
          bucketIntent,
          generatedBuckets: updatedGeneratedBuckets,
        }),
        message: `广告创意生成成功 (${bucket} - ${bucketIntent})`
      })
    }

  } catch (error: any) {
    console.error('生成广告创意失败:', error)

    if (error?.code === 'CREATIVE_QUALITY_GATE_FAILED' || error?.code === 'CREATIVE_PERSISTENCE_GATE_FAILED') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message || '创意门禁未通过',
            details: error.details || null,
          },
        },
        { status: 422 }
      )
    }

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 特殊处理AI配置错误
    if (error.message?.includes('AI配置未设置')) {
      const appError = createError.aiConfigNotSet({
        suggestion: '请前往设置页面配置Gemini API',
        redirect: '/settings'
      })
      return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
    }

    // 通用创意生成错误
    const appError = createError.creativeGenerationFailed({
      originalError: error.message || '未知错误',
      offerId: parseInt((error as any).offerId) || undefined
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}

/**
 * GET /api/offers/[id]/generate-ad-creative
 * 获取指定Offer的所有广告创意
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const offerId = parseInt(params.id)
    if (isNaN(offerId)) {
      const error = createError.invalidParameter({ field: 'id', value: params.id })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(offerId, authResult.user.userId)
    if (!offer) {
      const error = createError.offerNotFound({ offerId, userId: authResult.user.userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const generationRound = searchParams.get('generation_round')
    const isSelected = searchParams.get('is_selected')

    const creatives = await listAdCreativesByOffer(offerId, authResult.user.userId, {
      generation_round: generationRound ? parseInt(generationRound) : undefined,
      is_selected: isSelected === 'true' ? true : isSelected === 'false' ? false : undefined
    })
    const publishableCreatives = creatives.filter(hasRequiredRsaAssetCounts)
    const filteredCreativeCount = creatives.length - publishableCreatives.length

    if (filteredCreativeCount > 0) {
      console.warn(
        `[Launch Step1] 过滤掉${filteredCreativeCount}条非15/4创意 (offerId=${offerId}, userId=${authResult.user.userId})`
      )
    }

    // 🔧 修复(2025-12-24): 从创意列表实时聚合generatedBuckets，避免依赖可能过时的数据库字段
    const transformedCreatives = publishableCreatives.map(transformCreativeToApiResponse)
    const generatedBuckets = Array.from(
      new Set(
        transformedCreatives
          .map(c => c.keywordBucket)
          .filter((b): b is string => !!b)
          .map(b => {
            const upper = String(b).toUpperCase()
            if (upper === 'A') return 'A'
            if (upper === 'B' || upper === 'C') return 'B'
            if (upper === 'D' || upper === 'S') return 'D'
            return upper
          })
      )
    )

    return NextResponse.json({
      success: true,
      // 🔧 修复(2025-12-11): 完整转换为 camelCase
      creatives: transformedCreatives,
      // 🔧 修复(2025-12-24): 从创意列表实时聚合，而不是读取数据库字段
      generatedBuckets: generatedBuckets,
      total: transformedCreatives.length
    })

  } catch (error: any) {
    console.error('获取广告创意列表失败:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'list_ad_creatives',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
