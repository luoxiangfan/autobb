/**
 * 持续运行的定时任务调度服务
 * 使用 cron 实现定时调度，由supervisord管理进程
 *
 * 功能：
 * 1. 每小时执行补点击任务（迁移到统一队列系统）
 * 2. 每5分钟检查一次，按用户配置间隔同步Google Ads数据
 * 3. 每天凌晨2点备份数据库
 * 4. 每天凌晨3点清理90天前的数据
 * 5. 每天凌晨2点检查链接可用性和账号状态（需求20优化）
 * 6. 每天定时暂停禁用/过期用户的后台任务（补点击/换链接）
 * 7. 每天 UTC 01:00 同步 USD 基准汇率（ExchangeRate-API）
 */

import {
  scheduleCronJob,
  stopAllScheduledCronJobs,
  stopScheduledCronJob,
  validateCronExpression,
  type ScheduledCronJob,
} from './lib/common/cron-schedule'
import { getDatabase } from './lib/db/database'
import { getQueueManagerForTaskType } from './lib/queue/queue-routing'
import { getOpenclawSettingsWithAffiliateSyncMap } from './lib/openclaw/settings'
// 🔄 已迁移到统一队列系统
import {
  triggerDataSync,
  triggerBackup,
  triggerLinkCheck,
  triggerCleanup,
} from './lib/queue/queue-triggers'
import { resolveGoogleAdsSyncCredentialGate } from '@/lib/google-ads/auth/context'
import { buildUserExecutionEligibleSql } from './lib/campaign/user-execution-eligibility'
import { detectAndFixZombieSyncTasks } from './lib/queue/affiliate-sync-zombie-detector'
import { LEGACY_AMAZON_MISCLASSIFIED_SQL_CONDITION } from './lib/launch-score/product-score-control'

// 日志函数
function log(message: string) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

function logError(message: string, error: any) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ${message}`, error instanceof Error ? error.message : String(error))
}

function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = String(value).trim().toLowerCase()
  return ['true', '1', 'yes', 'on'].includes(normalized)
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.round(parsed)
  if (normalized <= 0) return fallback
  return normalized
}

function normalizeAffiliateSyncMode(value: string | null | undefined): 'incremental' | 'realtime' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return normalized === 'realtime' ? 'realtime' : 'incremental'
}

function parseReportGeneratedAt(payloadJson?: string | null): Date | null {
  const raw = String(payloadJson || '').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { generatedAt?: string }
    const generatedAt = String(parsed?.generatedAt || '').trim()
    if (!generatedAt) return null
    const generatedDate = new Date(generatedAt)
    if (Number.isNaN(generatedDate.getTime())) return null
    return generatedDate
  } catch {
    return null
  }
}

function formatDateInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftDateKeyByDays(dateKey: string, days: number): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function buildAffiliateLookbackDates(days: number, timeZone: string): string[] {
  const safeDays = Math.min(30, Math.max(7, Math.round(days)))
  const today = new Date()
  const dates: string[] = []

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() - offset)
    dates.push(formatDateInTimezone(targetDate, timeZone))
  }

  return dates
}

function normalizeDateKey(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const matched = raw.match(/^\d{4}-\d{2}-\d{2}/)
  return matched ? matched[0] : raw
}

const openclawStrategySchedules = new Map<number, { cron: string; task: ScheduledCronJob }>()
let syncDataTaskRunning = false
let syncGoogleAdsTaskRunning = false
let isShuttingDown = false
const schedulerShutdownGraceMs = parsePositiveInt(process.env.SCHEDULER_SHUTDOWN_GRACE_MS, 6000)

async function getUsersWithActiveSyncTasks(): Promise<Set<number>> {
  const userIds = new Set<number>()
  try {
    const queue = getQueueManagerForTaskType('sync')
    await queue.ensureInitialized()

    const [pendingTasks, runningTasks] = await Promise.all([
      queue.getPendingTasks(),
      queue.getRunningTasks(),
    ])

    for (const task of [...pendingTasks, ...runningTasks]) {
      if (task.type !== 'sync') continue
      userIds.add(Number(task.userId))
    }
  } catch (error) {
    logError('⚠️ 读取同步队列状态失败（将继续按时间窗口触发）:', error)
  }
  return userIds
}

async function hasValidSyncCredentials(userId: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const gate = await resolveGoogleAdsSyncCredentialGate(userId)
    if (!gate.ok) {
      return { ok: false, reason: gate.reason }
    }
    return { ok: true }
  } catch (error: any) {
    return { ok: false, reason: `凭证验证失败: ${error?.message || String(error)}` }
  }
}

async function enqueueOpenclawStrategy(userId: number, mode: string) {
  try {
    const queue = getQueueManagerForTaskType('openclaw-strategy')
    await queue.enqueue(
      'openclaw-strategy',
      {
        userId,
        mode,
        trigger: 'cron',
        kind: 'analyze_recommendations',
        // 避免与任务6（独立日报推送）重复投递
        sendReport: false,
      },
      userId,
      { priority: 'normal', maxRetries: 0 }
    )
    log(`🧠 OpenClaw策略已入队 (user=${userId}, mode=${mode})`)
  } catch (error) {
    logError(`❌ OpenClaw策略入队失败 (user=${userId})`, error)
  }
}

async function refreshOpenclawStrategySchedules() {
  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })
  const rows = await db.query<{
    user_id: number
    enabled: string | null
    cron: string | null
  }>(
    `
    SELECT
      ss.user_id,
      MAX(CASE WHEN ss.key = 'openclaw_strategy_enabled' THEN ss.value END) as enabled,
      MAX(CASE WHEN ss.key = 'openclaw_strategy_cron' THEN ss.value END) as cron
    FROM system_settings ss
    INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.category = 'openclaw'
        AND ss.user_id IS NOT NULL
        AND ss.key IN ('openclaw_strategy_enabled', 'openclaw_strategy_cron')
        AND ${userEligibleCondition}
        AND u.strategy_center_enabled = ?
      GROUP BY ss.user_id
  `,
    [true]
  )

  const activeUsers = new Set<number>()
  for (const row of rows || []) {
    const enabled = parseBoolean(row.enabled)
    if (!enabled) continue
    const cronExpr = (row.cron || '0 9 * * *').trim() || '0 9 * * *'
    if (!validateCronExpression(cronExpr)) {
      logError(`❌ OpenClaw策略cron无效 (user=${row.user_id})`, cronExpr)
      continue
    }

    activeUsers.add(row.user_id)
    const existing = openclawStrategySchedules.get(row.user_id)
    if (!existing || existing.cron !== cronExpr) {
      if (existing) {
        stopScheduledCronJob(existing.task)
      }
      const task = scheduleCronJob(
        cronExpr,
        async () => {
          await enqueueOpenclawStrategy(row.user_id, 'auto')
        },
        {
          timeZone: 'Asia/Shanghai',
        }
      )
      openclawStrategySchedules.set(row.user_id, { cron: cronExpr, task })
      log(`✅ OpenClaw策略调度已更新 (user=${row.user_id}, cron=${cronExpr})`)
    }
  }

  for (const [userId, schedule] of openclawStrategySchedules.entries()) {
    if (!activeUsers.has(userId)) {
      stopScheduledCronJob(schedule.task)
      openclawStrategySchedules.delete(userId)
      log(`⏸️  OpenClaw策略调度已移除 (user=${userId})`)
    }
  }
}

/**
 * 任务0: 补点击任务调度
 * 频率: 每小时执行一次
 * 🔄 已迁移到统一队列系统，自动检查并执行待处理的补点击任务
 */
async function clickFarmSchedulerTask() {
  log('🖱️ 开始执行补点击任务调度...')

  try {
    // 直接调用内部触发函数，不依赖外部cron
    const { triggerAllPendingTasks } = await import('./lib/click-farm/click-farm-scheduler-trigger')
    const result = await triggerAllPendingTasks()

    log(
      `🖱️ 补点击任务调度完成 - 处理: ${result.processed}, 入队: ${result.queued}, 跳过: ${result.skipped}, 暂停: ${result.paused}`
    )
  } catch (error) {
    logError('❌ 补点击任务调度执行失败:', error)
  }
}

/**
 * 任务0.1: 换链接任务调度
 * 频率: 每分钟执行一次
 * 🔄 已迁移到统一队列系统，自动检查并执行待处理的换链接任务
 * 📍 唯一调度位置：只在 scheduler 进程运行（与补点击任务架构一致）
 */
async function urlSwapSchedulerTask() {
  log('🔄 开始执行换链接任务调度...')

  try {
    // 直接调用内部触发函数
    const { triggerAllUrlSwapTasks } = await import('./lib/url-swap/url-swap-scheduler')
    const result = await triggerAllUrlSwapTasks()

    log(
      `🔄 换链接任务调度完成 - 处理: ${result.processed}, 入队: ${result.executed}, 跳过: ${result.skipped}, 错误: ${result.errors}`
    )

    try {
      const { sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap } =
        await import('./lib/queue/inactive-source-queue-sweep')
      const sweep = await sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap()
      if (sweep.clickFarmQueueRemoved > 0 || sweep.urlSwapQueueRemoved > 0) {
        log(
          `🧹 非活跃来源队列清理 - 暂停补点击ID数: ${sweep.pausedClickFarmIds}, 禁用换链ID数: ${sweep.disabledUrlSwapIds}, 移除队列项: 补点击=${sweep.clickFarmQueueRemoved}, 换链=${sweep.urlSwapQueueRemoved}`
        )
      }
    } catch (sweepError) {
      logError('❌ 非活跃来源队列清理失败:', sweepError)
    }
  } catch (error) {
    logError('❌ 换链接任务调度执行失败:', error)
  }
}

/**
 * 任务0.2: 联盟商品同步调度
 * 频率: 每10分钟执行一次
 * 🔄 检查并触发 PartnerBoost/YeahPromos 商品同步任务
 * 📍 唯一调度位置：只在 scheduler 进程运行（与补点击任务架构一致）
 */
async function affiliateProductSyncSchedulerTask() {
  log('🛍️ 开始执行联盟商品同步调度...')

  try {
    const { getAffiliateProductSyncScheduler } =
      await import('./lib/queue/schedulers/affiliate-product-sync-scheduler')
    const scheduler = getAffiliateProductSyncScheduler()

    // 调用内部检查方法（通过反射访问私有方法）
    // @ts-ignore - 访问私有方法
    await scheduler.checkAndScheduleSync()

    log('🛍️ 联盟商品同步调度完成')
  } catch (error) {
    logError('❌ 联盟商品同步调度执行失败:', error)
  }
}

/**
 * 任务0.3: 推荐指数自愈调度
 * 频率: 默认每小时执行一次
 * 目标:
 * - 兜底补齐 recommendation_score 为空的商品
 * - 兜底补齐“同步后评分过期”的商品（score_calculated_at < last_synced_at）
 * - 避免仅依赖 sync-complete/manual 触发导致的长期积压
 */
async function productScoreSchedulerTask() {
  const maxUsers = parsePositiveInt(process.env.PRODUCT_SCORE_SCHEDULER_MAX_USERS, 50)
  const batchSize = parsePositiveInt(process.env.PRODUCT_SCORE_BATCH_SIZE, 200)
  const includeSeasonalityAnalysis = process.env.PRODUCT_SCORE_INCLUDE_SEASONALITY !== 'false'

  log(
    `⭐ 开始执行推荐指数自愈调度... (maxUsers=${maxUsers}, batchSize=${batchSize}, includeSeasonality=${includeSeasonalityAnalysis})`
  )

  try {
    const db = await getDatabase()
    const dueUsers = await db.query<{ user_id: number; due_count: number | string }>(
      `SELECT
             user_id,
             COUNT(*)::int AS due_count
           FROM affiliate_products
           WHERE recommendation_score IS NULL
             OR score_calculated_at IS NULL
             OR (
               last_synced_at IS NOT NULL
               AND score_calculated_at < (last_synced_at AT TIME ZONE 'UTC')
             )
             OR ${LEGACY_AMAZON_MISCLASSIFIED_SQL_CONDITION}
           GROUP BY user_id
           ORDER BY due_count DESC
           LIMIT ?`,
      [maxUsers]
    )

    if (!dueUsers || dueUsers.length === 0) {
      log('⭐ 推荐指数自愈调度完成 - 当前无待评分用户')
      return
    }

    const { scheduleProductScoreCalculation } =
      await import('./lib/queue/schedulers/product-score-scheduler')
    let queued = 0
    let failed = 0

    for (const row of dueUsers) {
      const userId = Number((row as any)?.user_id)
      if (!Number.isFinite(userId) || userId <= 0) continue

      try {
        await scheduleProductScoreCalculation(userId, {
          forceRecalculate: false,
          batchSize,
          includeSeasonalityAnalysis,
          trigger: 'schedule',
          priority: 'normal',
        })
        queued++
      } catch (error) {
        failed++
        logError(`❌ 推荐指数任务调度失败 (user=${userId})`, error)
      }
    }

    const topUsers = dueUsers
      .slice(0, 5)
      .map((row) => `u${Number((row as any)?.user_id)}:${Number((row as any)?.due_count || 0)}`)
      .join(', ')

    log(
      `⭐ 推荐指数自愈调度完成 - 待评分用户: ${dueUsers.length}, 入队成功: ${queued}, 失败: ${failed}` +
        `${topUsers ? `, top=${topUsers}` : ''}`
    )
  } catch (error) {
    logError('❌ 推荐指数自愈调度执行失败:', error)
  }
}

/**
 * 任务1: 数据同步任务
 * 频率：根据用户在/settings页面配置的数据同步间隔执行
 * 🔄 已迁移到统一队列系统，按用户配置执行
 */
async function syncDataTask() {
  log('📊 开始执行数据同步任务...')

  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })
  const DEFAULT_DATA_SYNC_INTERVAL_HOURS = 4

  try {
    // 获取所有活跃用户及其同步配置
    const activeUsers = await db.query<{
      id: number
      username: string
      email: string | null
      sync_interval_hours: string | null
      last_sync_at: string | null
    }>(
      `
      SELECT DISTINCT
        u.id,
        u.username,
        u.email,
        COALESCE(
          (
            SELECT value
            FROM system_settings ss_interval
            WHERE ss_interval.user_id = u.id
              AND ss_interval.category = 'system'
              AND ss_interval.key = 'data_sync_interval_hours'
            LIMIT 1
          ),
          '${DEFAULT_DATA_SYNC_INTERVAL_HOURS}'
        ) as sync_interval_hours,
        (
          SELECT MAX(started_at)
          FROM sync_logs
          WHERE user_id = u.id
            AND sync_type = 'auto'
        ) as last_sync_at
      FROM users u
      INNER JOIN google_ads_accounts ga ON u.id = ga.user_id
      WHERE ${userEligibleCondition}
        AND ga.is_active = ?
        AND COALESCE(
          LOWER(TRIM((
            SELECT value
            FROM system_settings ss_enabled
            WHERE ss_enabled.user_id = u.id
              AND ss_enabled.category = 'system'
              AND ss_enabled.key = 'data_sync_enabled'
            LIMIT 1
          ))),
          'true'
        ) IN ('true', '1', 'yes', 'on')
    `,
      [true]
    )

    log(`找到 ${activeUsers.length} 个活跃用户`)

    const now = new Date()
    let queuedCount = 0
    const usersWithActiveSyncTasks = await getUsersWithActiveSyncTasks()
    if (usersWithActiveSyncTasks.size > 0) {
      log(`⏭️ 当前有 ${usersWithActiveSyncTasks.size} 个用户存在进行中的同步任务，将跳过重复入队`)
    }

    // 🔄 为每个用户检查是否需要同步
    for (const user of activeUsers) {
      if (usersWithActiveSyncTasks.has(user.id)) {
        log(`⏭️ 用户 ${user.username} 跳过同步（队列中已有 pending/running sync 任务）`)
        continue
      }

      // 获取用户配置的同步间隔（默认4小时）
      const parsedInterval = parseInt(
        String(user.sync_interval_hours || DEFAULT_DATA_SYNC_INTERVAL_HOURS),
        10
      )
      const syncIntervalHours =
        Number.isFinite(parsedInterval) && parsedInterval > 0
          ? parsedInterval
          : DEFAULT_DATA_SYNC_INTERVAL_HOURS

      // 检查是否需要同步（距离上次同步超过配置的间隔）
      if (user.last_sync_at) {
        const lastSyncTime = new Date(user.last_sync_at)
        const hoursSinceLastSync = (now.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60)

        if (hoursSinceLastSync < syncIntervalHours) {
          log(
            `⏭️ 用户 ${user.username} 跳过同步（距上次同步 ${hoursSinceLastSync.toFixed(1)} 小时，配置间隔 ${syncIntervalHours} 小时）`
          )
          continue
        }
      }

      const credentialCheck = await hasValidSyncCredentials(user.id)
      if (!credentialCheck.ok) {
        log(`⏭️ 用户 ${user.username} 跳过同步（${credentialCheck.reason || '凭证不可用'}）`)
        continue
      }

      try {
        log(`正在为用户 ${user.username} (ID: ${user.id}) 入队同步任务...`)

        const taskId = await triggerDataSync(user.id, {
          syncType: 'auto',
          priority: 'normal',
        })

        log(`📥 用户 ${user.username} 同步任务已入队: ${taskId}`)
        queuedCount++
      } catch (error) {
        logError(`❌ 用户 ${user.username} 入队失败:`, error)
        // 继续处理下一个用户
        continue
      }
    }

    log(`📊 数据同步任务入队完成 - 已入队: ${queuedCount}/${activeUsers.length}`)
  } catch (error) {
    logError('❌ 数据同步任务执行失败:', error)
  }
}

async function exchangeRatesDailyTask() {
  if (isShuttingDown) {
    return
  }
  if (process.env.EXCHANGE_RATE_SYNC_ENABLED === 'false') {
    return
  }
  try {
    const { getExchangeRateApiKey, syncExchangeRatesFromRemote } =
      await import('./lib/common/exchange-rates-service')
    if (!getExchangeRateApiKey()) {
      log('⏭️  USD 汇率同步跳过：未配置 EXCHANGE_RATE_API_KEY')
      return
    }
    const result = await syncExchangeRatesFromRemote()
    if (result.ok) {
      log('✅ USD 汇率已从 ExchangeRate-API 更新')
    } else {
      logError('❌ USD 汇率同步失败:', result.message)
    }
  } catch (error) {
    logError('❌ USD 汇率同步异常:', error)
  }
}

async function runSyncDataTaskSafely(trigger: 'cron' | 'startup') {
  if (syncDataTaskRunning) {
    log(`⏭️ 数据同步检查仍在执行，跳过本轮 (${trigger})`)
    return
  }

  syncDataTaskRunning = true
  try {
    await syncDataTask()
  } finally {
    syncDataTaskRunning = false
  }
}

async function runSyncGoogleAdsTaskSafely(trigger: 'cron' | 'startup') {
  if (syncGoogleAdsTaskRunning) {
    log(`⏭️ GoogleAds同步检查仍在执行，跳过本轮 (${trigger})`)
    return
  }

  syncGoogleAdsTaskRunning = true
  try {
    const { getGoogleAdsCampaignSyncScheduler } =
      await import('./lib/queue/schedulers/google-ads-campaign-sync-scheduler')
    const scheduler = getGoogleAdsCampaignSyncScheduler()

    // 调用内部检查方法（通过反射访问私有方法）
    // @ts-ignore - 访问私有方法
    await scheduler.checkAndScheduleSync()
  } finally {
    syncGoogleAdsTaskRunning = false
  }
}

/**
 * 任务2: 数据库备份任务
 * 频率：每天凌晨2点
 * 🔄 已迁移到统一队列系统
 */
async function backupDatabaseTask() {
  log('💾 开始执行数据库备份任务...')

  try {
    // 🔄 使用队列系统触发备份任务
    const taskId = await triggerBackup({
      backupType: 'auto',
    })
    log(`📥 数据库备份任务已入队: ${taskId}`)
  } catch (error) {
    logError('❌ 数据库备份任务入队失败:', error)
  }
}

/**
 * 任务3: 清理旧数据任务
 * 频率：每天凌晨3点
 * 🔄 已迁移到统一队列系统
 */
async function cleanupOldDataTask() {
  log('🗑️ 开始执行数据清理任务...')

  try {
    // 🔄 使用队列系统触发清理任务
    const taskId = await triggerCleanup({
      cleanupType: 'daily',
      retentionDays: 90,
      backupRetentionDays: 7,
      targets: ['performance', 'sync_logs', 'backups', 'link_check_history'],
    })
    log(`📥 数据清理任务已入队: ${taskId}`)
  } catch (error) {
    logError('❌ 数据清理任务入队失败:', error)
  }
}

/**
 * 任务5: 禁用/过期用户后台任务暂停
 * 频率：每天一次（可配置）
 *
 * 策略：
 * - click-farm：标记为 stopped
 * - url-swap：标记为 disabled
 * - 清理队列中已入队但未执行的 click-farm/url-swap 任务（pending/delayed）
 *
 * 注意：任务不会在用户重新启用/续费后自动恢复，需用户手动重新开启。
 */
async function suspendInactiveOrExpiredUserTasksTask() {
  log('⛔️ 开始检查禁用/过期用户，并暂停补点击/换链接任务...')

  try {
    const { suspendBackgroundTasksForInactiveOrExpiredUsers } =
      await import('./lib/common/background-task-suspension')
    const result = await suspendBackgroundTasksForInactiveOrExpiredUsers({ purgeQueue: true })

    log(
      `⛔️ 完成 - affectedUsers=${result.affectedUserIds.length}, stoppedClickFarm=${result.clickFarmStopped}, disabledUrlSwap=${result.urlSwapDisabled}, purgedQueue=${result.queuePurged}`
    )
  } catch (error) {
    logError('❌ 禁用/过期用户任务暂停执行失败:', error)
  }
}

/**
 * 任务6: OpenClaw 每日报表推送（飞书）
 * 频率：每天上午9点（Asia/Shanghai，推送前一自然日数据）
 */
async function openclawDailyReportTask() {
  const reportTimeZone = process.env.TZ || 'Asia/Shanghai'
  const todayDate = formatDateInTimezone(new Date(), reportTimeZone)
  const reportDate = shiftDateKeyByDays(todayDate, -1)

  log(`📨 开始推送 OpenClaw 每日报表 (reportDate=${reportDate}, timezone=${reportTimeZone})...`)

  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })

  try {
    const rows = await db.query<{
      user_id: number
      target: string | null
      doc_folder: string | null
      bitable_app: string | null
    }>(
      `
      SELECT
        ss.user_id,
        MAX(CASE WHEN ss.key = 'feishu_target' THEN ss.value END) as target,
        MAX(CASE WHEN ss.key = 'feishu_doc_folder_token' THEN ss.value END) as doc_folder,
        MAX(CASE WHEN ss.key = 'feishu_bitable_app_token' THEN ss.value END) as bitable_app
      FROM system_settings ss
      INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.category = 'openclaw'
        AND ss.user_id IS NOT NULL
        AND ss.value IS NOT NULL
        AND ss.value != ''
        AND ss.key IN ('feishu_target', 'feishu_doc_folder_token', 'feishu_bitable_app_token')
        AND ${userEligibleCondition}
        AND u.openclaw_enabled = ?
      GROUP BY ss.user_id
    `,
      [true]
    )

    if (!rows || rows.length === 0) {
      log('📭 未找到需要推送的OpenClaw用户')
      return
    }

    const queue = getQueueManagerForTaskType('openclaw-report-send')

    let queuedCount = 0
    for (const row of rows) {
      try {
        const taskId = await queue.enqueue(
          'openclaw-report-send',
          {
            userId: row.user_id,
            target: row.target || undefined,
            date: reportDate,
            trigger: 'cron',
          },
          row.user_id,
          {
            priority: 'normal',
            maxRetries: 1,
          }
        )
        queuedCount++
        log(`📥 OpenClaw报表投递任务已入队 (user=${row.user_id}, task=${taskId})`)
      } catch (error) {
        logError(`❌ OpenClaw报表投递任务入队失败 (user=${row.user_id})`, error)
      }
    }

    log(`📨 OpenClaw 报表投递任务入队完成 - 成功: ${queuedCount}/${rows.length}`)
  } catch (error) {
    logError('❌ OpenClaw 报表推送执行失败:', error)
  }
}

/**
 * 任务6.1: OpenClaw 每周报表推送（飞书）
 * 频率：每周一上午（Asia/Shanghai，推送上周一~周日数据）
 */
async function openclawWeeklyReportTask() {
  const reportTimeZone = process.env.TZ || 'Asia/Shanghai'
  const todayDate = formatDateInTimezone(new Date(), reportTimeZone)
  const reportEndDate = shiftDateKeyByDays(todayDate, -1)
  const reportStartDate = shiftDateKeyByDays(reportEndDate, -6)

  log(
    `🗓️ 开始推送 OpenClaw 周报 (start=${reportStartDate}, end=${reportEndDate}, timezone=${reportTimeZone})...`
  )

  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })

  try {
    const rows = await db.query<{
      user_id: number
      target: string | null
    }>(
      `
      SELECT
        ss.user_id,
        MAX(CASE WHEN ss.key = 'feishu_target' THEN ss.value END) as target
      FROM system_settings ss
      INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.category = 'openclaw'
        AND ss.user_id IS NOT NULL
        AND ss.value IS NOT NULL
        AND ss.value != ''
        AND ss.key IN ('feishu_target')
        AND ${userEligibleCondition}
        AND u.openclaw_enabled = ?
      GROUP BY ss.user_id
    `,
      [true]
    )

    if (!rows || rows.length === 0) {
      log('📭 未找到需要推送周报的 OpenClaw 用户')
      return
    }

    const queue = getQueueManagerForTaskType('openclaw-report-send')

    let queuedCount = 0
    for (const row of rows) {
      try {
        const taskId = await queue.enqueue(
          'openclaw-report-send',
          {
            userId: row.user_id,
            target: row.target || undefined,
            date: reportEndDate,
            startDate: reportStartDate,
            trigger: 'cron',
          },
          row.user_id,
          {
            priority: 'normal',
            maxRetries: 1,
            taskId: `openclaw-weekly-report-send-cron:${row.user_id}:${reportStartDate}:${reportEndDate}`,
          }
        )
        queuedCount++
        log(
          `📥 OpenClaw周报投递任务已入队 (user=${row.user_id}, task=${taskId}, range=${reportStartDate}~${reportEndDate})`
        )
      } catch (error) {
        logError(`❌ OpenClaw周报投递任务入队失败 (user=${row.user_id})`, error)
      }
    }

    log(`🗓️ OpenClaw 周报投递任务入队完成 - 成功: ${queuedCount}/${rows.length}`)
  } catch (error) {
    logError('❌ OpenClaw 周报推送执行失败:', error)
  }
}

/**
 * 任务6.2: OpenClaw 联盟成交/佣金快照刷新
 * 频率：每小时执行一次（按用户配置的 interval 过滤）
 * 范围：默认刷新最近7天（含当天）；若设置了更长 pending 宽限期，会自动扩展窗口；也可通过 OPENCLAW_AFFILIATE_SYNC_LOOKBACK_DAYS 配置
 */
async function openclawAffiliateRevenueSnapshotTask() {
  log('🧾 开始刷新 OpenClaw 联盟成交/佣金快照...')

  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })
  const reportTimeZone = 'Asia/Shanghai'
  const pendingGraceDays = Math.max(
    1,
    parsePositiveInt(process.env.OPENCLAW_AFFILIATE_ATTRIBUTION_PENDING_DAYS, 7)
  )
  const lookbackDays = Math.max(
    7,
    pendingGraceDays,
    parsePositiveInt(process.env.OPENCLAW_AFFILIATE_SYNC_LOOKBACK_DAYS, 7)
  )
  const reportDates = buildAffiliateLookbackDates(lookbackDays, reportTimeZone)
  const firstReportDate = reportDates[0]
  const latestReportDate = reportDates[reportDates.length - 1]

  try {
    const rows = await db.query<{ user_id: number }>(`
      SELECT
        u.id as user_id
      FROM users u
      WHERE ${userEligibleCondition}
      GROUP BY u.id
    `)

    if (!rows || rows.length === 0) {
      log('📭 未找到可刷新的用户')
      return
    }

    const queue = getQueueManagerForTaskType('openclaw-affiliate-sync')

    let queuedUsers = 0
    let queuedTasks = 0
    let skippedIntervalDates = 0
    let skippedNoPlatform = 0
    let failedCount = 0
    const nowMs = Date.now()

    for (const row of rows) {
      // 重要：联盟 token 属于敏感配置，数据库中 value 可能为空，仅 encrypted_value 有值。
      // 必须走 settings 层解密读取，否则会误判“未配置平台”，导致同步任务不入队。
      const openclawSettings = await getOpenclawSettingsWithAffiliateSyncMap(row.user_id)
      const partnerboostToken = String(openclawSettings.partnerboost_token || '').trim()
      const yeahpromosToken = String(openclawSettings.yeahpromos_token || '').trim()
      const yeahpromosSiteId = String(openclawSettings.yeahpromos_site_id || '').trim()

      const hasPartnerBoost = Boolean(partnerboostToken)
      const hasYeahPromos = Boolean(yeahpromosToken && yeahpromosSiteId)
      if (!hasPartnerBoost && !hasYeahPromos) {
        skippedNoPlatform += 1
        continue
      }

      const syncIntervalHours = Math.min(
        24,
        Math.max(
          1,
          parsePositiveInt(String(openclawSettings.openclaw_affiliate_sync_interval_hours || ''), 1)
        )
      )
      const syncMode = normalizeAffiliateSyncMode(
        String(openclawSettings.openclaw_affiliate_sync_mode || '')
      )

      const existingRows = await db.query<{ report_date: string; payload_json: string | null }>(
        `SELECT report_date, payload_json
         FROM openclaw_daily_reports
         WHERE user_id = ?
           AND report_date IN (${reportDates.map(() => '?').join(', ')})`,
        [row.user_id, ...reportDates]
      )
      const generatedAtByDate = new Map<string, Date>()
      for (const reportRow of existingRows || []) {
        const reportDateKey = normalizeDateKey(reportRow.report_date)
        const generatedAt = parseReportGeneratedAt(reportRow.payload_json)
        if (!reportDateKey || !generatedAt) continue
        generatedAtByDate.set(reportDateKey, generatedAt)
      }

      let queuedForUser = 0
      for (const reportDate of reportDates) {
        const generatedAt = generatedAtByDate.get(reportDate)
        if (generatedAt) {
          const hoursSinceLastRefresh = (nowMs - generatedAt.getTime()) / (1000 * 60 * 60)
          if (hoursSinceLastRefresh < syncIntervalHours) {
            skippedIntervalDates += 1
            continue
          }
        }

        try {
          const taskId = await queue.enqueue(
            'openclaw-affiliate-sync',
            {
              userId: row.user_id,
              date: reportDate,
              syncMode,
              trigger: 'cron',
            },
            row.user_id,
            {
              priority: 'normal',
              maxRetries: 1,
            }
          )

          queuedForUser += 1
          queuedTasks += 1
          log(
            `📥 OpenClaw 联盟佣金快照同步任务已入队 (user=${row.user_id}, task=${taskId}, date=${reportDate}, mode=${syncMode}, interval=${syncIntervalHours}h)`
          )
        } catch (error) {
          failedCount += 1
          logError(
            `❌ OpenClaw 联盟佣金快照同步任务入队失败 (user=${row.user_id}, date=${reportDate})`,
            error
          )
        }
      }

      if (queuedForUser > 0) {
        queuedUsers += 1
      }
    }

    log(
      `🧾 OpenClaw 联盟佣金快照刷新入队完成 - 窗口: ${firstReportDate}~${latestReportDate}(${reportDates.length}天), 入队用户: ${queuedUsers}/${rows.length}, 入队任务: ${queuedTasks}, 跳过未配置平台: ${skippedNoPlatform}, 跳过间隔(按日期): ${skippedIntervalDates}, 失败: ${failedCount}`
    )
  } catch (error) {
    logError('❌ OpenClaw 联盟佣金快照任务执行失败:', error)
  }
}

/**
 * 任务4: 链接可用性和账号状态检查
 * 频率：根据用户在/settings页面配置的link_check_time执行
 * 需求20优化：后续异步操作 - Ads账号状态检测、推广链接检测
 * 🔄 已迁移到统一队列系统，按用户配置执行
 */
async function linkAndAccountCheckTask() {
  log('🔍 开始执行链接可用性和账号状态检查任务...')

  const db = await getDatabase()
  const userEligibleCondition = buildUserExecutionEligibleSql({ userAlias: 'u' })

  try {
    // 获取所有启用了链接检查且执行资格有效的用户配置
    const userConfigs = await db.query<{
      user_id: number
      link_check_enabled: string
      link_check_time: string
    }>(`
      SELECT
        ss.user_id,
        MAX(CASE WHEN ss.key = 'link_check_enabled' THEN ss.value END) as link_check_enabled,
        MAX(CASE WHEN ss.key = 'link_check_time' THEN ss.value END) as link_check_time
      FROM system_settings ss
      INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.category = 'system'
        AND ss.key IN ('link_check_enabled', 'link_check_time')
        AND ss.user_id IS NOT NULL
        AND ${userEligibleCondition}
      GROUP BY ss.user_id
    `)

    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    let queuedCount = 0

    for (const config of userConfigs) {
      // 检查是否启用了链接检查
      if (config.link_check_enabled !== 'true') {
        continue
      }

      // 检查是否到了执行时间（允许5分钟误差）
      const checkTime = config.link_check_time || '02:00'
      if (!isTimeMatch(currentTime, checkTime, 5)) {
        continue
      }

      try {
        // 🔄 使用队列系统触发链接检查任务
        const taskId = await triggerLinkCheck({
          checkType: 'daily',
          userId: config.user_id,
          useUrlResolver: true, // 使用URL解析器验证链接
        })
        log(`📥 用户 ${config.user_id} 链接检查任务已入队: ${taskId}`)
        queuedCount++
      } catch (error) {
        logError(`❌ 用户 ${config.user_id} 链接检查任务入队失败:`, error)
      }
    }

    log(`🔍 链接检查任务入队完成 - 已入队: ${queuedCount}`)
  } catch (error) {
    logError('❌ 链接和账号检查任务执行失败:', error)
  }
}

/**
 * 任务 3.0: 广告系列暂停任务检测
 * 频率：默认每 30 分钟
 * 功能：检测所有已暂停的广告系列，自动暂停关联 offer 的补点击和换链接任务
 */
async function campaignPausedTaskSchedulerTask() {
  log('🔄 开始检测已暂停广告系列的任务...')

  try {
    const { getCampaignPausedTaskScheduler } =
      await import('./lib/queue/schedulers/campaign-paused-task-scheduler')
    const scheduler = getCampaignPausedTaskScheduler()

    // 调用内部检查方法（通过反射访问私有方法）
    // @ts-ignore - 访问私有方法
    await scheduler.checkAndPauseTasks()

    log('🔄 广告系列暂停任务检测完成')
  } catch (error) {
    logError('❌ 广告系列暂停任务检测执行失败:', error)
  }
}

/**
 * 任务3.1: 创意完成后未发布超时检查
 * 频率：默认每30分钟
 */
async function creativePublishTimeoutAlertTask() {
  const thresholdMinutes = parsePositiveInt(
    process.env.CREATIVE_PUBLISH_ALERT_THRESHOLD_MINUTES,
    90
  )
  const lookbackHours = parsePositiveInt(process.env.CREATIVE_PUBLISH_ALERT_LOOKBACK_HOURS, 48)
  const limit = parsePositiveInt(process.env.CREATIVE_PUBLISH_ALERT_LIMIT, 500)

  log(
    `🚨 开始执行创意发布超时检查任务... (threshold=${thresholdMinutes}m, lookback=${lookbackHours}h, limit=${limit})`
  )

  try {
    const { checkCreativePublishTimeouts } = await import('./lib/creatives/creative-publish-alerts')
    const result = await checkCreativePublishTimeouts({
      thresholdMinutes,
      lookbackHours,
      limit,
    })

    log(
      `🚨 创意发布超时检查完成 - scanned=${result.scannedOffers}, stalled=${result.stalledOffers}, alerts=${result.alertsTriggered}, skippedWithPublish=${result.skippedWithPublishRequest}`
    )
  } catch (error) {
    logError('❌ 创意发布超时检查任务执行失败:', error)
  }
}

/**
 * 检查当前时间是否匹配目标时间（允许一定分钟误差）
 */
function isTimeMatch(currentTime: string, targetTime: string, toleranceMinutes: number): boolean {
  const [currentHour, currentMin] = currentTime.split(':').map(Number)
  const [targetHour, targetMin] = targetTime.split(':').map(Number)

  const currentTotalMin = currentHour * 60 + currentMin
  const targetTotalMin = targetHour * 60 + targetMin

  return Math.abs(currentTotalMin - targetTotalMin) <= toleranceMinutes
}

/**
 * 启动调度器
 */
function startScheduler() {
  log('🚀 定时任务调度器启动')
  log('📅 任务调度计划:')
  log('  - 补点击任务: 每小时整点 (0 * * * *)')
  log(
    '  - 换链接任务: 每分钟 (* * * * *)；同周期兜底清理「已暂停补点击 / 已禁用换链」在队列中的挂起项'
  )
  log('  - 联盟商品同步: 每10分钟 (*/10 * * * *)')
  log('  - 推荐指数自愈调度: 默认每小时 (20 * * * *)')
  log('  - 数据同步: 每5分钟检查，按用户间隔触发（默认4小时）')
  log('  - 数据库备份: 每天凌晨2点')
  log('  - 链接和账号检查: 每天凌晨2点 (需求20优化)')
  log('  - 创意发布超时检查: 默认每30分钟')
  log('  - 数据清理: 每天凌晨3点')
  log('  - 禁用/过期用户任务暂停: 每天一次 (默认凌晨4点)')
  log('  - OpenClaw 每日报表推送: 每天上午9点')
  log('  - OpenClaw 每周报表推送: 每周一上午9:10')
  log('  - OpenClaw 联盟佣金快照刷新: 每小时（按用户配置）')
  log('  - OpenClaw 策略调度: 按用户配置')
  log('  - USD 汇率同步: 每天 UTC 01:00（EXCHANGE_RATE_SYNC_CRON 可覆盖）')
  log('  - A/B测试监控: [已禁用] 当前业务未使用')

  // 任务0: 每小时整点执行补点击任务调度
  // 注意：调度器的时区只影响触发时机，实际执行时间判断使用每个任务自己的时区
  console.log(`[Scheduler] 补点击任务调度器启动，当前时间: ${new Date().toISOString()}`)
  scheduleCronJob('0 * * * *', async () => {
    await clickFarmSchedulerTask()
  })

  // 任务0.1: 每分钟执行换链接任务调度
  // 📍 唯一调度位置：只在 scheduler 进程运行（与补点击任务架构一致）
  const urlSwapCheckCron = process.env.URL_SWAP_CHECK_CRON || '* * * * *'
  scheduleCronJob(
    urlSwapCheckCron,
    async () => {
      await urlSwapSchedulerTask()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )
  log(`✅ 换链接任务调度已启动 (cron: ${urlSwapCheckCron})`)

  // 任务0.2: 每10分钟执行联盟商品同步调度
  // 📍 唯一调度位置：只在 scheduler 进程运行（与补点击任务架构一致）
  const affiliateProductSyncCron = process.env.AFFILIATE_PRODUCT_SYNC_CRON || '*/10 * * * *'
  scheduleCronJob(
    affiliateProductSyncCron,
    async () => {
      await affiliateProductSyncSchedulerTask()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )
  log(`✅ 联盟商品同步调度已启动 (cron: ${affiliateProductSyncCron})`)

  // 任务0.3: 推荐指数自愈调度（兜底未评分/过期评分）
  const productScoreSchedulerEnabled = process.env.PRODUCT_SCORE_SCHEDULER_ENABLED !== 'false'
  const productScoreSchedulerCron = process.env.PRODUCT_SCORE_SCHEDULER_CRON || '20 * * * *'
  if (productScoreSchedulerEnabled) {
    scheduleCronJob(
      productScoreSchedulerCron,
      async () => {
        await productScoreSchedulerTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ 推荐指数自愈调度已启动 (cron: ${productScoreSchedulerCron})`)
  } else {
    log('⏸️  推荐指数自愈调度已禁用 (PRODUCT_SCORE_SCHEDULER_ENABLED=false)')
  }

  // 任务0.4: USD 基准汇率（UTC 每天 01:00，与 API 日更对齐）
  const exchangeRateSyncEnabled = process.env.EXCHANGE_RATE_SYNC_ENABLED !== 'false'
  const exchangeRateCron = process.env.EXCHANGE_RATE_SYNC_CRON || '0 1 * * *'
  if (exchangeRateSyncEnabled) {
    scheduleCronJob(
      exchangeRateCron,
      async () => {
        await exchangeRatesDailyTask()
      },
      {
        timeZone: 'UTC',
      }
    )
    log(`✅ USD 汇率同步已启动 (cron: ${exchangeRateCron}, timezone: UTC)`)
  } else {
    log('⏸️  USD 汇率同步已禁用 (EXCHANGE_RATE_SYNC_ENABLED=false)')
  }

  // 任务1: 高频检查 + 按用户间隔触发同步（避免固定整点导致的延迟）
  const dataSyncCheckCron = process.env.DATA_SYNC_CHECK_CRON || '*/5 * * * *'
  scheduleCronJob(
    dataSyncCheckCron,
    async () => {
      await runSyncDataTaskSafely('cron')
    },
    {
      timeZone: 'Asia/Shanghai', // 使用中国时区
    }
  )
  log(`✅ 数据同步检查任务已启动 (cron: ${dataSyncCheckCron})`)

  // 任务2: 每2小时执行一次 Google Ads 数据同步
  scheduleCronJob(
    '0 */2 * * *',
    async () => {
      await runSyncGoogleAdsTaskSafely('cron')
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )
  log('✅ Google Ads 数据同步检查任务已启动 (cron: 0 */2 * * *)')
  // 任务2: 每天凌晨2点备份数据库
  scheduleCronJob(
    '0 2 * * *',
    async () => {
      await backupDatabaseTask()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )

  // 任务3: 每天凌晨2点检查链接和账号状态（需求20优化）
  // 使用环境变量控制是否启用
  const linkCheckEnabled = process.env.LINK_CHECK_ENABLED !== 'false'
  const linkCheckCron = process.env.LINK_CHECK_CRON || '0 2 * * *'

  if (linkCheckEnabled) {
    scheduleCronJob(
      linkCheckCron,
      async () => {
        await linkAndAccountCheckTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ 链接和账号检查任务已启动 (cron: ${linkCheckCron})`)
  } else {
    log('⏸️  链接和账号检查任务已禁用 (LINK_CHECK_ENABLED=false)')
  }

  // 任务 3.0: 广告系列暂停任务检测（新增功能）
  const campaignPausedTaskCron = process.env.CAMPAIGN_PAUSED_TASK_CHECK_CRON || '*/30 * * * *'
  const campaignPausedTaskEnabled = process.env.CAMPAIGN_PAUSED_TASK_ENABLED !== 'false'

  if (campaignPausedTaskEnabled) {
    scheduleCronJob(
      campaignPausedTaskCron,
      async () => {
        await campaignPausedTaskSchedulerTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log('✅ 广告系列暂停任务检测已启动 (cron: ' + campaignPausedTaskCron + ')')
  } else {
    log('⏸️  广告系列暂停任务检测已禁用 (CAMPAIGN_PAUSED_TASK_ENABLED=false)')
  }

  // 任务3.1: 创意完成后未发布超时检查
  const creativePublishAlertEnabled = process.env.CREATIVE_PUBLISH_ALERT_ENABLED !== 'false'
  const creativePublishAlertCron = process.env.CREATIVE_PUBLISH_ALERT_CRON || '*/30 * * * *'

  if (creativePublishAlertEnabled) {
    scheduleCronJob(
      creativePublishAlertCron,
      async () => {
        await creativePublishTimeoutAlertTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ 创意发布超时检查任务已启动 (cron: ${creativePublishAlertCron})`)
  } else {
    log('⏸️  创意发布超时检查任务已禁用 (CREATIVE_PUBLISH_ALERT_ENABLED=false)')
  }

  // 任务4: 每天凌晨3点清理旧数据
  scheduleCronJob(
    '0 3 * * *',
    async () => {
      await cleanupOldDataTask()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )

  // 任务5: 每天定时暂停禁用/过期用户的后台任务（补点击/换链接）
  // 可通过环境变量控制启用与 Cron 表达式
  const userTaskSweepEnabled = process.env.USER_TASK_SWEEP_ENABLED !== 'false'
  const userTaskSweepCron = process.env.USER_TASK_SWEEP_CRON || '0 4 * * *'

  if (userTaskSweepEnabled) {
    scheduleCronJob(
      userTaskSweepCron,
      async () => {
        await suspendInactiveOrExpiredUserTasksTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ 禁用/过期用户任务暂停已启动 (cron: ${userTaskSweepCron})`)
  } else {
    log('⏸️  禁用/过期用户任务暂停已禁用 (USER_TASK_SWEEP_ENABLED=false)')
  }

  // 任务6: OpenClaw 每日报表推送
  scheduleCronJob(
    '0 9 * * *',
    async () => {
      await openclawDailyReportTask()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )

  // 任务6.1: OpenClaw 每周报表推送（每周一）
  const openclawWeeklyReportEnabled = process.env.OPENCLAW_WEEKLY_REPORT_ENABLED !== 'false'
  const openclawWeeklyReportCron = process.env.OPENCLAW_WEEKLY_REPORT_CRON || '10 9 * * 1'

  if (openclawWeeklyReportEnabled) {
    scheduleCronJob(
      openclawWeeklyReportCron,
      async () => {
        await openclawWeeklyReportTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ OpenClaw 每周报表推送任务已启动 (cron: ${openclawWeeklyReportCron})`)
  } else {
    log('⏸️  OpenClaw 每周报表推送任务已禁用 (OPENCLAW_WEEKLY_REPORT_ENABLED=false)')
  }

  // 任务6.2: OpenClaw 联盟成交/佣金快照刷新（每小时）
  const openclawAffiliateSyncEnabled = process.env.OPENCLAW_AFFILIATE_SYNC_ENABLED !== 'false'
  const openclawAffiliateSyncCron = process.env.OPENCLAW_AFFILIATE_SYNC_CRON || '5 * * * *'

  if (openclawAffiliateSyncEnabled) {
    scheduleCronJob(
      openclawAffiliateSyncCron,
      async () => {
        await openclawAffiliateRevenueSnapshotTask()
      },
      {
        timeZone: 'Asia/Shanghai',
      }
    )
    log(`✅ OpenClaw 联盟佣金快照刷新任务已启动 (cron: ${openclawAffiliateSyncCron})`)
  } else {
    log('⏸️  OpenClaw 联盟佣金快照刷新任务已禁用 (OPENCLAW_AFFILIATE_SYNC_ENABLED=false)')
  }

  // 任务7: OpenClaw 策略调度（按用户配置）
  refreshOpenclawStrategySchedules().catch((error) => {
    logError('❌ OpenClaw策略调度初始化失败:', error)
  })
  scheduleCronJob(
    '*/10 * * * *',
    async () => {
      await refreshOpenclawStrategySchedules()
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )

  // 任务10: 僵尸同步任务自动清理（每小时）
  scheduleCronJob(
    '0 * * * *',
    async () => {
      try {
        log('🧟 开始检测并修复僵尸同步任务...')
        const result = await detectAndFixZombieSyncTasks({ autoFix: true, dryRun: false })

        if (result.zombieTasks.length > 0) {
          log(`🧟 发现 ${result.zombieTasks.length} 个僵尸任务，已修复 ${result.fixedCount} 个`)

          // 记录详细信息
          for (const task of result.zombieTasks) {
            log(
              `  - 任务 #${task.id}: ${task.platform} | ${task.status} | ${task.processedItems}/${task.totalItems} | ${task.reason}`
            )
          }

          if (result.errors.length > 0) {
            logError(`🧟 修复过程中出现 ${result.errors.length} 个错误`, result.errors.join('; '))
          }
        } else {
          log('✅ 未发现僵尸同步任务')
        }
      } catch (error: any) {
        logError('❌ 僵尸任务检测失败:', error)
      }
    },
    {
      timeZone: 'Asia/Shanghai',
    }
  )

  log('✅ 所有定时任务已启动')

  // 启动时立即执行一次数据同步（可选）
  if (process.env.RUN_SYNC_ON_START === 'true') {
    log('🔄 启动时立即执行数据同步...')
    runSyncDataTaskSafely('startup').catch((error) => {
      logError('启动同步失败:', error)
    })
  }

  if (process.env.RUN_SYNC_GOOGLE_ADS_ON_START === 'true') {
    log('🔄 启动时立即执行Google Ads 数据同步...')
    runSyncGoogleAdsTaskSafely('startup').catch((error) => {
      logError('启动同步失败:', error)
    })
  }

  if (process.env.OPENCLAW_AFFILIATE_SYNC_ON_START === 'true') {
    log('🧾 启动时立即刷新 OpenClaw 联盟成交/佣金快照...')
    openclawAffiliateRevenueSnapshotTask().catch((error) => {
      logError('启动 OpenClaw 联盟佣金快照刷新失败:', error)
    })
  }

  if (process.env.PRODUCT_SCORE_SCHEDULER_RUN_ON_START !== 'false') {
    log('⭐ 启动时立即执行一次推荐指数自愈调度...')
    productScoreSchedulerTask().catch((error) => {
      logError('启动推荐指数自愈调度失败:', error)
    })
  }
}

function stopAllSchedulerTasks() {
  stopAllScheduledCronJobs()

  // 停止 Google Ads 同步调度器
  try {
    const {
      getGoogleAdsCampaignSyncScheduler,
    } = require('./lib/queue/schedulers/google-ads-campaign-sync-scheduler')
    const googleAdsSyncScheduler = getGoogleAdsCampaignSyncScheduler()
    googleAdsSyncScheduler.stop()
    log('✅ Google Ads 广告系列同步调度器已停止')
  } catch (error) {
    logError('⚠️ 停止 Google Ads 同步调度器失败:', error)
  }

  openclawStrategySchedules.clear()
}

/**
 * 优雅退出
 */
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`📴 收到 ${signal} 信号，正在优雅退出...`)
  stopAllSchedulerTasks()

  const shutdownTimer = setTimeout(() => {
    log('✅ 调度器已停止')
    process.exit(0)
  }, schedulerShutdownGraceMs)
  shutdownTimer.unref?.()
}

// 监听退出信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// 全局错误处理
process.on('uncaughtException', (error) => {
  logError('❌ 未捕获的异常:', error)
  // 不退出进程，让supervisord管理重启
})

process.on('unhandledRejection', (reason, _promise) => {
  logError('❌ 未处理的Promise拒绝:', reason)
  // 不退出进程，让supervisord管理重启
})

// 启动调度器
startScheduler()

// 保持进程运行
log('💡 调度器进程运行中，按 Ctrl+C 停止')
