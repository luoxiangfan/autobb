/**
 * POST /api/cron/sync-google-ads-campaigns
 * 定时任务：从 Google Ads 同步广告系列到数据库
 *
 * 功能
 * 1. 为符合条件的用户入队 `google-ads-campaign-sync` 后台任务（异步执行）
 * 2. 任务执行时为每个广告系列创建关联的 Offer，并标记需完善信息
 *
 * 调用方式
 * 1. 广告系列页「同步」：登录用户 Cookie，仅为当前用户入队
 * 2. 运维批量 Cron：`Authorization: Bearer $CRON_SECRET` 且 `?scope=all`，为所有活跃用户入队
 * 3. 实际同步由队列 Worker（QUEUE_BACKGROUND_WORKER）执行
 *
 * 说明：同步由后台队列任务执行，各用户执行结果见 `sync_logs`（由任务执行器写入）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCampaignSyncScheduler } from '@/lib/queue/schedulers/google-ads-campaign-sync-scheduler'
import {
  enqueueGoogleAdsCampaignSyncForUser,
  userHasActiveGoogleAdsCampaignSyncWork,
} from '@/lib/google-ads/campaign/sync-pipeline-status'

function isCronBatchRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  const authHeader = request.headers.get('authorization')
  return (
    authHeader === `Bearer ${cronSecret}` && request.nextUrl.searchParams.get('scope') === 'all'
  )
}

async function handleSyncEnqueue(
  targetUserIds: number[],
  batchAllUsers: boolean,
  startTime: number
): Promise<Response> {
  const startedAt = new Date().toISOString()
  console.log('[Cron] Enqueue Google Ads campaign sync jobs...', {
    startedAt,
    batchAllUsers,
    targetUsers: targetUserIds.length,
  })

  const scheduler = getGoogleAdsCampaignSyncScheduler()
  const taskIds: string[] = []
  let enqueueFailures = 0
  let skippedActive = 0

  for (const userId of targetUserIds) {
    try {
      const activeWork = await userHasActiveGoogleAdsCampaignSyncWork(userId)
      if (activeWork.active) {
        skippedActive++
        console.log(
          `[Cron] Skip user #${userId}: active sync (${activeWork.reason}, pending=${activeWork.pending}, running=${activeWork.running})`
        )
        continue
      }

      const taskId = batchAllUsers
        ? await scheduler.triggerManualSync(userId)
        : await enqueueGoogleAdsCampaignSyncForUser(userId, { syncType: 'manual' })
      taskIds.push(taskId)
    } catch (err) {
      enqueueFailures++
      console.error(`[Cron] Failed to enqueue google-ads-campaign-sync for user ${userId}:`, err)
    }
  }

  const duration = Date.now() - startTime
  const completedAt = new Date().toISOString()

  console.log('[Cron] Google Ads campaign sync enqueue completed:', {
    duration: `${duration}ms`,
    totalUsers: targetUserIds.length,
    enqueued: taskIds.length,
    skippedActive,
    enqueueFailures,
    batchAllUsers,
  })

  const taskIdsSample = taskIds.length > 40 ? taskIds.slice(0, 40) : taskIds

  return NextResponse.json(
    {
      accepted: true,
      async: true,
      timestamp: completedAt,
      duration: `${duration}ms`,
      summary: {
        totalUsers: targetUserIds.length,
        enqueued: taskIds.length,
        skippedActive,
        enqueueFailures,
        batchAllUsers,
      },
      taskIds: taskIdsSample,
      taskIdsTruncated: taskIds.length > taskIdsSample.length,
      message:
        taskIds.length === 0
          ? skippedActive > 0
            ? '同步任务已在队列或执行中，未重复入队'
            : '未将任何用户加入同步队列（无目标用户或全部入队失败）'
          : batchAllUsers
            ? `已将 ${taskIds.length} 个用户的同步任务加入后台队列，请等待 Worker 执行`
            : '同步任务已加入后台队列，请等待 Worker 执行',
    },
    { status: 202 }
  )
}

const postForAuthenticatedUser = withAuth(async (_request, user) => {
  return handleSyncEnqueue([user.userId], false, Date.now())
})

/**
 * POST — 入队 Google Ads 广告系列同步任务（异步）
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    if (isCronBatchRequest(request)) {
      const db = await getDatabase()
      const users = (await db.query(
        `SELECT id FROM users WHERE role != 'admin' AND is_active = true`
      )) as { id: number }[]
      const targetUserIds = users.map((row) => row.id)
      return handleSyncEnqueue(targetUserIds, true, startTime)
    }

    return postForAuthenticatedUser(request)
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
      'POST 时为当前登录用户（或 scope=all + CRON_SECRET 时为全部活跃用户）入队 google-ads-campaign-sync 异步任务',
    schedule: 'Every 6 hours (recommended)',
    endpoints: {
      sync: 'POST /api/cron/sync-google-ads-campaigns',
      syncAllUsers:
        'POST /api/cron/sync-google-ads-campaigns?scope=all (Authorization: Bearer CRON_SECRET)',
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
