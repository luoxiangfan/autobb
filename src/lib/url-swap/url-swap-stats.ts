/**
 * Url-swap statistics and aggregates.
 */
import { getDatabase } from '@/lib/db'
import type { UrlSwapTaskStats, UrlSwapGlobalStats } from './url-swap-types'
import { getUrlSwapTaskById } from './url-swap-queries'

/**
 * 获取任务统计
 */
export async function getUrlSwapTaskStats(
  taskId: string,
  userId: number
): Promise<UrlSwapTaskStats> {
  const task = await getUrlSwapTaskById(taskId, userId)
  if (!task) {
    throw new Error('任务不存在')
  }

  const successRate =
    task.total_swaps > 0 ? Math.round((task.success_swaps / task.total_swaps) * 100) : 0

  return {
    swap_count: task.total_swaps,
    success_count: task.success_swaps,
    failed_count: task.failed_swaps,
    success_rate: successRate,
    last_swap_at:
      task.swap_history.length > 0
        ? task.swap_history[task.swap_history.length - 1].swapped_at
        : null,
    next_swap_at: task.next_swap_at,
    current_final_url: task.current_final_url || '',
    current_final_url_suffix: task.current_final_url_suffix || '',
    status: task.status,
  }
}

/**
 * 获取当前用户的统计
 */
export async function getUrlSwapUserStats(userId: number): Promise<UrlSwapGlobalStats> {
  const db = await getDatabase()

  const stats = await db.queryOne<any>(
    `
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled_tasks,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      COALESCE(SUM(total_swaps), 0) as total_swaps,
      COALESCE(SUM(success_swaps), 0) as success_swaps,
      COALESCE(SUM(failed_swaps), 0) as failed_swaps,
      COALESCE(SUM(url_changed_count), 0) as url_changed_count
    FROM url_swap_tasks
    WHERE user_id = ? AND is_deleted = false
  `,
    [userId]
  )

  const successRate =
    stats.total_swaps > 0 ? Math.round((stats.success_swaps / stats.total_swaps) * 100) : 0

  return {
    total_tasks: stats.total_tasks || 0,
    active_tasks: stats.active_tasks || 0,
    disabled_tasks: stats.disabled_tasks || 0,
    error_tasks: stats.error_tasks || 0,
    completed_tasks: stats.completed_tasks || 0,
    total_swaps: stats.total_swaps || 0,
    success_swaps: stats.success_swaps || 0,
    failed_swaps: stats.failed_swaps || 0,
    url_changed_count: stats.url_changed_count || 0,
    success_rate: successRate,
  }
}

/**
 * 获取全局统计（管理员）
 */
export async function getUrlSwapGlobalStats(): Promise<UrlSwapGlobalStats> {
  const db = await getDatabase()

  const stats = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled_tasks,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      COALESCE(SUM(total_swaps), 0) as total_swaps,
      COALESCE(SUM(success_swaps), 0) as success_swaps,
      COALESCE(SUM(failed_swaps), 0) as failed_swaps,
      COALESCE(SUM(url_changed_count), 0) as url_changed_count
    FROM url_swap_tasks
    WHERE is_deleted = false
  `)

  const successRate =
    stats.total_swaps > 0 ? Math.round((stats.success_swaps / stats.total_swaps) * 100) : 0

  return {
    total_tasks: stats.total_tasks || 0,
    active_tasks: stats.active_tasks || 0,
    disabled_tasks: stats.disabled_tasks || 0,
    error_tasks: stats.error_tasks || 0,
    completed_tasks: stats.completed_tasks || 0,
    total_swaps: stats.total_swaps || 0,
    success_swaps: stats.success_swaps || 0,
    failed_swaps: stats.failed_swaps || 0,
    url_changed_count: stats.url_changed_count || 0,
    success_rate: successRate,
  }
}
