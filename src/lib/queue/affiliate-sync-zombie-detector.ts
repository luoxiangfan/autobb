/**
 * 联盟商品同步僵尸任务检测和自动修复
 *
 * 问题历史：
 * - 2025-12-29: 修复sync_log僵尸任务（commit 55edc7c5）
 * - 2026-02-18: 加固PB同步状态和心跳（commit ed7f870a）
 * - 2026-03-07: 添加状态更新日志（commit 29233db9, 75462993）
 * - 2026-03-07: 发现status字段在continuation时被重置为queued（本次修复）
 *
 * 本模块提供：
 * 1. 自动检测卡住的同步任务（超时、无心跳、状态异常）
 * 2. 自动修复僵尸任务状态
 * 3. 定期清理和报告
 */

import { getDatabase } from '@/lib/db'

export type ZombieTaskDetectionResult = {
  zombieTasks: Array<{
    id: number
    userId: number
    platform: string
    status: string
    totalItems: number
    processedItems: number
    startedAt: string
    lastHeartbeatAt: string | null
    hoursRunning: number
    hoursSinceHeartbeat: number | null
    reason: string
  }>
  fixedCount: number
  errors: string[]
}

const MAX_RUNNING_HOURS = 48 // 超过48小时视为异常
const MAX_HEARTBEAT_GAP_HOURS = 0.5 // 心跳超过30分钟未更新视为异常（YP登录态失效通常立即体现）

/**
 * 检测并修复僵尸同步任务
 */
export async function detectAndFixZombieSyncTasks(options: {
  autoFix?: boolean
  dryRun?: boolean
} = {}): Promise<ZombieTaskDetectionResult> {
  const { autoFix = false, dryRun = false } = options
  const db = await getDatabase()
  const zombieTasks: ZombieTaskDetectionResult['zombieTasks'] = []
  const errors: string[] = []
  let fixedCount = 0

  try {
    // 查找可疑的同步任务
    const suspiciousTasks = await db.query<{
      id: number
      user_id: number
      platform: string
      status: string
      total_items: number
      created_count: number
      updated_count: number
      started_at: string
      last_heartbeat_at: string | null
      hours_running: number
      hours_since_heartbeat: number | null
    }>(
      `
        SELECT
          id,
          user_id,
          platform,
          status,
          total_items,
          created_count,
          updated_count,
          started_at,
          last_heartbeat_at,
          EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600 as hours_running,
          CASE
            WHEN last_heartbeat_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) / 3600
            ELSE NULL
          END as hours_since_heartbeat
        FROM affiliate_product_sync_runs
        WHERE status IN ('queued', 'running')
          AND started_at IS NOT NULL
          AND completed_at IS NULL
          AND (
            -- 条件1: 运行超过48小时
            started_at < NOW() - INTERVAL '${MAX_RUNNING_HOURS} hours'
            OR
            -- 条件2: 心跳超过2小时未更新
            (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - INTERVAL '${MAX_HEARTBEAT_GAP_HOURS} hours')
            OR
            -- 条件3: 已开始但状态仍为queued（状态机错误）
            (status = 'queued' AND started_at IS NOT NULL)
          )
        ORDER BY started_at ASC
      `,
      []
    )

    for (const task of suspiciousTasks) {
      const processedItems = task.created_count + task.updated_count
      const completionRate = task.total_items > 0
        ? (processedItems / task.total_items * 100).toFixed(2)
        : '0.00'

      // 判断僵尸原因
      let reason = ''
      let shouldMarkAsCompleted = false
      let shouldMarkAsFailed = false

      if (task.status === 'queued' && task.started_at) {
        reason = `状态机错误：已开始运行但状态仍为queued（运行${task.hours_running.toFixed(1)}小时）`
        // 如果已处理超过95%，标记为完成；否则标记为失败
        shouldMarkAsCompleted = processedItems > 0 && (processedItems / Math.max(task.total_items, 1)) >= 0.95
        shouldMarkAsFailed = !shouldMarkAsCompleted
      } else if (task.hours_running > MAX_RUNNING_HOURS) {
        reason = `运行超时：已运行${task.hours_running.toFixed(1)}小时（完成度${completionRate}%）`
        shouldMarkAsCompleted = processedItems > 0 && (processedItems / Math.max(task.total_items, 1)) >= 0.95
        shouldMarkAsFailed = !shouldMarkAsCompleted
      } else if (task.hours_since_heartbeat && task.hours_since_heartbeat > MAX_HEARTBEAT_GAP_HOURS) {
        reason = `心跳超时：最后心跳距今${task.hours_since_heartbeat.toFixed(1)}小时（完成度${completionRate}%）`
        // YP平台心跳超时很可能是登录态失效导致
        if (task.platform === 'yeahpromos') {
          reason += ' - 可能是YP登录态失效，请重新采集登录态后再试'
        }
        shouldMarkAsFailed = true
      }

      zombieTasks.push({
        id: task.id,
        userId: task.user_id,
        platform: task.platform,
        status: task.status,
        totalItems: task.total_items,
        processedItems,
        startedAt: task.started_at,
        lastHeartbeatAt: task.last_heartbeat_at,
        hoursRunning: task.hours_running,
        hoursSinceHeartbeat: task.hours_since_heartbeat,
        reason,
      })

      // 自动修复
      if (autoFix && !dryRun) {
        try {
          if (shouldMarkAsCompleted) {
            await db.exec(
              `
                UPDATE affiliate_product_sync_runs
                SET
                  status = 'completed',
                  completed_at = NOW(),
                  updated_at = NOW(),
                  error_message = COALESCE(error_message, '') || ' [自动修复: ' || ? || ']'
                WHERE id = ?
              `,
              [reason, task.id]
            )
            console.log(`[zombie-detector] 已修复任务 #${task.id} 为 completed: ${reason}`)
            fixedCount++
          } else if (shouldMarkAsFailed) {
            await db.exec(
              `
                UPDATE affiliate_product_sync_runs
                SET
                  status = 'failed',
                  completed_at = NOW(),
                  updated_at = NOW(),
                  error_message = ?
                WHERE id = ?
              `,
              [`[自动修复] ${reason}`, task.id]
            )
            console.log(`[zombie-detector] 已修复任务 #${task.id} 为 failed: ${reason}`)
            fixedCount++
          }
        } catch (error: any) {
          const errorMsg = `修复任务 #${task.id} 失败: ${error?.message || error}`
          console.error(`[zombie-detector] ${errorMsg}`)
          errors.push(errorMsg)
        }
      }
    }

    if (zombieTasks.length > 0) {
      console.warn(
        `[zombie-detector] 发现 ${zombieTasks.length} 个僵尸同步任务`,
        autoFix ? `，已修复 ${fixedCount} 个` : '（未启用自动修复）'
      )
    }

    return {
      zombieTasks,
      fixedCount,
      errors,
    }
  } catch (error: any) {
    console.error('[zombie-detector] 检测失败:', error)
    errors.push(`检测失败: ${error?.message || error}`)
    return {
      zombieTasks,
      fixedCount,
      errors,
    }
  }
}

/**
 * 获取僵尸任务统计
 */
export async function getZombieTaskStats(): Promise<{
  totalZombies: number
  byStatus: Record<string, number>
  byPlatform: Record<string, number>
  oldestZombieHours: number | null
}> {
  const db = await getDatabase()

  const stats = await db.query<{
    status: string
    platform: string
    count: number
    oldest_hours: number | null
  }>(
    `
      SELECT
        status,
        platform,
        COUNT(*) as count,
        MAX(EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600) as oldest_hours
      FROM affiliate_product_sync_runs
      WHERE status IN ('queued', 'running')
        AND started_at IS NOT NULL
        AND completed_at IS NULL
        AND (
          started_at < NOW() - INTERVAL '${MAX_RUNNING_HOURS} hours'
          OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - INTERVAL '${MAX_HEARTBEAT_GAP_HOURS} hours')
          OR (status = 'queued' AND started_at IS NOT NULL)
        )
      GROUP BY status, platform
    `,
    []
  )

  const byStatus: Record<string, number> = {}
  const byPlatform: Record<string, number> = {}
  let totalZombies = 0
  let oldestZombieHours: number | null = null

  for (const row of stats) {
    const count = Number(row.count)
    totalZombies += count
    byStatus[row.status] = (byStatus[row.status] || 0) + count
    byPlatform[row.platform] = (byPlatform[row.platform] || 0) + count

    if (row.oldest_hours !== null) {
      oldestZombieHours = oldestZombieHours === null
        ? row.oldest_hours
        : Math.max(oldestZombieHours, row.oldest_hours)
    }
  }

  return {
    totalZombies,
    byStatus,
    byPlatform,
    oldestZombieHours,
  }
}
