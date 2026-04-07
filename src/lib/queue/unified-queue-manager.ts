import { randomUUID } from 'crypto'
import { getHeapStatistics } from 'v8'
import type {
  Task,
  TaskType,
  TaskPriority,
  TaskExecutor,
  QueueConfig,
  QueueStats,
  QueueStorageAdapter,
  PendingEligibilityStats,
  RunningConcurrencySnapshot,
  ProxyConfig
} from './types'
import { MemoryQueueAdapter } from './memory-adapter'
import { RedisQueueAdapter } from './redis-adapter'
import { SimpleProxyManager } from './proxy-manager'
import { isProxyRequiredForTaskType, getProxyForCountry } from './user-proxy-loader'
import { isBackgroundTaskType } from './task-category'
import { logger } from '@/lib/structured-logger'
import { runWithLogContext } from '@/lib/log-context'
import { toDbJsonObjectField } from '@/lib/json-field'
import {
  assertUserExecutionAllowed,
  isUserExecutionSuspendedError,
  USER_EXECUTION_SUSPENDED_ERROR_CODE,
} from '@/lib/user-execution-eligibility'

function getPositiveIntFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback

  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return parsed
}

function getBoundedFloatFromEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key]
  if (!raw) return fallback

  const parsed = parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function getBooleanFromEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function isBackgroundWorkerProcess(): boolean {
  return getBooleanFromEnv('QUEUE_BACKGROUND_WORKER', false)
}

function canRunBackgroundQueueConsumerInCurrentProcess(): boolean {
  const splitEnabled = getBooleanFromEnv('QUEUE_SPLIT_BACKGROUND', false)
  if (!splitEnabled) return true
  if (isBackgroundWorkerProcess()) return true
  return getBooleanFromEnv('QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB', false)
}

function clampPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

/**
 * 统一队列管理器
 *
 * 核心功能:
 * 1. Redis优先 + 内存回退
 * 2. 三层并发控制 (全局/用户/类型)
 * 3. 代理IP池管理
 * 4. 任务执行器注册
 * 5. 自动重试机制
 */
export class UnifiedQueueManager {
  private adapter: QueueStorageAdapter
  private config: QueueConfig
  private executors: Map<TaskType, TaskExecutor> = new Map()
  private proxyManager: SimpleProxyManager
  private running: boolean = false
  private processingLoop: NodeJS.Timeout | null = null

  // 并发控制
  private globalRunningCount: number = 0
  private perUserRunningCount: Map<number, number> = new Map()
  private perTypeRunningCount: Map<TaskType, number> = new Map()

  // 轻量级后台任务：不占用“核心任务配额”（global/perUser 并发），避免阻塞创意生成等重任务
  private backgroundRunningCount: number = 0
  private backgroundPerUserRunningCount: Map<number, number> = new Map()

  // 初始化状态跟踪
  private initialized: boolean = false
  private initializingPromise: Promise<void> | null = null
  private started: boolean = false
  private startingPromise: Promise<void> | null = null
  private executorsRegistered: boolean = false

  // 🔥 健康检查定时器
  private healthCheckLoop: NodeJS.Timeout | null = null
  private readonly HEALTH_CHECK_INTERVAL = 5 * 60 * 1000  // 5分钟检查一次
  private readonly STALE_TASK_TIMEOUT = 30 * 60 * 1000    // 30分钟超时
  private readonly BATCH_STATUS_CHECK_INTERVAL = 60 * 1000  // 1分钟检查一次 batch 状态

  // 🔥 错误追踪和退避机制（防止Redis连接问题时的错误刷屏）
  private consecutiveErrors: number = 0
  private lastErrorTime: number = 0
  private lastRunningSnapshotErrorAt: number = 0
  private readonly MAX_CONSECUTIVE_ERRORS = 3
  private readonly ERROR_BACKOFF_MS = 5000  // 连续错误后暂停5秒
  private readonly clickFarmHeapPressureThresholdPct = getBoundedFloatFromEnv(
    'QUEUE_CLICK_FARM_HEAP_PRESSURE_PCT',
    72,
    50,
    95
  )
  private readonly clickFarmConcurrencyHardCap = getPositiveIntFromEnv(
    'QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP',
    40
  )
  private readonly clickFarmBatchConcurrencyHardCap = getPositiveIntFromEnv(
    'QUEUE_CLICK_FARM_BATCH_CONCURRENCY_HARD_CAP',
    12
  )
  private readonly clickFarmTriggerConcurrencyHardCap = getPositiveIntFromEnv(
    'QUEUE_CLICK_FARM_TRIGGER_CONCURRENCY_HARD_CAP',
    8
  )
  private readonly skipStartupPendingRepair = getBooleanFromEnv(
    'QUEUE_SKIP_STARTUP_PENDING_REPAIR',
    false
  )

  constructor(config: Partial<QueueConfig> = {}) {
    const defaultRedisKeyPrefix =
      process.env.REDIS_KEY_PREFIX ||
      `autoads:${process.env.NODE_ENV || 'development'}:queue:`

    const clickFarmConcurrencyCap = getPositiveIntFromEnv('QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP', 40)
    const defaultClickFarmConcurrency = Math.min(
      getPositiveIntFromEnv('QUEUE_CLICK_FARM_CONCURRENCY', 20),
      Math.max(1, clickFarmConcurrencyCap)
    )
    const defaultUrlSwapConcurrency = getPositiveIntFromEnv('QUEUE_URL_SWAP_CONCURRENCY', 3)

    // 合并默认配置
    this.config = {
      autoStartOnEnqueue: config.autoStartOnEnqueue !== false,
      globalConcurrency: config.globalConcurrency || 999,    // 🔥 全局并发提升至999（补点击需求）
      perUserConcurrency: config.perUserConcurrency || 999,  // 🔥 单用户并发提升至999（补点击需求）
      perTypeConcurrency: config.perTypeConcurrency || {
        scrape: 3,
        'ai-analysis': 2,
        sync: 1,
        backup: 1,
        email: 3,
        export: 2,
        'link-check': 2,
        cleanup: 1,
        'offer-extraction': 2,      // Offer提取任务并发限制（AI密集型）
        'batch-offer-creation': 1,  // 批量任务协调器（串行执行，避免资源竞争）
        'ad-creative': 3,           // 创意生成任务并发限制（提高到3，允许多用户同时生成）
        'campaign-publish': 2,      // 🆕 广告系列发布并发限制（Google Ads API限制）
        'click-farm-trigger': 4,    // 🆕 补点击触发任务（控制面）
        'click-farm-batch': 6,      // 🆕 补点击批次分发任务（滚动派发）
        'click-farm': defaultClickFarmConcurrency, // 🆕 支持通过 QUEUE_CLICK_FARM_CONCURRENCY 覆盖
        'url-swap': defaultUrlSwapConcurrency,     // 支持通过 QUEUE_URL_SWAP_CONCURRENCY 覆盖
        'openclaw-strategy': 2,     // 🆕 OpenClaw 策略任务并发限制（默认2，避免策略批量冲击配额）
        'affiliate-product-sync': 2, // 🆕 联盟商品同步任务并发限制（默认2，降低平台API冲击）
        'openclaw-command': 3,       // 🆕 OpenClaw 指令执行任务并发限制
        'openclaw-affiliate-sync': 2, // 🆕 OpenClaw 联盟佣金快照同步任务并发限制
        'openclaw-report-send': 2,    // 🆕 OpenClaw 报表投递任务并发限制
        'product-score-calculation': 2, // 🆕 商品推荐指数计算任务并发限制（AI密集型）
        'google-ads-campaign-sync': 1, // 🆕 Google Ads广告系列同步任务并发限制
      },
      maxQueueSize: config.maxQueueSize || 1000,
      taskTimeout: config.taskTimeout || 900000,  // 15分钟超时（店铺深度抓取+竞品分析可能需要10-15分钟）
      defaultMaxRetries: config.defaultMaxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      redisKeyPrefix: config.redisKeyPrefix || defaultRedisKeyPrefix,
      proxyPool: config.proxyPool || [],
      proxyRotation: config.proxyRotation !== false,
      instanceName: config.instanceName
    }

    // 初始化代理管理器
    this.proxyManager = new SimpleProxyManager(this.config.proxyPool || [])

    // 初始化存储适配器（Redis优先 → 内存回退）
    this.adapter = this.createAdapter()
  }

  private isBackgroundTaskType(type: TaskType): boolean {
    return isBackgroundTaskType(type)
  }

  private getCoreGlobalRunningCount(): number {
    return Math.max(0, this.globalRunningCount - this.backgroundRunningCount)
  }

  private isHeapPressureHigh(thresholdPct: number): boolean {
    try {
      const heapUsed = process.memoryUsage().heapUsed
      const limit = getHeapStatistics().heap_size_limit
      if (!limit || limit <= 0) return false
      const pct = (heapUsed / limit) * 100
      return pct >= thresholdPct
    } catch {
      return false
    }
  }

  /**
   * 创建存储适配器（Redis优先 → 内存回退）
   */
  private createAdapter(): QueueStorageAdapter {
    if (this.config.redisUrl) {
      console.log('🔄 尝试连接Redis队列...')
      return new RedisQueueAdapter(
        this.config.redisUrl,
        this.config.redisKeyPrefix
      )
    } else {
      console.log('⚠️ REDIS_URL未配置，使用内存队列')
      return new MemoryQueueAdapter()
    }
  }

  getRuntimeInfo(): {
    instanceName: string
    adapter: string
    connected: boolean
    redisUrlPresent: boolean
    redisKeyPrefix?: string
    autoStartOnEnqueue: boolean
  } {
    const adapterName = (this.adapter as any)?.constructor?.name || 'UnknownAdapter'
    const connected = typeof this.adapter.isConnected === 'function'
      ? this.adapter.isConnected()
      : true
    return {
      instanceName: this.config.instanceName || 'queue',
      adapter: adapterName,
      connected,
      redisUrlPresent: Boolean(this.config.redisUrl),
      redisKeyPrefix: this.config.redisKeyPrefix,
      autoStartOnEnqueue: this.config.autoStartOnEnqueue !== false,
    }
  }

  /**
   * 初始化队列（连接存储）
   * 只执行一次，后续调用直接返回
   */
  async initialize(): Promise<void> {
    // 如果已初始化，直接返回
    if (this.initialized) {
      console.log(`✅ 队列已初始化: ${this.adapter.constructor.name}`)
      return
    }

    // 如果正在初始化，等待完成
    if (this.initializingPromise) {
      await this.initializingPromise
      return
    }

    // 开始初始化
    this.initializingPromise = (async () => {
      try {
        await this.adapter.connect()
        console.log(`✅ 队列已初始化: ${this.adapter.constructor.name}`)
        logger.info('queue_runtime_info', this.getRuntimeInfo())
        this.initialized = true
      } catch (error: any) {
        console.error('❌ Redis连接失败，回退到内存队列:', error.message)

        // 回退到内存队列
        this.adapter = new MemoryQueueAdapter()
        await this.adapter.connect()
        console.log('✅ 内存队列已启用')
        logger.warn('queue_runtime_info', {
          ...this.getRuntimeInfo(),
          fallback: 'memory',
          error: error?.message || String(error),
        })
        this.initialized = true
      }
    })()

    await this.initializingPromise
  }

  /**
   * 启动队列处理
   * 只执行一次，后续调用直接返回
   */
  async start(): Promise<void> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize()
    }

    // 如果已启动，直接返回
    if (this.started) {
      console.log('🚀 队列处理已在运行中')
      return
    }

    // 如果正在启动，等待完成
    if (this.startingPromise) {
      await this.startingPromise
      return
    }

    // split 模式下，背景队列只能由 background-worker 消费。
    // 非 worker 进程允许 enqueue + initialize，但禁止 start 处理循环。
    if (
      this.config.instanceName === 'background' &&
      !canRunBackgroundQueueConsumerInCurrentProcess()
    ) {
      logger.warn('queue_background_start_blocked', {
        instanceName: this.config.instanceName || 'background',
        splitFlag: getBooleanFromEnv('QUEUE_SPLIT_BACKGROUND', false),
        backgroundWorker: isBackgroundWorkerProcess(),
        override: getBooleanFromEnv('QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB', false),
        reason: 'split_enabled_non_worker_process',
      })
      return
    }

    // 开始启动
    this.startingPromise = (async () => {
      const startAt = Date.now()
      if (this.running) return

      this.running = true
      console.log('🚀 队列处理启动中...')

      // 🔥 启启动修复：重启后 running 任务会变成“僵尸”，应回到 pending 而不是直接清空
      if (this.adapter.requeueAllRunningOnStartup) {
        const requeueStartedAt = Date.now()
        const result = await this.adapter.requeueAllRunningOnStartup()
        const requeueElapsedMs = Date.now() - requeueStartedAt
        if (result.requeuedCount > 0 || result.cleanedMissingCount > 0) {
          console.log(
            `🧹 队列启动修复: requeued=${result.requeuedCount}, cleanedMissing=${result.cleanedMissingCount}, elapsed=${requeueElapsedMs}ms`
          )
        } else {
          console.log(`🧹 队列启动修复: 无需处理 (elapsed=${requeueElapsedMs}ms)`)
        }
      } else {
        // 旧适配器兼容：不支持 requeue 时仍然保留原行为（仅清理 running 僵尸可能会丢任务）
        const zombieCleanupStartedAt = Date.now()
        await this.cleanupZombieTasks('startup')
        console.log(`🧹 僵尸任务清理完成 (elapsed=${Date.now() - zombieCleanupStartedAt}ms)`)
      }

      // 🔥 修复 pending 索引：避免 tasks hash 中的 pending 任务因缺失 zset 索引而永远无法执行
      if (this.adapter.repairPendingIndexes && !this.skipStartupPendingRepair) {
        const repairStartedAt = Date.now()
        const repair = await this.adapter.repairPendingIndexes()
        const repairElapsedMs = Date.now() - repairStartedAt
        if (repair.repairedCount > 0) {
          console.log(`🧩 pending 索引修复: repaired=${repair.repairedCount}, scanned=${repair.scannedCount}, elapsed=${repairElapsedMs}ms`)
        } else {
          console.log(`🧩 pending 索引修复: 无需处理 (scanned=${repair.scannedCount}, elapsed=${repairElapsedMs}ms)`)
        }
      } else if (this.adapter.repairPendingIndexes && this.skipStartupPendingRepair) {
        console.log('⏭️ 启动阶段已跳过 pending 索引修复 (QUEUE_SKIP_STARTUP_PENDING_REPAIR=true)')
      }

      // 🔥 启动时清理URL Swap队列任务（避免重复执行）
      const urlSwapCleanupStartedAt = Date.now()
      await this.cleanupUrlSwapTasksOnStartup()
      console.log(`🧹 URL Swap 启动清理完成 (elapsed=${Date.now() - urlSwapCleanupStartedAt}ms)`)

      // 启动处理循环（每100ms检查一次）
      this.processingLoop = setInterval(() => {
        this.processQueue()
      }, 100)

      // 🔥 启动健康检查循环
      this.startHealthCheckLoop()

      this.started = true
      console.log(`🚀 队列处理已启动 (totalElapsed=${Date.now() - startAt}ms)`)
    })()

    await this.startingPromise
  }

  /**
   * 停止队列处理
   */
  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false
    this.started = false

    // 停止处理循环
    if (this.processingLoop) {
      clearInterval(this.processingLoop)
      this.processingLoop = null
    }

    // 🔥 停止健康检查循环
    this.stopHealthCheckLoop()

    await this.adapter.disconnect()
    console.log('⏹️ 队列处理已停止')
  }

  /**
   * 注册任务执行器
   * 防止重复注册
   */
  registerExecutor<T = any, R = any>(
    type: TaskType,
    executor: TaskExecutor<T, R>
  ): void {
    if (this.executors.has(type)) {
      return // 静默跳过，不输出警告日志
    }
    this.executors.set(type, executor)
    console.log(`📝 已注册执行器: ${type}`)
  }

  /**
   * 注册所有任务执行器（防重复）
   */
  registerAllExecutors(): void {
    if (this.executorsRegistered) {
      console.log('⚠️ 任务执行器已注册，跳过重复注册')
      return
    }
    this.executorsRegistered = true
  }

  /**
   * 公开方法：确保队列已初始化
   * 可用于手动初始化队列系统
   */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.initialize()
  }

  /**
   * 公开方法：确保队列已启动
   * 可用于手动启动队列系统
   */
  async ensureStarted(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
    if (!this.started) {
      await this.start()
    }
    // start() 可能因“非 worker 背景队列保护”被显式拦截，此时不注册执行器。
    if (!this.started) {
      return
    }
    // 自动注册执行器（如果尚未注册）
    if (!this.executorsRegistered) {
      await this.registerAllExecutorsSafe()
    }
  }

  /**
   * 公开方法：注册所有任务执行器
   */
  async registerAllExecutorsSafe(): Promise<void> {
    if (this.executorsRegistered) {
      console.log('⚠️ 任务执行器已注册，跳过重复注册')
      return
    }

    console.log('📝 注册任务执行器...')

    // 动态导入执行器注册函数
    const { registerAllExecutors } = await import('./executors')
    registerAllExecutors(this)

    this.executorsRegistered = true
    console.log('📝 任务执行器注册完成')
  }

  /**
   * 添加任务到队列
   * 自动确保队列已初始化和启动
   */
  async enqueue<T = any>(
    type: TaskType,
    data: T,
    userId: number,
    options: {
      priority?: TaskPriority
      requireProxy?: boolean
      proxyConfig?: ProxyConfig
      maxRetries?: number
      taskId?: string  // 可选的预定义taskId
      parentRequestId?: string  // 可选：关联上游HTTP请求
    } = {}
  ): Promise<string> {
    // 兼容：默认保持旧行为（enqueue 时自动启动 worker）
    // 拆分 worker 场景：允许仅连接存储并写入 pending，由独立 worker 负责执行
    if (this.config.autoStartOnEnqueue) {
      await this.ensureStarted()
    } else {
      await this.ensureInitialized()
    }

    const taskId = options.taskId || randomUUID()
    const parentRequestId = options.parentRequestId
    const priority: TaskPriority =
      options.priority ??
      (this.isBackgroundTaskType(type) ? 'low' : 'normal')

    // click-farm：明确不重试（用户可重新触发/由调度器下一轮重建）
    const noRetryTaskTypes = new Set<TaskType>([
      'click-farm',
      'click-farm-trigger',
      'click-farm-batch',
    ])
    const maxRetries = noRetryTaskTypes.has(type)
      ? (options.maxRetries ?? 0)
      : (options.maxRetries ?? this.config.defaultMaxRetries)

    const task: Task<T> = {
      id: taskId,
      type,
      data,
      userId,
      parentRequestId,
      priority,
      status: 'pending',
      requireProxy: options.requireProxy || false,
      proxyConfig: options.proxyConfig,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries
    }

    // 若任务携带 scheduledAt（ISO 字符串），将其映射为 notBefore，避免“提前 dequeue 后长时间 setTimeout”等待导致内存/并发失控
    const scheduledAt = (data as any)?.scheduledAt
    if (typeof scheduledAt === 'string') {
      const notBefore = Date.parse(scheduledAt)
      if (Number.isFinite(notBefore)) {
        ;(task as any).notBefore = notBefore
      }
    }

    await this.adapter.enqueue(task)
    logger.info('queue_task_enqueued', {
      taskId: task.id,
      taskType: task.type,
      userId: task.userId,
      parentRequestId: task.parentRequestId,
      priority: task.priority,
    })

    return task.id
  }

  /**
   * 队列处理循环
   */
  private async processQueue(): Promise<void> {
    if (!this.running) return

    // 🔥 检查是否处于错误退避期
    const now = Date.now()
    if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
      const timeSinceLastError = now - this.lastErrorTime
      if (timeSinceLastError < this.ERROR_BACKOFF_MS) {
        // 仍在退避期，跳过本次处理
        return
      }
      // 退避期结束，重置错误计数
      console.log('🔄 Redis连接恢复尝试，重置错误计数')
      this.consecutiveErrors = 0
    }

    // 检查是否达到“核心任务配额”（轻量级后台任务不占用 globalConcurrency）
    if (this.getCoreGlobalRunningCount() >= this.config.globalConcurrency) {
      return
    }

    try {
      // 尝试获取任务
      const task = await this.adapter.dequeue()
      if (!task) {
        // 成功执行（即使没有任务），重置错误计数
        if (this.consecutiveErrors > 0) {
          this.consecutiveErrors = 0
        }
        return
      }

      // 检查是否有对应的执行器
      const executor = this.executors.get(task.type)
      if (!executor) {
        console.warn(`⚠️ 未找到执行器: ${task.type}`)
        await this.adapter.updateTaskStatus(task.id, 'failed', 'No executor found')
        return
      }

      // 检查并发限制
      if (!await this.canExecuteTask(task)) {
        // 放回队列
        task.status = 'pending'
        // 清理 startedAt（否则会被误判为长时间 running / 并影响调试）
        delete (task as any).startedAt

        // 🔥 关键修复：并发受限时不要立刻重新入队到队首，否则会反复 dequeue 同一个任务导致“饥饿”
        // 为该任务设置短暂退避，让其他用户/类型的任务有机会被执行。
        const deferCount = ((task as any).deferCount || 0) + 1
        ;(task as any).deferCount = deferCount
        const baseDelay = Math.min(200 * deferCount, 5000) // 200ms, 400ms, ... 上限5s
        const jitter = Math.floor(Math.random() * 50)
        ;(task as any).notBefore = Date.now() + baseDelay + jitter
        await this.adapter.enqueue(task)
        return
      }

      // 执行任务
      this.executeTask(task, executor)

      // 成功执行，重置错误计数
      if (this.consecutiveErrors > 0) {
        this.consecutiveErrors = 0
      }
    } catch (error: any) {
      this.consecutiveErrors++
      this.lastErrorTime = now

      // 🔥 只在首次错误或达到退避阈值时记录详细错误
      if (this.consecutiveErrors === 1) {
        console.error('❌ 队列处理错误:', error.message)
      } else if (this.consecutiveErrors === this.MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `❌ Redis连接持续失败（${this.consecutiveErrors}次），` +
          `暂停${this.ERROR_BACKOFF_MS / 1000}秒后重试。错误: ${error.message}`
        )
      }
      // 其他连续错误静默处理，避免刷屏
    }
  }

  /**
   * 检查是否可以执行任务（并发控制）
   */
  private async canExecuteTask(task: Task): Promise<boolean> {
    const isBackground = this.isBackgroundTaskType(task.type)

    // click-farm 属于高频任务，堆内存压力高时主动延后，避免把 Web 进程顶到 OOM
    if (
      (task.type === 'click-farm' || task.type === 'click-farm-batch') &&
      this.isHeapPressureHigh(this.clickFarmHeapPressureThresholdPct)
    ) {
      return false
    }

    let coreGlobalRunning = this.getCoreGlobalRunningCount()
    let userRunning = this.perUserRunningCount.get(task.userId) || 0
    let typeRunning = this.perTypeRunningCount.get(task.type) || 0

    // 多实例部署时，补充跨进程 running 快照，避免“每个进程各算各的”导致实际并发超限。
    const crossProcessSnapshot = await this.getCrossProcessRunningSnapshot(task)
    if (crossProcessSnapshot) {
      coreGlobalRunning = Math.max(coreGlobalRunning, crossProcessSnapshot.globalCoreRunning)
      userRunning = Math.max(userRunning, crossProcessSnapshot.userCoreRunning)
      typeRunning = Math.max(typeRunning, crossProcessSnapshot.typeRunning)
    }

    // 1. 全局并发检查（轻量级后台任务不占用 globalConcurrency）
    if (!isBackground && coreGlobalRunning >= this.config.globalConcurrency) {
      return false
    }

    // 2. 用户并发检查（轻量级后台任务不占用 perUserConcurrency）
    if (!isBackground) {
      if (userRunning >= this.config.perUserConcurrency) {
        return false
      }
    }

    // 3. 类型并发检查
    const typeLimit = this.config.perTypeConcurrency[task.type] || 2
    if (typeRunning >= typeLimit) {
      return false
    }

    return true
  }

  private async getCrossProcessRunningSnapshot(task: Task): Promise<RunningConcurrencySnapshot | null> {
    if (!this.adapter.getRunningConcurrencySnapshot) {
      return null
    }

    try {
      return await this.adapter.getRunningConcurrencySnapshot({
        userId: task.userId,
        type: task.type,
        excludeTaskId: task.id,
      })
    } catch (error: any) {
      const now = Date.now()
      // 限流日志：避免 Redis 抖动时刷屏
      if (now - this.lastRunningSnapshotErrorAt >= 5000) {
        this.lastRunningSnapshotErrorAt = now
        logger.warn('queue_running_snapshot_failed', {
          taskId: task.id,
          taskType: task.type,
          userId: task.userId,
          message: error?.message || String(error),
        })
      }
      return null
    }
  }

  /**
   * 检查错误是否可恢复
   *
   * 不可恢复的错误（直接标记失败，不重试）：
   * - 配置缺失（Google Ads凭证、API Key等）
   * - 权限错误
   * - 认证失败
   * - 资源不存在
   * - 数据验证失败
   *
   * 可恢复的错误（重试）：
   * - 网络超时
   * - 临时服务故障
   * - 限流错误（429）
   * - 数据库连接错误
   * - 临时故障
   *
   * 🔧 修复(2025-12-29): 统一错误分类标准，避免因配置不完整导致无效重试
   * 🔧 修复(2025-12-29): 支持OAuth和服务账号两种认证方式的错误分类
   */
  private isRecoverableError(error: any): boolean {
    const errorMessage = error?.message || String(error)

    // 不可恢复的错误模式
    const nonRecoverablePatterns = [
      '未配置',                                              // 配置缺失
      '未配置完整',                                          // 配置不完整
      '配置不完整',                                          // 配置不完整 (变体)
      '不完整',                                              // 配置不完整
      '需要',                                                // 需要某个参数
      '必需参数',                                            // 缺少必需参数
      '缺少',                                                // 缺少某个参数
      '缺失',                                                // 参数缺失
      '未找到',                                              // 未找到资源/配置
      '权限',                                                // 权限相关
      '认证',                                                // 认证相关
      '授权',                                                // 授权相关
      '不存在',                                              // 资源不存在
      '无效的',                                              // 无效的参数/资源
      '找不到',                                              // 找不到资源
      '上传',                                                // 需要上传文件
      '权限等级',                                            // Developer Token 权限等级（新增 2025-12-29）
      'only approved for use with test accounts',           // Developer Token 权限错误（新增 2025-12-29）
      'unauthorized',                                        // 未授权
      'forbidden',                                           // 禁止访问
      'not found',                                           // 未找到
      'invalid',                                             // 无效的
      'missing',                                             // 缺失的
      'required',                                            // 必需的
      'credential',                                          // 凭证相关
      'config',                                              // 配置相关
      'permission_denied',                                   // Google Ads API 权限拒绝
      'business abnormality',                                // 代理服务商业务异常（需人工介入）
      'contact customer service',                            // 代理服务商要求联系客服
      'api business error',                                  // 代理服务商业务错误（不可恢复）
    ]

    for (const pattern of nonRecoverablePatterns) {
      if (errorMessage.toLowerCase().includes(pattern)) {
        return false
      }
    }

    // 其他错误视为可恢复的
    return true
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: Task, executor: TaskExecutor): Promise<void> {
    // 更新并发计数
    this.incrementConcurrency(task)
    const startedAt = Date.now()

    const context = {
      requestId: task.parentRequestId,
      parentRequestId: task.parentRequestId,
      userId: task.userId,
      taskId: task.id,
      taskType: task.type,
    }

    // 将任务上下文绑定到当前异步链路，确保执行器内部 console.* 也能带上 userId/taskId/requestId
    await runWithLogContext(context, async () => {
      logger.info('queue_task_started', {
        taskId: task.id,
        taskType: task.type,
        userId: task.userId,
        parentRequestId: task.parentRequestId,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      })

      try {
      // 用户执行资格门禁：禁用/过期用户任务直接终止，避免继续消耗资源
      await assertUserExecutionAllowed(task.userId, {
        source: `queue:${task.type}:${task.id}`,
      })

      // 准备代理配置（按需加载）
      // 1. 检查任务类型是否需要代理
      // 2. 如果需要代理，从用户配置中加载
      if (!task.proxyConfig) {
        const needsProxy = task.requireProxy ?? isProxyRequiredForTaskType(task.type)
        if (needsProxy) {
          // 从任务数据中获取目标国家（优先使用offer的target_country字段）
          const targetCountry = task.data?.target_country || task.data?.targetCountry || task.data?.country || 'US'
          const userProxy = await getProxyForCountry(targetCountry, task.userId)
          if (userProxy) {
            task.proxyConfig = {
              host: userProxy.host,
              port: userProxy.port,
              username: userProxy.username,
              password: userProxy.password,
              protocol: userProxy.protocol,
              // 保存原始URL用于动态代理服务
              originalUrl: userProxy.originalUrl
            } as ProxyConfig
            console.log(`🔌 任务 ${task.id} 使用用户 ${task.userId} 的代理 (${userProxy.country})`)
          } else {
            console.log(`⚠️ 任务 ${task.id} 需要代理但用户 ${task.userId} 未配置代理`)
          }
        }
      }

      // 执行任务（带超时）
      const result = await this.executeWithTimeout(
        executor(task),
        this.config.taskTimeout
      )

      // 标记代理成功（如果使用了代理池中的代理）
      if (task.proxyConfig && this.proxyManager.getStats().total > 0) {
        this.proxyManager.markProxySuccess(task.proxyConfig)
      }

      // 更新任务状态
      await this.adapter.updateTaskStatus(task.id, 'completed')
      logger.info('queue_task_completed', {
        taskId: task.id,
        taskType: task.type,
        userId: task.userId,
        parentRequestId: task.parentRequestId,
        durationMs: Date.now() - startedAt,
      })
      } catch (error: any) {
      logger.error(
        'queue_task_failed',
        {
          taskId: task.id,
          taskType: task.type,
          userId: task.userId,
          parentRequestId: task.parentRequestId,
          durationMs: Date.now() - startedAt,
        },
        error
      )

      // 标记代理失败
      if (task.proxyConfig) {
        this.proxyManager.markProxyFailed(task.proxyConfig)
      }

      const isUserSuspended = isUserExecutionSuspendedError(error)

      // 判断错误是否可恢复
      const isRecoverable = isUserSuspended ? false : this.isRecoverableError(error)

      // 重试逻辑：仅对可恢复的错误执行重试
      const shouldRetry = isRecoverable && (task.retryCount || 0) < (task.maxRetries || 0)
      if (shouldRetry) {
        task.retryCount = (task.retryCount || 0) + 1
        task.status = 'pending'
        // 清理 startedAt，避免被误判为长时间 running
        delete (task as any).startedAt

        // 🔧 修复：重试时清除代理配置，强制重新获取新代理
        // 这样可以避免使用失败的代理IP，提高重试成功率
        if (task.type === 'click-farm' && task.data?.proxyUrl) {
          console.log(`🔄 任务重试 (${task.retryCount}/${task.maxRetries}): ${task.id} - 清除旧代理，准备更换新代理`)
          delete task.data.proxyUrl
          task.proxyConfig = undefined
        } else {
          console.log(`🔄 任务重试 (${task.retryCount}/${task.maxRetries}): ${task.id}`)
        }

        // 延迟后重新入队
        logger.warn('queue_task_retry_scheduled', {
          taskId: task.id,
          taskType: task.type,
          userId: task.userId,
          parentRequestId: task.parentRequestId,
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
          retryDelayMs: this.config.retryDelay,
        })

        // 使用 notBefore 将重试延迟持久化到队列，避免 setTimeout 导致进程重启后丢失/误判 running
        ;(task as any).notBefore = Date.now() + this.config.retryDelay
        await this.adapter.enqueue(task)
      } else {
        // 不可恢复的错误或超过重试次数，标记为失败
        if (!isRecoverable) {
          if (isUserSuspended) {
            logger.warn('queue_task_aborted_user_suspended', {
              taskId: task.id,
              taskType: task.type,
              userId: task.userId,
              parentRequestId: task.parentRequestId,
              errorCode: USER_EXECUTION_SUSPENDED_ERROR_CODE,
              reason: (error as any)?.reason || undefined,
            })
          }
          console.log(`⚠️ 不可恢复的错误，不再重试: ${task.id}`)
        }
        // 队列恢复功能已移除，用户可重新提交任务
        await this.adapter.updateTaskStatus(task.id, 'failed', error.message)
        await this.syncTaskFailureToDatabase(task, error)
      }
      } finally {
      // 减少并发计数
      this.decrementConcurrency(task)

      // 🔥 2025-12-12 内存优化：任务完成后主动清理资源
      // 清理空闲的浏览器实例，释放内存
      if (task.type === 'offer-extraction' || task.type === 'batch-offer-creation') {
        try {
          const { getPlaywrightPool } = await import('@/lib/playwright-pool')
          const pool = getPlaywrightPool()
          await pool.clearIdleInstances()
          console.log(`🧹 [内存清理] 任务 ${task.id} 完成后清理空闲浏览器实例`)
        } catch (cleanupError) {
          // 清理失败不影响主流程
          console.warn(`⚠️ [内存清理] 清理空闲实例失败: ${cleanupError}`)
        }

        // 触发Node.js垃圾回收（如果可用）
        if (global.gc) {
          try {
            global.gc()
            console.log(`🧹 [内存清理] 触发GC`)
          } catch {
            // GC失败不影响主流程
          }
        }
      }
      }
    })
  }

  /**
   * 将队列层失败同步回业务数据库，避免业务任务长期停留在 running 状态。
   * 目前对 offer-extraction / affiliate-product-sync 做强一致兜底。
   */
  private async syncTaskFailureToDatabase(task: Task, error: any): Promise<void> {
    if (task.type === 'affiliate-product-sync') {
      try {
        const runId = Number(task.data?.runId)
        if (!Number.isFinite(runId) || runId <= 0) return

        const { updateAffiliateProductSyncRun } = await import('@/lib/affiliate-products')
        await updateAffiliateProductSyncRun({
          runId,
          status: 'failed',
          failedCount: 1,
          completedAt: new Date().toISOString(),
          errorMessage: error?.message || '任务执行失败',
        })
      } catch (syncError: any) {
        console.warn(`⚠️ 同步 affiliate_product_sync_runs 失败状态失败: ${task.id}: ${syncError?.message || syncError}`)
      }
      return
    }

    if (task.type === 'offer-extraction') {
      try {
        const { getDatabase } = await import('@/lib/db')
        const db = getDatabase()
        const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
        const message = error?.message || '任务执行失败'
        const errorPayload = toDbJsonObjectField({
          message,
          source: 'queue-manager',
        }, db.type, { message, source: 'queue-manager' })

        await db.exec(
          `UPDATE offer_tasks
           SET status = 'failed',
               message = ?,
               error = ?,
               completed_at = COALESCE(completed_at, ${nowSql}),
               updated_at = ${nowSql}
           WHERE id = ?
             AND status IN ('pending', 'running')`,
          [message, errorPayload, task.id]
        )
      } catch (syncError: any) {
        console.warn(`⚠️ 同步 offer_tasks 失败状态失败: ${task.id}: ${syncError?.message || syncError}`)
      }
    }
  }

  /**
   * 执行任务并设置超时
   */
  private executeWithTimeout<T>(
    promise: Promise<T>,
    timeout: number
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Task timeout')), timeout)
    })

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })
  }

  /**
   * 增加并发计数
   */
  private incrementConcurrency(task: Task): void {
    this.globalRunningCount++
    if (this.isBackgroundTaskType(task.type)) {
      this.backgroundRunningCount++
      this.backgroundPerUserRunningCount.set(
        task.userId,
        (this.backgroundPerUserRunningCount.get(task.userId) || 0) + 1
      )
    } else {
      this.perUserRunningCount.set(
        task.userId,
        (this.perUserRunningCount.get(task.userId) || 0) + 1
      )
    }
    this.perTypeRunningCount.set(
      task.type,
      (this.perTypeRunningCount.get(task.type) || 0) + 1
    )
  }

  /**
   * 减少并发计数
   */
  private decrementConcurrency(task: Task): void {
    this.globalRunningCount--
    if (this.isBackgroundTaskType(task.type)) {
      this.backgroundRunningCount = Math.max(0, this.backgroundRunningCount - 1)
      this.backgroundPerUserRunningCount.set(
        task.userId,
        Math.max(0, (this.backgroundPerUserRunningCount.get(task.userId) || 0) - 1)
      )
    } else {
      this.perUserRunningCount.set(
        task.userId,
        Math.max(0, (this.perUserRunningCount.get(task.userId) || 0) - 1)
      )
    }
    this.perTypeRunningCount.set(
      task.type,
      Math.max(0, (this.perTypeRunningCount.get(task.type) || 0) - 1)
    )
  }

  /**
   * 获取队列统计
   */
  async getStats(): Promise<QueueStats> {
    return this.adapter.getStats()
  }

  async getRunningTasks(): Promise<Task[]> {
    return this.adapter.getRunningTasks()
  }

  async getPendingEligibilityStats(): Promise<PendingEligibilityStats | null> {
    const adapter = this.adapter as QueueStorageAdapter & {
      getPendingEligibilityStats?: () => Promise<PendingEligibilityStats>
    }
    if (typeof adapter.getPendingEligibilityStats !== 'function') return null
    return adapter.getPendingEligibilityStats()
  }

  /**
   * 获取代理统计
   */
  getProxyStats() {
    return this.proxyManager.getDetailedStats()
  }

  /**
   * 清理已完成任务
   */
  async clearCompleted(): Promise<number> {
    return this.adapter.clearCompleted()
  }

  /**
   * 清理失败任务
   */
  async clearFailed(): Promise<number> {
    return this.adapter.clearFailed()
  }

  /**
   * 🔥 清理僵尸任务（启动时调用）
   *
   * 僵尸任务定义：
   * 1. running状态但实际上没有在执行（服务重启导致）
   * 2. 超时的running任务（执行时间过长）
   *
   * 清理策略：
   * 1. 启动时：清空所有running任务（因为服务重启后没有任务在执行）
   * 2. 运行时：定期检查超时的running任务并标记为失败
   */
  async cleanupZombieTasks(mode: 'startup' | 'runtime' = 'runtime'): Promise<{
    cleaned: number
    details: string
  }> {
    try {
      if (mode === 'startup') {
        // 启动模式：清空所有未完成任务
        if (this.adapter.clearAllUnfinished) {
          const result = await this.adapter.clearAllUnfinished()
          const details = `pending=${result.pendingCleared}, running(zombie)=${result.runningCleared}, userQueues=${result.userQueuesCleared}`

          if (result.totalCleared > 0) {
            console.log(`🧹 队列启动清理: 清除 ${result.totalCleared} 个僵尸任务`)
            console.log(`   ${details}`)
          }

          return {
            cleaned: result.totalCleared,
            details
          }
        }
      } else {
        // 运行时模式：只清理超时任务
        if (this.adapter.cleanupStaleRunningTasks) {
          const result = await this.adapter.cleanupStaleRunningTasks(this.STALE_TASK_TIMEOUT)

          if (result.cleanedCount > 0) {
            console.log(`🧹 队列健康检查: 清理 ${result.cleanedCount} 个超时任务`)
          }

          return {
            cleaned: result.cleanedCount,
            details: `stale tasks cleaned: ${result.cleanedTaskIds.join(', ')}`
          }
        }
      }

      return { cleaned: 0, details: 'No cleanup adapter available' }
    } catch (error: any) {
      console.error('❌ 僵尸任务清理失败:', error.message)
      return { cleaned: 0, details: `Error: ${error.message}` }
    }
  }

  /**
   * 🔥 执行健康检查
   *
   * 检查内容：
   * 1. 内存中的running计数是否与Redis一致
   * 2. 是否有超时的任务需要清理
   * 3. 队列状态是否正常
   */
  async performHealthCheck(): Promise<{
    healthy: boolean
    issues: string[]
    actions: string[]
  }> {
    const issues: string[] = []
    const actions: string[] = []

    try {
      // 1. 获取队列统计
      const stats = await this.adapter.getStats()

      // 0. Node heap 使用率预警（避免无声逼近 --max-old-space-size 导致 OOM）
      try {
        const heap = process.memoryUsage().heapUsed
        const limit = getHeapStatistics().heap_size_limit
        if (limit > 0) {
          const pct = (heap / limit) * 100
          if (pct >= 85) {
            issues.push(`Node heap 使用率高: ${pct.toFixed(1)}% (${Math.round(heap / 1024 / 1024)}MB / ${Math.round(limit / 1024 / 1024)}MB)`)
          }
        }
      } catch {
        // ignore
      }

      // 1b. 🔥 若存在 pending 任务，修复 pending 索引（避免“孤儿 pending 任务”永远无法 dequeue）
      if (stats.pending > 0 && this.adapter.repairPendingIndexes) {
        const repair = await this.adapter.repairPendingIndexes()
        if (repair.repairedCount > 0) {
          issues.push(`发现 pending 索引缺失: repaired=${repair.repairedCount}`)
          actions.push(`已修复 pending 索引: repaired=${repair.repairedCount}`)
        }
      }

      // 2. 检查内存计数与Redis是否一致
      if (this.globalRunningCount !== stats.running) {
        issues.push(`内存running计数(${this.globalRunningCount})与Redis(${stats.running})不一致`)

        // 如果Redis中有running任务但内存中没有，说明有僵尸任务
        if (this.globalRunningCount === 0 && stats.running > 0) {
          // 清理这些僵尸任务
          const cleanupResult = await this.cleanupZombieTasks('runtime')
          actions.push(`清理了 ${cleanupResult.cleaned} 个僵尸任务`)
        }
      }

      // 3. 检查超时任务
      if (this.adapter.cleanupStaleRunningTasks) {
        const staleCleanup = await this.adapter.cleanupStaleRunningTasks(this.STALE_TASK_TIMEOUT)
        if (staleCleanup.cleanedCount > 0) {
          issues.push(`发现 ${staleCleanup.cleanedCount} 个超时任务`)
          actions.push(`清理超时任务: ${staleCleanup.cleanedTaskIds.join(', ')}`)
        }
      }

      const healthy = issues.length === 0
      if (!healthy) {
        console.log(`⚠️ 队列健康检查发现问题:`)
        issues.forEach(issue => console.log(`   - ${issue}`))
        actions.forEach(action => console.log(`   ✅ ${action}`))
      }

      return { healthy, issues, actions }
    } catch (error: any) {
      return {
        healthy: false,
        issues: [`健康检查失败: ${error.message}`],
        actions: []
      }
    }
  }

  /**
   * 🔥 清理数据库中超时的 running 任务
   *
   * 这个方法直接操作数据库，不依赖 Redis 适配器
   * 用于处理那些虽然数据库标记为 running，但实际上已经超时的任务
   */
  async cleanupStaleDatabaseTasks(): Promise<{
    cleanedCount: number
    taskIds: string[]
  }> {
    try {
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      const db_type = db.type

      // PostgreSQL 和 SQLite 使用不同的超时计算方式
      let timeoutThreshold: string
      if (db_type === 'postgres') {
        timeoutThreshold = `NOW() - INTERVAL '${this.STALE_TASK_TIMEOUT / 1000} seconds'`
      } else {
        timeoutThreshold = `datetime('now', '-${this.STALE_TASK_TIMEOUT / 1000} seconds')`
      }

      // 获取超时的 running 任务
      const staleTasks = await db.query<{ id: string; batch_id: string | null; started_at: string }>(`
        SELECT id, batch_id, started_at
        FROM offer_tasks
        WHERE status = 'running'
          AND started_at < ${timeoutThreshold}
      `, [])

      if (staleTasks.length === 0) {
        return { cleanedCount: 0, taskIds: [] }
      }

      console.log(`⚠️ 发现 ${staleTasks.length} 个数据库超时任务: ${staleTasks.map(t => t.id).join(', ')}`)

      // 将超时任务标记为 failed
      const nowFunc = db_type === 'postgres' ? 'NOW()' : "datetime('now')"
      const timeoutErrorJson = toDbJsonObjectField({
        timeout: true,
        message: 'Task timeout - no heartbeat received',
      }, db_type, { timeout: true, message: 'Task timeout - no heartbeat received' })
      const updateResult = await db.exec(`
        UPDATE offer_tasks
        SET status = 'failed',
            message = '任务超时',
            error = ?,
            completed_at = COALESCE(completed_at, ${nowFunc}),
            updated_at = ${nowFunc}
        WHERE status = 'running'
          AND started_at < ${timeoutThreshold}
      `, [timeoutErrorJson])

      // 如果有超时的 batch 任务，一并处理
      const staleBatchIds = [...new Set(staleTasks.filter(t => t.batch_id).map(t => t.batch_id!))]
      for (const batchId of staleBatchIds) {
        // 检查该 batch 是否所有任务都已完成或失败
        const batchStats = await db.queryOne<{
          total: number
          completed: number
          failed: number
          running: number
          pending: number
        }>(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE status = 'running') as running,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
          FROM offer_tasks
          WHERE batch_id = ?
        `, [batchId])

        if (batchStats && batchStats.running === 0 && batchStats.pending === 0) {
          // 所有任务都完成了，更新 batch 状态
          const newStatus = batchStats.failed > 0 ? 'failed' : 'completed'
          await db.exec(`
            UPDATE batch_tasks
            SET status = ?,
                completed_at = ${nowFunc},
                updated_at = ${nowFunc}
            WHERE id = ?
          `, [newStatus, batchId])
          console.log(`📦 Batch ${batchId} 状态已更新为: ${newStatus}`)
        }
      }

      console.log(`✅ 已清理 ${updateResult.changes} 个超时任务`)

      return {
        cleanedCount: updateResult.changes,
        taskIds: staleTasks.map(t => t.id)
      }
    } catch (error: any) {
      console.error('❌ 清理数据库超时任务失败:', error.message)
      return { cleanedCount: 0, taskIds: [] }
    }
  }

  /**
   * 🔥 启动健康检查循环
   */
  private startHealthCheckLoop(): void {
    if (this.healthCheckLoop) return

    // 立即执行一次健康检查
    this.performHealthCheck().catch(err =>
      console.error('❌ 首次健康检查失败:', err.message)
    )

    // 设置定期检查
    this.healthCheckLoop = setInterval(async () => {
      try {
        // 1. 执行队列健康检查（依赖 Redis）
        await this.performHealthCheck()

        // 2. 清理数据库中超时的任务（不依赖 Redis）
        const dbCleanup = await this.cleanupStaleDatabaseTasks()
        if (dbCleanup.cleanedCount > 0) {
          console.log(`🧹 数据库清理: ${dbCleanup.cleanedCount} 个超时任务已标记为失败`)
        }
      } catch (error: any) {
        console.error('❌ 定期健康检查失败:', error.message)
      }
    }, this.HEALTH_CHECK_INTERVAL)

    console.log(`🏥 队列健康检查已启动 (间隔: ${this.HEALTH_CHECK_INTERVAL / 1000}秒)`)
  }

  /**
   * 🔥 停止健康检查循环
   */
  private stopHealthCheckLoop(): void {
    if (this.healthCheckLoop) {
      clearInterval(this.healthCheckLoop)
      this.healthCheckLoop = null
      console.log('🏥 队列健康检查已停止')
    }
  }

  /**
   * 🔥 服务启动时清理URL Swap队列任务
   *
   * 目的：避免服务重启时重复执行换链接任务
   * - 删除所有type='url-swap'且status='pending'或'running'的任务
   * - 不修改url_swap_tasks表的统计数据
   * - 调度器会在下一个时间间隔重新入队
   */
  private async cleanupUrlSwapTasksOnStartup(): Promise<void> {
    try {
      console.log('[队列健康] 🧹 服务启动，清理换链接队列任务...')

      // 检查adapter是否支持deleteTasksByTypeAndStatus
      if (!this.adapter.deleteTasksByTypeAndStatus) {
        console.log('[队列健康] ⚠️ 当前适配器不支持按类型删除任务，跳过清理')
        return
      }

      // 清理 running 状态的 url-swap 任务（最重要）
      const runningDeleted = await this.adapter.deleteTasksByTypeAndStatus('url-swap', 'running')

      // 清理 pending 状态的 url-swap 任务（防止重复入队）
      const pendingDeleted = await this.adapter.deleteTasksByTypeAndStatus('url-swap', 'pending')

      const total = runningDeleted + pendingDeleted

      if (total > 0) {
        console.log(`[队列健康] ✅ 清理 ${total} 个换链接任务 (running: ${runningDeleted}, pending: ${pendingDeleted})`)
        console.log('[队列健康] ℹ️  任务将在下一个时间间隔由调度器重新入队')
      } else {
        console.log('[队列健康] ✅ 无需清理换链接任务')
      }
    } catch (error: any) {
      console.error('[队列健康] ❌ 清理换链接任务失败:', error.message)
      // 不阻塞启动流程
    }
  }

  /**
   * 🔥 取消批量任务的所有子任务
   *
   * @param batchId 批量任务ID
   * @returns 取消的任务数量
   */
  async cancelBatchTasks(batchId: string): Promise<number> {
    try {
      await this.ensureInitialized()

      // 1. 获取数据库实例
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      const db_type = db.type
      const nowFunc = db_type === 'postgres' ? 'NOW()' : "datetime('now')"

      // 2. 获取所有子任务（包括 pending 和 running 状态）
      const childTasks = await db.query<{
        id: string
        status: string
      }>(`
        SELECT id, status FROM offer_tasks WHERE batch_id = ? AND status IN ('pending', 'running')
      `, [batchId])

      let cancelledCount = 0

      // 3. 从队列中移除 pending 任务
      for (const childTask of childTasks) {
        if (childTask.status === 'pending') {
          try {
            await this.adapter.removeTask?.(childTask.id)
            cancelledCount++
            console.log(`🚫 已从队列移除 pending 任务: ${childTask.id}`)
          } catch (err) {
            console.warn(`⚠️ 移除任务失败: ${childTask.id}`, err)
          }
        }
      }

      // 4. 将 running/pending 任务标记为 failed（因为无法直接停止正在执行的代码）
      // PostgreSQL 使用 JSONB，SQLite 使用 JSON 字符串
      if (db_type === 'postgres') {
        await db.exec(`
          UPDATE offer_tasks
          SET status = 'failed',
              message = '因批次取消而终止',
              error = jsonb_build_object('cancelled', true, 'message', 'Batch cancelled by user', 'cancelled_at', ${nowFunc}),
              updated_at = ${nowFunc}
          WHERE batch_id = ? AND status IN ('pending', 'running')
        `, [batchId])
      } else {
        // SQLite
        await db.exec(`
          UPDATE offer_tasks
          SET status = 'failed',
              message = '因批次取消而终止',
              error = json_object('cancelled', 1, 'message', 'Batch cancelled by user'),
              updated_at = ${nowFunc}
          WHERE batch_id = ? AND status IN ('pending', 'running')
        `, [batchId])
      }

      console.log(`✅ 批量任务 ${batchId} 已取消，共处理 ${cancelledCount} 个 pending 任务`)

      return cancelledCount
    } catch (error: any) {
      console.error('❌ 取消批量任务失败:', error)
      throw error
    }
  }

  /**
   * 🔥 同步批量任务状态
   *
   * 检查 batch_tasks 的状态是否与子任务状态一致
   * 如果不一致，自动修正状态
   *
   * @param batchId 可选，指定要同步的 batch，不指定则同步所有
   * @returns 同步结果统计
   */
  async syncBatchStatus(batchId?: string): Promise<{
    checked: number
    fixed: number
    details: string[]
  }> {
    try {
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      const db_type = db.type
      const nowFunc = db_type === 'postgres' ? 'NOW()' : "datetime('now')"

      let batches: { id: string; status: string }[]

      if (batchId) {
        // 只检查指定的 batch
        const batch = await db.queryOne<{ id: string; status: string }>(
          'SELECT id, status FROM batch_tasks WHERE id = ?',
          [batchId]
        )
        batches = batch ? [batch] : []
      } else {
        // 检查所有 running 状态的 batch
        batches = await db.query<{ id: string; status: string }>(
          'SELECT id, status FROM batch_tasks WHERE status = ?',
          ['running']
        )
      }

      let fixed = 0
      const details: string[] = []

      for (const batch of batches) {
        // 统计子任务状态
        const stats = await db.queryOne<{
          total: number
          completed: number
          failed: number
          running: number
          pending: number
        }>(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE status = 'running') as running,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
          FROM offer_tasks
          WHERE batch_id = ?
        `, [batch.id])

        if (!stats) continue

        let newStatus: string | null = null

        // 根据子任务状态决定 batch 状态
        if (stats.completed > 0 && stats.running === 0 && stats.pending === 0) {
          // 所有任务都完成了
          newStatus = stats.failed > 0 ? 'partial' : 'completed'
        } else if (stats.running === 0 && stats.pending === 0) {
          // 没有正在运行和等待的任务
          newStatus = stats.failed === stats.total ? 'failed' : 'partial'
        }

        // 如果状态不一致，更新 batch 状态
        if (newStatus && newStatus !== batch.status) {
          await db.exec(`
            UPDATE batch_tasks
            SET status = ?,
                completed_count = ?,
                failed_count = ?,
                completed_at = ${nowFunc},
                updated_at = ${nowFunc}
            WHERE id = ?
          `, [newStatus, stats.completed, stats.failed, batch.id])

          fixed++
          details.push(
            `Batch ${batch.id}: ${batch.status} → ${newStatus} ` +
            `(completed: ${stats.completed}, failed: ${stats.failed}, running: ${stats.running}, pending: ${stats.pending})`
          )
        }
      }

      console.log(`🔄 Batch 状态同步完成: 检查 ${batches.length} 个, 修复 ${fixed} 个`)

      return {
        checked: batches.length,
        fixed,
        details
      }
    } catch (error: any) {
      console.error('❌ 同步 batch 状态失败:', error)
      return { checked: 0, fixed: 0, details: [`错误: ${error.message}`] }
    }
  }

  /**
   * 获取任务详情
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.adapter.getTask(taskId)
  }

  /**
   * 更新队列配置
   */
  updateConfig(config: Partial<QueueConfig>): void {
    const mergedPerTypeConcurrency = {
      ...this.config.perTypeConcurrency,
      ...(config.perTypeConcurrency || {}),
    }

    const applyHardCap = (type: TaskType, cap: number, fallback: number) => {
      const normalized = clampPositiveInt(mergedPerTypeConcurrency[type], fallback)
      const capped = Math.min(normalized, Math.max(1, cap))
      if (capped !== mergedPerTypeConcurrency[type]) {
        console.warn(
          `[QueueConfig] ${type} 并发已被硬上限限制: requested=${mergedPerTypeConcurrency[type]}, capped=${capped}, hardCap=${cap}`
        )
      }
      mergedPerTypeConcurrency[type] = capped
    }

    applyHardCap('click-farm', this.clickFarmConcurrencyHardCap, 20)
    applyHardCap('click-farm-batch', this.clickFarmBatchConcurrencyHardCap, 6)
    applyHardCap('click-farm-trigger', this.clickFarmTriggerConcurrencyHardCap, 4)

    this.config = {
      ...this.config,
      ...config,
      // 防御性合并：避免外部只传部分perTypeConcurrency导致其它类型丢失（进而回退到默认2并发）
      perTypeConcurrency: mergedPerTypeConcurrency,
    }
    console.log('🔄 队列配置已更新')
  }

  /**
   * 获取当前队列配置（只读）
   */
  getConfig(): Readonly<QueueConfig> {
    return { ...this.config }
  }

  /**
   * 🔥 获取所有待处理任务（供外部使用，如清理Offer关联任务）
   */
  async getPendingTasks(): Promise<Task[]> {
    try {
      if (this.adapter.getAllPendingTasks) {
        return await this.adapter.getAllPendingTasks()
      }
      return []
    } catch (error) {
      console.error('[队列] 获取待处理任务失败:', error)
      return []
    }
  }

  /**
   * 🔥 从队列中移除指定任务（供外部使用，如清理Offer关联任务）
   */
  async removeTask(taskId: string): Promise<boolean> {
    try {
      if (this.adapter.removeTask) {
        await this.adapter.removeTask(taskId)
        return true
      }
      return false
    } catch (error) {
      console.error(`[队列] 移除任务失败: ${taskId}`, error)
      return false
    }
  }

  /**
   * 🔥 按 user + types 批量移除 pending 任务（用于用户禁用/过期等场景的“队列止血”）
   *
   * 仅移除 pending（含 delayed notBefore）任务；不处理 running 中的任务。
   * 不会自动启动队列处理循环（只需 ensureInitialized 连接存储）。
   */
  async purgePendingTasksByUserAndTypes(
    userId: number,
    types: TaskType[]
  ): Promise<{ removedCount: number; removedTaskIds: string[] }> {
    if (!Array.isArray(types) || types.length === 0) {
      return { removedCount: 0, removedTaskIds: [] }
    }

    await this.ensureInitialized()

    if (this.adapter.removePendingTasksByUserAndTypes) {
      return await this.adapter.removePendingTasksByUserAndTypes(userId, types)
    }

    if (!this.adapter.removeTask) {
      return { removedCount: 0, removedTaskIds: [] }
    }

    const typeSet = new Set(types)
    const pending = await this.adapter.getPendingTasks()
    const toRemove = pending.filter((t) => t.userId === userId && typeSet.has(t.type)).map((t) => t.id)

    for (const taskId of toRemove) {
      await this.adapter.removeTask(taskId)
    }

    return { removedCount: toRemove.length, removedTaskIds: toRemove }
  }
}

// 使用 globalThis 防止 Next.js 热重载时重置单例
// 与 db.ts 保持一致的单例模式
declare global {
  var __queueManager: UnifiedQueueManager | undefined
  var __backgroundQueueManager: UnifiedQueueManager | undefined
}

/**
 * 获取统一队列管理器单例
 * 使用 globalThis 存储实例，防止 Next.js 热重载时重新初始化
 */
export function getQueueManager(config?: Partial<QueueConfig>): UnifiedQueueManager {
  if (!globalThis.__queueManager) {
    console.log('🚀 创建统一队列管理器单例...')
    globalThis.__queueManager = new UnifiedQueueManager({
      instanceName: 'core',
      ...config,
    })
  }
  return globalThis.__queueManager
}

/**
 * 获取后台任务队列管理器单例（click-farm / url-swap 等）
 *
 * 通过独立 redisKeyPrefix 隔离存储与消费，便于用独立 worker 进程执行，降低对核心业务请求的影响。
 */
export function getBackgroundQueueManager(config?: Partial<QueueConfig>): UnifiedQueueManager {
  const backgroundWorker = isBackgroundWorkerProcess()
  const forceProducerMode =
    getBooleanFromEnv('QUEUE_SPLIT_BACKGROUND', false) &&
    !backgroundWorker &&
    !getBooleanFromEnv('QUEUE_ALLOW_BACKGROUND_EXECUTORS_IN_WEB', false)
  const requestedAutoStart =
    config?.autoStartOnEnqueue ??
    backgroundWorker
  const effectiveAutoStartOnEnqueue = forceProducerMode
    ? false
    : requestedAutoStart

  if (!globalThis.__backgroundQueueManager) {
    console.log('🚀 创建后台队列管理器单例...')
    const defaultBackgroundRedisKeyPrefix =
      process.env.REDIS_KEY_PREFIX_BACKGROUND ||
      `autoads:${process.env.NODE_ENV || 'development'}:queue:bg:`

    globalThis.__backgroundQueueManager = new UnifiedQueueManager({
      instanceName: 'background',
      ...config,
      // 默认使用独立前缀（可用环境变量覆盖）
      redisKeyPrefix: config?.redisKeyPrefix || defaultBackgroundRedisKeyPrefix,
      // split 模式下非 worker 固定为 producer-only（enqueue 不消费）。
      autoStartOnEnqueue: effectiveAutoStartOnEnqueue,
    })
  } else {
    const currentAutoStart = globalThis.__backgroundQueueManager.getConfig().autoStartOnEnqueue !== false
    if (currentAutoStart !== effectiveAutoStartOnEnqueue) {
      globalThis.__backgroundQueueManager.updateConfig({
        autoStartOnEnqueue: effectiveAutoStartOnEnqueue,
      })
    }
  }
  return globalThis.__backgroundQueueManager
}
