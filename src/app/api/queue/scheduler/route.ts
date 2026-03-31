/**
 * 调度器健康检查 API
 * GET /api/queue/scheduler - 检查调度器健康状态（通过任务执行情况判断）
 * POST /api/queue/scheduler - 手动触发调度器检查
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { triggerAllUrlSwapTasks } from '@/lib/url-swap-scheduler'
import { getDatabase } from '@/lib/db'
import { getQueueManager, getBackgroundQueueManager, isBackgroundQueueSplitEnabled } from '@/lib/queue'

/**
 * GET - 获取调度器健康状态
 *
 * 注意：调度器运行在独立的 scheduler 进程中，无法直接检查运行状态
 * 因此通过检查任务执行情况来判断调度器是否正常工作
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const isAdmin = authResult.user.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const db = await getDatabase()

    // 检查所有调度器的健康状态
    const [
      clickFarmHealth,
      urlSwapHealth,
      dataSyncHealth,
      affiliateSyncHealth,
      zombieCleanupHealth,
      openclawStrategyHealth
    ] = await Promise.all([
      checkClickFarmSchedulerHealth(db),
      checkUrlSwapSchedulerHealth(db),
      checkDataSyncSchedulerHealth(db),
      checkAffiliateSyncSchedulerHealth(db),
      checkZombieCleanupSchedulerHealth(db),
      checkOpenclawStrategySchedulerHealth(db),
    ])

    return NextResponse.json({
      success: true,
      data: {
        clickFarmScheduler: clickFarmHealth,
        urlSwapScheduler: urlSwapHealth,
        dataSyncScheduler: dataSyncHealth,
        affiliateSyncScheduler: affiliateSyncHealth,
        zombieCleanupScheduler: zombieCleanupHealth,
        openclawStrategyScheduler: openclawStrategyHealth,
        note: '调度器运行在独立的 scheduler 进程中，此处显示的是通过任务执行情况推断的健康状态'
      }
    })
  } catch (error: any) {
    console.error('[Scheduler API] 获取调度器状态失败:', error)
    return NextResponse.json(
      { error: error.message || '获取调度器状态失败' },
      { status: 500 }
    )
  }
}

/**
 * 检查补点击调度器健康状态
 */
async function checkClickFarmSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 获取队列统计信息
  const queueManager = await getQueueManager()
  const stats = await queueManager.getStats()

  // 检查最近入队的补点击任务数量
  const clickFarmQueued = stats.byType?.['click-farm'] || 0
  const clickFarmRunning = stats.byTypeRunning?.['click-farm'] || 0

  // 检查是否有启用的补点击任务
  const enabledTasksQuery = `
    SELECT COUNT(*) as count
    FROM click_farm_tasks
    WHERE status IN ('running', 'pending')
      AND ${db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'}
  `
  const enabledTasksResult = await db.queryOne(enabledTasksQuery) as { count: number } | undefined
  const enabledTasksCount = Number(enabledTasksResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledTasksCount === 0) {
    status = 'healthy'
    message = '没有运行中的补点击任务'
  } else if (clickFarmQueued === 0 && clickFarmRunning === 0) {
    status = 'warning'
    message = '有启用的任务但队列中没有待执行任务（可能任务未到执行时间）'
  }

  return {
    status,
    message,
    metrics: {
      enabledTasks: enabledTasksCount,
      recentQueuedTasks: clickFarmQueued,
      runningTasks: clickFarmRunning,
      lastQueuedAt: null, // 队列管理器不提供时间戳信息
      checkInterval: '每小时',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查 URL Swap 调度器健康状态
 */
async function checkUrlSwapSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  const now = new Date()

  // 获取队列统计信息
  const queueManager = await getQueueManager()
  const stats = await queueManager.getStats()

  const urlSwapQueued = stats.byType?.['url-swap'] || 0
  const urlSwapRunning = stats.byTypeRunning?.['url-swap'] || 0

  // 1. 检查逾期任务数量
  const overdueQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM url_swap_tasks
      WHERE status = 'enabled'
        AND next_swap_at <= CURRENT_TIMESTAMP
        AND started_at <= CURRENT_TIMESTAMP
        AND is_deleted = FALSE
    `
    : `
      SELECT COUNT(*) as count
      FROM url_swap_tasks
      WHERE status = 'enabled'
        AND next_swap_at <= datetime('now')
        AND started_at <= datetime('now')
        AND is_deleted = 0
    `

  const overdueResult = await db.queryOne(overdueQuery) as { count: number } | undefined
  const overdueCount = Number(overdueResult?.count || 0)

  // 2. 检查是否有启用的任务
  const enabledTasksQuery = `
    SELECT COUNT(*) as count
    FROM url_swap_tasks
    WHERE status = 'enabled'
      AND ${db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'}
  `
  const enabledTasksResult = await db.queryOne(enabledTasksQuery) as { count: number } | undefined
  const enabledTasksCount = Number(enabledTasksResult?.count || 0)

  // 判断健康状态
  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledTasksCount === 0) {
    status = 'healthy'
    message = '没有启用的换链接任务'
  } else if (overdueCount > 0) {
    if (overdueCount >= 10) {
      status = 'error'
      message = `有 ${overdueCount} 个任务逾期未执行，调度器可能未运行`
    } else {
      status = 'warning'
      message = `有 ${overdueCount} 个任务逾期未执行（可能刚启动或任务间隔较短）`
    }
  } else if (urlSwapQueued === 0 && urlSwapRunning === 0 && enabledTasksCount > 0) {
    status = 'warning'
    message = '队列中没有待执行任务，但可能是因为任务间隔较长'
  }

  return {
    status,
    message,
    metrics: {
      enabledTasks: enabledTasksCount,
      overdueTasks: overdueCount,
      recentQueuedTasks: urlSwapQueued,
      runningTasks: urlSwapRunning,
      lastQueuedAt: null,
      checkInterval: '每分钟',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查数据同步调度器健康状态
 */
async function checkDataSyncSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 获取队列统计信息
  const queueManager = await getQueueManager()
  const stats = await queueManager.getStats()

  const dataSyncQueued = stats.byType?.['sync'] || 0
  const dataSyncRunning = stats.byTypeRunning?.['sync'] || 0

  // 检查是否有启用自动同步的用户
  const enabledUsersQuery = `
    SELECT COUNT(DISTINCT u.id) as count
    FROM users u
    WHERE COALESCE(
      (SELECT value FROM system_settings
       WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
      'true'
    ) = 'true'
  `
  const enabledUsersResult = await db.queryOne(enabledUsersQuery) as { count: number } | undefined
  const enabledUsersCount = Number(enabledUsersResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledUsersCount === 0) {
    status = 'healthy'
    message = '没有启用自动同步的用户'
  } else if (dataSyncQueued === 0 && dataSyncRunning === 0) {
    status = 'warning'
    message = '队列中没有待执行任务（可能是因为同步间隔较长）'
  }

  return {
    status,
    message,
    metrics: {
      enabledUsers: enabledUsersCount,
      recentQueuedTasks: dataSyncQueued,
      runningTasks: dataSyncRunning,
      lastQueuedAt: null,
      checkInterval: '每小时',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查联盟商品同步调度器健康状态
 */
async function checkAffiliateSyncSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 获取队列统计信息
  const queueManager = await getQueueManager()
  const stats = await queueManager.getStats()

  const affiliateSyncQueued = stats.byType?.['affiliate-product-sync'] || 0
  const affiliateSyncRunning = stats.byTypeRunning?.['affiliate-product-sync'] || 0

  // 检查是否有启用商品管理的用户
  const enabledUsersQuery = `
    SELECT COUNT(*) as count
    FROM users
    WHERE ${db.type === 'postgres' ? 'product_management_enabled = TRUE' : 'product_management_enabled = 1'}
  `
  const enabledUsersResult = await db.queryOne(enabledUsersQuery) as { count: number } | undefined
  const enabledUsersCount = Number(enabledUsersResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledUsersCount === 0) {
    status = 'healthy'
    message = '没有启用商品管理的用户'
  } else if (affiliateSyncQueued === 0 && affiliateSyncRunning === 0) {
    status = 'warning'
    message = '队列中没有待执行任务（可能是因为同步间隔较长）'
  }

  return {
    status,
    message,
    metrics: {
      enabledUsers: enabledUsersCount,
      recentQueuedTasks: affiliateSyncQueued,
      runningTasks: affiliateSyncRunning,
      lastQueuedAt: null,
      checkInterval: '每10分钟',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查僵尸任务清理调度器健康状态
 */
async function checkZombieCleanupSchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 检查最近 2 小时内是否有僵尸任务被修复
  const recentFixedQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'failed'
        AND error_message LIKE '%僵尸任务%'
        AND updated_at >= NOW() - INTERVAL '2 hours'
    `
    : `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'failed'
        AND error_message LIKE '%僵尸任务%'
        AND updated_at >= datetime('now', '-2 hours')
    `

  const recentFixedResult = await db.queryOne(recentFixedQuery) as { count: number } | undefined
  const recentFixedCount = Number(recentFixedResult?.count || 0)

  // 检查当前是否有潜在的僵尸任务（运行超过2小时）
  const zombieQuery = db.type === 'postgres'
    ? `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '2 hours'
    `
    : `
      SELECT COUNT(*) as count
      FROM affiliate_product_sync_runs
      WHERE status = 'running'
        AND started_at < datetime('now', '-2 hours')
    `

  const zombieResult = await db.queryOne(zombieQuery) as { count: number } | undefined
  const zombieCount = Number(zombieResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (zombieCount > 0) {
    status = 'warning'
    message = `发现 ${zombieCount} 个潜在僵尸任务，等待下次清理`
  } else if (recentFixedCount > 0) {
    status = 'healthy'
    message = `最近 2 小时修复了 ${recentFixedCount} 个僵尸任务`
  } else {
    status = 'healthy'
    message = '未发现僵尸任务'
  }

  return {
    status,
    message,
    metrics: {
      potentialZombieTasks: zombieCount,
      recentFixedTasks: recentFixedCount,
      checkInterval: '每小时',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * 检查 OpenClaw 策略调度器健康状态
 */
async function checkOpenclawStrategySchedulerHealth(db: Awaited<ReturnType<typeof getDatabase>>) {
  // 获取队列统计信息
  const queueManager = await getQueueManager()
  const stats = await queueManager.getStats()

  const openclawStrategyQueued = stats.byType?.['openclaw-strategy'] || 0
  const openclawStrategyRunning = stats.byTypeRunning?.['openclaw-strategy'] || 0

  // 检查是否有启用策略中心的用户
  const enabledUsersQuery = `
    SELECT COUNT(DISTINCT u.id) as count
    FROM users u
    INNER JOIN system_settings ss ON ss.user_id = u.id
    WHERE ${db.type === 'postgres' ? 'u.strategy_center_enabled = TRUE' : 'u.strategy_center_enabled = 1'}
      AND ss.category = 'openclaw'
      AND ss.key = 'openclaw_strategy_enabled'
      AND ss.value IN ('true', '1', 'yes', 'on')
  `
  const enabledUsersResult = await db.queryOne(enabledUsersQuery) as { count: number } | undefined
  const enabledUsersCount = Number(enabledUsersResult?.count || 0)

  let status: 'healthy' | 'warning' | 'error' = 'healthy'
  let message = '调度器运行正常'

  if (enabledUsersCount === 0) {
    status = 'healthy'
    message = '没有启用策略中心的用户'
  } else if (openclawStrategyQueued === 0 && openclawStrategyRunning === 0) {
    status = 'warning'
    message = '队列中没有待执行任务（可能用户配置的执行时间未到）'
  }

  return {
    status,
    message,
    metrics: {
      enabledUsers: enabledUsersCount,
      recentQueuedTasks: openclawStrategyQueued,
      runningTasks: openclawStrategyRunning,
      lastQueuedAt: null,
      checkInterval: '按用户配置',
      schedulerProcess: 'scheduler 进程'
    }
  }
}

/**
 * POST - 手动触发调度器检查
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const isAdmin = authResult.user.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    console.log('[Scheduler API] 手动触发URL Swap调度器检查...')
    const result = await triggerAllUrlSwapTasks()

    return NextResponse.json({
      success: true,
      message: '调度器检查完成',
      data: {
        processed: result.processed,
        executed: result.executed,
        skipped: result.skipped,
        errors: result.errors
      }
    })
  } catch (error: any) {
    console.error('[Scheduler API] 手动触发调度器失败:', error)
    return NextResponse.json(
      { error: error.message || '手动触发调度器失败' },
      { status: 500 }
    )
  }
}
