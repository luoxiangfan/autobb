/**
 * 广告系列暂停任务检测调度器
 *
 * 功能：定时检测所有已暂停的广告系列，自动暂停关联 offer 的补点击和换链接任务
 *
 * 架构说明：
 * - 运行在 scheduler 进程中
 * - 与 URL Swap、补点击任务调度器采用相同架构
 * - 定时检测 + 队列任务执行
 *
 * 配置项：
 * - QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS: 检测间隔（默认 30 分钟）
 * - QUEUE_CAMPAIGN_PAUSED_RUN_ON_START: 启动时是否立即执行一次（默认 true）
 */

import { getDatabase } from '@/lib/db'
import { pauseOfferTasksBatch } from '@/lib/campaign-offer-tasks'

function parseBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (rawValue === undefined) return defaultValue

  const normalized = rawValue.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false

  return defaultValue
}

function parseNonNegativeIntEnv(rawValue: string | undefined, defaultValue: number): number {
  if (rawValue === undefined) return defaultValue

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue
  }

  return parsed
}

interface PausedCampaignInfo {
  id: number
  user_id: number
  offer_id: number
  status: string
  updated_at: string
}

export class CampaignPausedTaskScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private startupTimeoutHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private lastCheckAt: Date | null = null
  private lastCheckResult: {
    totalPausedCampaigns: number
    totalOffersProcessed: number
    clickFarmTasksPaused: number
    urlSwapTasksDisabled: number
    errors: number
  } | null = null

  private readonly CHECK_INTERVAL_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_CHECK_INTERVAL_MS,
    30 * 60 * 1000  // 默认 30 分钟
  )
  private readonly RUN_ON_START = parseBooleanEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_RUN_ON_START,
    true
  )
  private readonly STARTUP_DELAY_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_CAMPAIGN_PAUSED_STARTUP_DELAY_MS,
    15_000  // 默认 15 秒延迟，避免冷启动竞争
  )

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️  广告系列暂停任务检测调度器已在运行')
      return
    }

    console.log('🔄 启动广告系列暂停任务检测调度器...')
    this.isRunning = true

    // 启动时执行一次检查（支持延迟）
    if (this.RUN_ON_START) {
      if (this.STARTUP_DELAY_MS === 0) {
        this.checkAndPauseTasks()
      } else {
        console.log(`⏳ 首次检测将在 ${Math.round(this.STARTUP_DELAY_MS / 1000)} 秒后执行`)
        this.startupTimeoutHandle = setTimeout(() => {
          this.startupTimeoutHandle = null
          this.checkAndPauseTasks()
        }, this.STARTUP_DELAY_MS)
      }
    } else {
      console.log('⏭️ 已禁用启动时首次检测')
    }

    // 设置定时检查
    this.intervalHandle = setInterval(() => {
      this.checkAndPauseTasks()
    }, this.CHECK_INTERVAL_MS)

    console.log(`✅ 广告系列暂停任务检测调度器已启动 (检测间隔：${this.CHECK_INTERVAL_MS / 1000 / 60}分钟)`)
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('⏹️ 停止广告系列暂停任务检测调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle)
      this.startupTimeoutHandle = null
    }

    this.isRunning = false
    console.log('✅ 广告系列暂停任务检测调度器已停止')
  }

  /**
   * 检查并暂停任务
   */
  private async checkAndPauseTasks(): Promise<void> {
    const checkStartAt = Date.now()

    try {
      const now = new Date()
      console.log(`\n[${now.toISOString()}] 🔄 检测已暂停广告系列的任务...`)

      const db = await getDatabase()
      const isDeletedCondition = db.type === 'postgres' ? false : 0
      // 查询所有已暂停的广告系列（按用户分组）
      const query = `
        SELECT 
          c.id,
          c.user_id,
          c.offer_id,
          c.status,
          c.updated_at
        FROM campaigns c
        WHERE c.status = 'PAUSED'
          AND c.is_deleted = ${isDeletedCondition}
          AND c.offer_id IS NOT NULL
        ORDER BY c.user_id, c.updated_at DESC
      `

      const pausedCampaigns = await db.query<PausedCampaignInfo>(query)

      if (pausedCampaigns.length === 0) {
        console.log('  ℹ️  没有已暂停的广告系列')
        this.lastCheckAt = new Date()
        this.lastCheckResult = {
          totalPausedCampaigns: 0,
          totalOffersProcessed: 0,
          clickFarmTasksPaused: 0,
          urlSwapTasksDisabled: 0,
          errors: 0,
        }
        return
      }

      console.log(`  📊 找到 ${pausedCampaigns.length} 个已暂停的广告系列`)

      // 按用户分组，去重 offer_id
      const userOfferMap = new Map<number, Set<number>>()

      for (const campaign of pausedCampaigns) {
        const userId = campaign.user_id
        const offerId = campaign.offer_id

        if (!userOfferMap.has(userId)) {
          userOfferMap.set(userId, new Set())
        }
        userOfferMap.get(userId)!.add(offerId)
      }

      // 批量处理每个用户的 offer
      let totalOffersProcessed = 0
      let totalClickFarmTasksPaused = 0
      let totalUrlSwapTasksDisabled = 0
      let totalErrors = 0

      for (const [userId, offerIds] of userOfferMap.entries()) {
        const offerIdArray = Array.from(offerIds)

        try {
          const batchResults = await pauseOfferTasksBatch(
            offerIdArray,
            userId,
            'campaign_paused_cron',
            '定时检测：关联广告系列已暂停，自动暂停任务'
          )

          for (const { result } of batchResults) {
            if (result.clickFarmTaskPaused) totalClickFarmTasksPaused++
            if (result.urlSwapTaskDisabled) totalUrlSwapTasksDisabled++
          }

          totalOffersProcessed += offerIdArray.length

          console.log(
            `  ✓ 用户 ${userId}: 处理 ${offerIdArray.length} 个 offer, ` +
            `暂停 ${totalClickFarmTasksPaused} 个补点击任务，禁用 ${totalUrlSwapTasksDisabled} 个换链接任务`
          )
        } catch (error: any) {
          totalErrors++
          console.error(`  ✗ 用户 ${userId} 处理失败:`, error.message)
        }
      }

      const elapsedMs = Date.now() - checkStartAt

      // 记录检查结果
      this.lastCheckAt = new Date()
      this.lastCheckResult = {
        totalPausedCampaigns: pausedCampaigns.length,
        totalOffersProcessed,
        clickFarmTasksPaused: totalClickFarmTasksPaused,
        urlSwapTasksDisabled: totalUrlSwapTasksDisabled,
        errors: totalErrors,
      }

      console.log(`\n✅ 检测完成（耗时 ${elapsedMs}ms）:`)
      console.log(`   - 已暂停广告系列：${pausedCampaigns.length}`)
      console.log(`   - 已处理 offer: ${totalOffersProcessed}`)
      console.log(`   - 已暂停补点击任务：${totalClickFarmTasksPaused}`)
      console.log(`   - 已禁用换链接任务：${totalUrlSwapTasksDisabled}`)
      console.log(`   - 错误数：${totalErrors}`)
    } catch (error: any) {
      const elapsedMs = Date.now() - checkStartAt
      console.error(`❌ 检测已暂停广告系列任务失败（耗时 ${elapsedMs}ms）:`, error)

      this.lastCheckAt = new Date()
      this.lastCheckResult = {
        totalPausedCampaigns: 0,
        totalOffersProcessed: 0,
        clickFarmTasksPaused: 0,
        urlSwapTasksDisabled: 0,
        errors: 1,
      }
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
      totalOffersProcessed: number
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
