/**
 * Click-farm statistics, daily history, and batched click counters.
 */
import { getDatabase, toDbJsonObjectField, datetimeMinusHours, parseJsonField } from '@/lib/db'
import { getDateInTimezone, createDateInTimezone } from '@/lib/common/server'
import { estimateTraffic } from './distribution'
import type {
  ClickFarmTask,
  ClickFarmTaskStatus,
  ClickFarmStats,
  HourlyDistribution,
  DailyHistoryEntry,
} from './click-farm-types'
import { parseClickFarmTask, calculateMatchRate } from './click-farm-row'

const CLICK_FARM_STATS_BATCH_SIZE = (() => {
  const n = parseInt(process.env.CLICK_FARM_STATS_BATCH_SIZE || '20', 10)
  return Number.isFinite(n) && n > 0 ? n : 20
})()

const CLICK_FARM_STATS_FLUSH_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CLICK_FARM_STATS_FLUSH_INTERVAL_MS || '2000', 10)
  return Number.isFinite(n) && n >= 0 ? n : 2000
})()

const CLICK_FARM_MAX_HISTORY_DAYS = (() => {
  const n = parseInt(process.env.CLICK_FARM_MAX_HISTORY_DAYS || '60', 10)
  return Number.isFinite(n) && n > 0 ? n : 60
})()

type HourlyDelta = { actual: number; success: number; failed: number }

type PendingStatsUpdate = {
  total: number
  success: number
  failed: number
  hourly: Map<number, HourlyDelta>
  timer?: NodeJS.Timeout
}

const pendingStatsUpdates = new Map<string, PendingStatsUpdate>()
const pendingFlushLocks = new Map<string, Promise<void>>()

function shiftDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().split('T')[0]
}

function pruneDailyHistoryByDays(
  history: DailyHistoryEntry[],
  todayStr: string
): DailyHistoryEntry[] {
  if (!CLICK_FARM_MAX_HISTORY_DAYS || CLICK_FARM_MAX_HISTORY_DAYS <= 0) return history
  const cutoff = shiftDateStr(todayStr, -(CLICK_FARM_MAX_HISTORY_DAYS - 1))
  return history.filter((entry) => entry?.date && entry.date >= cutoff)
}

function recordHourlyDelta(entry: PendingStatsUpdate, hour: number, success: boolean) {
  const current = entry.hourly.get(hour) || { actual: 0, success: 0, failed: 0 }
  current.actual += 1
  if (success) current.success += 1
  else current.failed += 1
  entry.hourly.set(hour, current)
}

function scheduleStatsFlush(taskId: string, entry: PendingStatsUpdate) {
  if (entry.timer || CLICK_FARM_STATS_FLUSH_INTERVAL_MS <= 0) return
  entry.timer = setTimeout(() => {
    void flushPendingStats(taskId).catch((error) => {
      console.warn(`[click-farm] 批量统计刷新失败: ${taskId}`, error)
    })
  }, CLICK_FARM_STATS_FLUSH_INTERVAL_MS)
  entry.timer.unref?.()
}

async function flushPendingStats(taskId: string): Promise<void> {
  const existing = pendingFlushLocks.get(taskId)
  if (existing) return existing

  const flushPromise = (async () => {
    const entry = pendingStatsUpdates.get(taskId)
    if (!entry || entry.total <= 0) return

    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }

    pendingStatsUpdates.delete(taskId)

    const snapshot: PendingStatsUpdate = {
      total: entry.total,
      success: entry.success,
      failed: entry.failed,
      hourly: new Map(entry.hourly),
    }

    try {
      const db = await getDatabase()
      const taskRow = await db.queryOne<any>(
        `
        SELECT id, daily_history, hourly_distribution, timezone, started_at
        FROM click_farm_tasks
        WHERE id = ?
      `,
        [taskId]
      )

      if (!taskRow) {
        return
      }

      const task = parseClickFarmTask(taskRow)
      const todayInTaskTimezone = getTodayInTaskTimezone(task)

      let dailyHistory: DailyHistoryEntry[] =
        task.daily_history && task.daily_history.length > 0 ? [...task.daily_history] : []

      let todayEntry = dailyHistory.find((entryItem) => entryItem.date === todayInTaskTimezone)
      if (!todayEntry) {
        todayEntry = {
          date: todayInTaskTimezone,
          target: task.hourly_distribution.reduce((sum, count) => sum + count, 0),
          actual: 0,
          success: 0,
          failed: 0,
          hourly_breakdown: task.hourly_distribution.map((target) => ({
            target,
            actual: 0,
            success: 0,
            failed: 0,
          })),
        }
        dailyHistory.push(todayEntry)
      }

      if (!todayEntry.hourly_breakdown || todayEntry.hourly_breakdown.length !== 24) {
        todayEntry.hourly_breakdown = task.hourly_distribution.map((target) => ({
          target,
          actual: 0,
          success: 0,
          failed: 0,
        }))
      }

      todayEntry.actual += snapshot.total
      todayEntry.success += snapshot.success
      todayEntry.failed += snapshot.failed

      for (const [hour, delta] of snapshot.hourly.entries()) {
        const hourEntry = todayEntry.hourly_breakdown[hour]
        if (!hourEntry) continue
        hourEntry.actual += delta.actual
        hourEntry.success += delta.success
        hourEntry.failed += delta.failed
      }

      dailyHistory = pruneDailyHistoryByDays(dailyHistory, todayInTaskTimezone)

      await db.exec(
        `
        UPDATE click_farm_tasks
        SET total_clicks = total_clicks + ?,
            success_clicks = success_clicks + ?,
            failed_clicks = failed_clicks + ?,
            daily_history = ?,
            updated_at = NOW()
        WHERE id = ?
      `,
        [
          snapshot.total,
          snapshot.success,
          snapshot.failed,
          toDbJsonObjectField(dailyHistory, []),
          taskId,
        ]
      )
    } catch (error) {
      const merged = pendingStatsUpdates.get(taskId) || {
        total: 0,
        success: 0,
        failed: 0,
        hourly: new Map(),
      }
      merged.total += snapshot.total
      merged.success += snapshot.success
      merged.failed += snapshot.failed
      for (const [hour, delta] of snapshot.hourly.entries()) {
        const current = merged.hourly.get(hour) || { actual: 0, success: 0, failed: 0 }
        current.actual += delta.actual
        current.success += delta.success
        current.failed += delta.failed
        merged.hourly.set(hour, current)
      }
      pendingStatsUpdates.set(taskId, merged)
      scheduleStatsFlush(taskId, merged)
      throw error
    }
  })()

  pendingFlushLocks.set(taskId, flushPromise)
  try {
    await flushPromise
  } finally {
    pendingFlushLocks.delete(taskId)
  }
}

export async function getClickFarmStats(
  userId: number,
  daysBack: number | 'all' = 'all'
): Promise<ClickFarmStats> {
  const db = await getDatabase()
  const debug = process.env.CLICK_FARM_DEBUG === '1'

  // 构建日期过滤条件
  let dateFilter = ''
  let statsParams: (number | string)[] = [userId]
  if (daysBack !== 'all') {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    dateFilter = ' AND started_at >= ?'
    statsParams.push(cutoffDate.toISOString())
  }

  // 🔧 修复：获取所有任务及其对应的timezone，在应用层按每个任务的timezone过滤今日数据
  // ⚠️ 注意：每个任务可能有不同的timezone（来自offer的target_country）
  // 必须按每个任务的timezone单独判断"today"，然后聚合统计
  // 仅扫描最近更新的任务，避免解析大量历史任务导致内存暴涨
  const recentCutoff = datetimeMinusHours(48)
  const allTasksQuery = `
    SELECT timezone, daily_history
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE AND started_at IS NOT NULL ${dateFilter}
      AND updated_at >= ${recentCutoff}
  `

  const allTasks = await db.query<{
    timezone: string
    daily_history: string | any[]
  }>(allTasksQuery, statsParams)

  // 🔧 修复：今日统计应该从 daily_history 中按任务的时区查找今天的记录
  // 而不是判断 started_at 是否在今天
  // 今日点击数据
  let todayClicks = 0
  let todaySuccessClicks = 0
  let todayFailedClicks = 0

  // 从每个任务的 daily_history 中提取今日数据
  for (const task of allTasks) {
    let history: any[] = []
    if (typeof task.daily_history === 'string') {
      try {
        history = JSON.parse(task.daily_history)
      } catch (_e) {
        history = []
      }
    } else if (Array.isArray(task.daily_history)) {
      history = task.daily_history
    }

    if (history.length > 0 && task.timezone) {
      // 用任务的时区获取今天的日期
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone)
      if (debug) {
        console.log('🔍 [click-farm] 任务时区:', task.timezone, '今日日期:', todayInTaskTimezone)
        console.log('🔍 [click-farm] daily_history 前3条:', JSON.stringify(history.slice(0, 3)))
      }

      // 从 daily_history 中找今天的记录
      const todayEntry = history.find((entry: any) => entry.date === todayInTaskTimezone)
      if (todayEntry) {
        if (debug) {
          console.log('🔍 [click-farm] 找到今日记录:', JSON.stringify(todayEntry))
        }
        todayClicks += todayEntry.actual || 0
        todaySuccessClicks += todayEntry.success || 0
        todayFailedClicks += todayEntry.failed || 0
      } else {
        const latestEntry = history[history.length - 1]
        if (debug) {
          console.log('🔍 [click-farm] 未找到今日记录，尝试查找最近日期')
          console.log('🔍 [click-farm] 最新记录:', JSON.stringify(latestEntry))
        }
      }
    } else {
      if (debug) {
        console.log(
          '🔍 [click-farm] 跳过任务: history.length=',
          history.length,
          'timezone=',
          task.timezone
        )
      }
    }
  }

  if (debug) {
    console.log('🔍 [click-farm] 今日统计（从daily_history）:', {
      clicks: todayClicks,
      successClicks: todaySuccessClicks,
      failedClicks: todayFailedClicks,
    })
  }

  // 累计统计（不含已删除任务）

  const todaySuccessRate = todayClicks > 0 ? (todaySuccessClicks / todayClicks) * 100 : 0

  // 累计统计（不含已删除任务）
  // 如果指定了daysBack，则只统计指定范围内的数据
  let cumulativeFilter = ''
  let cumulativeParams: (string | number)[] = [userId]
  if (daysBack !== 'all') {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    cumulativeFilter = ' AND created_at >= ?'
    cumulativeParams.push(cutoffDate.toISOString())
  }

  // 累计统计（不含已删除任务）
  const cumulativeResult = await db.queryOne<any>(
    `
    SELECT
      COALESCE(SUM(total_clicks), 0) as clicks,
      COALESCE(SUM(success_clicks), 0) as success_clicks,
      COALESCE(SUM(failed_clicks), 0) as failed_clicks
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE ${cumulativeFilter}
  `,
    cumulativeParams
  )

  // 🔧 调试日志：查看PostgreSQL返回的原始数据
  if (debug) {
    console.log('🔍 [click-farm] cumulativeResult 原始数据:', JSON.stringify(cumulativeResult))
    console.log('🔍 [click-farm] cumulativeResult 字段:', {
      clicks: cumulativeResult?.clicks,
      success_clicks: cumulativeResult?.success_clicks,
      failed_clicks: cumulativeResult?.failed_clicks,
      successClicks: cumulativeResult?.successClicks,
      failedClicks: cumulativeResult?.failedClicks,
    })
  }

  // 🔧 修复: PostgreSQL 列名是小写的（success_clicks 而非 successClicks）
  // 确保所有字段都是数字类型（PostgreSQL numeric 类型可能返回字符串）
  const cumulative = {
    clicks: parseFloat(String(cumulativeResult?.clicks || 0)),
    successClicks: parseFloat(String(cumulativeResult?.success_clicks || 0)),
    failedClicks: parseFloat(String(cumulativeResult?.failed_clicks || 0)),
  }

  if (debug) {
    console.log('🔍 [click-farm] cumulative 解析后:', cumulative)
  }

  const cumulativeSuccessRate =
    cumulative.clicks > 0
      ? parseFloat(((cumulative.successClicks / cumulative.clicks) * 100).toFixed(1))
      : 0

  // 🆕 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(
    `
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE ${dateFilter.replace('started_at', 'created_at')}
    GROUP BY status
  `,
    [userId]
  )

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0,
  }

  statusDistribution.forEach((row) => {
    const status = row.status as ClickFarmTaskStatus
    const count = Number(row.count) // 🔧 修复：确保count是数字
    taskStatusDistribution[status] = count
    taskStatusDistribution.total += count
  })

  return {
    today: {
      clicks: todayClicks,
      successClicks: todaySuccessClicks,
      failedClicks: todayFailedClicks,
      successRate: parseFloat(todaySuccessRate.toFixed(1)),
      traffic: estimateTraffic(todayClicks), // 🔧 统一使用估算函数
    },
    cumulative: {
      clicks: cumulative.clicks,
      successClicks: cumulative.successClicks,
      failedClicks: cumulative.failedClicks,
      successRate: parseFloat(cumulativeSuccessRate.toFixed(1)),
      traffic: estimateTraffic(cumulative.clicks), // 🔧 统一使用估算函数
    },
    taskStatusDistribution, // 🆕 任务状态分布
  }
}

/**
 * 获取管理员全局统计数据（支持多时区聚合）
 * ⚠️ 重要：统计"今日"是指在每个任务所在时区的"今日"
 * 例如：
 * - 任务A（America/New_York）的"今日"点击 = 60
 * - 任务B（Asia/Shanghai）的"今日"点击 = 50
 * - 管理员看到的总"今日点击" = 110（聚合所有时区）
 */
export async function getAdminClickFarmStats(): Promise<{
  total_tasks: number
  active_tasks: number
  total_clicks: number
  success_clicks: number
  success_rate: number
  today_clicks: number
  today_success_clicks: number // 🆕 今日成功点击数
  today_success_rate: number // 🆕 今日成功率
  today_traffic: number
  total_traffic: number
  taskStatusDistribution: {
    pending: number
    running: number
    paused: number
    stopped: number
    completed: number
    total: number
  }
}> {
  const db = await getDatabase()

  // 1️⃣ 全局统计（包含已删除任务的历史数据，以便保留历史记录）
  const global = await db.queryOne<any>(
    `
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'running' AND NOT is_deleted THEN 1 ELSE 0 END) as active_tasks,
      COALESCE(SUM(total_clicks), 0) as total_clicks,
      COALESCE(SUM(success_clicks), 0) as success_clicks,
      COALESCE(SUM(failed_clicks), 0) as failed_clicks
    FROM click_farm_tasks
  `,
    []
  )

  const successRate =
    global.total_clicks > 0 ? (global.success_clicks / global.total_clicks) * 100 : 0

  // 2️⃣ 今日统计（按每个任务的timezone判断）
  // 🔧 修复：从每个任务的 daily_history 中提取今日数据
  // 而不是判断 started_at 是否为今天（started_at 是任务首次开始日期，可能是很久以前）
  // 仅扫描最近更新的任务，避免解析大量历史任务导致内存暴涨
  const recentCutoff = datetimeMinusHours(48)
  const allTasks = await db.query<{
    timezone: string
    daily_history: string | any[]
  }>(
    `
    SELECT timezone, daily_history
    FROM click_farm_tasks
    WHERE is_deleted = FALSE AND started_at IS NOT NULL
      AND updated_at >= ${recentCutoff}
  `,
    []
  )

  // 从每个任务的 daily_history 中提取今日数据
  let todayClicks = 0
  let todaySuccessClicks = 0
  let todayFailedClicks = 0

  for (const task of allTasks) {
    let history: any[] = []
    if (typeof task.daily_history === 'string') {
      try {
        history = JSON.parse(task.daily_history)
      } catch (_e) {
        history = []
      }
    } else if (Array.isArray(task.daily_history)) {
      history = task.daily_history
    }

    if (history.length > 0 && task.timezone) {
      // 用任务的时区获取今天的日期
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone)
      // 从 daily_history 中找今天的记录
      const todayEntry = history.find((entry: any) => entry.date === todayInTaskTimezone)
      if (todayEntry) {
        todayClicks += todayEntry.actual || 0
        todaySuccessClicks += todayEntry.success || 0
        todayFailedClicks += todayEntry.failed || 0
      }
    }
  }

  const today = {
    clicks: todayClicks,
    successClicks: todaySuccessClicks,
    failedClicks: todayFailedClicks,
  }

  const todaySuccessRate = today.clicks > 0 ? (today.successClicks / today.clicks) * 100 : 0

  // 3️⃣ 任务状态分布统计（不含已删除任务）
  const statusDistribution = await db.query<{ status: string; count: number }>(
    `
    SELECT status, COUNT(*) as count
    FROM click_farm_tasks
    WHERE is_deleted = FALSE
    GROUP BY status
  `,
    []
  )

  // 构建状态分布对象
  const taskStatusDistribution = {
    pending: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    completed: 0,
    total: 0,
  }

  statusDistribution.forEach((row) => {
    const status = row.status as ClickFarmTaskStatus
    const count = Number(row.count) // 🔧 修复：确保count是数字
    taskStatusDistribution[status] = count
    taskStatusDistribution.total += count
  })

  return {
    total_tasks: global.total_tasks,
    active_tasks: global.active_tasks,
    total_clicks: global.total_clicks,
    success_clicks: global.success_clicks,
    success_rate: parseFloat(successRate.toFixed(1)),
    today_clicks: today.clicks,
    today_success_clicks: today.successClicks, // 🆕 今日成功点击数
    today_success_rate: parseFloat(todaySuccessRate.toFixed(1)), // 🆕 今日成功率
    today_traffic: estimateTraffic(today.clicks), // 🔧 统一使用估算函数
    total_traffic: estimateTraffic(global.total_clicks), // 🔧 统一使用估算函数
    taskStatusDistribution,
  }
}

/**
 * 获取今日时间分布
 * 🔧 修复P1-5：从daily_history的hourly_breakdown中提取实际执行分布
 * 支持用户查看"配置分布" vs "实际执行分布"的对比
 */
export async function getHourlyDistribution(userId: number): Promise<HourlyDistribution> {
  const db = await getDatabase()

  // 获取今日所有任务的配置分布（汇总）
  const tasks = await db.query<any>(
    `
    SELECT hourly_distribution, timezone, daily_history, started_at
    FROM click_farm_tasks
    WHERE user_id = ? AND is_deleted = FALSE AND status IN ('running', 'completed')
  `,
    [userId]
  )

  const hourlyConfigured = new Array(24).fill(0)
  const hourlyActual = new Array(24).fill(0)
  const todayStr = getDateInTimezone(new Date(), 'UTC') // 使用UTC作为参考

  // 聚合所有任务的配置和实际执行分布
  tasks.forEach((task: any) => {
    const distribution = parseJsonField<number[]>(task.hourly_distribution, [])
    if (!Array.isArray(distribution)) {
      console.warn('[getHourlyDistribution] hourly_distribution 不是数组，已跳过')
      return
    }
    distribution.forEach((count: number, hour: number) => {
      hourlyConfigured[hour] += Number(count) || 0
    })

    // 🆕 P1-5：从daily_history的hourly_breakdown中提取实际执行数
    const dailyHistory = parseJsonField<DailyHistoryEntry[]>(task.daily_history, [])
    if (!Array.isArray(dailyHistory)) return

    // 找到对应今天的daily_history条目
    // 这里使用任务的timezone来确定"今天"
    const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone)
    const todayEntry = dailyHistory.find(
      (entry: DailyHistoryEntry) => entry.date === todayInTaskTimezone
    )

    if (todayEntry && Array.isArray(todayEntry.hourly_breakdown)) {
      todayEntry.hourly_breakdown.forEach((hourData: any, hour: number) => {
        hourlyActual[hour] += Number(hourData?.actual) || 0
      })
    }
  })

  // 计算匹配度
  const matchRate = calculateMatchRate(hourlyActual, hourlyConfigured)

  return {
    date: todayStr,
    hourlyActual,
    hourlyConfigured,
    matchRate,
  }
}

export async function initializeDailyHistory(task: ClickFarmTask): Promise<void> {
  const db = await getDatabase()

  // 如果daily_history已经有数据，说明已经初始化过，无需重复初始化
  if (task.daily_history && task.daily_history.length > 0) {
    return
  }

  // 从scheduled_start_date开始
  // 🔧 修复(2025-12-31): 确保 scheduled_start_date 是字符串格式 YYYY-MM-DD
  let currentDateStr: string
  const dateValue = task.scheduled_start_date as any
  if (typeof dateValue === 'string') {
    currentDateStr = dateValue.split('T')[0]
  } else if (dateValue instanceof Date) {
    const year = dateValue.getFullYear()
    const month = String(dateValue.getMonth() + 1).padStart(2, '0')
    const day = String(dateValue.getDate()).padStart(2, '0')
    currentDateStr = `${year}-${month}-${day}`
  } else {
    currentDateStr = String(dateValue)
  }
  const dailyHistory: DailyHistoryEntry[] = []

  // 计算应该创建的最后一天
  let endDateStr: string
  if (task.duration_days > 0) {
    // 有限期任务：计算结束日期
    // 🔧 修复：使用createDateInTimezone确保日期计算在正确的时区
    const startDate = createDateInTimezone(currentDateStr, '00:00', task.timezone)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + task.duration_days - 1)
    endDateStr = getDateInTimezone(endDate, task.timezone)
  } else {
    // 无限期任务：只初始化最近7天（P0-4修复）
    // 避免对于运行很久的任务初始化数千条记录
    const maxDaysToInit = 7
    const today = getDateInTimezone(new Date(), task.timezone)
    const endDate = new Date(today)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - (maxDaysToInit - 1))

    currentDateStr = startDate.toISOString().split('T')[0]
    endDateStr = today
  }

  // 为每一天创建历史记录
  while (currentDateStr <= endDateStr) {
    // 计算该天的目标点击数（基于hourly_distribution）
    const targetClicks = task.hourly_distribution.reduce((sum, count) => sum + count, 0)

    // 🆕 P1-5：初始化hourly_breakdown用于跟踪每小时的执行情况
    const hourlyBreakdown = task.hourly_distribution.map((target) => ({
      target,
      actual: 0,
      success: 0,
      failed: 0,
    }))

    dailyHistory.push({
      date: currentDateStr, // ⚠️ 这个日期相对于 task.timezone（任务时区的本地日期）
      target: targetClicks,
      actual: 0,
      success: 0,
      failed: 0,
      hourly_breakdown: hourlyBreakdown, // 🆕 添加小时级别追踪
    })

    // 日期递增（直接操作字符串+1天）
    const [year, month, day] = currentDateStr.split('-').map(Number)
    const nextDate = new Date(year, month - 1, day)
    nextDate.setDate(nextDate.getDate() + 1)
    currentDateStr = nextDate.toISOString().split('T')[0]
  }

  // 更新任务的daily_history
  await db.exec(
    `
    UPDATE click_farm_tasks
    SET daily_history = ?,
        updated_at = NOW()
    WHERE id = ?
  `,
    [toDbJsonObjectField(dailyHistory, []), task.id]
  )
}

/**
 * 获取任务在特定时区的今天日期（YYYY-MM-DD格式）
 *
 * ⚠️ 时区处理：返回的日期是相对于 task.timezone 的本地日期
 * 例如：task.timezone = "Asia/Shanghai"，当前UTC = 2024-12-28 16:00:00
 * 则返回 "2024-12-29"（上海时间）
 */
function getTodayInTaskTimezone(task: ClickFarmTask): string {
  return getDateInTimezone(new Date(), task.timezone)
}

/**
 * 更新任务执行统计
 * 包括全局统计和每日历史记录
 *
 * 🔧 修复P1-1：使用原子操作避免竞态条件
 * 🔧 修复P1-5：同时更新hourly_breakdown用于实际执行分布追踪
 * 🆕 内存优化：批量累积统计，避免每次点击都读写daily_history
 */
export async function updateTaskStats(
  id: number | string,
  success: boolean,
  currentHour?: number // 可选：当前小时（用于更新hourly_breakdown）
): Promise<void> {
  const taskId = String(id)
  const hour = Number.isFinite(currentHour) ? Number(currentHour) : undefined

  const entry = pendingStatsUpdates.get(taskId) || {
    total: 0,
    success: 0,
    failed: 0,
    hourly: new Map(),
  }

  entry.total += 1
  if (success) entry.success += 1
  else entry.failed += 1

  if (hour !== undefined && hour >= 0 && hour <= 23) {
    recordHourlyDelta(entry, hour, success)
  }

  pendingStatsUpdates.set(taskId, entry)

  if (CLICK_FARM_STATS_BATCH_SIZE <= 1) {
    await flushPendingStats(taskId)
    return
  }

  if (entry.total >= CLICK_FARM_STATS_BATCH_SIZE) {
    await flushPendingStats(taskId)
    return
  }

  scheduleStatsFlush(taskId, entry)
}
