/**
 * 联盟商品同步调度器（PB + YP）
 *
 * 目标：
 * - PB 快速刷新（delta）默认每6小时
 * - PB 全量补齐（platform）默认每24小时
 * - YP 快速刷新（delta）默认每6小时
 * - YP 全量补齐（platform）默认每24小时
 * - 复用现有队列与 run 记录，避免引入额外基础设施
 */

import { getDatabase } from '../../db'
import {
  checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun,
  getLatestFailedAffiliateProductSyncRun,
  runAffiliateProductsRawJsonRetirementMaintenance,
  type SyncMode,
  updateAffiliateProductSyncRun,
} from '../../affiliate-products'
import { getQueueManagerForTaskType } from '../queue-routing'
import { isYeahPromosManualSyncOnly } from '../../yeahpromos-session'
import { buildUserExecutionEligibleSql } from '../../user-execution-eligibility'

const DEFAULT_DELTA_INTERVAL_MINUTES = 6 * 60
const DEFAULT_FULL_INTERVAL_HOURS = 24
const MIN_DELTA_INTERVAL_MINUTES = 10
const MAX_DELTA_INTERVAL_MINUTES = 24 * 60
const MIN_FULL_INTERVAL_HOURS = 6
const MAX_FULL_INTERVAL_HOURS = 24 * 7

const PB_DELTA_INTERVAL_KEY = 'affiliate_pb_delta_interval_minutes'
const PB_FULL_INTERVAL_KEY = 'affiliate_pb_full_interval_hours'
const PB_LAST_DELTA_SYNC_KEY = 'affiliate_pb_last_delta_sync_at'
const PB_LAST_FULL_SYNC_KEY = 'affiliate_pb_last_full_sync_at'
const YP_DELTA_INTERVAL_KEY = 'affiliate_yp_delta_interval_minutes'
const YP_FULL_INTERVAL_KEY = 'affiliate_yp_full_interval_hours'
const YP_LAST_DELTA_SYNC_KEY = 'affiliate_yp_last_delta_sync_at'
const YP_LAST_FULL_SYNC_KEY = 'affiliate_yp_last_full_sync_at'

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const DEFAULT_STARTUP_DELAY_MS = 45 * 1000

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
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue
  return parsed
}

function parseIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function parseTimeValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }

  const normalized = String(value || '').trim()
  if (!normalized) return null
  const time = Date.parse(normalized)
  if (!Number.isFinite(time)) return null
  return new Date(time)
}

function isDue(lastTime: Date | null, intervalMs: number, nowMs: number): boolean {
  if (!lastTime) return true
  return nowMs - lastTime.getTime() >= intervalMs
}

type UserScheduleConfig = {
  deltaIntervalMinutes: number
  fullIntervalHours: number
  lastDeltaAt: Date | null
  lastFullAt: Date | null
}

export class AffiliateProductSyncScheduler {
  private intervalHandle: NodeJS.Timeout | null = null
  private startupTimeoutHandle: NodeJS.Timeout | null = null
  private isRunning = false
  private readonly RUN_ON_START = parseBooleanEnv(process.env.QUEUE_AFFILIATE_SYNC_RUN_ON_START, true)
  private readonly STARTUP_DELAY_MS = parseNonNegativeIntEnv(
    process.env.QUEUE_AFFILIATE_SYNC_STARTUP_DELAY_MS,
    DEFAULT_STARTUP_DELAY_MS
  )

  start(): void {
    if (this.isRunning) {
      console.log('⚠️  联盟商品同步调度器已在运行')
      return
    }

    this.isRunning = true
    console.log('🔄 启动联盟商品同步调度器...')

    if (this.RUN_ON_START) {
      if (this.STARTUP_DELAY_MS === 0) {
        this.checkAndScheduleSync().catch((error) => {
          console.error('❌ 联盟商品同步启动检查失败:', error)
        })
      } else {
        console.log(`⏳ 联盟商品同步首次检查将在 ${Math.round(this.STARTUP_DELAY_MS / 1000)} 秒后执行`)
        this.startupTimeoutHandle = setTimeout(() => {
          this.startupTimeoutHandle = null
          this.checkAndScheduleSync().catch((error) => {
            console.error('❌ 联盟商品同步启动检查失败:', error)
          })
        }, this.STARTUP_DELAY_MS)
      }
    } else {
      console.log('⏭️ 已禁用联盟商品同步启动首轮检查')
    }

    this.intervalHandle = setInterval(() => {
      this.checkAndScheduleSync().catch((error) => {
        console.error('❌ 联盟商品同步周期检查失败:', error)
      })
    }, CHECK_INTERVAL_MS)

    console.log(`✅ 联盟商品同步调度器已启动 (检查间隔: ${CHECK_INTERVAL_MS / 1000 / 60}分钟)`)
  }

  stop(): void {
    if (!this.isRunning) return

    console.log('⏹️ 停止联盟商品同步调度器...')

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle)
      this.startupTimeoutHandle = null
    }

    this.isRunning = false
    console.log('✅ 联盟商品同步调度器已停止')
  }

  getStatus(): { isRunning: boolean; checkIntervalMs: number } {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: CHECK_INTERVAL_MS,
    }
  }

  private async checkAndScheduleSync(): Promise<void> {
    if (!this.isRunning) return

    const checkStartAt = Date.now()
    const now = new Date()
    const nowIso = now.toISOString()

    console.log(`\n[${nowIso}] 🔄 检查联盟商品同步任务...`)

    try {
      try {
        await runAffiliateProductsRawJsonRetirementMaintenance()
      } catch (error: any) {
        console.warn(`[affiliate-sync-scheduler] raw_json retirement maintenance failed: ${error?.message || error}`)
      }

      const users = await this.listEligibleUsers()
      if (users.length === 0) {
        console.log('  ℹ️  没有符合条件的用户')
        return
      }

      let queuedCount = 0
      let skippedCount = 0

      for (const userId of users) {
        try {
          const queued = await this.scheduleForUser(userId, now)
          if (queued) {
            queuedCount += 1
            continue
          }
          skippedCount += 1
        } catch (error: any) {
          skippedCount += 1
          console.warn(`[affiliate-sync-scheduler] user ${userId} schedule failed: ${error?.message || error}`)
        }
      }

      const elapsedMs = Date.now() - checkStartAt
      console.log(`✅ 联盟商品同步检查完成: 入队 ${queuedCount}，跳过 ${skippedCount}（耗时 ${elapsedMs}ms）`)
    } catch (error) {
      const elapsedMs = Date.now() - checkStartAt
      console.error(`❌ 联盟商品同步检查失败（耗时 ${elapsedMs}ms）:`, error)
    }
  }

  private async listEligibleUsers(): Promise<number[]> {
    const db = await getDatabase()
    const userEligibleCondition = buildUserExecutionEligibleSql({ dbType: db.type })
    const whereClause = `${userEligibleCondition} AND ${db.type === 'postgres' ? 'product_management_enabled = TRUE' : 'product_management_enabled = 1'}`

    const rows = await db.query<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE ${whereClause}
      `
    )

    return rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0)
  }

  private async scheduleForUser(userId: number, now: Date): Promise<boolean> {
    const nowIso = now.toISOString()
    const nowMs = now.getTime()

    const pbConfigCheck = await checkAffiliatePlatformConfig(userId, 'partnerboost')
    if (pbConfigCheck.configured) {
      const pbHasActiveRun = await this.hasActiveSyncRun(userId, 'partnerboost')
      if (!pbHasActiveRun) {
        const scheduleConfig = await this.loadUserScheduleConfig(userId)
        const latestCompleted = await this.loadLatestCompletedRunTimes(userId)
        const lastDeltaAt = scheduleConfig.lastDeltaAt || latestCompleted.lastDeltaAt
        const lastFullAt = scheduleConfig.lastFullAt || latestCompleted.lastFullAt

        const shouldRunFull = isDue(
          lastFullAt,
          scheduleConfig.fullIntervalHours * 60 * 60 * 1000,
          nowMs
        )
        const shouldRunDelta = !shouldRunFull && isDue(
          lastDeltaAt,
          scheduleConfig.deltaIntervalMinutes * 60 * 1000,
          nowMs
        )

        if (shouldRunFull || shouldRunDelta) {
          const mode: SyncMode = shouldRunFull ? 'platform' : 'delta'
          await this.enqueueSyncTask({
            userId,
            platform: 'partnerboost',
            mode,
            nowIso,
          })
          const recordKey = shouldRunFull ? PB_LAST_FULL_SYNC_KEY : PB_LAST_DELTA_SYNC_KEY
          await this.upsertUserSystemSetting(userId, recordKey, nowIso)
          return true
        }
      }
    }

    const ypManualOnly = await isYeahPromosManualSyncOnly(userId)
    if (ypManualOnly) {
      return false
    }

    const ypConfigCheck = await checkAffiliatePlatformConfig(userId, 'yeahpromos')
    if (!ypConfigCheck.configured) {
      return false
    }

    // ✅ 新增：检查YP登录态是否有效，避免调度无效任务
    const { getYeahPromosSessionState } = await import('@/lib/yeahpromos-session')
    const ypSession = await getYeahPromosSessionState(userId)
    if (!ypSession.hasSession) {
      // 登录态缺失或过期，跳过调度
      return false
    }

    const ypHasActiveRun = await this.hasActiveSyncRun(userId, 'yeahpromos')
    if (ypHasActiveRun) {
      return false
    }

    const ypScheduleConfig = await this.loadYeahpromosScheduleConfig(userId)
    const latestYpCompleted = await this.loadLatestCompletedRunTimesByPlatform(userId, 'yeahpromos')
    const ypLastDeltaAt = ypScheduleConfig.lastDeltaAt || latestYpCompleted.lastDeltaAt
    const ypLastFullAt = ypScheduleConfig.lastFullAt || latestYpCompleted.lastFullAt

    const shouldRunYpFull = isDue(
      ypLastFullAt,
      ypScheduleConfig.fullIntervalHours * 60 * 60 * 1000,
      nowMs
    )
    const shouldRunYpDelta = !shouldRunYpFull && isDue(
      ypLastDeltaAt,
      ypScheduleConfig.deltaIntervalMinutes * 60 * 1000,
      nowMs
    )
    if (!shouldRunYpFull && !shouldRunYpDelta) {
      return false
    }

    const ypMode: SyncMode = shouldRunYpFull ? 'platform' : 'delta'
    await this.enqueueSyncTask({
      userId,
      platform: 'yeahpromos',
      mode: ypMode,
      nowIso,
    })
    const ypRecordKey = shouldRunYpFull ? YP_LAST_FULL_SYNC_KEY : YP_LAST_DELTA_SYNC_KEY
    await this.upsertUserSystemSetting(userId, ypRecordKey, nowIso)
    return true
  }

  private async hasActiveSyncRun(userId: number, platform: 'partnerboost' | 'yeahpromos'): Promise<boolean> {
    const db = await getDatabase()
    const activeRunFreshnessSql = db.type === 'postgres'
      ? "COALESCE(last_heartbeat_at, updated_at, created_at) >= NOW() - INTERVAL '45 minutes'"
      : "COALESCE(last_heartbeat_at, updated_at, created_at) >= datetime('now', '-45 minutes')"
    const row = await db.queryOne<{ id: number }>(
      `
        SELECT id
        FROM affiliate_product_sync_runs
        WHERE user_id = ?
          AND platform = ?
          AND status IN ('queued', 'running')
          AND (${activeRunFreshnessSql})
        LIMIT 1
      `,
      [userId, platform]
    )
    return Boolean(row?.id)
  }

  private async enqueueSyncTask(params: {
    userId: number
    platform: 'partnerboost' | 'yeahpromos'
    mode: SyncMode
    nowIso: string
  }): Promise<void> {
    const runId = await createAffiliateProductSyncRun({
      userId: params.userId,
      platform: params.platform,
      mode: params.mode,
      triggerSource: 'schedule',
      status: 'queued',
    })

    if (params.mode === 'platform') {
      const latestFailedRun = await getLatestFailedAffiliateProductSyncRun({
        userId: params.userId,
        platform: params.platform,
        mode: 'platform',
        excludeRunId: runId,
      })

      if (latestFailedRun && latestFailedRun.cursor_page > 0) {
        const totalItems = Math.max(0, Number(latestFailedRun.total_items || 0))
        const createdCount = Math.max(0, Number(latestFailedRun.created_count || 0))
        const updatedCount = Math.max(0, Number(latestFailedRun.updated_count || 0))
        const processedBatches = Math.max(0, Number(latestFailedRun.processed_batches || 0))
        const cursorPage = Math.max(1, Number(latestFailedRun.cursor_page || 1))
        const cursorScope = String(latestFailedRun.cursor_scope || '').trim() || null

        await updateAffiliateProductSyncRun({
          runId,
          totalItems,
          createdCount,
          updatedCount,
          failedCount: 0,
          cursorPage,
          cursorScope,
          processedBatches,
          // 续跑场景沿用原失败任务的 started_at，避免后续状态基线偏移导致误判 sync_missing
          startedAt: latestFailedRun.started_at || null,
          lastHeartbeatAt: null,
          errorMessage: null,
          completedAt: null,
        })

        console.log(
          `[affiliate-product-sync-scheduler] 续跑失败任务: user=${params.userId}, platform=${params.platform}, run=${runId}, resumeFrom=${latestFailedRun.id}, cursor=${cursorScope || 'default'}:${cursorPage}`
        )
      }
    }

    try {
      const queue = getQueueManagerForTaskType('affiliate-product-sync')
      await queue.enqueue(
        'affiliate-product-sync',
        {
          userId: params.userId,
          platform: params.platform,
          mode: params.mode,
          runId,
          trigger: 'schedule',
        },
        params.userId,
        {
          priority: 'normal',
          maxRetries: 1,
        }
      )
    } catch (error: any) {
      await updateAffiliateProductSyncRun({
        runId,
        status: 'failed',
        failedCount: 1,
        completedAt: params.nowIso,
        errorMessage: error?.message || '调度入队失败',
      })
      throw error
    }
  }

  private async loadUserScheduleConfig(userId: number): Promise<UserScheduleConfig> {
    const db = await getDatabase()
    const rows = await db.query<{ key: string; value: string | null }>(
      `
        SELECT key, value
        FROM system_settings
        WHERE user_id = ?
          AND category = 'system'
          AND key IN (?, ?, ?, ?)
      `,
      [
        userId,
        PB_DELTA_INTERVAL_KEY,
        PB_FULL_INTERVAL_KEY,
        PB_LAST_DELTA_SYNC_KEY,
        PB_LAST_FULL_SYNC_KEY,
      ]
    )

    const valueMap = new Map<string, string | null>()
    for (const row of rows) {
      valueMap.set(row.key, row.value)
    }

    return {
      deltaIntervalMinutes: parseIntegerInRange(
        valueMap.get(PB_DELTA_INTERVAL_KEY) || String(DEFAULT_DELTA_INTERVAL_MINUTES),
        DEFAULT_DELTA_INTERVAL_MINUTES,
        MIN_DELTA_INTERVAL_MINUTES,
        MAX_DELTA_INTERVAL_MINUTES
      ),
      fullIntervalHours: parseIntegerInRange(
        valueMap.get(PB_FULL_INTERVAL_KEY) || String(DEFAULT_FULL_INTERVAL_HOURS),
        DEFAULT_FULL_INTERVAL_HOURS,
        MIN_FULL_INTERVAL_HOURS,
        MAX_FULL_INTERVAL_HOURS
      ),
      lastDeltaAt: parseTimeValue(valueMap.get(PB_LAST_DELTA_SYNC_KEY)),
      lastFullAt: parseTimeValue(valueMap.get(PB_LAST_FULL_SYNC_KEY)),
    }
  }

  private async loadYeahpromosScheduleConfig(userId: number): Promise<UserScheduleConfig> {
    const db = await getDatabase()
    const rows = await db.query<{ key: string; value: string | null }>(
      `
        SELECT key, value
        FROM system_settings
        WHERE user_id = ?
          AND category = 'system'
          AND key IN (?, ?, ?, ?)
      `,
      [
        userId,
        YP_DELTA_INTERVAL_KEY,
        YP_FULL_INTERVAL_KEY,
        YP_LAST_DELTA_SYNC_KEY,
        YP_LAST_FULL_SYNC_KEY,
      ]
    )

    const valueMap = new Map<string, string | null>()
    for (const row of rows) {
      valueMap.set(row.key, row.value)
    }

    return {
      deltaIntervalMinutes: parseIntegerInRange(
        valueMap.get(YP_DELTA_INTERVAL_KEY) || String(DEFAULT_DELTA_INTERVAL_MINUTES),
        DEFAULT_DELTA_INTERVAL_MINUTES,
        MIN_DELTA_INTERVAL_MINUTES,
        MAX_DELTA_INTERVAL_MINUTES
      ),
      fullIntervalHours: parseIntegerInRange(
        valueMap.get(YP_FULL_INTERVAL_KEY) || String(DEFAULT_FULL_INTERVAL_HOURS),
        DEFAULT_FULL_INTERVAL_HOURS,
        MIN_FULL_INTERVAL_HOURS,
        MAX_FULL_INTERVAL_HOURS
      ),
      lastDeltaAt: parseTimeValue(valueMap.get(YP_LAST_DELTA_SYNC_KEY)),
      lastFullAt: parseTimeValue(valueMap.get(YP_LAST_FULL_SYNC_KEY)),
    }
  }

  private async loadLatestCompletedRunTimes(userId: number): Promise<{
    lastDeltaAt: Date | null
    lastFullAt: Date | null
  }> {
    const db = await getDatabase()
    const rows = await db.query<{ mode: string; last_at: string | null }>(
      `
        SELECT mode, MAX(COALESCE(completed_at, updated_at, created_at)) AS last_at
        FROM affiliate_product_sync_runs
        WHERE user_id = ?
          AND platform = 'partnerboost'
          AND status = 'completed'
          AND mode IN ('delta', 'platform')
        GROUP BY mode
      `,
      [userId]
    )

    let lastDeltaAt: Date | null = null
    let lastFullAt: Date | null = null
    for (const row of rows) {
      if (row.mode === 'delta') {
        lastDeltaAt = parseTimeValue(row.last_at)
      } else if (row.mode === 'platform') {
        lastFullAt = parseTimeValue(row.last_at)
      }
    }

    return { lastDeltaAt, lastFullAt }
  }

  private async loadLatestCompletedRunTimesByPlatform(
    userId: number,
    platform: 'partnerboost' | 'yeahpromos'
  ): Promise<{
    lastDeltaAt: Date | null
    lastFullAt: Date | null
  }> {
    const db = await getDatabase()
    const rows = await db.query<{ mode: string; last_at: string | null }>(
      `
        SELECT mode, MAX(COALESCE(completed_at, updated_at, created_at)) AS last_at
        FROM affiliate_product_sync_runs
        WHERE user_id = ?
          AND platform = ?
          AND status = 'completed'
          AND mode IN ('delta', 'platform')
        GROUP BY mode
      `,
      [userId, platform]
    )

    let lastDeltaAt: Date | null = null
    let lastFullAt: Date | null = null
    for (const row of rows) {
      if (row.mode === 'delta') {
        lastDeltaAt = parseTimeValue(row.last_at)
      } else if (row.mode === 'platform') {
        lastFullAt = parseTimeValue(row.last_at)
      }
    }

    return { lastDeltaAt, lastFullAt }
  }

  private async upsertUserSystemSetting(userId: number, key: string, value: string): Promise<void> {
    const db = await getDatabase()
    const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const falseValue = db.type === 'postgres' ? false : 0

    const existing = await db.queryOne<{ id: number }>(
      `
        SELECT id
        FROM system_settings
        WHERE user_id = ?
          AND category = 'system'
          AND key = ?
        LIMIT 1
      `,
      [userId, key]
    )

    if (existing?.id) {
      await db.exec(
        `
          UPDATE system_settings
          SET value = ?, updated_at = ${nowExpr}
          WHERE id = ?
        `,
        [value, existing.id]
      )
      return
    }

    const description = key === PB_LAST_FULL_SYNC_KEY
      ? 'PB全量补齐最近入队时间'
      : key === PB_LAST_DELTA_SYNC_KEY
        ? 'PB快速刷新最近入队时间'
        : key === YP_LAST_FULL_SYNC_KEY
          ? 'YP全量补齐最近入队时间'
          : 'YP快速刷新最近入队时间'

    await db.exec(
      `
        INSERT INTO system_settings (
          user_id,
          category,
          key,
          value,
          data_type,
          is_sensitive,
          is_required,
          description
        ) VALUES (?, 'system', ?, ?, 'string', ?, ?, ?)
      `,
      [userId, key, value, falseValue, falseValue, description]
    )
  }
}

let schedulerInstance: AffiliateProductSyncScheduler | null = null

export function getAffiliateProductSyncScheduler(): AffiliateProductSyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new AffiliateProductSyncScheduler()
  }
  return schedulerInstance
}
