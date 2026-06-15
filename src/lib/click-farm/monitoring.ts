/**
 * 补点击系统健康监控
 * src/lib/click-farm/monitoring.ts
 *
 * 用于监控系统在高负载下的表现（432k+ daily clicks）
 */

import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { dateMinusDays, datetimeMinusHours } from '@/lib/db'

const AVG_LATENCY_MS_SQL = 'AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)'

export interface ClickFarmHealth {
  timestamp: string
  queueStats: {
    depth: number
    avgProcessTime: number // 毫秒
    warning: boolean
  }
  successRate: {
    today: number // 百分比
    last7days: number
    warning: boolean
  }
  taskStats: {
    activeTaskCount: number
    totalClicks: number
    projectedDaily: number // 基于当前时间推算的日总点击数
  }
  performanceMetrics: {
    cronExecutionTime: number // 毫秒
    avgClickLatency: number // 毫秒
    dbQueryTime: number // 毫秒
  }
  alerts: Array<{
    level: 'warning' | 'error' | 'info'
    message: string
    timestamp: string
  }>
}

/**
 * 获取补点击系统健康状态
 */
export async function getClickFarmHealth(): Promise<ClickFarmHealth> {
  const db = await getDatabase()
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const alerts: ClickFarmHealth['alerts'] = []

  const queueStats = await getQueueStats(db, alerts)
  const successRate = await getSuccessRate(db, today, alerts)
  const taskStats = await getTaskStats(db, today, alerts)
  const performanceMetrics = await getPerformanceMetrics(db, alerts)

  return {
    timestamp: now.toISOString(),
    queueStats,
    successRate,
    taskStats,
    performanceMetrics,
    alerts,
  }
}

async function getQueueStats(
  db: DatabaseAdapter,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['queueStats']> {
  const pendingTasks = await db.queryOne<any>(`
    SELECT COUNT(*) as count FROM click_farm_queue WHERE status = 'pending'
  `)

  const depth = pendingTasks?.count || 0
  const lastHour = datetimeMinusHours(1)

  const recentTasks = await db.queryOne<any>(`
    SELECT
      ${AVG_LATENCY_MS_SQL} as avgTime
    FROM click_farm_queue
    WHERE status = 'completed'
      AND completed_at >= ${lastHour}
  `)

  const avgProcessTime = Math.round(recentTasks?.avgTime || 0)

  let warning = false
  if (depth > 50000) {
    warning = true
    alerts.push({
      level: 'warning',
      message: `队列堆积严重: ${depth} 个待处理任务，建议增加executor并发数`,
      timestamp: new Date().toISOString(),
    })
  }

  if (avgProcessTime > 5000) {
    warning = true
    alerts.push({
      level: 'warning',
      message: `点击处理缓慢: 平均耗时 ${avgProcessTime}ms，检查代理性能`,
      timestamp: new Date().toISOString(),
    })
  }

  return { depth, avgProcessTime, warning }
}

async function getSuccessRate(
  db: DatabaseAdapter,
  today: string,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['successRate']> {
  const todayStats = await db.queryOne<any>(
    `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success_clicks > 0 THEN 1 ELSE 0 END) as successful
    FROM click_farm_tasks
    WHERE scheduled_start_date = ?
  `,
    [today]
  )

  const todayRate =
    todayStats?.total > 0 ? Math.round((todayStats.successful / todayStats.total) * 100) : 0

  const last7days = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success_clicks > 0 THEN 1 ELSE 0 END) as successful
    FROM click_farm_tasks
    WHERE scheduled_start_date >= ${dateMinusDays(7)}
  `)

  const last7daysRate =
    last7days?.total > 0 ? Math.round((last7days.successful / last7days.total) * 100) : 0

  if (todayRate < 90) {
    alerts.push({
      level: 'warning',
      message: `今日成功率过低: ${todayRate}%，检查代理配置或网络连接`,
      timestamp: new Date().toISOString(),
    })
  }

  return {
    today: todayRate,
    last7days: last7daysRate,
    warning: todayRate < 90,
  }
}

async function getTaskStats(
  db: DatabaseAdapter,
  today: string,
  alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['taskStats']> {
  const activeTasks = await db.queryOne<any>(
    `
    SELECT COUNT(*) as count
    FROM click_farm_tasks
    WHERE status = 'running'
      AND scheduled_start_date <= ?
  `,
    [today]
  )

  const activeTaskCount = activeTasks?.count || 0

  const totalClicks = await db.queryOne<any>(
    `
    SELECT SUM(total_clicks) as total
    FROM click_farm_tasks
    WHERE scheduled_start_date = ?
  `,
    [today]
  )

  const todayClicks = totalClicks?.total || 0

  const now = new Date()
  const hoursElapsed = now.getHours() + now.getMinutes() / 60
  const projectedDaily =
    hoursElapsed > 0 ? Math.round((todayClicks / hoursElapsed) * 24) : todayClicks

  if (projectedDaily > 500000) {
    alerts.push({
      level: 'info',
      message: `今日推算总点击数: ${projectedDaily}, 已接近高负载`,
      timestamp: new Date().toISOString(),
    })
  }

  return {
    activeTaskCount,
    totalClicks: todayClicks,
    projectedDaily,
  }
}

async function getPerformanceMetrics(
  db: DatabaseAdapter,
  _alerts: ClickFarmHealth['alerts']
): Promise<ClickFarmHealth['performanceMetrics']> {
  const dbStart = Date.now()
  await db.queryOne<any>(`SELECT 1`)
  const dbQueryTime = Date.now() - dbStart

  const lastHour = datetimeMinusHours(1)

  const cronLogs = await db.queryOne<any>(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000) as avgTime
    FROM cron_execution_logs
    WHERE name = 'click-farm-scheduler'
      AND end_time >= ${lastHour}
  `)

  const cronExecutionTime = Math.round(cronLogs?.avgTime || 0)

  const clickLatency = await db.queryOne<any>(`
    SELECT
      ${AVG_LATENCY_MS_SQL} as avgLatency
    FROM click_farm_queue
    WHERE completed_at >= ${lastHour}
  `)

  const avgClickLatency = Math.round(clickLatency?.avgLatency || 0)

  return {
    cronExecutionTime,
    avgClickLatency,
    dbQueryTime,
  }
}

/**
 * 获取历史监控数据（用于仪表板展示）
 */
export async function getClickFarmMetricsHistory(hours: number = 24) {
  const db = await getDatabase()

  const metrics = await db.query<any>(
    `
    SELECT
      date_trunc('hour', created_at) as hour,
      COUNT(*) as totalClicks,
      SUM(CASE WHEN success THEN 1 ELSE 0 END) as successClicks,
      ${AVG_LATENCY_MS_SQL} as avgLatency
    FROM click_farm_queue
    WHERE created_at >= CURRENT_TIMESTAMP - (? * INTERVAL '1 hour')
    GROUP BY date_trunc('hour', created_at)
    ORDER BY hour DESC
  `,
    [hours]
  )

  return metrics
}
