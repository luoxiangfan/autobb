import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCampaignSyncQueueCounts } from '@/lib/google-ads-campaign-sync-pipeline-status'

/**
 * GET /api/sync/status-v2
 * 检查是否有正在进行的同步任务，并附带 google-ads-campaign-sync 队列深度（供异步同步轮询）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()
    const userId = authResult.user.userId

    // 🔧 检查是否有正在进行的同步任务（status = 'running'）
    const runningCheck = "status = 'running'"

    // 查询最近 30 分钟内开始的运行中任务
    const timeThreshold = "(CURRENT_TIMESTAMP - INTERVAL '30 minutes')"

    const runningSecondsSql =
      'CAST(EXTRACT(EPOCH FROM (NOW() - started_at::timestamptz)) AS INTEGER)'

    const startedAtField = 'started_at::timestamptz'

    const runningSync = (await db.queryOne(`
      SELECT 
        id,
        user_id,
        sync_type,
        status,
        started_at,
        is_manual,
        ${runningSecondsSql} as running_seconds
      FROM sync_logs
      WHERE ${runningCheck}
        AND ${startedAtField} >= ${timeThreshold}
      ORDER BY ${startedAtField} DESC
      LIMIT 1
    `)) as any

    // 查询最近一次同步完成的时间
    const lastCompletedSync = (await db.queryOne(
      `
      SELECT 
        status,
        completed_at,
        record_count,
        sync_type,
        is_manual
      FROM sync_logs
      WHERE user_id = ? AND status IN ('success', 'partial', 'failed')
      ORDER BY completed_at DESC
      LIMIT 1
    `,
      [userId]
    )) as any

    const googleAdsCampaignSyncQueue = await getGoogleAdsCampaignSyncQueueCounts()

    return NextResponse.json({
      hasRunningSync: !!runningSync,
      runningSync: runningSync
        ? {
            id: runningSync.id,
            syncType: runningSync.sync_type,
            status: runningSync.status,
            startedAt: runningSync.started_at,
            isManual: runningSync.is_manual,
            runningSeconds: runningSync.running_seconds,
          }
        : null,
      lastCompletedSync: lastCompletedSync
        ? {
            status: lastCompletedSync.status,
            completedAt: lastCompletedSync.completed_at,
            recordCount: lastCompletedSync.record_count,
            syncType: lastCompletedSync.sync_type,
            isManual: lastCompletedSync.is_manual,
          }
        : null,
      googleAdsCampaignSyncQueue,
    })
  } catch (error: any) {
    console.error('检查同步状态失败:', error)
    return NextResponse.json({ error: error.message || '服务器错误' }, { status: 500 })
  }
}
