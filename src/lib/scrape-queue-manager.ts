/**
 * 抓取队列管理器
 *
 * 功能：
 * 1. 全局并发限制：防止服务器过载
 * 2. 单用户并发限制：防止单个用户占用过多资源
 * 3. 优先级队列：支持任务优先级
 * 4. 动态配置：根据机器配置调整并发数
 * 5. 监控统计：实时监控队列状态
 */

import os from 'os'

// ========== 配置接口 ==========

export interface QueueConfig {
  // 全局并发限制（所有用户）
  globalConcurrency: number
  // 单用户并发限制
  perUserConcurrency: number
  // 队列最大长度
  maxQueueSize: number
  // 任务超时时间（毫秒）
  taskTimeout: number
  // 是否启用优先级队列
  enablePriority: boolean
}

export interface TaskOptions {
  userId: number
  offerId: number
  priority?: number // 优先级（1-10，数字越大优先级越高）
  timeout?: number // 任务超时时间（毫秒）
}

export interface QueueStats {
  // 全局统计
  globalRunning: number
  globalQueued: number
  globalCompleted: number
  globalFailed: number
  // 单用户统计
  perUserStats: Map<number, {
    running: number
    queued: number
    completed: number
    failed: number
  }>
  // 配置信息
  config: QueueConfig
}

// ========== 任务接口 ==========

interface QueueTask {
  id: string
  userId: number
  offerId: number
  priority: number
  addedAt: number
  startedAt?: number
  completedAt?: number
  timeout: number
  execute: () => Promise<void>
  resolve: (value: void) => void
  reject: (error: Error) => void
}

// ========== 队列管理器 ==========

class ScrapeQueueManager {
  private config: QueueConfig
  private queue: QueueTask[] = []
  private runningTasks: Map<string, QueueTask> = new Map()
  private userRunningCount: Map<number, number> = new Map()
  private stats = {
    completed: 0,
    failed: 0,
  }

  constructor(config?: Partial<QueueConfig>) {
    this.config = this.getDefaultConfig(config)
    console.log('[QueueManager] 初始化队列管理器:', this.config)
  }

  /**
   * 获取默认配置（根据机器配置动态调整）
   */
  private getDefaultConfig(override?: Partial<QueueConfig>): QueueConfig {
    const cpuCount = os.cpus().length
    const totalMemoryGB = os.totalmem() / (1024 ** 3)

    // 根据CPU核心数和内存动态计算并发数
    // 规则：
    // - 全局并发 = CPU核心数 * 2（考虑IO密集型任务）
    // - 单用户并发 = 全局并发 / 4（防止单用户占用过多资源）
    const defaultGlobalConcurrency = Math.max(4, Math.min(cpuCount * 2, 20))
    const defaultPerUserConcurrency = Math.max(2, Math.floor(defaultGlobalConcurrency / 4))

    console.log(`[QueueManager] 机器配置: CPU=${cpuCount}核, 内存=${totalMemoryGB.toFixed(2)}GB`)
    console.log(`[QueueManager] 推荐并发: 全局=${defaultGlobalConcurrency}, 单用户=${defaultPerUserConcurrency}`)

    return {
      globalConcurrency: override?.globalConcurrency ?? defaultGlobalConcurrency,
      perUserConcurrency: override?.perUserConcurrency ?? defaultPerUserConcurrency,
      maxQueueSize: override?.maxQueueSize ?? 1000,
      taskTimeout: override?.taskTimeout ?? 5 * 60 * 1000, // 5分钟
      enablePriority: override?.enablePriority ?? true,
    }
  }

  /**
   * 添加任务到队列
   */
  async addTask(
    options: TaskOptions,
    execute: () => Promise<void>
  ): Promise<void> {
    const { userId, offerId, priority = 5, timeout } = options

    // 检查队列是否已满
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`队列已满（最大${this.config.maxQueueSize}个任务）`)
    }

    // 检查是否已存在相同的任务
    const existingTask = this.queue.find(t => t.offerId === offerId) ||
      Array.from(this.runningTasks.values()).find(t => t.offerId === offerId)

    if (existingTask) {
      console.log(`[QueueManager] 任务已存在: Offer #${offerId}`)
      throw new Error(`Offer #${offerId} 已在队列中`)
    }

    return new Promise((resolve, reject) => {
      const task: QueueTask = {
        id: `${userId}-${offerId}-${Date.now()}`,
        userId,
        offerId,
        priority,
        addedAt: Date.now(),
        timeout: timeout ?? this.config.taskTimeout,
        execute,
        resolve,
        reject,
      }

      this.queue.push(task)
      console.log(`[QueueManager] 添加任务: Offer #${offerId}, 用户 #${userId}, 优先级 ${priority}, 队列长度 ${this.queue.length}`)

      // 尝试执行下一个任务
      this.processNext()
    })
  }

  /**
   * 处理下一个任务
   */
  private async processNext(): Promise<void> {
    // 检查全局并发限制
    if (this.runningTasks.size >= this.config.globalConcurrency) {
      console.log(`[QueueManager] 全局并发已满 (${this.runningTasks.size}/${this.config.globalConcurrency})`)
      return
    }

    // 检查队列是否为空
    if (this.queue.length === 0) {
      return
    }

    // 按优先级排序（如果启用）
    if (this.config.enablePriority) {
      this.queue.sort((a, b) => {
        // 优先级高的优先
        if (b.priority !== a.priority) {
          return b.priority - a.priority
        }
        // 优先级相同，先添加的优先
        return a.addedAt - b.addedAt
      })
    }

    // 查找可以执行的任务（考虑单用户并发限制）
    let taskIndex = -1
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i]
      const userRunning = this.userRunningCount.get(task.userId) || 0

      if (userRunning < this.config.perUserConcurrency) {
        taskIndex = i
        break
      }
    }

    // 没有可执行的任务
    if (taskIndex === -1) {
      console.log(`[QueueManager] 所有用户的并发已满，等待任务完成`)
      return
    }

    // 取出任务
    const task = this.queue.splice(taskIndex, 1)[0]

    // 更新统计
    this.runningTasks.set(task.id, task)
    this.userRunningCount.set(
      task.userId,
      (this.userRunningCount.get(task.userId) || 0) + 1
    )

    task.startedAt = Date.now()

    console.log(`[QueueManager] 开始执行任务: Offer #${task.offerId}, 用户 #${task.userId}`)
    console.log(`[QueueManager] 当前状态: 全局运行 ${this.runningTasks.size}/${this.config.globalConcurrency}, 队列 ${this.queue.length}`)

    // 执行任务（带超时）
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`任务超时（${task.timeout}ms）`))
      }, task.timeout)
    })

    try {
      await Promise.race([task.execute(), timeoutPromise])

      task.completedAt = Date.now()
      this.stats.completed++

      console.log(`[QueueManager] ✅ 任务完成: Offer #${task.offerId}, 耗时 ${task.completedAt - task.startedAt!}ms`)

      task.resolve()
    } catch (error: any) {
      this.stats.failed++

      console.error(`[QueueManager] ❌ 任务失败: Offer #${task.offerId}, 错误: ${error.message}`)

      task.reject(error)
    } finally {
      // 清理任务
      this.runningTasks.delete(task.id)
      this.userRunningCount.set(
        task.userId,
        Math.max(0, (this.userRunningCount.get(task.userId) || 0) - 1)
      )

      // 尝试执行下一个任务
      setImmediate(() => this.processNext())
    }
  }

  /**
   * 获取队列统计信息
   */
  getStats(): QueueStats {
    const perUserStats = new Map<number, {
      running: number
      queued: number
      completed: number
      failed: number
    }>()

    // 统计每个用户的运行中任务
    for (const task of this.runningTasks.values()) {
      if (!perUserStats.has(task.userId)) {
        perUserStats.set(task.userId, {
          running: 0,
          queued: 0,
          completed: 0,
          failed: 0,
        })
      }
      perUserStats.get(task.userId)!.running++
    }

    // 统计每个用户的队列中任务
    for (const task of this.queue) {
      if (!perUserStats.has(task.userId)) {
        perUserStats.set(task.userId, {
          running: 0,
          queued: 0,
          completed: 0,
          failed: 0,
        })
      }
      perUserStats.get(task.userId)!.queued++
    }

    return {
      globalRunning: this.runningTasks.size,
      globalQueued: this.queue.length,
      globalCompleted: this.stats.completed,
      globalFailed: this.stats.failed,
      perUserStats,
      config: this.config,
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config }
    console.log('[QueueManager] 配置已更新:', this.config)

    // 尝试处理队列中的任务
    this.processNext()
  }

  /**
   * 清空队列（仅清空等待中的任务，不影响运行中的任务）
   */
  clearQueue(userId?: number): number {
    const beforeLength = this.queue.length

    if (userId !== undefined) {
      this.queue = this.queue.filter(task => task.userId !== userId)
      console.log(`[QueueManager] 清空用户 #${userId} 的队列: ${beforeLength - this.queue.length} 个任务`)
    } else {
      this.queue = []
      console.log(`[QueueManager] 清空所有队列: ${beforeLength} 个任务`)
    }

    return beforeLength - this.queue.length
  }

  /**
   * 取消特定任务
   */
  cancelTask(offerId: number): boolean {
    const taskIndex = this.queue.findIndex(t => t.offerId === offerId)

    if (taskIndex !== -1) {
      const task = this.queue.splice(taskIndex, 1)[0]
      task.reject(new Error('任务已取消'))
      console.log(`[QueueManager] 取消任务: Offer #${offerId}`)
      return true
    }

    return false
  }
}

// ========== 单例实例 ==========

// 使用 global 对象防止热重载时重置
declare global {
  var __queueManagerInstance: ScrapeQueueManager | undefined
}

/**
 * 获取队列管理器实例（单例）
 *
 * 使用 global 对象存储实例，防止 Next.js 热重载时重新初始化
 */
export function getQueueManager(config?: Partial<QueueConfig>): ScrapeQueueManager {
  if (!global.__queueManagerInstance) {
    global.__queueManagerInstance = new ScrapeQueueManager(config)
  } else if (config) {
    global.__queueManagerInstance.updateConfig(config)
  }
  return global.__queueManagerInstance
}

/**
 * 重置队列管理器（用于测试）
 */
export function resetQueueManager(): void {
  global.__queueManagerInstance = undefined
}
