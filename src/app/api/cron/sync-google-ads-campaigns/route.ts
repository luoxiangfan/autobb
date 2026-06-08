/**
 * POST /api/cron/sync-google-ads-campaigns
 * 定时任务：从 Google Ads 同步广告系列到数据库
 *
 * 功能：
 * 1. 为每个符合条件的用户入队 `google-ads-campaign-sync` 后台任务（异步执行）
 * 2. 任务执行时为每个广告系列创建关联的 Offer，并标记需完善信息
 *
 * 调用方式：
 * 1. 本地测试：直接 POST 请求（立即返回 202，实际同步由队列 Worker 执行）
 * 2. 生产环境：配置 Cron 任务（建议每 6 小时一次）
 *    - 需保证 Redis 与后台队列消费进程（QUEUE_BACKGROUND_WORKER）可用
 *
 * 说明：同步由后台队列任务执行，各用户执行结果见 `sync_logs`（由任务执行器写入）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCampaignSyncScheduler } from '@/lib/queue/schedulers/google-ads-campaign-sync-scheduler'

/**
 * POST — 为所有活跃用户入队同步任务（异步）
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const startedAt = new Date().toISOString()
    console.log('[Cron] Enqueue Google Ads campaign sync jobs...', startedAt)

    const db = await getDatabase()
    const users = (await db.query(
      `SELECT id FROM users WHERE role != 'admin' AND is_active = ${
        db.type === 'postgres' ? 'TRUE' : '1'
      }`
    )) as { id: number }[]

    const scheduler = getGoogleAdsCampaignSyncScheduler()
    const taskIds: string[] = []
    let enqueueFailures = 0

    for (const row of users) {
      try {
        const taskId = await scheduler.triggerManualSync(row.id)
        taskIds.push(taskId)
      } catch (err) {
        enqueueFailures++
        console.error(`[Cron] Failed to enqueue google-ads-campaign-sync for user ${row.id}:`, err)
      }
    }

    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()

    console.log('[Cron] Google Ads campaign sync enqueue completed:', {
      duration: `${duration}ms`,
      totalUsers: users.length,
      enqueued: taskIds.length,
      enqueueFailures,
    })

    const taskIdsSample = taskIds.length > 40 ? taskIds.slice(0, 40) : taskIds

    return NextResponse.json(
      {
        accepted: true,
        async: true,
        timestamp: completedAt,
        duration: `${duration}ms`,
        summary: {
          totalUsers: users.length,
          enqueued: taskIds.length,
          enqueueFailures,
        },
        taskIds: taskIdsSample,
        taskIdsTruncated: taskIds.length > taskIdsSample.length,
        message:
          taskIds.length === 0
            ? '未将任何用户加入同步队列（无活跃用户或全部入队失败）'
            : `已将 ${taskIds.length} 个用户的同步任务加入后台队列，请等待 Worker 执行`,
      },
      { status: 202 }
    )
  } catch (error: any) {
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()
    console.error('[Cron] Google Ads campaign sync enqueue error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message || '同步服务异常',
        timestamp: completedAt,
        duration: `${duration}ms`,
      },
      { status: 500 }
    )
  }
}

/**
 * GET 请求处理 - 健康检查
 */
export async function GET() {
  return NextResponse.json({
    service: 'google-ads-campaign-sync-cron',
    status: 'healthy',
    description:
      'POST 时为活跃用户入队 google-ads-campaign-sync 异步任务；实际拉数由队列 Worker 完成',
    schedule: 'Every 6 hours (recommended)',
    endpoints: {
      sync: 'POST /api/cron/sync-google-ads-campaigns',
      health: 'GET /api/cron/sync-google-ads-campaigns',
    },
    environment: {
      cronSecretConfigured: !!process.env.CRON_SECRET,
    },
    timestamp: new Date().toISOString(),
  })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300
