/**
 * Google Ads 广告系列同步调度器
 *
 * 集成到统一队列系统中的内置调度器
 * 功能：定时检查用户的 Google Ads 账户，自动创建广告系列同步任务并入队
 *
 * 优势：
 * - 不需要外部 crontab
 * - 与队列系统生命周期绑定
 * - 统一管理和监控
 * - 支持动态配置
 * - 已有关联 Offer 时自动跳过
 */

import { getDatabase } from '../../db'
import {
  GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE,
  markStaleGoogleAdsCampaignSyncLogs,
  userHasActiveGoogleAdsCampaignSyncWork,
} from '@/lib/google-ads/campaign/sync-pipeline-status'
import { getQueueManagerForTaskType } from '../queue-routing'
import { resolveGoogleAdsSyncCredentialGate } from '@/lib/google-ads/auth/context'
import { userHasGoogleAdsMccAssignments } from '@/lib/google-ads/campaign/sync/index'
import { buildUserExecutionEligibleSql } from '../../campaign/server'

/**
 * Google Ads 广告系列同步任务数据
 */
interface GoogleAdsCampaignSyncTaskData {
  userId: number
  syncType: 'manual' | 'auto'
  customerId?: string // 指定同步特定账户
  dryRun?: boolean // 仅预览，不实际写入
}

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

interface UserSyncConfig {
  user_id: number
  google_ads_sync_enabled: string | boolean
  google_ads_sync_interval_hours: string | number
  last_campaign_sync_at: string | null
}

class GoogleAdsCampaignSyncScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private startupTimeoutHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private readonly CHECK_INTERVAL_MS = 60 * 1000 // 每分钟检查一次 (fallback)
  private readonly RUN_ON_START = parseBooleanEnv(
    process.env.QUEUE_GOOGLE_ADS_SYNC_RUN_ON_START,
    true
  )
  private readonly STARTUP_DELAY_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_GOOGLE_ADS_SYNC_STARTUP_DELAY_MS,
    30_000
  )
  private readonly SYNC_INTERVAL_HOURS = parseNonNegativeIntEnv(
    process.env.QUEUE_GOOGLE_ADS_SYNC_INTERVAL_HOURS,
    2
  )

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️  Google Ads 广告系列同步调度器已在运行')
      return
    }

    console.log('🔄 启动 Google Ads 广告系列同步调度器...')
    this.isRunning = true

    // 支持通过环境变量指定每天固定时间运行（格式: HH:mm，例如 17:00）
    const dailyAtRaw = process.env.QUEUE_GOOGLE_ADS_SYNC_DAILY_AT?.trim()
    const dailyAt = this.parseDailyAt(dailyAtRaw)

    if (dailyAt) {
      // 当配置了每日定时运行时，以该策略为准（忽略 RUN_ON_START 的首次即时执行）
      console.log(
        `⏰ 使用每日定时策略: 每天 ${String(dailyAt.hour).padStart(2, '0')}:${String(
          dailyAt.minute
        ).padStart(2, '0')}`
      )

      // 计算到下次执行的延迟并设置定时器；执行后使用 24h 的间隔循环
      const scheduleDailyRun = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(dailyAt.hour, dailyAt.minute, 0, 0)
        if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
        const msUntilNext = next.getTime() - now.getTime()

        console.log(`⏳ 下一次 Google Ads 同步将在 ${new Date(Date.now() + msUntilNext).toISOString()} 执行`)

        // 清 任已有句柄
        if (this.startupTimeoutHandle) {
          clearTimeout(this.startupTimeoutHandle)
          this.startupTimeoutHandle = null
        }
        if (this.intervalHandle) {
          clearInterval(this.intervalHandle)
          this.intervalHandle = null
        }

        this.startupTimeoutHandle = setTimeout(() => {
          this.startupTimeoutHandle = null
          void this.checkAndScheduleSync()

          // 执行后每 24 小时运行一次
          this.intervalHandle = setInterval(() => {
            void this.checkAndScheduleSync()
          }, 24 * 60 * 60 * 1000)
        }, msUntilNext)
      }

      scheduleDailyRun()

    } else {
      // 启动时执行一次检查（支持延迟，降低冷启动竞争）
      if (this.RUN_ON_START) {
        if (this.startupTimeoutHandle) {
          clearTimeout(this.startupTimeoutHandle)
          this.startupTimeoutHandle = null
        }
        if (this.STARTUP_DELAY_MS === 0) {
          void this.checkAndScheduleSync()
        } else {
          console.log(
            `⏳ Google Ads 同步首次检查将在 ${Math.round(this.STARTUP_DELAY_MS / 1000)} 秒后执行`
          )
          this.startupTimeoutHandle = setTimeout(() => {
            this.startupTimeoutHandle = null
            void this.checkAndScheduleSync()
          }, this.STARTUP_DELAY_MS)
        }
      } else {
        console.log('⏭️ 已禁用启动时 Google Ads 同步首轮检查')
      }

      // 设置定时检查（每分钟）
      this.intervalHandle = setInterval(() => {
        this.checkAndScheduleSync()
      }, this.CHECK_INTERVAL_MS)

      console.log(
        `✅ Google Ads 广告系列同步调度器已启动 (检查间隔：${this.CHECK_INTERVAL_MS / 1000 / 60}分钟，同步间隔：${this.SYNC_INTERVAL_HOURS}小时)`
      )
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('⏹️ 停止 Google Ads 广告系列同步调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle)
      this.startupTimeoutHandle = null
    }

    this.isRunning = false
    console.log('✅ Google Ads 广告系列同步调度器已停止')
  }

  /**
   * 解析并验证 daily_at 字符串（支持 HH:mm）
   */
  private parseDailyAt(raw: string | undefined): { hour: number; minute: number } | null {
    if (!raw) return null
    const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
    if (!m) return null
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { hour, minute }
  }

  /**
   * 检查并调度同步任务
   */
  private async checkAndScheduleSync(): Promise<void> {
    const checkStartAt = Date.now()

    try {
      console.log(`\n[${new Date().toISOString()}] 🔄 检查 Google Ads 广告系列同步任务...`)

      const staleClosed = await markStaleGoogleAdsCampaignSyncLogs()
      if (staleClosed > 0) {
        console.log(`  🧹 已自动关闭 ${staleClosed} 条超时的 running 同步日志`)
      }

      const db = await getDatabase()
      const now = new Date()
      const userEligibleCondition = buildUserExecutionEligibleSql({
        userAlias: 'u',
      })

      // 查询所有启用了自动同步的用户
      const configs = await db.query<UserSyncConfig>(
        `
        SELECT
          u.id AS user_id,
          COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'google_ads' AND key = 'campaign_sync_enabled' LIMIT 1),
            'true'
          ) AS google_ads_sync_enabled,
          COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'google_ads' AND key = 'sync_interval_hours' LIMIT 1),
            '${this.SYNC_INTERVAL_HOURS}'
          ) AS google_ads_sync_interval_hours,
          (
            SELECT MAX(completed_at)
            FROM sync_logs
            WHERE user_id = u.id
              AND sync_type = '${GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE}'
              AND status IN ('success', 'partial', 'failed')
              AND completed_at IS NOT NULL
          ) AS last_campaign_sync_at
        FROM users u
        WHERE COALESCE(
          (SELECT value FROM system_settings
           WHERE user_id = u.id AND category = 'google_ads' AND key = 'campaign_sync_enabled' LIMIT 1),
          'true'
        ) = 'true'
          AND ${userEligibleCondition}
        `
      )

      if (configs.length === 0) {
        console.log('  ℹ️  没有启用 Google Ads 广告系列自动同步的用户')
        return
      }

      console.log(`  📊 找到 ${configs.length} 个启用自动同步的用户配置`)

      // 遍历用户，检查是否需要触发同步
      let triggeredCount = 0
      let skippedCount = 0
      let noCredentialsCount = 0
      let noMccCount = 0
      let activeWorkSkippedCount = 0

      for (const config of configs) {
        const userId = config.user_id
        const intervalHours =
          parseInt(String(config.google_ads_sync_interval_hours)) || this.SYNC_INTERVAL_HOURS
        const lastSyncAt = config.last_campaign_sync_at
          ? new Date(config.last_campaign_sync_at)
          : null

        // 计算距离上次同步的小时数
        const hoursSinceLastSync = lastSyncAt
          ? (now.getTime() - lastSyncAt.getTime()) / (1000 * 60 * 60)
          : Infinity

        // 如果从未同步过，或者距离上次同步已超过间隔时间，触发同步
        if (hoursSinceLastSync >= intervalHours) {
          const activeWork = await userHasActiveGoogleAdsCampaignSyncWork(userId)
          if (activeWork.active) {
            console.log(
              `  ⏭️  用户 #${userId}: 已有进行中的同步（${activeWork.reason}, pending=${activeWork.pending}, running=${activeWork.running}），跳过入队`
            )
            activeWorkSkippedCount++
            skippedCount++
            continue
          }
          let hasValidCredentials = false
          let skipReason = ''

          try {
            const gate = await resolveGoogleAdsSyncCredentialGate(userId)
            hasValidCredentials = gate.ok
            if (!gate.ok) {
              skipReason = gate.reason
            }
          } catch (error) {
            skipReason = `凭证验证失败：${error instanceof Error ? error.message : String(error)}`
          }

          if (!hasValidCredentials) {
            console.log(`  ⚠️  用户 #${userId}: ${skipReason}，跳过同步`)
            noCredentialsCount++
            skippedCount++
            continue
          }

          const hasMcc = await userHasGoogleAdsMccAssignments(userId)
          if (!hasMcc) {
            console.log(`  ⏭️  用户 #${userId}: 未分配 MCC，无法同步 Google Ads 广告系列，跳过入队`)
            noMccCount++
            skippedCount++
            continue
          }

          // 4. 凭证有效，创建同步任务
          console.log(
            `  🔄 用户 #${userId}: 距离上次同步 ${lastSyncAt ? `${hoursSinceLastSync.toFixed(1)}小时` : '从未同步'}, 触发同步 (间隔：${intervalHours}h)`
          )

          try {
            const taskId = await this.triggerGoogleAdsCampaignSync(userId, {
              syncType: 'auto',
            })
            console.log(`     ✅ 同步任务已入队：${taskId}`)
            triggeredCount++
          } catch (error) {
            console.error(`     ❌ 触发同步失败:`, error)
            skippedCount++
          }
        } else {
          const hoursUntilNext = intervalHours - hoursSinceLastSync
          console.log(`  ⏰ 用户 #${userId}: 距离下次同步还有 ${hoursUntilNext.toFixed(1)} 小时`)
        }
      }

      const elapsedMs = Date.now() - checkStartAt
      console.log(
        `\n✅ 检查完成：触发了 ${triggeredCount}/${configs.length} 个同步任务，跳过 ${skippedCount} 个用户（${noCredentialsCount} 个无凭证，${noMccCount} 个无 MCC，${[...Array(activeWorkSkippedCount).keys()].length} 个活跃任务）（耗时 ${elapsedMs}ms）`
      )
    } catch (error) {
      const elapsedMs = Date.now() - checkStartAt
      console.error(`❌ 检查 Google Ads 同步任务失败（耗时${elapsedMs}ms）:`, error)
    }
  }

  /**
   * 触发 Google Ads 广告系列同步任务
   */
  async triggerGoogleAdsCampaignSync(
    userId: number,
    options: {
      syncType?: 'manual' | 'auto'
      customerId?: string
      dryRun?: boolean
    } = {}
  ): Promise<string> {
    // 🆕 修复：使用 getQueueManagerForTaskType 确保任务被路由到正确的队列
    // google-ads-campaign-sync 属于后台任务，应该入队到 background 队列
    const queue = getQueueManagerForTaskType('@/lib/google-ads/campaign/sync')

    const taskData: GoogleAdsCampaignSyncTaskData = {
      userId,
      syncType: options.syncType || 'auto',
      customerId: options.customerId,
      dryRun: options.dryRun,
    }

    const taskId = await queue.enqueue('@/lib/google-ads/campaign/sync', taskData, userId, {
      priority: options.syncType === 'manual' ? 'high' : 'normal',
      maxRetries: 3,
    })

    console.log(
      `📥 [GoogleAdsSyncTrigger] 同步任务已入队：${taskId}, 用户 #${userId}, 类型：${taskData.syncType}`
    )

    return taskId
  }

  /**
   * 手动触发同步（用于 API 调用）
   */
  async triggerManualSync(
    userId: number,
    options?: {
      customerId?: string
      dryRun?: boolean
    }
  ): Promise<string> {
    console.log(`🔧 [GoogleAdsSyncScheduler] 手动触发用户 #${userId} 的同步任务`)

    const taskId = await this.triggerGoogleAdsCampaignSync(userId, {
      syncType: 'manual',
      ...options,
    })

    return taskId
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    isRunning: boolean
    checkIntervalMs: number
    syncIntervalHours: number
  } {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.CHECK_INTERVAL_MS,
      syncIntervalHours: this.SYNC_INTERVAL_HOURS,
    }
  }
}

/**
 * 单例实例
 */
let schedulerInstance: GoogleAdsCampaignSyncScheduler | null = null

/**
 * 获取调度器单例
 */
export function getGoogleAdsCampaignSyncScheduler(): GoogleAdsCampaignSyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new GoogleAdsCampaignSyncScheduler()
  }
  return schedulerInstance
}
