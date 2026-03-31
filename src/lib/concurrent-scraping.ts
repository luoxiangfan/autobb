/**
 * Concurrent Scraping Orchestrator
 *
 * Purpose: Manage concurrent offer scraping with dynamic resource-based limits
 * Key Features:
 * - Dynamic concurrency based on CPU/Memory usage
 * - Fair scheduling across users
 * - Progress tracking and error handling
 * - Integration with user-isolated proxy pool
 */

import os from 'os'
import { getUserIsolatedProxyPoolManager } from './proxy/user-isolated-proxy-pool'

// ============ Types ============

interface ScrapeTask {
  offerId: number
  userId: number
  priority: number  // 优先级（1-10，10最高）
  createdAt: Date
}

interface ScrapeResult {
  offerId: number
  success: boolean
  duration: number
  error?: string
}

interface ConcurrencyConfig {
  minConcurrency: number  // 最小并发数
  maxConcurrency: number  // 最大并发数
  cpuThreshold: number    // CPU阈值（%）
  memoryThreshold: number // 内存阈值（%）
}

// ============ Resource Monitor (Enhanced) ============

class ResourceMonitor {
  private cpuHistory: number[] = []
  private memHistory: number[] = []
  private readonly historySize = 10

  /**
   * 获取动态并发限制
   */
  getConcurrencyLimit(config: ConcurrencyConfig): number {
    const avgCpu = this.getAverageCPUUsage()
    const avgMem = this.getAverageMemoryUsage()

    console.log(`📊 资源状态: CPU=${avgCpu.toFixed(1)}%, Memory=${avgMem.toFixed(1)}%`)

    // 根据资源使用率动态调整
    if (avgCpu > 80 || avgMem > 85) {
      return Math.max(config.minConcurrency, 2)  // 资源紧张
    } else if (avgCpu > 65 || avgMem > 70) {
      return Math.max(config.minConcurrency, 3)  // 中等负载
    } else if (avgCpu > 50 || avgMem > 60) {
      return Math.min(config.maxConcurrency, 5)  // 较低负载
    } else if (avgCpu > 35 || avgMem > 45) {
      return Math.min(config.maxConcurrency, 7)  // 轻负载
    } else {
      return config.maxConcurrency  // 资源充足
    }
  }

  /**
   * 更新资源使用历史
   */
  updateResourceUsage(): void {
    const cpu = this.getCurrentCPUUsage()
    const mem = this.getCurrentMemoryUsage()

    this.cpuHistory.push(cpu)
    this.memHistory.push(mem)

    // 保持历史记录大小
    if (this.cpuHistory.length > this.historySize) {
      this.cpuHistory.shift()
    }
    if (this.memHistory.length > this.historySize) {
      this.memHistory.shift()
    }
  }

  private getAverageCPUUsage(): number {
    if (this.cpuHistory.length === 0) {
      this.updateResourceUsage()
    }
    return this.cpuHistory.reduce((a, b) => a + b, 0) / this.cpuHistory.length
  }

  private getAverageMemoryUsage(): number {
    if (this.memHistory.length === 0) {
      this.updateResourceUsage()
    }
    return this.memHistory.reduce((a, b) => a + b, 0) / this.memHistory.length
  }

  private getCurrentCPUUsage(): number {
    const cpus = os.cpus()
    let totalIdle = 0
    let totalTick = 0

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times]
      }
      totalIdle += cpu.times.idle
    }

    const idle = totalIdle / cpus.length
    const total = totalTick / cpus.length
    const usage = 100 - ~~(100 * idle / total)

    return usage
  }

  private getCurrentMemoryUsage(): number {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usage = ((totalMem - freeMem) / totalMem) * 100

    return usage
  }

  getStats() {
    return {
      currentCpu: this.getCurrentCPUUsage(),
      currentMemory: this.getCurrentMemoryUsage(),
      avgCpu: this.getAverageCPUUsage(),
      avgMemory: this.getAverageMemoryUsage()
    }
  }
}

// ============ Concurrent Scraper ============

class ConcurrentScrapingOrchestrator {
  private queue: ScrapeTask[] = []
  private running: Map<number, Promise<ScrapeResult>> = new Map()
  private results: ScrapeResult[] = []
  private config: ConcurrencyConfig
  private resourceMonitor: ResourceMonitor
  private monitorInterval: NodeJS.Timeout | null = null

  constructor(config?: Partial<ConcurrencyConfig>) {
    this.config = {
      minConcurrency: 2,
      maxConcurrency: 8,
      cpuThreshold: 75,
      memoryThreshold: 80,
      ...config,
    }

    this.resourceMonitor = new ResourceMonitor()
  }

  /**
   * 添加抓取任务到队列
   */
  addTask(offerId: number, userId: number, priority: number = 5): void {
    this.queue.push({
      offerId,
      userId,
      priority,
      createdAt: new Date(),
    })

    // 按优先级排序（高优先级在前）
    this.queue.sort((a, b) => b.priority - a.priority)

    console.log(`✅ 任务已加入队列: Offer ${offerId} (用户 ${userId}, 优先级 ${priority})`)
  }

  /**
   * 批量添加任务
   */
  addTasks(tasks: Array<{ offerId: number; userId: number; priority?: number }>): void {
    for (const task of tasks) {
      this.addTask(task.offerId, task.userId, task.priority || 5)
    }
  }

  /**
   * 开始处理队列
   */
  async processQueue(scrapeFunction: (offerId: number, userId: number) => Promise<void>): Promise<ScrapeResult[]> {
    console.log(`🚀 开始处理抓取队列: ${this.queue.length}个任务`)

    // 启动资源监控
    this.startMonitoring()

    while (this.queue.length > 0 || this.running.size > 0) {
      // 动态获取并发限制
      const concurrencyLimit = this.resourceMonitor.getConcurrencyLimit(this.config)

      // 启动新任务直到达到并发限制
      while (this.queue.length > 0 && this.running.size < concurrencyLimit) {
        const task = this.queue.shift()!

        const scrapePromise = this.executeTask(task, scrapeFunction)
        this.running.set(task.offerId, scrapePromise)

        // 立即开始执行（不等待）
        scrapePromise.finally(() => {
          this.running.delete(task.offerId)
        })
      }

      // 等待一段时间后再检查
      if (this.queue.length > 0 || this.running.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // 停止资源监控
    this.stopMonitoring()

    console.log(`✅ 队列处理完成: ${this.results.length}个任务`)
    return this.results
  }

  /**
   * 获取进度统计
   */
  getProgress(): {
    total: number
    completed: number
    running: number
    queued: number
    successRate: number
  } {
    const total = this.results.length + this.running.size + this.queue.length
    const completed = this.results.length
    const running = this.running.size
    const queued = this.queue.length
    const successCount = this.results.filter(r => r.success).length
    const successRate = completed > 0 ? (successCount / completed) * 100 : 0

    return {
      total,
      completed,
      running,
      queued,
      successRate,
    }
  }

  /**
   * 获取结果汇总
   */
  getSummary(): {
    totalTasks: number
    successfulTasks: number
    failedTasks: number
    totalDuration: number
    averageDuration: number
    errors: Array<{ offerId: number; error: string }>
  } {
    const successfulTasks = this.results.filter(r => r.success).length
    const failedTasks = this.results.filter(r => !r.success).length
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)
    const averageDuration = this.results.length > 0 ? totalDuration / this.results.length : 0

    const errors = this.results
      .filter(r => !r.success && r.error)
      .map(r => ({ offerId: r.offerId, error: r.error! }))

    return {
      totalTasks: this.results.length,
      successfulTasks,
      failedTasks,
      totalDuration,
      averageDuration,
      errors,
    }
  }

  // ============ Private Methods ============

  /**
   * 执行单个抓取任务
   */
  private async executeTask(
    task: ScrapeTask,
    scrapeFunction: (offerId: number, userId: number) => Promise<void>
  ): Promise<ScrapeResult> {
    const startTime = Date.now()

    console.log(`🔄 开始抓取: Offer ${task.offerId} (用户 ${task.userId})`)

    try {
      await scrapeFunction(task.offerId, task.userId)

      const duration = Date.now() - startTime
      const result: ScrapeResult = {
        offerId: task.offerId,
        success: true,
        duration,
      }

      this.results.push(result)
      console.log(`✅ 抓取成功: Offer ${task.offerId} (耗时 ${(duration / 1000).toFixed(1)}秒)`)

      return result
    } catch (error: any) {
      const duration = Date.now() - startTime
      const result: ScrapeResult = {
        offerId: task.offerId,
        success: false,
        duration,
        error: error.message,
      }

      this.results.push(result)
      console.error(`❌ 抓取失败: Offer ${task.offerId} (${error.message})`)

      return result
    }
  }

  /**
   * 启动资源监控
   */
  private startMonitoring(): void {
    this.monitorInterval = setInterval(() => {
      this.resourceMonitor.updateResourceUsage()

      const progress = this.getProgress()
      const stats = this.resourceMonitor.getStats()

      console.log(`📊 进度: ${progress.completed}/${progress.total} ` +
                  `(运行中: ${progress.running}, 队列: ${progress.queued}) ` +
                  `| CPU: ${stats.avgCpu.toFixed(1)}% ` +
                  `| Memory: ${stats.avgMemory.toFixed(1)}%`)
    }, 5000)  // 每5秒更新一次
  }

  /**
   * 停止资源监控
   */
  private stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }
}

// ============ Utility Functions ============

/**
 * 便捷函数：并发抓取多个Offer
 */
export async function scrapeOffersConcurrently(
  offers: Array<{ offerId: number; userId: number; priority?: number }>,
  scrapeFunction: (offerId: number, userId: number) => Promise<void>,
  config?: Partial<ConcurrencyConfig>
): Promise<ScrapeResult[]> {
  const orchestrator = new ConcurrentScrapingOrchestrator(config)

  orchestrator.addTasks(offers)

  const results = await orchestrator.processQueue(scrapeFunction)

  const summary = orchestrator.getSummary()
  console.log(`\n📊 抓取汇总:`)
  console.log(`   总任务数: ${summary.totalTasks}`)
  console.log(`   成功: ${summary.successfulTasks}`)
  console.log(`   失败: ${summary.failedTasks}`)
  console.log(`   总耗时: ${(summary.totalDuration / 1000).toFixed(1)}秒`)
  console.log(`   平均耗时: ${(summary.averageDuration / 1000).toFixed(1)}秒/任务`)

  if (summary.errors.length > 0) {
    console.log(`\n❌ 失败任务:`)
    for (const error of summary.errors) {
      console.log(`   Offer ${error.offerId}: ${error.error}`)
    }
  }

  return results
}

export { ConcurrentScrapingOrchestrator, ResourceMonitor }
export type { ScrapeTask, ScrapeResult, ConcurrencyConfig }
