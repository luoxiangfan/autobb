/**
 * POST /api/cron/sync-google-ads-campaigns
 * 定时任务：从 Google Ads 同步广告系列到数据库
 *
 * 功能：
 * 1. 定时从所有用户的 Google Ads 账户同步广告系列
 * 2. 为每个广告系列创建关联的 Offer
 * 3. 标记这些 Offer 需要完善相关信息
 *
 * 调用方式：
 * 1. 本地测试：直接 POST 请求
 * 2. 生产环境：配置 Cron 任务（建议每 6 小时一次）
 *    - Vercel Cron: vercel.json 配置
 *    - Cloud Scheduler: Google Cloud
 *    - Linux Cron: crontab
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { syncAllUsersCampaigns } from '@/lib/google-ads-campaign-sync'

/**
 * POST 请求处理 - 执行同步任务
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  let syncLogId: number | null = null
  let authResult: any = null
  const db = await getDatabase()
  
  try {
    authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    console.log('[Cron] Starting Google Ads campaign sync...')
    console.log('[Cron] Timestamp:', startedAt)

    // 🔧 优化：同步开始时写入 running 状态的记录
    try {
      const logResult = await db.exec(
        `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'google_ads_campaign_sync', 'running', 0, 0, startedAt, null, true]  // user_id=userId, is_manual=true
      )
      // 🔧 获取插入的 ID（支持 PostgreSQL 和 SQLite）
      syncLogId = logResult.lastInsertRowid || null
      console.log('[Cron] Created sync log with ID:', syncLogId)
    } catch (logError) {
      console.error('[Cron] Failed to create initial sync log:', logError)
    }

    // 执行同步
    const result = await syncAllUsersCampaigns()
    
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()

    console.log('[Cron] Google Ads campaign sync completed:', {
      duration: `${duration}ms`,
      totalUsers: result.totalUsers,
      totalSynced: result.totalSynced,
      totalCreated: result.totalCreated,
      totalSkipped: result.totalSkipped,
      totalErrors: result.totalErrors,
    })

    // 🔧 优化：同步完成后更新记录（而不是插入新记录）
    if (syncLogId !== null) {
      try {
        await db.exec(
          `UPDATE sync_logs 
           SET status = ?, 
               record_count = ?, 
               duration_ms = ?, 
               completed_at = ?
           WHERE id = ?`,
          [result.totalErrors > 0 ? 'partial' : 'success', result.totalSynced, duration, completedAt, syncLogId]
        )
        console.log('[Cron] Updated sync log ID:', syncLogId)
      } catch (logError) {
        console.error('[Cron] Failed to update sync log:', logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录（保持原有逻辑）
      try {
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, 'google_ads_campaign_sync', result.totalErrors > 0 ? 'partial' : 'success',
           result.totalSynced, duration, startedAt, completedAt, false]  // user_id=userId, is_manual=false
        )
      } catch (logError) {
        console.error('[Cron] Failed to create sync log (fallback):', logError)
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: completedAt,
      duration: `${duration}ms`,
      summary: {
        totalUsers: result.totalUsers,
        totalSynced: result.totalSynced,
        totalCreated: result.totalCreated,
        totalSkipped: result.totalSkipped,
        totalErrors: result.totalErrors,
      },
      message: result.totalErrors === 0
        ? `同步完成，新建 ${result.totalCreated} 个 Offer，跳过 ${result.totalSkipped} 个已关联 Offer`
        : `同步完成，有 ${result.totalErrors} 个错误`,
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()
    console.error('[Cron] Google Ads campaign sync error:', error)

    // 🔧 优化：同步失败时更新记录
    if (syncLogId !== null) {
      try {
        await db.exec(
          `UPDATE sync_logs 
           SET status = ?, 
               record_count = ?, 
               duration_ms = ?, 
               completed_at = ?,
               error_message = ?
           WHERE id = ?`,
          ['failed', 0, duration, completedAt, error.message || '同步失败', syncLogId]
        )
        console.log('[Cron] Updated sync log ID (failed):', syncLogId)
      } catch (logError) {
        console.error('[Cron] Failed to update sync log (failed):', logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录（保持原有逻辑）
      try {
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [authResult?.user?.userId || 0, 'google_ads_campaign_sync', 'failed', 0, duration, startedAt, completedAt, true]  // is_manual=true
        )
      } catch (logError) {
        console.error('[Cron] Failed to create sync log (fallback):', logError)
      }
    }

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
    description: '定时从 Google Ads 同步广告系列到数据库',
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

/**
 * 动态配置 - 强制动态渲染
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
