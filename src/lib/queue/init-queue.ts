/**
 * 队列系统初始化脚本
 *
 * 在应用启动时自动初始化统一队列管理器
 *
 * 代理配置说明：
 * - 代理不在初始化时全局加载，而是在任务执行时按需加载
 * - 每个用户使用自己配置的代理，不使用全局代理
 * - 只有特定任务类型（如scrape）需要代理
 *
 * 🔥 Redis环境隔离 (2025-12-10优化为方案3):
 * - 使用结构化REDIS_PREFIX_CONFIG配置
 * - 队列: autoads:{NODE_ENV}:queue:
 * - 缓存: autoads:{NODE_ENV}:cache:
 * - 统一的命名空间设计
 */

import { getQueueManager } from './index'
import { registerAllExecutors } from './executors'
import { NODE_ENV, REDIS_PREFIX_CONFIG } from '../config'
import type { UnifiedQueueManager } from './unified-queue-manager'
import type { QueueConfig } from './types'
import { getUrlSwapScheduler } from './schedulers/url-swap-scheduler'
import { getAffiliateProductSyncScheduler } from './schedulers/affiliate-product-sync-scheduler'
import { getQueueRoutingDiagnostics } from './queue-routing'
import { logger } from '@/lib/structured-logger'

// 🔧 修复(2025-01-01): 防止队列重复初始化
let __queueInitialized = false
let __queueInitPromise: Promise<UnifiedQueueManager> | null = null

/**
 * 初始化统一队列系统
 */
export async function initializeQueue(): Promise<UnifiedQueueManager> {
  // 🔧 修复(2025-01-01): 防止重复初始化
  if (__queueInitialized) {
    console.log('⏭️ 队列系统已初始化，跳过重复初始化')
    return getQueueManager()
  }

  // 防止并发初始化时的竞态条件
  if (__queueInitPromise) {
    return __queueInitPromise
  }

  __queueInitPromise = (async () => {
    console.log('🚀 初始化统一队列系统...')

    console.log(`📝 环境配置:`)
    console.log(`   - NODE_ENV: ${NODE_ENV}`)
    console.log(`   - Redis Queue Prefix: ${REDIS_PREFIX_CONFIG.queue}`)
    console.log(`   - Redis Cache Prefix: ${REDIS_PREFIX_CONFIG.cache}`)
    console.log(`   - 任务队列隔离: ✅ 已启用`)
    logger.info('queue_routing_diagnostics', getQueueRoutingDiagnostics())

    // 获取队列管理器实例
    // 注意：不再在初始化时加载代理池，代理在任务执行时按需加载
    const queue = getQueueManager({
      // 从环境变量读取配置
      globalConcurrency: parseInt(process.env.QUEUE_GLOBAL_CONCURRENCY || '999'),  // 🔥 全局并发提升至999（补点击需求）
      perUserConcurrency: parseInt(process.env.QUEUE_PER_USER_CONCURRENCY || '999'),  // 🔥 单用户并发提升至999（补点击需求）
      maxQueueSize: parseInt(process.env.QUEUE_MAX_SIZE || '1000'),
      taskTimeout: parseInt(process.env.QUEUE_TASK_TIMEOUT || '600000'),  // 🔥 修复（2025-12-10）：默认10分钟（Offer提取约需5分钟）
      defaultMaxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000'),
      redisUrl: process.env.REDIS_URL,
      redisKeyPrefix: REDIS_PREFIX_CONFIG.queue,  // 🔥 使用环境隔离的prefix
      // 代理池为空，代理在任务执行时按需从用户配置加载
      proxyPool: []
    })

    // 连接存储适配器（Redis优先，失败则回退内存）
    await queue.initialize()
    logger.info('queue_runtime_status', {
      ...queue.getRuntimeInfo(),
      ...getQueueRoutingDiagnostics(),
    })

    // 注册任务执行器
    registerAllExecutors(queue)

    // 启动队列处理循环
    await queue.start()

    // 数据同步由独立 scheduler 进程负责，队列初始化阶段不再启动内置数据同步调度器
    console.log('⏭️ 跳过内置数据同步调度器（由独立 scheduler 进程负责）')

    // 🔄 URL Swap 调度器已迁移到独立 scheduler 进程（与补点击任务架构一致）
    // 原因：补点击任务只在 scheduler 进程运行且工作正常，换链接任务采用相同架构
    console.log('⏭️ 跳过内置 URL Swap 调度器（由独立 scheduler 进程负责）')

    // 🔄 联盟商品同步调度器已迁移到独立 scheduler 进程（与补点击任务架构一致）
    // 原因：补点击任务只在 scheduler 进程运行且工作正常，联盟商品同步采用相同架构
    console.log('⏭️ 跳过内置联盟商品同步调度器（由独立 scheduler 进程负责）')

    console.log('✅ 统一队列系统已启动')
    console.log('📝 代理配置：任务执行时按需从用户设置加载')
    console.log('🔄 所有调度器已迁移至独立 scheduler 进程')

    // 🔧 修复(2025-01-01): 标记为已初始化
    __queueInitialized = true

    return queue
  })()

  try {
    return await __queueInitPromise
  } catch (error: any) {
    console.error('❌ 队列系统初始化失败:', error.message)
    __queueInitPromise = null  // 重置失败的初始化承诺
    throw error
  }
}

/**
 * 优雅关闭队列系统
 */
export async function shutdownQueue() {
  try {
    console.log('⏹️ 关闭队列系统...')

    // URL Swap 和联盟商品同步调度器已迁移到独立 scheduler 进程，此处无需停止

    // 停止队列处理
    const queue = getQueueManager()
    await queue.stop()

    console.log('✅ 队列系统已关闭')
  } catch (error: any) {
    console.error('❌ 队列系统关闭失败:', error.message)
  }
}

// 处理进程退出信号
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('\n收到SIGINT信号...')
    await shutdownQueue()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n收到SIGTERM信号...')
    await shutdownQueue()
    process.exit(0)
  })
}

/**
 * 获取队列管理器并确保已初始化和启动
 * 用于API路由中快速获取可用的队列实例
 */
export async function getOrCreateQueueManager(config?: Partial<QueueConfig>): Promise<UnifiedQueueManager> {
  const queue = getQueueManager(config)
  await queue.ensureStarted()
  return queue
}
