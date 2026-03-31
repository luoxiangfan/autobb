/**
 * Sync Scheduler - Background service for automated data synchronization
 *
 * This service runs in the background and triggers automatic syncs based on
 * user configuration. It checks for pending syncs every minute and executes
 * them according to the configured interval.
 *
 * 🔄 已迁移到统一队列系统
 * - 同步任务通过 triggerDataSync() 入队
 * - 邮件通知通过 triggerEmail() 入队
 * - 保留调度器逻辑，但执行改为队列任务
 */

import { getDatabase } from './db'
import { triggerDataSync, triggerEmail } from './queue-triggers'

export interface SyncSchedulerConfig {
  checkIntervalMs: number // How often to check for pending syncs (default: 60000 = 1 minute)
  enabled: boolean // Master switch for scheduler
}

export class SyncScheduler {
  private static instance: SyncScheduler
  private checkInterval: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private config: SyncSchedulerConfig

  private constructor(config?: Partial<SyncSchedulerConfig>) {
    this.config = {
      checkIntervalMs: config?.checkIntervalMs || 60000, // 1 minute
      enabled: config?.enabled ?? true,
    }
  }

  static getInstance(config?: Partial<SyncSchedulerConfig>): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler(config)
    }
    return SyncScheduler.instance
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Sync scheduler is already running')
      return
    }

    if (!this.config.enabled) {
      console.log('⏸️  Sync scheduler is disabled')
      return
    }

    console.log('🚀 Starting sync scheduler...')
    this.isRunning = true

    // Initial check
    this.checkPendingSyncs()

    // Set up periodic check
    this.checkInterval = setInterval(() => {
      this.checkPendingSyncs()
    }, this.config.checkIntervalMs)

    console.log(
      `✅ Sync scheduler started (check interval: ${this.config.checkIntervalMs}ms)`
    )
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Sync scheduler is not running')
      return
    }

    console.log('🛑 Stopping sync scheduler...')

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    this.isRunning = false
    console.log('✅ Sync scheduler stopped')
  }

  /**
   * Check for users with pending syncs and execute them
   */
  private async checkPendingSyncs() {
    if (!this.isRunning) {
      return
    }

    try {
      const db = await getDatabase()
      const now = new Date().toISOString()
      const autoSyncCondition = db.type === 'postgres' ? 'sc.auto_sync_enabled = true' : 'sc.auto_sync_enabled = 1'

      // Find users with auto sync enabled and next sync time has passed
      const pendingSyncs = await db.query(
        `
        SELECT
          sc.user_id,
          sc.sync_interval_hours,
          sc.max_retry_attempts,
          sc.retry_delay_minutes,
          sc.consecutive_failures,
          sc.notify_on_success,
          sc.notify_on_failure,
          sc.notification_email
        FROM sync_config sc
        WHERE ${autoSyncCondition}
          AND (
            sc.next_scheduled_sync_at IS NULL
            OR sc.next_scheduled_sync_at <= ?
          )
          AND (
            sc.consecutive_failures < sc.max_retry_attempts
            OR sc.max_retry_attempts = 0
          )
      `,
        [now]
      ) as Array<{
        user_id: number
        sync_interval_hours: number
        max_retry_attempts: number
        retry_delay_minutes: number
        consecutive_failures: number
        notify_on_success: number
        notify_on_failure: number
        notification_email: string | null
      }>

      if (pendingSyncs.length === 0) {
        // No pending syncs
        return
      }

      console.log(`📊 Found ${pendingSyncs.length} pending auto syncs`)

      // Execute syncs sequentially to avoid overloading
      for (const sync of pendingSyncs) {
        await this.executeSyncForUser(sync)
      }
    } catch (error) {
      console.error('❌ Error checking pending syncs:', error)
    }
  }

  /**
   * Execute sync for a specific user
   */
  private async executeSyncForUser(syncConfig: {
    user_id: number
    sync_interval_hours: number
    max_retry_attempts: number
    retry_delay_minutes: number
    consecutive_failures: number
    notify_on_success: number
    notify_on_failure: number
    notification_email: string | null
  }) {
    const { user_id, sync_interval_hours, consecutive_failures } = syncConfig
    const db = await getDatabase()

    try {
      console.log(`🔄 Starting auto sync for user ${user_id}...`)

      // 🔄 使用队列系统触发同步任务（替代直接调用dataSyncService）
      const taskId = await triggerDataSync(user_id, {
        syncType: 'auto',
        priority: 'normal'
      })

      console.log(`📥 Auto sync task queued for user ${user_id}: ${taskId}`)

      // Calculate next sync time
      const nextSync = new Date()
      nextSync.setHours(nextSync.getHours() + sync_interval_hours)

      // Update config: set next sync time (failures will be handled by queue system)
      await db.exec(
        `
        UPDATE sync_config
        SET
          last_auto_sync_at = ?,
          next_scheduled_sync_at = ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `,
        [new Date().toISOString(), nextSync.toISOString(), user_id]
      )

      // 🔄 使用队列系统发送成功通知
      if (syncConfig.notify_on_success && syncConfig.notification_email) {
        await this.sendNotification(
          syncConfig.notification_email,
          'success',
          0,  // 记录数将由队列任务完成后更新
          0   // 耗时将由队列任务完成后更新
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`❌ Auto sync queue failed for user ${user_id}:`, errorMessage)

      const newFailureCount = consecutive_failures + 1

      // Determine next retry time
      let nextRetryTime: string | null = null
      if (newFailureCount < syncConfig.max_retry_attempts) {
        const nextRetry = new Date()
        nextRetry.setMinutes(
          nextRetry.getMinutes() + syncConfig.retry_delay_minutes
        )
        nextRetryTime = nextRetry.toISOString()
        console.log(
          `⏱️  Will retry in ${syncConfig.retry_delay_minutes} minutes (attempt ${newFailureCount + 1}/${syncConfig.max_retry_attempts})`
        )
      } else {
        console.log(
          `⚠️  Max retry attempts (${syncConfig.max_retry_attempts}) reached, disabling auto sync`
        )
      }

      // Update config: increment failures, set next retry time
      await db.exec(
        `
        UPDATE sync_config
        SET
          consecutive_failures = ?,
          next_scheduled_sync_at = ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `,
        [newFailureCount, nextRetryTime, user_id]
      )

      // 🔄 使用队列系统发送失败通知
      if (syncConfig.notify_on_failure && syncConfig.notification_email) {
        await this.sendNotification(
          syncConfig.notification_email,
          'failure',
          0,
          0,
          errorMessage
        )
      }
    }
  }

  /**
   * Send notification email via queue system
   * 🔄 已迁移到统一队列系统，使用 triggerEmail() 入队
   */
  private async sendNotification(
    email: string,
    type: 'success' | 'failure',
    recordCount?: number,
    duration?: number,
    error?: string
  ) {
    try {
      const subject = type === 'success'
        ? '✅ AutoAds 数据同步成功'
        : '❌ AutoAds 数据同步失败'

      const body = type === 'success'
        ? `<p>您的 Google Ads 数据同步已成功完成。</p>
           <ul>
             <li>同步记录数: ${recordCount || '处理中'}</li>
             <li>耗时: ${duration ? `${duration}ms` : '处理中'}</li>
           </ul>
           <p>您可以登录 AutoAds 查看最新数据。</p>`
        : `<p>您的 Google Ads 数据同步失败。</p>
           <p><strong>错误信息:</strong> ${error || '未知错误'}</p>
           <p>系统将自动重试，如果问题持续，请检查您的 Google Ads 账户配置。</p>`

      // 🔄 使用队列系统发送邮件
      await triggerEmail({
        to: email,
        subject,
        body,
        type: type === 'failure' ? 'alert' : 'notification'
      })

      console.log(`📧 [Email Notification queued to ${email}] Type: ${type}`)
    } catch (err) {
      console.error(`❌ Failed to queue email notification:`, err)
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.config.checkIntervalMs,
      enabled: this.config.enabled,
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncSchedulerConfig>) {
    const wasRunning = this.isRunning

    if (wasRunning) {
      this.stop()
    }

    this.config = {
      ...this.config,
      ...config,
    }

    if (wasRunning && this.config.enabled) {
      this.start()
    }
  }
}

/**
 * Export singleton instance
 */
export const syncScheduler = SyncScheduler.getInstance()

/**
 * Initialize scheduler on server startup (call this in your server entry point)
 */
export function initializeSyncScheduler() {
  console.log('⏭️ initializeSyncScheduler 已废弃：数据同步由独立 scheduler 进程统一负责')
}
