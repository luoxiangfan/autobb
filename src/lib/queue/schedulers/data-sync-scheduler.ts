/**
 * 数据同步定时调度器
 *
 * 集成到统一队列系统中的内置调度器
 * 功能：定时检查用户的同步配置，自动创建同步任务并入队
 *
 * 优势：
 * - 不需要外部 crontab
 * - 与队列系统生命周期绑定
 * - 统一管理和监控
 * - 支持动态配置
 */

import { getDatabase } from '../../db'
import { triggerDataSync } from '../../queue-triggers'
import { getUserAuthType, getGoogleAdsCredentials } from '../../google-ads-oauth'
import { getServiceAccountConfig } from '../../google-ads-service-account'
import { buildUserExecutionEligibleSql } from '../../user-execution-eligibility'

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
  data_sync_enabled: string | boolean
  data_sync_interval_hours: string | number
  last_auto_sync_at: string | null
}

export class DataSyncScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private startupTimeoutHandle: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000  // 每小时检查一次
  private readonly RUN_ON_START = parseBooleanEnv(process.env.QUEUE_DATA_SYNC_RUN_ON_START, true)
  private readonly STARTUP_DELAY_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_DATA_SYNC_STARTUP_DELAY_MS,
    30_000
  )

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️  数据同步调度器已在运行')
      return
    }

    console.log('🔄 启动数据同步调度器...')
    this.isRunning = true

    // 启动时执行一次检查（支持延迟，降低冷启动竞争）
    if (this.RUN_ON_START) {
      if (this.STARTUP_DELAY_MS === 0) {
        this.checkAndScheduleSync()
      } else {
        console.log(`⏳ 数据同步首次检查将在 ${Math.round(this.STARTUP_DELAY_MS / 1000)} 秒后执行`)
        this.startupTimeoutHandle = setTimeout(() => {
          this.startupTimeoutHandle = null
          this.checkAndScheduleSync()
        }, this.STARTUP_DELAY_MS)
      }
    } else {
      console.log('⏭️ 已禁用启动时数据同步首轮检查')
    }

    // 设置定时检查（每小时）
    this.intervalHandle = setInterval(() => {
      this.checkAndScheduleSync()
    }, this.CHECK_INTERVAL_MS)

    console.log(`✅ 数据同步调度器已启动 (检查间隔: ${this.CHECK_INTERVAL_MS / 1000 / 60}分钟)`)
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    console.log('⏹️ 停止数据同步调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }

    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle)
      this.startupTimeoutHandle = null
    }

    this.isRunning = false
    console.log('✅ 数据同步调度器已停止')
  }

  /**
   * 检查并调度同步任务
   */
  private async checkAndScheduleSync(): Promise<void> {
    const checkStartAt = Date.now()

    try {
      console.log(`\n[${new Date().toISOString()}] 🔄 检查数据同步任务...`)

      const db = await getDatabase()
      const now = new Date()
      const userEligibleCondition = buildUserExecutionEligibleSql({ dbType: db.type, userAlias: 'u' })

      // 查询所有启用了自动同步的用户
      const configs = await db.query<UserSyncConfig>(
        `
        SELECT
          u.id AS user_id,
          COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
            'true'
          ) AS data_sync_enabled,
          COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_interval_hours' LIMIT 1),
            '6'
          ) AS data_sync_interval_hours,
          (
            SELECT started_at
            FROM sync_logs
            WHERE user_id = u.id AND sync_type = 'auto'
            ORDER BY started_at DESC
            LIMIT 1
          ) AS last_auto_sync_at
        FROM users u
        WHERE COALESCE(
          (SELECT value FROM system_settings
           WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
          'true'
        ) = 'true'
          AND ${userEligibleCondition}
        `
      )

      if (configs.length === 0) {
        console.log('  ℹ️  没有启用自动同步的用户')
        return
      }

      console.log(`  📊 找到 ${configs.length} 个启用自动同步的用户配置`)

      // 🔧 修复(2025-12-29): 检查是否有重复的user_id（调试信息）
      const userIds = configs.map(c => c.user_id)
      const duplicates = userIds.filter((id, idx) => userIds.indexOf(id) !== idx)
      if (duplicates.length > 0) {
        console.warn(`  ⚠️  检测到重复用户ID: ${[...new Set(duplicates)].join(', ')}，这可能导致任务重复创建`)
      }

      // 遍历用户，检查是否需要触发同步
      let triggeredCount = 0
      let skippedCount = 0
      for (const config of configs) {
        const userId = config.user_id
        const intervalHours = parseInt(String(config.data_sync_interval_hours)) || 6
        const lastSyncAt = config.last_auto_sync_at ? new Date(config.last_auto_sync_at) : null

        // 计算距离上次同步的小时数
        const hoursSinceLastSync = lastSyncAt
          ? (now.getTime() - lastSyncAt.getTime()) / (1000 * 60 * 60)
          : Infinity

        // 如果从未同步过，或者距离上次同步已超过间隔时间，触发同步
        if (hoursSinceLastSync >= intervalHours) {
          // 🔧 修复(2025-12-28): 根据用户的认证类型验证相应的凭证
          let hasValidCredentials = false
          let skipReason = ''

          try {
            // 1. 判断用户使用哪种认证方式
            const auth = await getUserAuthType(userId)

            if (auth.authType === 'oauth') {
              // 2a. OAuth模式：验证 google_ads_credentials 表
              const credentials = await getGoogleAdsCredentials(userId)
              if (!credentials) {
                skipReason = '未配置OAuth凭证（需完成Google Ads OAuth授权）'
              } else if (!credentials.refresh_token) {
                skipReason = '缺少refresh_token（需重新完成OAuth授权）'
              } else if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
                skipReason = '缺少必需的OAuth配置参数（client_id/client_secret/developer_token）'
              } else {
                hasValidCredentials = true
              }
            } else {
              // 2b. 服务账号模式：验证 google_ads_service_accounts 表
              const serviceAccount = await getServiceAccountConfig(userId, auth.serviceAccountId)
              if (!serviceAccount) {
                skipReason = '未配置服务账号（需上传服务账号JSON文件）'
              } else if (!serviceAccount.mccCustomerId || !serviceAccount.developerToken || !serviceAccount.serviceAccountEmail || !serviceAccount.privateKey) {
                skipReason = '服务账号配置不完整（缺少必需参数）'
              } else {
                hasValidCredentials = true
              }
            }
          } catch (error) {
            skipReason = `凭证验证失败: ${error instanceof Error ? error.message : String(error)}`
          }

          // 3. 如果凭证无效，跳过此用户
          if (!hasValidCredentials) {
            console.log(
              `  ⚠️  用户 #${userId}: ${skipReason}，跳过自动同步`
            )
            skippedCount++
            continue
          }

          // 4. 凭证有效，创建同步任务
          console.log(
            `  🔄 用户 #${userId}: 距离上次同步 ${lastSyncAt ? `${hoursSinceLastSync.toFixed(1)}小时` : '从未同步'}, 触发同步 (间隔: ${intervalHours}h)`
          )

          try {
            const taskId = await triggerDataSync(userId, {
              syncType: 'auto',
              priority: 'normal',
            })
            console.log(`     ✅ 同步任务已入队: ${taskId}`)
            triggeredCount++
          } catch (error) {
            console.error(`     ❌ 触发同步失败:`, error)
          }
        } else {
          const hoursUntilNext = intervalHours - hoursSinceLastSync
          console.log(
            `  ⏰ 用户 #${userId}: 距离下次同步还有 ${hoursUntilNext.toFixed(1)} 小时`
          )
        }
      }

      const elapsedMs = Date.now() - checkStartAt
      console.log(`\n✅ 检查完成: 触发了 ${triggeredCount}/${configs.length} 个同步任务${skippedCount > 0 ? `，跳过 ${skippedCount} 个未配置凭证的用户` : ''}（耗时${elapsedMs}ms）`)
    } catch (error) {
      const elapsedMs = Date.now() - checkStartAt
      console.error(`❌ 检查数据同步任务失败（耗时${elapsedMs}ms）:`, error)
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus(): { isRunning: boolean; checkIntervalMs: number } {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.CHECK_INTERVAL_MS
    }
  }
}

/**
 * 单例实例
 */
let schedulerInstance: DataSyncScheduler | null = null

/**
 * 获取调度器单例
 */
export function getDataSyncScheduler(): DataSyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new DataSyncScheduler()
  }
  return schedulerInstance
}
