/**
 * 队列系统初始化API
 *
 * POST /api/queue/init
 *
 * 在应用启动时由QueueInitializer组件调用
 * 初始化统一队列系统（Redis优先 + 内存回退）
 */

import { NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { getDatabase } from '@/lib/db'
import type { QueueConfig } from '@/lib/queue/types'
import { getUrlSwapScheduler } from '@/lib/queue/schedulers/url-swap-scheduler'
import { getAffiliateProductSyncScheduler } from '@/lib/queue/schedulers/affiliate-product-sync-scheduler'
import { getGoogleAdsCampaignSyncScheduler } from '@/lib/queue/schedulers/google-ads-campaign-sync-scheduler'

// 全局标记：队列是否已初始化
let queueInitialized = false
let initializationPromise: Promise<void> | null = null

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : undefined
}

async function loadQueueConfigFromDB(): Promise<Partial<QueueConfig> | null> {
  try {
    const db = await getDatabase()
    const result = await db.queryOne<{ value: string }>(`
      SELECT value FROM system_settings
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
      LIMIT 1
    `)

    if (!result?.value) return null
    const parsed = JSON.parse(result.value) as Partial<QueueConfig>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.warn('⚠️  队列初始化：读取数据库配置失败，将使用环境变量/默认值:', error)
    return null
  }
}

/**
 * 初始化队列系统（单例模式）
 */
async function ensureQueueInitialized(): Promise<{ success: boolean; message: string }> {
  // 已初始化，直接返回
  if (queueInitialized) {
    return { success: true, message: '队列系统已运行中' }
  }

  // 正在初始化，等待完成
  if (initializationPromise) {
    await initializationPromise
    return { success: true, message: '队列系统初始化完成（等待中）' }
  }

  // 开始初始化
  initializationPromise = (async () => {
    try {
      console.log('🚀 开始初始化统一队列系统...')

      const dbConfig = await loadQueueConfigFromDB()
      const envConfig: Partial<QueueConfig> = {
        globalConcurrency: parseOptionalInt(process.env.QUEUE_GLOBAL_CONCURRENCY),
        perUserConcurrency: parseOptionalInt(process.env.QUEUE_PER_USER_CONCURRENCY),
        maxQueueSize: parseOptionalInt(process.env.QUEUE_MAX_SIZE),
        taskTimeout: parseOptionalInt(process.env.QUEUE_TASK_TIMEOUT),
        defaultMaxRetries: parseOptionalInt(process.env.QUEUE_MAX_RETRIES),
        retryDelay: parseOptionalInt(process.env.QUEUE_RETRY_DELAY),
      }

      // 获取队列管理器实例
      const queue = getQueueManager({
        ...envConfig,
        ...(dbConfig || {}),
        redisUrl: process.env.REDIS_URL,
        redisKeyPrefix:
          process.env.REDIS_KEY_PREFIX ||
          `autoads:${process.env.NODE_ENV || 'development'}:queue:`,
        proxyPool: [] // 代理在任务执行时按需加载
      })

      // 确保队列已启动（自动处理初始化）
      await queue.ensureStarted()

      // 如果 DB 配置是在队列实例创建后才加载出来（或包含新增字段），确保更新到内存配置
      if (dbConfig) {
        queue.updateConfig(dbConfig)
      }

      // 安全注册所有任务执行器（只注册一次）
      await queue.registerAllExecutorsSafe()

      // 启动内置调度器（各调度器内部具备幂等保护）
      // 数据同步由独立 scheduler 进程负责，Queue init API 不再启动内置版本
      console.log('⏭️ Queue init API: 跳过内置数据同步调度器（由独立 scheduler 进程负责）')
      getUrlSwapScheduler().start()
      getAffiliateProductSyncScheduler().start()
      getGoogleAdsCampaignSyncScheduler().start()

      queueInitialized = true
      console.log('✅ 统一队列系统初始化完成')
    } catch (error: any) {
      console.error('❌ 队列系统初始化失败:', error.message)
      throw error
    }
  })()

  await initializationPromise
  return { success: true, message: '队列系统初始化成功' }
}

export async function POST() {
  try {
    const result = await ensureQueueInitialized()

    return NextResponse.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('❌ 队列初始化API错误:', error.message)

    return NextResponse.json(
      {
        success: false,
        message: `队列初始化失败: ${error.message}`,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  // GET请求返回队列状态
  try {
    if (queueInitialized) {
      const queue = getQueueManager()
      const stats = await queue.getStats()

      return NextResponse.json({
        initialized: true,
        stats,
        timestamp: new Date().toISOString()
      })
    }

    return NextResponse.json({
      initialized: false,
      message: '队列系统尚未初始化',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        initialized: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
