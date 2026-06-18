/**
 * URL Swap 监控告警系统
 * src/lib/url-swap/alerts/monitoring.ts
 *
 * 功能：监控换链接任务的健康状态
 * - 全局健康度评估
 * - 异常任务检测
 * - 性能指标统计
 * - 自动告警触发
 */

import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/db'
import type { UrlSwapTask } from '@/lib/url-swap/url-swap-types'
import { pauseUrlSwapTargetsByTaskId } from '@/lib/url-swap/url-swap-targets'
import { removePendingUrlSwapQueueTasksByTaskIds } from '@/lib/url-swap/queue-cleanup'
import { notifySwapError, notifyUrlSwapTaskPaused } from './notifications'

export type HealthLevel = 'healthy' | 'warning' | 'critical'

export interface UrlSwapHealthStatus {
  overall: HealthLevel
  timestamp: string

  stats: {
    total: number
    enabled: number
    disabled: number
    error: number
    completed: number
  }

  performance: {
    totalSwaps: number
    successSwaps: number
    failedSwaps: number
    successRate: number
    averageSwapInterval: number
  }

  issues: {
    highFailureRate: UrlSwapTask[]
    stuckTasks: UrlSwapTask[]
    errorTasks: UrlSwapTask[]
    domainChanges: UrlSwapTask[]
  }

  alerts: {
    level: 'info' | 'warning' | 'error'
    message: string
    taskId?: string
    timestamp: string
  }[]
}

function calculateFailureRate(task: UrlSwapTask): number {
  if (task.total_swaps === 0) return 0
  return (task.failed_swaps / task.total_swaps) * 100
}

function isTaskStuck(task: UrlSwapTask): boolean {
  if (task.status !== 'enabled') return false
  if (!task.next_swap_at) return false

  const now = new Date()
  const nextSwapTime = new Date(task.next_swap_at)
  const expectedInterval = task.swap_interval_minutes * 60 * 1000

  const overdueMs = now.getTime() - nextSwapTime.getTime()
  return overdueMs > expectedInterval * 2
}

function hasDomainChange(task: UrlSwapTask): boolean {
  if (!task.swap_history || task.swap_history.length === 0) return false

  const latestSwap = task.swap_history[task.swap_history.length - 1]
  if (!latestSwap.success) return false
  if (!latestSwap.previous_final_url || !latestSwap.new_final_url) return false

  try {
    const oldDomain = new URL(latestSwap.previous_final_url).hostname
    const newDomain = new URL(latestSwap.new_final_url).hostname
    return oldDomain !== newDomain
  } catch {
    return false
  }
}

export async function getUrlSwapHealth(): Promise<UrlSwapHealthStatus> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const isDeletedCondition = 'is_deleted = FALSE'

  const tasks = await db.query<any>(`
    SELECT * FROM url_swap_tasks
    WHERE ${isDeletedCondition}
  `)

  const parsedTasks: UrlSwapTask[] = tasks.map((row) => ({
    ...row,
    enabled: Boolean(row.enabled),
    is_deleted: Boolean(row.is_deleted),
    swap_history: parseJsonField(row.swap_history, []),
  }))

  const stats = {
    total: parsedTasks.length,
    enabled: parsedTasks.filter((t) => t.status === 'enabled').length,
    disabled: parsedTasks.filter((t) => t.status === 'disabled').length,
    error: parsedTasks.filter((t) => t.status === 'error').length,
    completed: parsedTasks.filter((t) => t.status === 'completed').length,
  }

  const totalSwaps = parsedTasks.reduce((sum, t) => sum + t.total_swaps, 0)
  const successSwaps = parsedTasks.reduce((sum, t) => sum + t.success_swaps, 0)
  const failedSwaps = parsedTasks.reduce((sum, t) => sum + t.failed_swaps, 0)
  const successRate = totalSwaps > 0 ? (successSwaps / totalSwaps) * 100 : 100

  const activeTasksWithInterval = parsedTasks.filter(
    (t) => t.status === 'enabled' && t.swap_interval_minutes > 0
  )
  const averageSwapInterval =
    activeTasksWithInterval.length > 0
      ? activeTasksWithInterval.reduce((sum, t) => sum + t.swap_interval_minutes, 0) /
        activeTasksWithInterval.length
      : 60

  const performance = {
    totalSwaps,
    successSwaps,
    failedSwaps,
    successRate: Math.round(successRate * 100) / 100,
    averageSwapInterval: Math.round(averageSwapInterval),
  }

  const issues = {
    highFailureRate: parsedTasks.filter((t) => calculateFailureRate(t) > 50 && t.total_swaps >= 3),
    stuckTasks: parsedTasks.filter((t) => isTaskStuck(t)),
    errorTasks: parsedTasks.filter((t) => t.status === 'error'),
    domainChanges: parsedTasks.filter((t) => hasDomainChange(t)),
  }

  const alerts: UrlSwapHealthStatus['alerts'] = []

  for (const task of issues.highFailureRate) {
    const failureRate = calculateFailureRate(task)
    alerts.push({
      level: 'error',
      message: `任务 ${task.id.substring(0, 8)}... 失败率过高 (${failureRate.toFixed(1)}%)`,
      taskId: task.id,
      timestamp: now,
    })

    try {
      await notifySwapError(task.id, `任务失败率过高 (${failureRate.toFixed(1)}%)，请检查配置`)
    } catch (notifyError) {
      console.error(`Failed to send notification:`, notifyError)
    }
  }

  for (const task of issues.stuckTasks) {
    alerts.push({
      level: 'warning',
      message: `任务 ${task.id.substring(0, 8)}... 可能卡住，超过预期时间未执行`,
      taskId: task.id,
      timestamp: now,
    })
  }

  for (const task of issues.errorTasks) {
    alerts.push({
      level: 'error',
      message: `任务 ${task.id.substring(0, 8)}... 处于错误状态: ${task.error_message || '未知错误'}`,
      taskId: task.id,
      timestamp: now,
    })
  }

  for (const task of issues.domainChanges) {
    alerts.push({
      level: 'warning',
      message: `任务 ${task.id.substring(0, 8)}... 检测到域名变化，可能存在盗链风险`,
      taskId: task.id,
      timestamp: now,
    })
  }

  let overall: HealthLevel = 'healthy'

  if (issues.errorTasks.length > 0 || issues.highFailureRate.length > 0) {
    overall = 'critical'
  } else if (
    performance.successRate < 90 ||
    issues.stuckTasks.length > 0 ||
    issues.domainChanges.length > 0
  ) {
    overall = 'warning'
  }

  return {
    overall,
    timestamp: now,
    stats,
    performance,
    issues,
    alerts,
  }
}

async function autoFixStuckTask(taskId: string): Promise<boolean> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  try {
    const task = await db.queryOne<any>(
      `
      SELECT * FROM url_swap_tasks WHERE id = ?
    `,
      [taskId]
    )

    if (!task) return false
    if (task.status !== 'enabled') return false

    await db.exec(
      `
      UPDATE url_swap_tasks
      SET next_swap_at = ?,
          error_message = NULL,
          error_at = NULL,
          updated_at = ?
      WHERE id = ?
    `,
      [now, now, taskId]
    )

    console.log(`✅ 已自动修复卡住的任务: ${taskId}`)
    return true
  } catch (error: any) {
    console.error(`❌ 自动修复失败: ${taskId}`, error.message)
    return false
  }
}

async function autoDisableHighFailureTask(taskId: string): Promise<boolean> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  try {
    const task = await db.queryOne<any>(
      `
      SELECT * FROM url_swap_tasks WHERE id = ?
    `,
      [taskId]
    )

    if (!task) return false

    const failureRate = task.total_swaps > 0 ? (task.failed_swaps / task.total_swaps) * 100 : 0

    await db.exec(
      `
      UPDATE url_swap_tasks
      SET status = 'disabled',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `,
      [`任务失败率过高 (${failureRate.toFixed(1)}%)，已自动禁用`, now, taskId]
    )

    await pauseUrlSwapTargetsByTaskId(taskId)

    try {
      const userId = Number(task.user_id)
      await removePendingUrlSwapQueueTasksByTaskIds(
        [taskId],
        Number.isFinite(userId) && userId > 0 ? userId : undefined
      )
    } catch (error) {
      console.warn(`[url-swap] 自动禁用后清理队列失败: ${taskId}`, error)
    }

    await notifyUrlSwapTaskPaused(
      taskId,
      `失败率过高 (${failureRate.toFixed(1)}%)，系统已自动禁用任务`
    )

    console.log(`✅ 已自动禁用高失败率任务: ${taskId}`)
    return true
  } catch (error: any) {
    console.error(`❌ 自动禁用失败: ${taskId}`, error.message)
    return false
  }
}

export async function performHealthCheckAndAutoFix(): Promise<{
  health: UrlSwapHealthStatus
  fixed: {
    stuckTasks: number
    disabledTasks: number
  }
}> {
  const health = await getUrlSwapHealth()
  let stuckFixed = 0
  let disabledCount = 0

  for (const task of health.issues.stuckTasks) {
    const success = await autoFixStuckTask(task.id)
    if (success) stuckFixed++
  }

  for (const task of health.issues.highFailureRate) {
    const failureRate = calculateFailureRate(task)
    if (failureRate > 80 && task.total_swaps >= 5) {
      const success = await autoDisableHighFailureTask(task.id)
      if (success) disabledCount++
    }
  }

  console.log(`🏥 健康检查完成:`)
  console.log(`   - 整体状态: ${health.overall}`)
  console.log(`   - 修复卡住任务: ${stuckFixed}`)
  console.log(`   - 自动禁用任务: ${disabledCount}`)
  console.log(`   - 告警数量: ${health.alerts.length}`)

  return {
    health,
    fixed: {
      stuckTasks: stuckFixed,
      disabledTasks: disabledCount,
    },
  }
}
