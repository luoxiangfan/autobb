/**
 * 统一队列配置API
 * GET /api/queue/config - 获取配置
 * PUT /api/queue/config - 更新配置（仅管理员）
 *
 * 🔥 修复：配置持久化到数据库，解决多实例环境配置不同步问题
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'

const GLOBAL_CONCURRENCY_MAX = 1000
const PER_USER_CONCURRENCY_MAX = 1000
const PER_TYPE_CONCURRENCY_MAX = 1000
const MAX_QUEUE_SIZE_MAX = 10000
const TASK_TIMEOUT_MIN_MS = 10000
const TASK_TIMEOUT_MAX_MS = 900000
const DEFAULT_MAX_RETRIES_MAX = 5
const RETRY_DELAY_MAX_MS = 60000

// 默认队列配置
const DEFAULT_QUEUE_CONFIG = {
  globalConcurrency: 999,  // 🔥 全局并发提升至999（补点击需求）
  perUserConcurrency: 999,  // 🔥 单用户并发提升至999（补点击需求）
  perTypeConcurrency: {
    scrape: 3,
    'ai-analysis': 2,
    sync: 1,
    backup: 1,
    email: 3,
    export: 2,
    'link-check': 2,
    cleanup: 1,
    'offer-extraction': 2,
    'batch-offer-creation': 1,
    'ad-creative': 3,  // 创意生成任务（允许多用户同时生成）
    'campaign-publish': 2,  // 广告系列发布并发限制
    'click-farm-trigger': 4, // 补点击触发任务（控制面）
    'click-farm-batch': 6, // 补点击批次分发任务（滚动派发）
    'click-farm': 50,  // 补点击任务并发限制（默认保守，避免小规格容器资源耗尽；可在管理台调整）
    'url-swap': 3,  // 换链接任务并发限制（避免Playwright池争用导致获取实例超时）
    'openclaw-strategy': 2,  // OpenClaw 策略任务并发限制
    'affiliate-product-sync': 2, // 联盟商品同步任务并发限制
    'openclaw-command': 3, // OpenClaw 指令执行任务并发限制
    'openclaw-affiliate-sync': 2, // OpenClaw 联盟佣金快照同步任务并发限制
    'openclaw-report-send': 2, // OpenClaw 报表投递任务并发限制
    'product-score-calculation': 2, // 商品推荐指数计算任务并发限制（AI密集型）
    'google-ads-campaign-sync': 2, // Google Ads 广告系列同步任务并发限制
  },
  maxQueueSize: 1000,
  taskTimeout: 900000, // 15分钟（店铺深度抓取+竞品分析可能需要10-15分钟）
  defaultMaxRetries: 3,
  retryDelay: 5000,
}

const ALL_TASK_TYPES = [
  'scrape',
  'ai-analysis',
  'sync',
  'backup',
  'email',
  'export',
  'link-check',
  'cleanup',
  'offer-extraction',
  'batch-offer-creation',
  'ad-creative',
  'campaign-publish',
  'click-farm-trigger',
  'click-farm-batch',
  'click-farm',
  'url-swap',
  'openclaw-strategy',
  'affiliate-product-sync',
  'openclaw-command',
  'openclaw-affiliate-sync',
  'openclaw-report-send',
  'google-ads-campaign-sync',
] as const

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeQueueConfig(input: any): typeof DEFAULT_QUEUE_CONFIG {
  const merged = {
    ...DEFAULT_QUEUE_CONFIG,
    ...(input || {}),
    perTypeConcurrency: {
      ...DEFAULT_QUEUE_CONFIG.perTypeConcurrency,
      ...(input?.perTypeConcurrency || {}),
    },
  }

  // 对缺失的任务类型，显式补齐为2，保持与运行时默认行为一致（避免UI不显示、配置丢失）
  for (const taskType of ALL_TASK_TYPES) {
    if (merged.perTypeConcurrency[taskType] === undefined) {
      merged.perTypeConcurrency[taskType] = 2
    }
    merged.perTypeConcurrency[taskType] = clampNumber(
      merged.perTypeConcurrency[taskType],
      1,
      PER_TYPE_CONCURRENCY_MAX,
      DEFAULT_QUEUE_CONFIG.perTypeConcurrency[taskType]
    )
  }

  merged.globalConcurrency = clampNumber(
    merged.globalConcurrency,
    1,
    GLOBAL_CONCURRENCY_MAX,
    DEFAULT_QUEUE_CONFIG.globalConcurrency
  )
  merged.perUserConcurrency = clampNumber(
    merged.perUserConcurrency,
    1,
    PER_USER_CONCURRENCY_MAX,
    DEFAULT_QUEUE_CONFIG.perUserConcurrency
  )
  merged.maxQueueSize = clampNumber(
    merged.maxQueueSize,
    10,
    MAX_QUEUE_SIZE_MAX,
    DEFAULT_QUEUE_CONFIG.maxQueueSize
  )
  merged.taskTimeout = clampNumber(
    merged.taskTimeout,
    TASK_TIMEOUT_MIN_MS,
    TASK_TIMEOUT_MAX_MS,
    DEFAULT_QUEUE_CONFIG.taskTimeout
  )
  merged.defaultMaxRetries = clampNumber(
    merged.defaultMaxRetries,
    0,
    DEFAULT_MAX_RETRIES_MAX,
    DEFAULT_QUEUE_CONFIG.defaultMaxRetries
  )
  merged.retryDelay = clampNumber(
    merged.retryDelay,
    1000,
    RETRY_DELAY_MAX_MS,
    DEFAULT_QUEUE_CONFIG.retryDelay
  )

  return merged
}

// 统一队列配置验证Schema
const queueConfigSchema = z.object({
  globalConcurrency: z.number().min(1).max(GLOBAL_CONCURRENCY_MAX).optional(),  // 🔥 提升上限至1000（支持补点击999并发）
  perUserConcurrency: z.number().min(1).max(PER_USER_CONCURRENCY_MAX).optional(),  // 🔥 提升上限至1000（支持补点击999并发）
  perTypeConcurrency: z.record(z.number().min(1).max(PER_TYPE_CONCURRENCY_MAX)).optional(),  // 🔥 提升上限至1000（支持补点击999并发）
  maxQueueSize: z.number().min(10).max(MAX_QUEUE_SIZE_MAX).optional(),
  // 兼容历史超限值：先裁剪再验证，避免“修改其它字段时被旧 taskTimeout 阻塞”
  taskTimeout: z.preprocess(
    (value) => (typeof value === 'number' && Number.isFinite(value)
      ? Math.min(value, TASK_TIMEOUT_MAX_MS)
      : value),
    z.number().min(TASK_TIMEOUT_MIN_MS).max(TASK_TIMEOUT_MAX_MS).optional()
  ),
  defaultMaxRetries: z.number().min(0).max(DEFAULT_MAX_RETRIES_MAX).optional(),
  retryDelay: z.number().min(1000).max(RETRY_DELAY_MAX_MS).optional(),
}).passthrough()  // 🔥 允许额外字段（如 enablePriority, storageType 等前端状态字段）

function getRuntimeQueueConfig(): typeof DEFAULT_QUEUE_CONFIG {
  const queueManager = getQueueManager()
  const current = queueManager.getConfig()
  return normalizeQueueConfig({
    globalConcurrency: current.globalConcurrency,
    perUserConcurrency: current.perUserConcurrency,
    perTypeConcurrency: current.perTypeConcurrency,
    maxQueueSize: current.maxQueueSize,
    taskTimeout: current.taskTimeout,
    defaultMaxRetries: current.defaultMaxRetries,
    retryDelay: current.retryDelay,
  })
}

/**
 * 从数据库读取队列配置
 */
async function getQueueConfigFromDB(): Promise<typeof DEFAULT_QUEUE_CONFIG | null> {
  try {
    const db = await getDatabase()
    const result = await db.queryOne<{ value: string }>(`
      SELECT value FROM system_settings
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
      LIMIT 1
    `)

    if (result?.value) {
      return normalizeQueueConfig(JSON.parse(result.value))
    }
    return null
  } catch (error) {
    console.error('[QueueConfig] 从数据库读取配置失败:', error)
    return null
  }
}

/**
 * 保存队列配置到数据库
 */
async function saveQueueConfigToDB(config: typeof DEFAULT_QUEUE_CONFIG): Promise<void> {
  const db = await getDatabase()
  const configJson = JSON.stringify(normalizeQueueConfig(config))

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(`
    SELECT id FROM system_settings
    WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
  `)

  if (existing) {
    // 更新现有配置
    await db.exec(`
      UPDATE system_settings
      SET value = ?, updated_at = datetime('now')
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
    `, [configJson])
  } else {
    // 插入新配置
    await db.exec(`
      INSERT INTO system_settings (
        user_id, category, key, value, data_type, is_sensitive, is_required, description
      ) VALUES (
        NULL, 'queue', 'config', ?, 'json', FALSE, FALSE, '统一队列系统配置'
      )
    `, [configJson])
  }
}

/**
 * GET /api/queue/config
 * 获取统一队列配置（需要登录）
 * 优先从数据库读取，确保多实例环境配置一致
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 🔥 优先从数据库读取配置（确保多实例一致性）；否则返回“当前运行时配置”（避免与初始化环境变量/默认值不一致）
    const dbConfig = await getQueueConfigFromDB()
    const runtimeConfig = getRuntimeQueueConfig()
    const effectiveConfig = dbConfig || runtimeConfig

    // 同步更新内存中的队列管理器配置（确保返回值与当前生效配置一致）
    const queueManager = getQueueManager()
    queueManager.updateConfig(effectiveConfig)

    // 返回配置
    return NextResponse.json({
      success: true,
      config: {
        globalConcurrency: effectiveConfig.globalConcurrency,
        perUserConcurrency: effectiveConfig.perUserConcurrency,
        perTypeConcurrency: effectiveConfig.perTypeConcurrency,
        maxQueueSize: effectiveConfig.maxQueueSize,
        taskTimeout: effectiveConfig.taskTimeout,
        defaultMaxRetries: effectiveConfig.defaultMaxRetries,
        retryDelay: effectiveConfig.retryDelay,
        enablePriority: true, // 统一队列始终启用优先级
        // 状态信息
        storageType: process.env.REDIS_URL ? 'redis' : 'memory',
        redisConnected: !!process.env.REDIS_URL,
        // 🔥 新增：标识配置来源
        configSource: dbConfig ? 'database' : 'runtime',
        knownTaskTypes: ALL_TASK_TYPES
      }
    })
  } catch (error: any) {
    console.error('[UnifiedQueueConfig] 获取配置失败:', error)
    return NextResponse.json(
      { error: error.message || '获取配置失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/queue/config
 * 更新统一队列配置（仅管理员）
 * 同时保存到数据库和更新内存，确保多实例环境配置一致
 */
export async function PUT(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 检查用户是否为管理员
    if (auth.user.role !== 'admin') {
      return NextResponse.json(
        {
          error: '权限不足',
          message: '只有管理员可以修改系统队列配置'
        },
        { status: 403 }
      )
    }

    // 解析请求体
    const body = await request.json()

    // 验证配置
    const validationResult = queueConfigSchema.safeParse(body)
    if (!validationResult.success) {
      console.error('[UnifiedQueueConfig] 配置验证失败:', {
        body,
        errors: validationResult.error.errors
      })
      return NextResponse.json(
        { error: '配置格式错误', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const newConfig = validationResult.data

    // 🔥 先从数据库读取现有配置，合并后保存
    const dbConfig = await getQueueConfigFromDB()
    const existingConfig = dbConfig || getRuntimeQueueConfig()
    const mergedConfig = {
      ...existingConfig,
      ...newConfig,
      // 确保 perTypeConcurrency 也正确合并
      perTypeConcurrency: {
        ...existingConfig.perTypeConcurrency,
        ...(newConfig.perTypeConcurrency || {})
      }
    }

    // 🔥 保存到数据库（持久化）
    const normalizedConfig = normalizeQueueConfig(mergedConfig)
    await saveQueueConfigToDB(normalizedConfig)

    // 更新当前实例的内存配置
    const queueManager = getQueueManager()
    queueManager.updateConfig(normalizedConfig)

    console.log(`[UnifiedQueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, newConfig)

    return NextResponse.json({
      success: true,
      message: '配置已保存到数据库并在当前实例生效',
      config: normalizedConfig,
    })
  } catch (error: any) {
    console.error('[UnifiedQueueConfig] 更新配置失败:', error)
    return NextResponse.json(
      { error: error.message || '更新配置失败' },
      { status: 500 }
    )
  }
}
