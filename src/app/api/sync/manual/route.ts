import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { syncCampaignsFromGoogleAds } from '@/lib/google-ads-campaign-sync'

/**
 * POST /api/sync/manual
 * 手动触发同步任务
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  let syncLogId: number | null = null
  let authResult: any = null
  let db: any = null
  
  try {
    // 验证用户登录
    authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    db = await getDatabase()

    console.log(`[Manual Sync] Starting manual sync for user ${userId}...`)

    // 🔧 优化：同步开始时写入 running 状态的记录（is_manual=true）
    try {
      const logResult = await db.exec(
        `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'google_ads_campaign_sync', 'running', 0, 0, startedAt, null, true]  // is_manual=true（手动触发）
      )
      syncLogId = logResult.lastInsertRowid || null
      console.log('[Manual Sync] Created sync log with ID:', syncLogId)
    } catch (logError) {
      console.error('[Manual Sync] Failed to create initial sync log:', logError)
    }

    // 执行同步
    const result = await syncCampaignsFromGoogleAds(userId, {
      dryRun: false,
    })
    
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()

    console.log('[Manual Sync] Sync completed:', {
      duration: `${duration}ms`,
      synced: result.syncedCount,
      created: result.createdOffersCount,
      updated: result.updatedOffersCount,
      skipped: result.skippedOffersCount,
      errors: result.errors.length,
    })

    // 🔧 优化：同步完成后更新记录
    if (syncLogId !== null) {
      try {
        await db.exec(
          `UPDATE sync_logs 
           SET status = ?, 
               record_count = ?, 
               duration_ms = ?, 
               completed_at = ?
           WHERE id = ?`,
          [result.errors.length > 0 ? 'partial' : 'success', result.syncedCount, duration, completedAt, syncLogId]
        )
        console.log('[Manual Sync] Updated sync log ID:', syncLogId)
      } catch (logError) {
        console.error('[Manual Sync] Failed to update sync log:', logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录
      try {
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, 'google_ads_campaign_sync', result.errors.length > 0 ? 'partial' : 'success',
           result.syncedCount, duration, startedAt, completedAt, true]  // is_manual=true
        )
      } catch (logError) {
        console.error('[Manual Sync] Failed to create sync log (fallback):', logError)
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: completedAt,
      duration: `${duration}ms`,
      summary: {
        syncedCount: result.syncedCount,
        createdOffersCount: result.createdOffersCount,
        updatedOffersCount: result.updatedOffersCount,
        skippedOffersCount: result.skippedOffersCount,
        errorsCount: result.errors.length,
      },
      message: result.errors.length === 0
        ? `同步完成，同步 ${result.syncedCount} 个广告系列，新建 ${result.createdOffersCount} 个 Offer`
        : `同步完成，有 ${result.errors.length} 个错误`,
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()
    console.error('[Manual Sync] Sync error:', error)

    // 🔧 优化：同步失败时更新记录
    if (syncLogId !== null && db !== null) {
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
        console.log('[Manual Sync] Updated sync log ID (failed):', syncLogId)
      } catch (logError) {
        console.error('[Manual Sync] Failed to update sync log (failed):', logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录
      try {
        if (db === null) {
          db = await getDatabase()
        }
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [authResult?.user?.userId || 0, 'google_ads_campaign_sync', 'failed', 0, duration, startedAt, completedAt, true]
        )
      } catch (logError) {
        console.error('[Manual Sync] Failed to create sync log (fallback):', logError)
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: '同步失败',
        message: error.message || '同步服务异常',
        timestamp: completedAt,
        duration: `${duration}ms`,
      },
      { status: 500 }
    )
  }
}
