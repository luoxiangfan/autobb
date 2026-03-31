/**
 * 广告创意生成任务执行器
 *
 * 功能：
 * 1. 调用核心generateAdCreative函数
 * 2. 将进度更新到creative_tasks表
 * 3. 支持SSE实时推送（通过数据库轮询）
 */

import type { Task } from '../types'
import { generateAdCreative } from '@/lib/ad-creative-gen'
import { createAdCreative } from '@/lib/ad-creative'
import {
  buildPreGenerationCreativeKeywordSet,
  buildCreativeBrandKeywords,
  createCreativeAdStrengthPayload,
  createCreativeOptimizationPayload,
  createCreativeOfferSummaryPayload,
  createCreativeQualityEvaluationInput,
  createCreativeResponsePayload,
  createCreativeScoreBreakdown,
  createCreativeTaskRetryHistory,
  evaluateCreativePersistenceHardGate,
  finalizeCreativeKeywordSet,
  mergeUsedKeywordsExcludingBrand,
  resolveCreativeKeywordAudit,
  resolveCreativeKeywordsForRetryExclusion,
} from '@/lib/creative-keyword-runtime'
import { findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/json-field'
import {
  AD_CREATIVE_MAX_AUTO_RETRIES,
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop
} from '@/lib/ad-creative-quality-loop'
// 🆕 v4.10: 关键词池集成
import {
  getOrCreateKeywordPool,
  getAvailableBuckets,
  getBucketInfo,
  type BucketType,
  type OfferKeywordPool,
  type PoolKeywordData
} from '@/lib/offer-keyword-pool'
import { getCreativeTypeForBucketSlot } from '@/lib/creative-type'
import { normalizeCreativeTaskError } from '@/lib/creative-task-error'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'

/**
 * 验证URL是否为有效的URL
 * 排除 null, undefined, "null", "null/" 等无效值
 */
function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (url === 'null' || url === 'null/' || url === 'undefined') return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function normalizeRequestedBucket(value: unknown): BucketType | null {
  const upper = String(value || '').trim().toUpperCase()
  if (!upper) return null
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function normalizeKeywordMapKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildKeywordPoolVolumeHintMap(keywordPool: OfferKeywordPool | null): Map<string, {
  searchVolume: number
  volumeUnavailableReason?: string
}> {
  const hints = new Map<string, { searchVolume: number; volumeUnavailableReason?: string }>()
  if (!keywordPool) return hints

  const groups: Array<unknown[] | undefined> = [
    keywordPool.brandKeywords,
    keywordPool.bucketAKeywords,
    keywordPool.bucketBKeywords,
    keywordPool.bucketCKeywords,
    keywordPool.bucketDKeywords,
    keywordPool.storeBucketAKeywords,
    keywordPool.storeBucketBKeywords,
    keywordPool.storeBucketCKeywords,
    keywordPool.storeBucketDKeywords,
    keywordPool.storeBucketSKeywords,
  ]

  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) continue
    for (const item of group) {
      const key = normalizeKeywordMapKey((item as any)?.keyword)
      if (!key) continue

      const searchVolume = Number((item as any)?.searchVolume || 0)
      const volumeUnavailableReasonRaw = String((item as any)?.volumeUnavailableReason || '').trim()
      const volumeUnavailableReason = volumeUnavailableReasonRaw || undefined

      const existing = hints.get(key)
      if (!existing) {
        hints.set(key, { searchVolume, volumeUnavailableReason })
        continue
      }

      if (searchVolume > existing.searchVolume) {
        hints.set(key, {
          searchVolume,
          volumeUnavailableReason: volumeUnavailableReason || existing.volumeUnavailableReason,
        })
        continue
      }

      if (!existing.volumeUnavailableReason && volumeUnavailableReason) {
        hints.set(key, {
          searchVolume: existing.searchVolume,
          volumeUnavailableReason,
        })
      }
    }
  }

  return hints
}

function backfillCreativeKeywordVolumesFromPoolHints(
  creative: Awaited<ReturnType<typeof generateAdCreative>>,
  hints: Map<string, { searchVolume: number; volumeUnavailableReason?: string }>,
  scopeLabel: string
): void {
  if (!Array.isArray(creative.keywordsWithVolume) || creative.keywordsWithVolume.length === 0) return
  if (!hints || hints.size === 0) return

  let patched = 0
  creative.keywordsWithVolume = creative.keywordsWithVolume.map((item) => {
    if (!item || typeof item !== 'object') return item

    const key = normalizeKeywordMapKey((item as any).keyword)
    if (!key) return item

    const hint = hints.get(key)
    if (!hint || hint.searchVolume <= 0) return item

    const currentSearchVolume = Number((item as any).searchVolume || 0)
    if (currentSearchVolume > 0) return item

    patched += 1
    return {
      ...item,
      searchVolume: hint.searchVolume,
      volumeUnavailableReason: (item as any).volumeUnavailableReason || hint.volumeUnavailableReason,
    }
  })

  if (patched > 0) {
    console.log(`[CreativeKeywordVolumeBackfill] ${scopeLabel}: patched ${patched} keywords from keyword pool hints`)
  }
}

const staleGeneratingPlaceholderMinutes = parsePositiveIntEnv(
  process.env.AD_CREATIVE_STALE_PLACEHOLDER_MINUTES,
  180
)
const staleGeneratingPlaceholderMs = staleGeneratingPlaceholderMinutes * 60 * 1000

function parseTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function parsePlaceholderTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
    }
  } catch {
    // Ignore invalid JSON and fallback to raw string
  }
  return [raw]
}

function shouldAutoReleaseGeneratingPlaceholder(row: {
  headlines: unknown
  descriptions: unknown
  created_at: unknown
  updated_at: unknown
}): boolean {
  const headlines = parsePlaceholderTextArray(row.headlines)
  const descriptions = parsePlaceholderTextArray(row.descriptions)
  const isPlaceholder =
    headlines.some(text => text.includes('生成中')) ||
    descriptions.some(text => text.includes('正在生成'))
  if (!isPlaceholder) return false

  const referenceMs = parseTimestampMs(row.updated_at) ?? parseTimestampMs(row.created_at)
  if (!referenceMs) return false

  return (Date.now() - referenceMs) >= staleGeneratingPlaceholderMs
}

/**
 * 广告创意生成任务数据接口
 */
export interface AdCreativeTaskData {
  offerId: number
  maxRetries?: number
  targetRating?: 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR'
  coverage?: boolean   // ✅ 新命名：coverage 模式，运行时仍统一映射到 D / product_intent
  synthetic?: boolean  // 🔧 向后兼容：旧版 coverage 标记（运行时映射到 D / product_intent）
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S'
  forceGenerateOnQualityGate?: boolean
  qualityGateBypassReason?: string
}

/**
 * 广告创意生成任务执行器
 */
export async function executeAdCreativeGeneration(
  task: Task<AdCreativeTaskData>
): Promise<any> {
  const {
    offerId,
    maxRetries = AD_CREATIVE_MAX_AUTO_RETRIES,
    targetRating = 'GOOD',
    coverage = false,
    synthetic = false,
    bucket,
    forceGenerateOnQualityGate = false,
    qualityGateBypassReason,
  } = task.data
  const db = getDatabase()
  const effectiveMaxRetries = Math.max(
    0,
    Math.min(
      AD_CREATIVE_MAX_AUTO_RETRIES,
      Number.isFinite(Number(maxRetries)) ? Math.floor(Number(maxRetries)) : AD_CREATIVE_MAX_AUTO_RETRIES
    )
  )
  const enforcedTargetRating: AdCreativeTaskData['targetRating'] = 'GOOD'
  const requestedBucket = normalizeRequestedBucket(bucket)
  const isCoverageTask = Boolean(coverage || synthetic)
  const creativeTaskHeartbeatMs = parsePositiveIntEnv(
    process.env.CREATIVE_TASK_HEARTBEAT_MS,
    15000
  )
  const creativeKeywordBrandOnly = parseBooleanEnv(
    process.env.CREATIVE_KEYWORD_BRAND_ONLY,
    false
  )
  const hardQualityGateEnabled = parseBooleanEnv(
    process.env.AD_CREATIVE_HARD_QUALITY_GATE_ENABLED,
    true
  )
  const hardPersistenceGateEnabled = parseBooleanEnv(
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED,
    true
  )
  const qualityGateBypassRequested = Boolean(forceGenerateOnQualityGate)
  const normalizedQualityGateBypassReason = String(qualityGateBypassReason || '').trim().slice(0, 240) || null

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const toDbJson = (value: any): any => toDbJsonObjectField(value, db.type, null)

  // 🔒 占位记录 ID（声明在 try 外，确保 catch 块可访问）
  let placeholderCreativeId: number | null = null

  try {
    // 更新任务状态为运行中
    await db.exec(`
      UPDATE creative_tasks
      SET status = 'running',
          started_at = ${nowFunc},
          message = '开始生成广告创意',
          max_retries = ?
      WHERE id = ?
    `, [effectiveMaxRetries, task.id])

    console.log(`🚀 开始执行创意生成任务: ${task.id}`)

    // 验证Offer存在
    const offer = await findOfferById(offerId, task.userId)
    if (!offer) {
      throw new Error('Offer不存在或无权访问')
    }

    if (offer.scrape_status === 'failed') {
      throw new Error('Offer信息抓取失败，请重新抓取')
    }

    let searchTermFeedbackHints: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
      highPerformingTerms?: string[]
    } | undefined
    try {
      const hints = await getSearchTermFeedbackHints({
        offerId,
        userId: task.userId,
      })
      searchTermFeedbackHints = {
        hardNegativeTerms: hints.hardNegativeTerms,
        softSuppressTerms: hints.softSuppressTerms,
        highPerformingTerms: hints.highPerformingTerms,
      }
      console.log(
        `🔁 队列搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
      )
    } catch (hintError: any) {
      console.warn(`⚠️ 队列搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
    }

    // 🆕 v4.10: 获取或创建关键词池（复用已有数据，避免重复AI调用）
    let keywordPool: OfferKeywordPool | null = null
    let selectedBucket: BucketType | null = null
    let bucketInfo: { keywords: PoolKeywordData[]; intent: string; intentEn: string } | null = null

    try {
      // 更新进度：准备关键词池
      await db.exec(`
        UPDATE creative_tasks
        SET stage = 'preparing', progress = 5, message = '正在准备关键词池...', updated_at = ${nowFunc}
        WHERE id = ?
      `, [task.id])

      type KeywordPoolProgressInfo = {
        phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'
        message: string
        current?: number
        total?: number
      }

      const reportKeywordPoolProgress = (() => {
        let lastProgress = 5
        let lastMessage = ''
        let lastUpdateAt = 0
        const minIntervalMs = 800

        const computeProgress = (info: KeywordPoolProgressInfo): number => {
          const ratio = info.current && info.total ? info.current / info.total : undefined
          switch (info.phase) {
            case 'seed-volume':
              return 6
            case 'expand-round':
              return 6 + (ratio ? Math.floor(ratio * 2) : 0) // 6-8
            case 'volume-batch':
              return 7 + (ratio ? Math.floor(ratio * 2) : 0) // 7-9
            case 'service-step':
              return 6 + (ratio ? Math.floor(ratio * 2) : 0) // 6-8
            case 'filter':
            case 'cluster':
            case 'save':
              return 9
            default:
              return 6
          }
        }

        return async (info: KeywordPoolProgressInfo) => {
          const now = Date.now()
          if (now - lastUpdateAt < minIntervalMs && info.message === lastMessage) return

          const nextProgress = Math.min(
            9,
            Math.max(lastProgress, computeProgress(info))
          )
          lastProgress = nextProgress
          lastMessage = info.message
          lastUpdateAt = now

          const message = info.message.startsWith('关键词池')
            ? info.message
            : `关键词池：${info.message}`

          try {
            await db.exec(`
              UPDATE creative_tasks
              SET stage = 'preparing', progress = ?, message = ?, updated_at = ${nowFunc}
              WHERE id = ?
            `, [nextProgress, message, task.id])
          } catch (error: any) {
            console.warn(`⚠️ 关键词池进度更新失败: ${error?.message || String(error)}`)
          }
        }
      })()

      keywordPool = await getOrCreateKeywordPool(offerId, task.userId, false, reportKeywordPoolProgress)

      // 🔒 使用事务级 advisory lock + 占位记录防止并发竞态
      // 在事务内完成：加锁 → 查询可用桶 → 插入占位记录
      // 事务提交后锁自动释放，但占位记录已写入，其他任务能看到桶被占用
      await db.transaction(async () => {
        // 使用 transaction-level advisory lock（事务结束自动释放）
        await db.exec('SELECT pg_advisory_xact_lock($1)', [offerId])
        console.log(`🔒 已获取 offer ${offerId} 的 transaction-level advisory lock`)

        // 在锁内查询可用桶（确保看到最新状态，包括其他任务的占位记录）
        const availableBucketsRaw = await getAvailableBuckets(offerId)

        // 额外保护：active 的 generating 占位记录也视为桶占用，防止并发重复生成同桶
        const generatingPlaceholders = await db.query<{
          id: number
          keyword_bucket: string | null
          headlines: string | null
          descriptions: string | null
          created_at: string | Date | null
          updated_at: string | Date | null
        }>(`
          SELECT id, keyword_bucket, headlines, descriptions, created_at, updated_at
          FROM ad_creatives
          WHERE offer_id = ?
            AND deleted_at IS NULL
            AND creation_status = 'generating'
        `, [offerId])

        const activeReservedBuckets = new Set<BucketType>()
        for (const placeholder of generatingPlaceholders) {
          const bucketSlot = normalizeRequestedBucket(placeholder.keyword_bucket)
          if (!bucketSlot) continue

          if (shouldAutoReleaseGeneratingPlaceholder(placeholder)) {
            await db.exec(`
              UPDATE ad_creatives
              SET
                is_deleted = ${db.type === 'sqlite' ? '1' : 'TRUE'},
                deleted_at = ${nowFunc},
                creation_status = 'failed',
                creation_error = ?,
                updated_at = ${nowFunc}
              WHERE id = ? AND deleted_at IS NULL
            `, [`系统自动回收超时占位创意（>${staleGeneratingPlaceholderMinutes}分钟）`, placeholder.id])
            console.warn(`🧹 自动回收超时占位记录 id=${placeholder.id} bucket=${bucketSlot}`)
            continue
          }

          activeReservedBuckets.add(bucketSlot)
        }

        if (activeReservedBuckets.size > 0) {
          console.log(`🔒 检测到运行中占位桶: ${Array.from(activeReservedBuckets).join(', ')}`)
        }

        const availableBuckets = availableBucketsRaw.filter(
          (slot) => !activeReservedBuckets.has(slot)
        )

        if (availableBuckets.length === 0) {
          throw new Error('该Offer已生成全部3种创意类型（A/B/D），无需继续生成。请删除某个类型后再生成。')
        }

        // 确定要生成的桶
        let preferred: BucketType | null = null
        if (requestedBucket) {
          if (!availableBuckets.includes(requestedBucket)) {
            throw new Error(
              `桶${requestedBucket}创意已存在或暂不可用。当前可用桶：${availableBuckets.join(', ') || '无'}`
            )
          }
          preferred = requestedBucket
        } else if (isCoverageTask && availableBuckets.includes('D')) {
          console.warn(`⚠️ 检测到 coverage/synthetic 请求，已映射为桶D（不再生成S桶）`)
          preferred = 'D'
        } else {
          preferred = availableBuckets[0]
        }

        if (!preferred) {
          throw new Error('未能确定可用的关键词桶')
        }

        if (!keywordPool) {
          throw new Error('关键词池未初始化')
        }

        selectedBucket = preferred
        bucketInfo = getBucketInfo(keywordPool, selectedBucket)
        const selectedCreativeType = getCreativeTypeForBucketSlot(selectedBucket as 'A' | 'B' | 'D')
        console.log(`📦 使用关键词池桶 ${selectedBucket} (${bucketInfo.intent}): ${bucketInfo.keywords.length} 个关键词`)

        // 🔥 关键修复：立即插入占位记录，标记桶已被占用
        // 使用最小化数据（后续 AI 生成完成后更新）
        const placeholderUrl = offer.final_url || offer.url || 'https://placeholder.com'
        const placeholderResult = await db.exec(`
          INSERT INTO ad_creatives (
            offer_id, user_id,
            headlines, descriptions, keywords,
            brand, url,
            final_url,
            creative_type,
            keyword_bucket, keyword_pool_id, bucket_intent,
            creation_status, theme
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          offerId,
          task.userId,
          JSON.stringify(['生成中...']),
          JSON.stringify(['正在生成广告创意，请稍候...']),
          JSON.stringify([]),
          offer.brand || null,
          offer.url || offer.final_url || null,
          placeholderUrl,
          selectedCreativeType,
          selectedBucket,
          keywordPool.id,
          bucketInfo.intent,
          'generating', // 标记为生成中
          `[生成中] ${bucketInfo.intent}`
        ])

        placeholderCreativeId = Number(placeholderResult.lastInsertRowid) || null
        console.log(`📝 已插入占位记录 id=${placeholderCreativeId}，桶 ${selectedBucket} 已被标记为占用`)
      })

      // 事务提交后，advisory lock 自动释放，但占位记录已生效
      console.log(`🔓 事务已提交，advisory lock 已自动释放，桶 ${selectedBucket} 占位记录生效`)
    } catch (poolError: any) {
      // 桶选择/并发冲突错误直接透传，不包装成"关键词池失败"
      const isBucketError = poolError.message?.includes('桶') || poolError.message?.includes('并发冲突') || poolError.message?.includes('创意类型')
      if (isBucketError) throw poolError
      // 🔥 统一架构(2025-12-16): 关键词池是必需的，失败直接抛错
      console.error(`❌ 关键词池创建失败: ${poolError.message}`)
      throw new Error(`关键词池创建失败，无法生成创意: ${poolError.message}`)
    }
    if (String(targetRating || '').toUpperCase() !== String(enforcedTargetRating)) {
      console.warn(`⚠️ queue targetRating=${targetRating} 已忽略，统一使用 GOOD 阈值`)
    }
    if (effectiveMaxRetries < Number(maxRetries)) {
      console.log(`ℹ️ 已限制自动重试次数: ${maxRetries} → ${effectiveMaxRetries}`)
    }
    if (!selectedBucket || !bucketInfo) {
      throw new Error('关键词桶上下文未初始化')
    }

    let usedKeywords: string[] = []
    const brandKeywords = buildCreativeBrandKeywords(offer.brand)
    const offerAny = offer as any
    const currentBucketInfo: { keywords: PoolKeywordData[]; intent: string; intentEn: string } = bucketInfo
    const rawBucketKeywords = currentBucketInfo.keywords
    const seedCandidates = Array.isArray(rawBucketKeywords)
      ? rawBucketKeywords as Array<Record<string, any>>
      : []
    const selectedCreativeType = selectedBucket
      ? getCreativeTypeForBucketSlot(selectedBucket as 'A' | 'B' | 'D')
      : null
    const keywordPoolVolumeHints = buildKeywordPoolVolumeHintMap(keywordPool)
    const precomputedKeywordSet = await buildPreGenerationCreativeKeywordSet({
      offer,
      userId: task.userId,
      creativeType: selectedCreativeType,
      bucket: (selectedBucket || null) as any,
      scopeLabel: selectedBucket ? `桶${selectedBucket}` : '默认',
      seedCandidates,
      enableSupplementation: Boolean(selectedBucket),
      continueOnSupplementError: true,
    })

    const generationResult = await runCreativeGenerationQualityLoop<Awaited<ReturnType<typeof generateAdCreative>>>({
      maxRetries: effectiveMaxRetries,
      delayMs: 1000,
      generate: async ({ attempt, retryFailureType }) => {
        const attemptBaseProgress = 10 + (attempt - 1) * 25
        const bucketLabel = selectedBucket ? ` [桶${selectedBucket}]` : ''
        const generationMessageBase = `第${attempt}次生成${bucketLabel}: AI正在创作广告文案...`
        const generationStartedAt = Date.now()
        let generationHeartbeatTimer: NodeJS.Timeout | null = null
        const updateGenerationHeartbeat = async () => {
          const elapsedSeconds = Math.floor((Date.now() - generationStartedAt) / 1000)
          await db.exec(`
            UPDATE creative_tasks
            SET stage = 'generating', progress = ?, message = ?, current_attempt = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress, `${generationMessageBase} (${elapsedSeconds}s)`, attempt, task.id])
        }
        await updateGenerationHeartbeat()
        generationHeartbeatTimer = setInterval(() => {
          void updateGenerationHeartbeat().catch((heartbeatError: any) => {
            console.warn(`⚠️ 创意生成心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
          })
        }, creativeTaskHeartbeatMs)

        let creative: Awaited<ReturnType<typeof generateAdCreative>>
        try {
          creative = await generateAdCreative(
            offerId,
            task.userId,
            {
              skipCache: true,
              excludeKeywords: attempt > 1 ? usedKeywords : undefined,
              retryFailureType,
              keywordPool: keywordPool || undefined,
              bucket: selectedBucket || undefined,
              searchTermFeedbackHints,
              bucketKeywords: currentBucketInfo.keywords.map((kw) => typeof kw === 'string' ? kw : kw.keyword),
              bucketIntent: currentBucketInfo.intent,
              bucketIntentEn: currentBucketInfo.intentEn,
              deferKeywordPostProcessingToBuilder: true,
              precomputedKeywordSet,
              // 🔥 2026-03-13: 移除 deferKeywordSupplementation，让缺口分析始终执行
              // deferKeywordSupplementation: Boolean(bucketInfo?.keywords && bucketInfo.keywords.length > 0)
            }
          )
        } finally {
          if (generationHeartbeatTimer) {
            clearInterval(generationHeartbeatTimer)
            generationHeartbeatTimer = null
          }
        }

        if (
          Array.isArray(creative.keywordsWithVolume)
          && creative.keywordsWithVolume.length > 0
          && precomputedKeywordSet.contextFallbackStrategy !== 'filtered'
        ) {
          console.warn(
            precomputedKeywordSet.contextFallbackStrategy === 'keyword_pool'
              ? '⚠️ 创意关键词上下文过滤后为空，回退关键词池候选'
              : '⚠️ 创意关键词上下文过滤后为空，回退原候选关键词'
          )
        }

        await finalizeCreativeKeywordSet({
          offer,
          userId: task.userId,
          creative,
          creativeType: selectedCreativeType,
          bucket: (selectedBucket || null) as any,
          scopeLabel: selectedBucket ? `桶${selectedBucket}-final` : '默认-final',
          seedCandidates,
        })
        backfillCreativeKeywordVolumesFromPoolHints(
          creative,
          keywordPoolVolumeHints,
          selectedBucket ? `桶${selectedBucket}-final` : '默认-final'
        )

        const executableKeywordCount = Array.isArray(creative.keywords)
          ? creative.keywords.length
          : 0
        if (executableKeywordCount === 0) {
          throw new Error(
            `关键词筛选后为空（bucket=${selectedBucket || 'unknown'}），中止本轮并触发重试`
          )
        }

        usedKeywords = mergeUsedKeywordsExcludingBrand({
          usedKeywords,
          candidateKeywords: resolveCreativeKeywordsForRetryExclusion(creative),
          brandKeywords,
        })

        return creative
      },
      evaluate: async (creative, { attempt }) => {
        const attemptBaseProgress = 10 + (attempt - 1) * 25
        const evaluationMessageBase = `第${attempt}次生成: 评估创意质量...`
        const evaluationStartedAt = Date.now()
        let evaluationHeartbeatTimer: NodeJS.Timeout | null = null
        const updateEvaluationHeartbeat = async () => {
          const elapsedSeconds = Math.floor((Date.now() - evaluationStartedAt) / 1000)
          await db.exec(`
            UPDATE creative_tasks
            SET stage = 'evaluating', progress = ?, message = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress + 10, `${evaluationMessageBase} (${elapsedSeconds}s)`, task.id])
        }
        await updateEvaluationHeartbeat()
        evaluationHeartbeatTimer = setInterval(() => {
          void updateEvaluationHeartbeat().catch((heartbeatError: any) => {
            console.warn(`⚠️ 创意评估心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
          })
        }, creativeTaskHeartbeatMs)

        try {
          const qualityEvaluation = await evaluateCreativeForQuality(createCreativeQualityEvaluationInput({
            creative,
            minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
            offer,
            userId: task.userId,
            bucket: selectedBucket || null,
            creativeType: selectedCreativeType,
            keywords: creative.keywords || [],
            productNameFallback: offerAny.product_title || offerAny.name,
            productTitleFallback: offerAny.title,
          }))

          let evaluation = qualityEvaluation
          let attemptPersistenceGateResult: ReturnType<typeof evaluateCreativePersistenceHardGate> | null = null
          if (hardPersistenceGateEnabled) {
            attemptPersistenceGateResult = evaluateCreativePersistenceHardGate({
              creative,
              bucket: selectedBucket || null,
              targetLanguage: offer.target_language,
              brandName: offer.brand,
            })
            if (!attemptPersistenceGateResult.passed) {
              const persistenceReasons = attemptPersistenceGateResult.violations.map(
                (item) => `persistence:${item.code}`
              )
              evaluation = {
                ...qualityEvaluation,
                passed: false,
                failureType: qualityEvaluation.failureType || 'format_fail',
                reasons: [...qualityEvaluation.reasons, ...persistenceReasons],
              }
            }
          }

          const evaluationSummaryMessage = attemptPersistenceGateResult && !attemptPersistenceGateResult.passed
            ? `第${attempt}次生成: ${evaluation.adStrength.finalRating} (${evaluation.adStrength.finalScore}分)，门禁预检未过`
            : `第${attempt}次生成: ${evaluation.adStrength.finalRating} (${evaluation.adStrength.finalScore}分)`

          await db.exec(`
            UPDATE creative_tasks
            SET progress = ?, message = ?, updated_at = ${nowFunc}
            WHERE id = ?
          `, [attemptBaseProgress + 18, evaluationSummaryMessage, task.id])
          return evaluation
        } finally {
          if (evaluationHeartbeatTimer) {
            clearInterval(evaluationHeartbeatTimer)
            evaluationHeartbeatTimer = null
          }
        }
      }
    })

    const attempts = generationResult.attempts
    const bestCreative = generationResult.selectedCreative
    const selectedEvaluation = generationResult.selectedEvaluation
    const bestEvaluation = selectedEvaluation.adStrength
    const bestCreativeAudit = resolveCreativeKeywordAudit(bestCreative)
    const retryHistory = createCreativeTaskRetryHistory(generationResult.history)
    const qualityGatePassed = (
      selectedEvaluation.rsaGate !== undefined || selectedEvaluation.ruleGate !== undefined
    )
      ? Boolean(selectedEvaluation.rsaGate?.passed) && Boolean(selectedEvaluation.ruleGate?.passed)
      : Boolean(selectedEvaluation.passed)
    const qualityWarning = !qualityGatePassed

    const qualityGateBypassed = qualityWarning && hardQualityGateEnabled && qualityGateBypassRequested
    if (qualityWarning && hardQualityGateEnabled && !qualityGateBypassRequested) {
      const gateReasons = Array.isArray(selectedEvaluation.reasons)
        ? selectedEvaluation.reasons
        : []
      const rsaReasons = Array.isArray(selectedEvaluation.rsaGate?.reasons)
        ? selectedEvaluation.rsaGate.reasons
        : []
      const ruleReasons = Array.isArray(selectedEvaluation.ruleGate?.reasons)
        ? selectedEvaluation.ruleGate.reasons
        : []
      const rsaPassed = selectedEvaluation.rsaGate?.passed
      const rulePassed = selectedEvaluation.ruleGate?.passed
      console.error(
        `[CreativeQualityGate] fail task=${task.id} bucket=${selectedBucket || 'unknown'} score=${bestEvaluation.finalScore} rating=${bestEvaluation.finalRating} rsaPassed=${String(rsaPassed)} rulePassed=${String(rulePassed)} reasons=${gateReasons.join(' | ') || '(none)'}`
      )
      const qualityGateError = new Error(
        `创意质量门禁未通过: ${bestEvaluation.finalRating} (${bestEvaluation.finalScore})`
      ) as Error & {
        code?: string
        category?: string
        userMessage?: string
        retryable?: boolean
        details?: Record<string, unknown>
      }
      qualityGateError.code = 'CREATIVE_QUALITY_GATE_FAILED'
      qualityGateError.category = 'validation'
      qualityGateError.userMessage = `创意质量规则门禁未通过（评级${bestEvaluation.finalRating}，${bestEvaluation.finalScore}分），任务已标记失败。`
      qualityGateError.retryable = true
      qualityGateError.details = {
        qualityGatePassed: false,
        requiredMinimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
        finalRating: bestEvaluation.finalRating,
        finalScore: bestEvaluation.finalScore,
        bucket: selectedBucket || null,
        attempts,
        failureType: selectedEvaluation.failureType || null,
        reasons: gateReasons,
        gateStates: {
          rsaPassed: rsaPassed ?? null,
          rulePassed: rulePassed ?? null,
          minimumScorePassed: selectedEvaluation.rsaGate?.minimumScorePassed ?? null,
          scoreGatePassed: selectedEvaluation.rsaGate?.gatePassed ?? null,
        },
        rsaReasons,
        ruleReasons,
        allowForceGenerate: true,
      }
      throw qualityGateError
    }

    if (qualityGateBypassed) {
      console.warn(
        `[CreativeQualityGate] bypassed task=${task.id} bucket=${selectedBucket || 'unknown'} score=${bestEvaluation.finalScore} rating=${bestEvaluation.finalRating} reason=${normalizedQualityGateBypassReason || 'user_confirmed'}`
      )
    } else if (qualityWarning) {
      console.warn(`⚠️ 创意未达 GOOD 阈值，已保存最佳结果: ${bestEvaluation.finalRating} (${bestEvaluation.finalScore})`)
    }

    if (hardPersistenceGateEnabled) {
      const persistenceGateResult = evaluateCreativePersistenceHardGate({
        creative: bestCreative,
        bucket: selectedBucket || null,
        targetLanguage: offer.target_language,
        brandName: offer.brand,
      })
      if (!persistenceGateResult.passed) {
        const persistenceGateError = new Error(
          `创意落库门禁未通过: ${persistenceGateResult.violations.map((item) => item.code).join(', ')}`
        ) as Error & {
          code?: string
          category?: string
          userMessage?: string
          retryable?: boolean
          details?: Record<string, unknown>
        }
        persistenceGateError.code = 'CREATIVE_PERSISTENCE_GATE_FAILED'
        persistenceGateError.category = 'validation'
        persistenceGateError.userMessage = '创意落库门禁未通过，任务已标记失败。'
        persistenceGateError.retryable = true
        persistenceGateError.details = {
          attempts,
          ...persistenceGateResult,
        }
        throw persistenceGateError
      }
    }

    // 更新进度：保存中
    await db.exec(`
      UPDATE creative_tasks
      SET stage = 'saving', progress = 85, message = '正在保存创意到数据库...', updated_at = ${nowFunc}
      WHERE id = ?
    `, [task.id])

    // 保存到数据库（包含完整的7维度Ad Strength数据）
    let savedCreative: any
    if (placeholderCreativeId) {
      // 🔥 修复：更新占位记录为真实创意数据
      console.log(`📝 更新占位记录 id=${placeholderCreativeId} 为真实创意数据`)
      
      const finalUrl = (() => {
        if (isValidUrl(offer.final_url)) return offer.final_url!
        if (isValidUrl(offer.url)) return offer.url!
        throw new Error('Offer缺少有效的URL（final_url和url均为无效值）')
      })()

      await db.exec(`
        UPDATE ad_creatives SET
          headlines = ?,
          descriptions = ?,
          keywords = ?,
          keywords_with_volume = ?,
          negative_keywords = ?,
          callouts = ?,
          sitelinks = ?,
          theme = ?,
          explanation = ?,
          brand = ?,
          url = ?,
          final_url = ?,
          final_url_suffix = ?,
          score = ?,
          score_breakdown = ?,
          generation_round = ?,
          ai_model = ?,
          ad_strength_data = ?,
          creative_type = ?,
          creation_status = 'draft',
          updated_at = ${nowFunc}
        WHERE id = ?
      `, [
        JSON.stringify(bestCreative.headlines),
        JSON.stringify(bestCreative.descriptions),
        JSON.stringify(bestCreative.keywords),
        bestCreative.keywordsWithVolume && bestCreative.keywordsWithVolume.length > 0
          ? JSON.stringify(bestCreative.keywordsWithVolume)
          : null,
        bestCreative.negativeKeywords && bestCreative.negativeKeywords.length > 0
          ? JSON.stringify(bestCreative.negativeKeywords)
          : null,
        bestCreative.callouts ? JSON.stringify(bestCreative.callouts) : null,
        bestCreative.sitelinks ? JSON.stringify(bestCreative.sitelinks) : null,
        bestCreative.theme,
        bestCreative.explanation,
        offer.brand || null,
        offer.url || offer.final_url || null,
        finalUrl,
        offer.final_url_suffix || null,
        bestEvaluation.finalScore,
        JSON.stringify(createCreativeScoreBreakdown(bestEvaluation, { allowPartialMetrics: true })),
        attempts,
        bestCreative.ai_model,
        JSON.stringify(createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit)),
        selectedBucket
          ? getCreativeTypeForBucketSlot(selectedBucket as 'A' | 'B' | 'D')
          : null,
        placeholderCreativeId
      ])
      
      // 读取更新后的记录
      savedCreative = await db.queryOne('SELECT * FROM ad_creatives WHERE id = ?', [placeholderCreativeId])
      if (!savedCreative) {
        throw new Error(`更新占位记录失败: id=${placeholderCreativeId}`)
      }
      savedCreative.id = placeholderCreativeId
      console.log(`✅ 占位记录已更新为真实创意 id=${placeholderCreativeId}`)
    } else {
      // 降级：没有占位记录（SQLite 或旧流程），直接插入
      console.log(`📝 直接插入新创意记录（无占位记录）`)
      savedCreative = await createAdCreative(task.userId, offerId, {
        headlines: bestCreative.headlines,
        descriptions: bestCreative.descriptions,
        keywords: bestCreative.keywords,
        keywordsWithVolume: bestCreative.keywordsWithVolume,
        negativeKeywords: bestCreative.negativeKeywords,
        callouts: bestCreative.callouts,
        sitelinks: bestCreative.sitelinks,
        theme: bestCreative.theme,
        explanation: bestCreative.explanation,
        final_url: (() => {
          if (isValidUrl(offer.final_url)) return offer.final_url!
          if (isValidUrl(offer.url)) return offer.url!
          throw new Error('Offer缺少有效的URL（final_url和url均为无效值）')
        })(),
        final_url_suffix: offer.final_url_suffix || undefined,
        score: bestEvaluation.finalScore,
        score_breakdown: createCreativeScoreBreakdown(bestEvaluation, { allowPartialMetrics: true }),
        generation_round: attempts,
        ai_model: bestCreative.ai_model,
        adStrength: createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit),
        creative_type: selectedBucket
          ? getCreativeTypeForBucketSlot(selectedBucket as 'A' | 'B' | 'D')
          : undefined,
        keyword_bucket: selectedBucket || undefined,
        keyword_pool_id: keywordPool?.id || undefined,
        bucket_intent: currentBucketInfo.intent || undefined
      })
    }

    // 构建完整结果
    const finalResult = {
      success: true,
      creative: createCreativeResponsePayload({
        id: savedCreative.id,
        creative: bestCreative,
        audit: bestCreativeAudit,
        includeNegativeKeywords: true,
        includeKeywordSupplementation: true,
      }),
      adStrength: createCreativeAdStrengthPayload(bestEvaluation, bestCreativeAudit),
      optimization: createCreativeOptimizationPayload({
        attempts,
        targetRating: enforcedTargetRating,
        achieved: selectedEvaluation.passed,
        qualityGatePassed: selectedEvaluation.passed,
        history: retryHistory
      }),
      qualityGate: {
        passed: qualityGatePassed,
        bypassed: qualityGateBypassed,
        reasons: Array.isArray(selectedEvaluation.reasons) ? selectedEvaluation.reasons : [],
        finalRating: bestEvaluation.finalRating,
        finalScore: bestEvaluation.finalScore,
        requiredMinimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
        bypassReason: qualityGateBypassed
          ? (normalizedQualityGateBypassReason || 'user_confirmed_from_quality_gate_modal')
          : null,
      },
      offer: createCreativeOfferSummaryPayload(offer)
    }

    // 更新任务为完成状态（带质量警告标记）
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'completed',
        stage = 'complete',
        progress = 100,
        message = ?,
        creative_id = ?,
        result = ?,
        optimization_history = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc}
      WHERE id = ?
    `, [
      qualityGateBypassed
        ? `⚠️ 已按确认强制生成（质量门禁未通过，${bestEvaluation.finalScore}分）`
        : qualityWarning
          ? `⚠️ 生成完成（质量${bestEvaluation.finalScore}分，建议优化）`
        : '✅ 生成完成',
      savedCreative.id,
      toDbJson(finalResult),
      toDbJson(retryHistory),
      task.id
    ])

    if (qualityWarning) {
      console.log(`⚠️ 创意生成任务完成（质量警告）: ${task.id} - ${bestEvaluation.finalScore}分`)
    } else {
      console.log(`✅ 创意生成任务完成: ${task.id}`)
    }

    return finalResult
  } catch (error: any) {
    console.error(`❌ 创意生成任务失败: ${task.id}:`, error.message)

    // 🔥 如果有占位记录但生成失败，删除占位记录避免桶被永久占用
    if (placeholderCreativeId) {
      try {
        await db.exec('DELETE FROM ad_creatives WHERE id = ?', [placeholderCreativeId])
        console.log(`🗑️ 已删除占位记录 id=${placeholderCreativeId}（任务失败）`)
      } catch (deleteErr: any) {
        console.warn(`⚠️ 删除占位记录失败: ${deleteErr?.message}`)
      }
    }

    // 🔧 PostgreSQL兼容性：在catch块中也需要使用正确的NOW函数
    const nowFuncErr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const structuredError = normalizeCreativeTaskError(error, '创意生成任务失败')
    const errorMessage = structuredError.userMessage || structuredError.message || '任务失败'

    // 更新任务为失败状态
    await db.exec(`
      UPDATE creative_tasks
      SET
        status = 'failed',
        message = ?,
        error = ?,
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr}
      WHERE id = ?
    `, [
      errorMessage,
      toDbJson({
        ...structuredError,
        message: structuredError.message || error.message,
        userMessage: structuredError.userMessage || errorMessage,
        details: {
          ...(structuredError.details || {}),
          originalMessage: error?.message || structuredError.message,
          stack: error?.stack || null,
        },
      }),
      task.id
    ])

    throw error
  }
}