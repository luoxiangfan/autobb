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
import { syncAllUsersCampaigns } from '@/lib/google-ads-campaign-sync'
import { createSyncLog } from '@/lib/data-sync-service'

/**
 * POST 请求处理 - 执行同步任务
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // 验证 Cron 密钥（生产环境保护）
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid cron secret' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting Google Ads campaign sync...')
    console.log('[Cron] Timestamp:', new Date().toISOString())

    // 执行同步
    const result = await syncAllUsersCampaigns()
    
    const duration = Date.now() - startTime

    console.log('[Cron] Google Ads campaign sync completed:', {
      duration: `${duration}ms`,
      totalUsers: result.totalUsers,
      totalSynced: result.totalSynced,
      totalCreated: result.totalCreated,
      totalSkipped: result.totalSkipped,
      totalErrors: result.totalErrors,
    })

    // 创建同步日志
    try {
      await createSyncLog({
        syncType: 'google_ads_campaign_sync',
        status: result.totalErrors > 0 ? 'partial' : 'success',
        recordCount: result.totalSynced,
        durationMs: duration,
        errorMessage: result.totalErrors > 0 ? `有 ${result.totalErrors} 个错误` : null,
      })
    } catch (logError) {
      console.error('[Cron] Failed to create sync log:', logError)
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
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
    console.error('[Cron] Google Ads campaign sync error:', error)

    // 记录错误日志
    try {
      await createSyncLog({
        syncType: 'google_ads_campaign_sync',
        status: 'failed',
        recordCount: 0,
        durationMs: duration,
        errorMessage: error.message || 'Unknown error',
      })
    } catch (logError) {
      console.error('[Cron] Failed to create sync log:', logError)
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message || '同步服务异常',
        timestamp: new Date().toISOString(),
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
