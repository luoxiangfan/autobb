/**
 * POST /api/cron/pause-offer-tasks-for-paused-campaigns
 * 定时任务：检测所有已暂停的广告系列，暂停关联 offer 的补点击和换链接任务
 *
 * 功能：
 * 1. 定时检测所有状态为 PAUSED 的广告系列
 * 2. 暂停这些广告系列关联 offer 的补点击任务和换链接任务
 * 3. 防止遗漏：即使 toggle-status 接口调用失败，定时任务也能保证任务被暂停
 *
 * 调用方式：
 * 1. 本地测试：直接 POST 请求
 * 2. 生产环境：配置 Cron 任务（建议每 30 分钟或每小时一次）
 *    - Vercel Cron: vercel.json 配置
 *    - Cloud Scheduler: Google Cloud
 *    - Linux Cron: crontab + curl
 *    - OpenClaw Cron: 使用 cron 工具配置
 *
 * 安全：
 * - 需要 CRON_SECRET 验证（生产环境）
 * - 仅处理 is_deleted = 0 的广告系列
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { runCampaignPausedTaskCheck } from '@/lib/campaign-paused-task-check'

/**
 * 验证 cron 请求的合法性
 */
function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // 开发环境没有配置 CRON_SECRET，允许直接调用
    return true
  }
  
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    return token === cronSecret
  }
  
  const urlParam = request.nextUrl.searchParams.get('secret')
  if (urlParam === cronSecret) {
    return true
  }
  
  return false
}

/**
 * POST 请求处理 - 执行定时任务
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // 生产环境验证 cron secret
    if (process.env.NODE_ENV === 'production') {
      if (!verifyCronRequest(request)) {
        return NextResponse.json(
          { error: 'Unauthorized', message: '无效的 cron 凭证' },
          { status: 401 }
        )
      }
    }

    console.log('[Cron] Starting paused campaign offer tasks check...')
    console.log('[Cron] Timestamp:', new Date().toISOString())

    const result = await runCampaignPausedTaskCheck(
      'campaign_paused_cron',
      '定时检测：关联广告系列已暂停，自动暂停任务'
    )

    if (result.summary.totalPausedOfferPairs === 0) {
      console.log('[Cron] 没有找到已暂停的广告系列')
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        duration: `${Date.now() - startTime}ms`,
        summary: result.summary,
        message: '没有找到已暂停的广告系列',
      })
    }
    for (const userResult of result.details) {
      console.log(`[Cron] 用户 ${userResult.userId}: 处理 ${userResult.offerIds.length} 个 offer, ` +
        `成功 ${userResult.offersSucceeded}，失败 ${userResult.offersFailed}，` +
        `暂停 ${userResult.clickFarmTasksPaused} 个补点击任务，禁用 ${userResult.urlSwapTasksDisabled} 个换链接任务`)
    }

    const duration = Date.now() - startTime

    console.log('[Cron] Paused campaign offer tasks check completed:', {
      duration: `${duration}ms`,
      ...result.summary,
    })

    // 4. 创建执行日志
    try {
      const db = await getDatabase()
      await db.exec(
        `INSERT INTO sync_logs (sync_type, status, record_count, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['paused_campaign_task_check', 'success', result.summary.totalOffersProcessed, duration, 
         new Date().toISOString(), new Date().toISOString()]
      )
    } catch (logError) {
      console.error('[Cron] Failed to create sync log:', logError)
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      summary: result.summary,
      details: result.details,
      message: `处理完成：检查 ${result.summary.totalPausedCampaigns} 个暂停广告系列（去重关系 ${result.summary.totalPausedOfferPairs}），` +
        `处理 ${result.summary.totalOffersProcessed} 个 offer，成功 ${result.summary.totalOffersSucceeded} 个（变更 ${result.summary.totalOffersChanged}，无变更 ${result.summary.totalOffersNoop}）、失败 ${result.summary.totalOffersFailed} 个，` +
        `暂停 ${result.summary.clickFarmTasksPaused} 个补点击任务，禁用 ${result.summary.urlSwapTasksDisabled} 个换链接任务`,
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error('[Cron] Paused campaign offer tasks check error:', error)

    // 记录错误日志
    try {
      const db = await getDatabase()
      await db.exec(
        `INSERT INTO sync_logs (sync_type, status, record_count, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['paused_campaign_task_check', 'failed', 0, duration, new Date().toISOString(), new Date().toISOString()]
      )
    } catch (logError) {
      console.error('[Cron] Failed to create sync log:', logError)
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message || '定时任务执行异常',
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
    service: 'paused-campaign-offer-tasks-cron',
    status: 'healthy',
    description: '定时检测已暂停广告系列，自动暂停关联 offer 的补点击和换链接任务',
    schedule: 'Every 30 minutes (recommended)',
    endpoints: {
      execute: 'POST /api/cron/pause-offer-tasks-for-paused-campaigns',
      health: 'GET /api/cron/pause-offer-tasks-for-paused-campaigns',
    },
    environment: {
      cronSecretConfigured: !!process.env.CRON_SECRET,
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * 动态配置 - 强制动态渲染
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
