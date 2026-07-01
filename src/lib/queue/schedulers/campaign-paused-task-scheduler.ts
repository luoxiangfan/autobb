/**
 * 广告系列暂停任务检测调度器
 *
 * 功能：定时检测所有已暂停的广告系列，自动暂停关联 offer 的补点击和换链接任务
 *
 * 架构说明
 * 运行在 scheduler 进程中
 * 与 URL Swap、补点击任务调度器采用相同架构
 * 定时检测 + 队列任务执行
 *
 * 配置项
 * QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS: 检测间隔（默认 30 分钟）
 * QUEUE_CAMPAIGN_PAUSED_RUN_ON_START: 启动时是否立即执行一次（默认 true）
 * QUEUE_CAMPAIGN_PAUSED_USER_CONCURRENCY: 按用户并发处理上限（默认 3，受 MAX 收敛）
 * QUEUE_CAMPAIGN_PAUSED_USER_CONCURRENCY_MAX: 用户并发硬上限（默认 16）
 */

import { logger } from '@/lib/common/server'
import { parseBooleanEnv } from '@/lib/common/parse-env'
import { runCampaignPausedTaskCheck } from '@/lib/campaign/server'
function parseNonNegativeIntEnv(
  rawValue: string | undefined,
  defaultValue: number,
  minValue: number = 0
): number {
  if (rawValue === undefined) return defaultValue

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return defaultValue
  }

  return parsed
}

export class CampaignPausedTaskScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private startupTimeoutHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private isChecking: boolean = false
  private lastCheckAt: Date | null = null
  private lastCheckResult: {
    totalPausedCampaigns: number
    totalPausedOfferPairs: number
    totalOffersProcessed: number
    totalOffersAttempted: number
    totalOffersSucceeded: number
    totalOffersFailed: number
    totalOffersChanged: number
    totalOffersNoop: number
    clickFarmTasksPaused: number
    urlSwapTasksDisabled: number
    errors: number
  } | null = null

  private readonly CHECK_INTERVAL_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS,
    30 * 60 * 1000, // 默认 30 分钟
    1_000 // 最低 1 秒，避免 0 导致忙循环
  )
  private readonly RUN_ON_START = parseBooleanEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_RUN_ON_START,
    true
  )
  private readonly STARTUP_DELAY_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_STARTUP_DELAY_MS,
    15_000 // 默认 15 秒延迟，避免冷启动竞争
  )

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      logger.debug('⚠️  广告系列暂停任务检测调度器已在运行')
      return
    }

    logger.debug('🔄 启动广告系列暂停任务检测调度器...')
    this.isRunning = true

    // 启动时执行一次检查（支持延迟）
    if (this.RUN_ON_START) {
      if (this.STARTUP_DELAY_MS === 0) {
        this.checkAndPauseTasks()
      } else {
        logger.debug(`⏳ 首次检测将在 ${Math.round(this.STARTUP_DELAY_MS / 1000)} 秒后执行`)
        this.startupTimeoutHandle = setTimeout(() => {
          this.startupTimeoutHandle = null
          this.checkAndPauseTasks()
        }, this.STARTUP_DELAY_MS)
      }
    } else {
      logger.debug('⏭️ 已禁用启动时首次检测')
    }

    // 设置定时检查
    this.intervalHandle = setInterval(() => {
      this.checkAndPauseTasks()
    }, this.CHECK_INTERVAL_MS)

    logger.debug(
      `✅ 广告系列暂停任务检测调度器已启动 (检测间隔：${this.CHECK_INTERVAL_MS / 1000 / 60}分钟)`
    )
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    logger.debug('⏹️ 停止广告系列暂停任务检测调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle)
      this.startupTimeoutHandle = null
    }

    this.isRunning = false
    logger.debug('✅ 广告系列暂停任务检测调度器已停止')
  }

  /**
   * 检查并暂停任务
   */
  private async checkAndPauseTasks(): Promise<void> {
    if (this.isChecking) {
      logger.debug('⏭️ 上一次暂停任务检测仍在运行，跳过本次执行')
      return
    }

    this.isChecking = true
    const checkStartAt = Date.now()

    try {
      const now = new Date()
      logger.debug(`\n[${now.toISOString()}] 🔄 检测已暂停广告系列的任务...`)

      const result = await runCampaignPausedTaskCheck(
        'campaign_paused_cron',
        '定时检测：关联广告系列已暂停，自动暂停任务'
      )

      if (result.summary.totalPausedOfferPairs === 0) {
        logger.debug('  ℹ️  没有已暂停的广告系列')
        this.lastCheckAt = new Date()
        this.lastCheckResult = {
          totalPausedCampaigns: result.summary.totalPausedCampaigns,
          totalPausedOfferPairs: 0,
          totalOffersProcessed: 0,
          totalOffersAttempted: 0,
          totalOffersSucceeded: 0,
          totalOffersFailed: 0,
          totalOffersChanged: 0,
          totalOffersNoop: 0,
          clickFarmTasksPaused: 0,
          urlSwapTasksDisabled: 0,
          errors: 0,
        }
        return
      }

      logger.debug(`  📊 找到 ${result.summary.totalPausedCampaigns} 个已暂停广告系列`)
      logger.debug(`  📊 去重后用户-offer 关系数：${result.summary.totalPausedOfferPairs}`)

      for (const userResult of result.details) {
        logger.debug(
          `  ✓ 用户 ${userResult.userId}: 处理 ${userResult.offerIds.length} 个 offer, ` +
            `成功 ${userResult.offersSucceeded}，失败 ${userResult.offersFailed}，` +
            `暂停 ${userResult.clickFarmTasksPaused} 个补点击任务，禁用 ${userResult.urlSwapTasksDisabled} 个换链接任务`
        )
      }

      const elapsedMs = Date.now() - checkStartAt

      // 记录检查结果
      this.lastCheckAt = new Date()
      this.lastCheckResult = {
        ...result.summary,
      }

      logger.debug(`\n✅ 检测完成（耗时 ${elapsedMs}ms）:`)
      logger.debug(`   - 已暂停广告系列：${result.summary.totalPausedCampaigns}`)
      logger.debug(`   - 去重后用户-offer 关系：${result.summary.totalPausedOfferPairs}`)
      logger.debug(`   - 已处理 offer: ${result.summary.totalOffersProcessed}`)
      logger.debug(`   - 尝试处理 offer: ${result.summary.totalOffersAttempted}`)
      logger.debug(`   - 处理成功 offer: ${result.summary.totalOffersSucceeded}`)
      logger.debug(`   - 处理失败 offer: ${result.summary.totalOffersFailed}`)
      logger.debug(`   - 发生状态变更 offer: ${result.summary.totalOffersChanged}`)
      logger.debug(`   - 无状态变更 offer: ${result.summary.totalOffersNoop}`)
      logger.debug(`   - 已暂停补点击任务：${result.summary.clickFarmTasksPaused}`)
      logger.debug(`   - 已禁用换链接任务：${result.summary.urlSwapTasksDisabled}`)
      logger.debug(`   - 错误数：${result.summary.errors}`)
    } catch (error: any) {
      const elapsedMs = Date.now() - checkStartAt
      console.error(`❌ 检测已暂停广告系列任务失败（耗时 ${elapsedMs}ms）:`, error)

      this.lastCheckAt = new Date()
      this.lastCheckResult = {
        totalPausedCampaigns: 0,
        totalPausedOfferPairs: 0,
        totalOffersProcessed: 0,
        totalOffersAttempted: 0,
        totalOffersSucceeded: 0,
        totalOffersFailed: 0,
        totalOffersChanged: 0,
        totalOffersNoop: 0,
        clickFarmTasksPaused: 0,
        urlSwapTasksDisabled: 0,
        errors: 1,
      }
    } finally {
      this.isChecking = false
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    isRunning: boolean
    checkIntervalMs: number
    lastCheckAt: string | null
    lastCheckResult: {
      totalPausedCampaigns: number
      totalPausedOfferPairs: number
      totalOffersProcessed: number
      totalOffersAttempted: number
      totalOffersSucceeded: number
      totalOffersFailed: number
      totalOffersChanged: number
      totalOffersNoop: number
      clickFarmTasksPaused: number
      urlSwapTasksDisabled: number
      errors: number
    } | null
  } {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.CHECK_INTERVAL_MS,
      lastCheckAt: this.lastCheckAt ? this.lastCheckAt.toISOString() : null,
      lastCheckResult: this.lastCheckResult,
    }
  }
}

/**
 * 单例实例
 */
let schedulerInstance: CampaignPausedTaskScheduler | null = null

/**
 * 获取调度器单例
 */
export function getCampaignPausedTaskScheduler(): CampaignPausedTaskScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CampaignPausedTaskScheduler()
  }
  return schedulerInstance
}
