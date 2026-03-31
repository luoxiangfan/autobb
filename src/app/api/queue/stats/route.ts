/**
 * 统一队列统计API
 * GET /api/queue/stats
 *
 * 返回统一队列管理器的实时统计信息
 * 支持Redis + 内存回退架构
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getBackgroundQueueManager, getQueueManager, isBackgroundQueueSplitEnabled } from '@/lib/queue'
import { isBackgroundTaskType } from '@/lib/queue/task-category'

type QueueStats = Awaited<ReturnType<ReturnType<typeof getQueueManager>['getStats']>>
type PendingEligibilityStats = NonNullable<Awaited<ReturnType<ReturnType<typeof getQueueManager>['getPendingEligibilityStats']>>>

function mergeQueueStats(a: QueueStats, b: QueueStats): QueueStats {
  const byType: Record<string, number> = { ...(a.byType || {}) }
  for (const [type, count] of Object.entries(b.byType || {})) {
    byType[type] = (byType[type] || 0) + (count || 0)
  }

  const byTypeRunning: Record<string, number> = { ...(a.byTypeRunning || {}) }
  for (const [type, count] of Object.entries(b.byTypeRunning || {})) {
    byTypeRunning[type] = (byTypeRunning[type] || 0) + (count || 0)
  }

  const byUser: QueueStats['byUser'] = { ...(a.byUser || {}) }
  for (const [userId, stats] of Object.entries(b.byUser || {})) {
    const uid = Number(userId)
    const current = byUser[uid] || {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      coreCompleted: 0,
      backgroundCompleted: 0,
      coreFailed: 0,
      backgroundFailed: 0,
    }

    byUser[uid] = {
      pending: (current.pending || 0) + (stats.pending || 0),
      running: (current.running || 0) + (stats.running || 0),
      completed: (current.completed || 0) + (stats.completed || 0),
      failed: (current.failed || 0) + (stats.failed || 0),
      coreCompleted: (current.coreCompleted || 0) + (stats.coreCompleted || 0),
      backgroundCompleted: (current.backgroundCompleted || 0) + (stats.backgroundCompleted || 0),
      coreFailed: (current.coreFailed || 0) + (stats.coreFailed || 0),
      backgroundFailed: (current.backgroundFailed || 0) + (stats.backgroundFailed || 0),
    }
  }

  return {
    total: (a.total || 0) + (b.total || 0),
    pending: (a.pending || 0) + (b.pending || 0),
    running: (a.running || 0) + (b.running || 0),
    completed: (a.completed || 0) + (b.completed || 0),
    failed: (a.failed || 0) + (b.failed || 0),
    byType: byType as any,
    byTypeRunning: byTypeRunning as any,
    byUser,
  }
}

function mergePendingEligibilityStats(
  a: PendingEligibilityStats | null,
  b: PendingEligibilityStats | null
): PendingEligibilityStats | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a

  const nextEligibleAt =
    a.nextEligibleAt === undefined
      ? b.nextEligibleAt
      : b.nextEligibleAt === undefined
        ? a.nextEligibleAt
        : Math.min(a.nextEligibleAt, b.nextEligibleAt)

  return {
    pendingTotal: (a.pendingTotal || 0) + (b.pendingTotal || 0),
    eligiblePending: (a.eligiblePending || 0) + (b.eligiblePending || 0),
    delayedPending: (a.delayedPending || 0) + (b.delayedPending || 0),
    nextEligibleAt,
  }
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const isAdmin = authResult.user.role === 'admin'

    // 获取统一队列管理器
    const coreQueueManager = getQueueManager()
    const proxyStats = coreQueueManager.getProxyStats()

    const backgroundSplitEnabled = isBackgroundQueueSplitEnabled()
    const backgroundQueueManager = backgroundSplitEnabled ? getBackgroundQueueManager() : null

    const [coreStats, corePendingEligibility] = await Promise.all([
      coreQueueManager.getStats(),
      coreQueueManager.getPendingEligibilityStats()
    ])

    const [backgroundStats, backgroundPendingEligibility] = backgroundQueueManager
      ? await (async () => {
        await backgroundQueueManager.ensureInitialized()
        const [s, p] = await Promise.all([
          backgroundQueueManager.getStats(),
          backgroundQueueManager.getPendingEligibilityStats()
        ])
        return [s, p] as const
      })()
      : [null, null]

    const stats = backgroundStats ? mergeQueueStats(coreStats, backgroundStats) : coreStats
    const pendingEligibility = backgroundPendingEligibility
      ? mergePendingEligibilityStats(corePendingEligibility, backgroundPendingEligibility)
      : corePendingEligibility

    // 如果是普通用户，只返回该用户的数据
    if (!isAdmin) {
      const userStats = stats.byUser[userId] || {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0
      }

      return NextResponse.json({
        success: true,
        data: {
          total: userStats.pending + userStats.running + userStats.completed + userStats.failed,
          pending: userStats.pending,
          running: userStats.running,
          completed: userStats.completed,
          failed: userStats.failed,
          userId,
          proxyAvailable: proxyStats.filter((p) => p.available).length,
          proxyTotal: proxyStats.length
        }
      })
    }

    const runningTasksPromise = stats.running > 0 ? (async () => {
      const [coreRunning, backgroundRunning] = await Promise.all([
        coreStats.running > 0 ? coreQueueManager.getRunningTasks() : Promise.resolve([]),
        backgroundQueueManager && backgroundStats && backgroundStats.running > 0
          ? backgroundQueueManager.getRunningTasks()
          : Promise.resolve([]),
      ])
      return [...coreRunning, ...backgroundRunning]
    })() : Promise.resolve([])

    const runningByUser: Record<
      number,
      { coreRunning: number; backgroundRunning: number; byType: Record<string, number> }
    > = {}
    let globalCoreRunning = 0
    let globalBackgroundRunning = 0

    // 🔥 获取当前配置（从队列管理器内存中读取）
    const currentConfig = coreQueueManager.getConfig()

    const userMapPromise = (async () => {
      // 🔥 获取用户信息（用于显示用户名）
      const { getDatabase } = await import('@/lib/db')
      const db = await getDatabase()

      const userIds = Object.keys(stats.byUser).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id))
      const userMap: Record<number, { username: string; email: string; packageType: string }> = {}

      if (userIds.length > 0) {
        const CHUNK_SIZE = 500
        for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
          const chunk = userIds.slice(i, i + CHUNK_SIZE)
          const placeholders = chunk.map(() => '?').join(',')
          const users = await db.query<{ id: number; username: string; email: string; package_type: string }>(
            `SELECT id, username, email, package_type FROM users WHERE id IN (${placeholders})`,
            chunk
          )
          users.forEach((user) => {
            userMap[user.id] = {
              username: user.username,
              email: user.email,
              packageType: user.package_type || 'trial',
            }
          })
        }
      }

      return userMap
    })()

    const [runningTasks, userMap] = await Promise.all([runningTasksPromise, userMapPromise])

    for (const task of runningTasks) {
      // 防御：running 索引可能因并发退回/重试等原因暂时与 tasks 状态不一致
      // 只统计真实 running 的任务，避免页面出现类似“10/4”的误导显示
      if (task.status !== 'running') continue
      if (!task.userId || task.userId <= 0) continue
      if (!runningByUser[task.userId]) {
        runningByUser[task.userId] = { coreRunning: 0, backgroundRunning: 0, byType: {} }
      }
      runningByUser[task.userId].byType[task.type] = (runningByUser[task.userId].byType[task.type] || 0) + 1

      if (isBackgroundTaskType(task.type)) {
        runningByUser[task.userId].backgroundRunning++
        globalBackgroundRunning++
      } else {
        runningByUser[task.userId].coreRunning++
        globalCoreRunning++
      }
    }

    // 管理员返回全局统计（兼容旧格式）
    return NextResponse.json({
      success: true,
      stats: {
        global: {
          running: stats.running,
          coreRunning: globalCoreRunning,
          backgroundRunning: globalBackgroundRunning,
          queued: stats.pending,
          queuedEligible: pendingEligibility?.eligiblePending,
          queuedDelayed: pendingEligibility?.delayedPending,
          nextQueuedAt: pendingEligibility?.nextEligibleAt,
          completed: stats.completed,
          failed: stats.failed
        },
        perUser: Object.entries(stats.byUser).map(([uid, userStats]) => {
          const numericUid = parseInt(uid)
          const userInfo = userMap[numericUid]
          const runningBreakdown = runningByUser[numericUid]
          return {
            userId: numericUid,
            username: userInfo?.username || `用户#${numericUid}`,
            email: userInfo?.email,
            packageType: userInfo?.packageType || 'trial',
            running: userStats.running,
            coreRunning: runningBreakdown?.coreRunning ?? 0,
            backgroundRunning: runningBreakdown?.backgroundRunning ?? 0,
            runningByType: runningBreakdown?.byType ?? {},
            queued: userStats.pending,
            completed: userStats.completed,
            failed: userStats.failed,
            coreCompleted: userStats.coreCompleted ?? 0,
            backgroundCompleted: userStats.backgroundCompleted ?? 0,
            coreFailed: userStats.coreFailed ?? 0,
            backgroundFailed: userStats.backgroundFailed ?? 0,
          }
        }),
        byType: stats.byType,
        byTypeRunning: stats.byTypeRunning,
        backgroundQueue: {
          enabled: backgroundSplitEnabled,
        },
        proxy: {
          total: proxyStats.length,
          available: proxyStats.filter((p) => p.available).length,
          failed: proxyStats.filter((p) => !p.available).length,
          details: proxyStats
        },
        // 🔥 修复：返回当前配置，前端需要此数据显示"当前生效配置"
        config: {
          globalConcurrency: currentConfig.globalConcurrency,
          perUserConcurrency: currentConfig.perUserConcurrency,
          perTypeConcurrency: currentConfig.perTypeConcurrency,  // 🔥 新增：任务类型并发限制
          maxQueueSize: currentConfig.maxQueueSize,
          taskTimeout: currentConfig.taskTimeout,
          enablePriority: true,  // 统一队列始终启用优先级
          defaultMaxRetries: currentConfig.defaultMaxRetries,
          retryDelay: currentConfig.retryDelay,
          storageType: process.env.REDIS_URL ? 'redis' : 'memory'
        }
      }
    })
  } catch (error: any) {
    console.error('[UnifiedQueueStats] 获取队列统计失败:', error)
    return NextResponse.json(
      { error: error.message || '获取队列统计失败' },
      { status: 500 }
    )
  }
}
