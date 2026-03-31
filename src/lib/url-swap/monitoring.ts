/**
 * URL Swap 监控告警系统
 * src/lib/url-swap/monitoring.ts
 *
 * 功能：监控换链接任务的健康状态
 * - 全局健康度评估
 * - 异常任务检测
 * - 性能指标统计
 * - 自动告警触发
 *
 * 🆕 新增(2025-01-03): 实时监控和健康检查
 */

import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/json-field'
import type { UrlSwapTask, UrlSwapTaskStatus } from '@/lib/url-swap-types'
import { pauseUrlSwapTargetsByTaskId } from '@/lib/url-swap'
import { notifySwapError, notifyUrlSwapTaskPaused } from './notifications'

/**
 * 健康状态级别
 */
export type HealthLevel = 'healthy' | 'warning' | 'critical'

/**
 * 健康检查结果
 */
export interface UrlSwapHealthStatus {
  // 整体状态
  overall: HealthLevel
  timestamp: string

  // 任务统计
  stats: {
    total: number
    enabled: number
    disabled: number
    error: number
    completed: number
  }

  // 性能指标
  performance: {
    totalSwaps: number
    successSwaps: number
    failedSwaps: number
    successRate: number           // 成功率 (%)
    averageSwapInterval: number   // 平均换链间隔 (分钟)
  }

  // 异常任务
  issues: {
    highFailureRate: UrlSwapTask[]        // 高失败率任务（> 50%）
    stuckTasks: UrlSwapTask[]             // 卡住的任务（很久没有执行）
    errorTasks: UrlSwapTask[]             // 错误状态的任务
    domainChanges: UrlSwapTask[]          // 检测到域名变化的任务
  }

  // 告警信息
  alerts: {
    level: 'info' | 'warning' | 'error'
    message: string
    taskId?: string
    timestamp: string
  }[]
}

/**
 * 计算任务的失败率
 */
function calculateFailureRate(task: UrlSwapTask): number {
  if (task.total_swaps === 0) return 0
  return (task.failed_swaps / task.total_swaps) * 100
}

/**
 * 检查任务是否"卡住"（很久没有执行）
 *
 * 定义：如果任务状态为 enabled，但 next_swap_at 超过预期时间 2 倍以上
 */
function isTaskStuck(task: UrlSwapTask): boolean {
  if (task.status !== 'enabled') return false
  if (!task.next_swap_at) return false

  const now = new Date()
  const nextSwapTime = new Date(task.next_swap_at)
  const expectedInterval = task.swap_interval_minutes * 60 * 1000  // 转换为毫秒

  // 如果 next_swap_at 已经过期超过 2 倍间隔时间，认为任务卡住了
  const overdueMs = now.getTime() - nextSwapTime.getTime()
  return overdueMs > (expectedInterval * 2)
}

/**
 * 检测域名变化（从历史记录中）
 *
 * 如果最近一次换链导致域名发生变化，标记为异常
 */
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

/**
 * 获取URL Swap系统的健康状态
 *
 * 使用场景：
 * - 管理员监控页面
 * - 定时健康检查任务
 * - API监控端点 /api/admin/url-swap/health
 *
 * @returns 系统健康状态对象
 *
 * @example
 * const health = await getUrlSwapHealth()
 * if (health.overall === 'critical') {
 *   console.error('URL Swap系统存在严重问题！')
 * }
 */
export async function getUrlSwapHealth(): Promise<UrlSwapHealthStatus> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  // 1. 查询所有未删除的任务
  const tasks = await db.query<any>(`
    SELECT * FROM url_swap_tasks
    WHERE ${isDeletedCondition}
  `)

  // 解析任务（包括 swap_history 字段）
  const parsedTasks: UrlSwapTask[] = tasks.map(row => ({
    ...row,
    enabled: Boolean(row.enabled),
    is_deleted: Boolean(row.is_deleted),
    swap_history: parseJsonField(row.swap_history, [])
  }))

  // 2. 统计基本信息
  const stats = {
    total: parsedTasks.length,
    enabled: parsedTasks.filter(t => t.status === 'enabled').length,
    disabled: parsedTasks.filter(t => t.status === 'disabled').length,
    error: parsedTasks.filter(t => t.status === 'error').length,
    completed: parsedTasks.filter(t => t.status === 'completed').length,
  }

  // 3. 计算性能指标
  const totalSwaps = parsedTasks.reduce((sum, t) => sum + t.total_swaps, 0)
  const successSwaps = parsedTasks.reduce((sum, t) => sum + t.success_swaps, 0)
  const failedSwaps = parsedTasks.reduce((sum, t) => sum + t.failed_swaps, 0)
  const successRate = totalSwaps > 0 ? (successSwaps / totalSwaps) * 100 : 100

  // 计算平均换链间隔
  const activeTasksWithInterval = parsedTasks.filter(t => t.status === 'enabled' && t.swap_interval_minutes > 0)
  const averageSwapInterval = activeTasksWithInterval.length > 0
    ? activeTasksWithInterval.reduce((sum, t) => sum + t.swap_interval_minutes, 0) / activeTasksWithInterval.length
    : 60

  const performance = {
    totalSwaps,
    successSwaps,
    failedSwaps,
    successRate: Math.round(successRate * 100) / 100,
    averageSwapInterval: Math.round(averageSwapInterval)
  }

  // 4. 检测异常任务
  const issues = {
    highFailureRate: parsedTasks.filter(t => calculateFailureRate(t) > 50 && t.total_swaps >= 3),
    stuckTasks: parsedTasks.filter(t => isTaskStuck(t)),
    errorTasks: parsedTasks.filter(t => t.status === 'error'),
    domainChanges: parsedTasks.filter(t => hasDomainChange(t)),
  }

  // 5. 生成告警
  const alerts: UrlSwapHealthStatus['alerts'] = []

  // 高失败率告警
  for (const task of issues.highFailureRate) {
    const failureRate = calculateFailureRate(task)
    alerts.push({
      level: 'error',
      message: `任务 ${task.id.substring(0, 8)}... 失败率过高 (${failureRate.toFixed(1)}%)`,
      taskId: task.id,
      timestamp: now
    })

    // 触发通知（可选：避免频繁通知，可以加上冷却期）
    try {
      await notifySwapError(
        task.id,
        `任务失败率过高 (${failureRate.toFixed(1)}%)，请检查配置`
      )
    } catch (notifyError) {
      console.error(`Failed to send notification:`, notifyError)
    }
  }

  // 卡住任务告警
  for (const task of issues.stuckTasks) {
    alerts.push({
      level: 'warning',
      message: `任务 ${task.id.substring(0, 8)}... 可能卡住，超过预期时间未执行`,
      taskId: task.id,
      timestamp: now
    })
  }

  // 错误任务告警
  for (const task of issues.errorTasks) {
    alerts.push({
      level: 'error',
      message: `任务 ${task.id.substring(0, 8)}... 处于错误状态: ${task.error_message || '未知错误'}`,
      taskId: task.id,
      timestamp: now
    })
  }

  // 域名变化告警
  for (const task of issues.domainChanges) {
    alerts.push({
      level: 'warning',
      message: `任务 ${task.id.substring(0, 8)}... 检测到域名变化，可能存在盗链风险`,
      taskId: task.id,
      timestamp: now
    })
  }

  // 6. 评估整体健康度
  let overall: HealthLevel = 'healthy'

  // 临界条件：存在错误任务或高失败率任务
  if (issues.errorTasks.length > 0 || issues.highFailureRate.length > 0) {
    overall = 'critical'
  }
  // 警告条件：成功率低于90%，或存在卡住的任务
  else if (performance.successRate < 90 || issues.stuckTasks.length > 0 || issues.domainChanges.length > 0) {
    overall = 'warning'
  }

  // 7. 返回健康状态
  return {
    overall,
    timestamp: now,
    stats,
    performance,
    issues,
    alerts
  }
}

/**
 * 自动修复卡住的任务
 *
 * 策略：
 * - 重置 next_swap_at 为当前时间
 * - 清除错误信息
 * - 保持 enabled 状态
 *
 * @param taskId 任务ID
 * @returns 是否成功修复
 */
export async function autoFixStuckTask(taskId: string): Promise<boolean> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  try {
    const task = await db.queryOne<any>(`
      SELECT * FROM url_swap_tasks WHERE id = ?
    `, [taskId])

    if (!task) return false
    if (task.status !== 'enabled') return false

    // 重置为立即执行
    await db.exec(`
      UPDATE url_swap_tasks
      SET next_swap_at = ?,
          error_message = NULL,
          error_at = NULL,
          updated_at = ?
      WHERE id = ?
    `, [now, now, taskId])

    console.log(`✅ 已自动修复卡住的任务: ${taskId}`)
    return true
  } catch (error: any) {
    console.error(`❌ 自动修复失败: ${taskId}`, error.message)
    return false
  }
}

/**
 * 自动禁用高失败率任务
 *
 * 策略：
 * - 将状态改为 disabled
 * - 发送通知给用户
 * - 记录原因
 *
 * @param taskId 任务ID
 * @returns 是否成功禁用
 */
export async function autoDisableHighFailureTask(taskId: string): Promise<boolean> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  try {
    const task = await db.queryOne<any>(`
      SELECT * FROM url_swap_tasks WHERE id = ?
    `, [taskId])

    if (!task) return false

    const failureRate = task.total_swaps > 0
      ? (task.failed_swaps / task.total_swaps) * 100
      : 0

    await db.exec(`
      UPDATE url_swap_tasks
      SET status = 'disabled',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `, [`任务失败率过高 (${failureRate.toFixed(1)}%)，已自动禁用`, now, taskId])

    await pauseUrlSwapTargetsByTaskId(taskId)

    // 发送通知
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

/**
 * 执行定期健康检查并自动修复
 *
 * 推荐使用场景：
 * - Cron任务（每小时执行一次）
 * - 手动触发（管理员操作）
 *
 * @returns 健康检查结果和修复统计
 */
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

  // 1. 修复卡住的任务
  for (const task of health.issues.stuckTasks) {
    const success = await autoFixStuckTask(task.id)
    if (success) stuckFixed++
  }

  // 2. 禁用高失败率任务（可选，谨慎使用）
  // 如果失败率 > 80% 且执行次数 >= 5，自动禁用
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
      disabledTasks: disabledCount
    }
  }
}
