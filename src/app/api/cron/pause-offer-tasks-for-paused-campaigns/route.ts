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
import { pauseOfferTasksBatch } from '@/lib/campaign-offer-tasks'

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

    const db = await getDatabase()

    // 1. 查询所有已暂停的广告系列（按用户分组）
    const pausedCampaigns = await db.query<any>(`
      SELECT 
        c.id as campaign_id,
        c.offer_id,
        c.user_id,
        c.status,
        c.updated_at
      FROM campaigns c
      WHERE c.status = 'PAUSED'
        AND c.is_deleted = 0
        AND c.offer_id IS NOT NULL
      ORDER BY c.user_id, c.updated_at DESC
    `)

    if (!pausedCampaigns || pausedCampaigns.length === 0) {
      console.log('[Cron] 没有找到已暂停的广告系列')
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        duration: `${Date.now() - startTime}ms`,
        summary: {
          totalPausedCampaigns: 0,
          totalOffersProcessed: 0,
          clickFarmTasksPaused: 0,
          urlSwapTasksDisabled: 0,
        },
        message: '没有找到已暂停的广告系列',
      })
    }

    // 2. 按用户分组，去重 offer_id（一个用户可能有多个广告系列关联同一个 offer）
    const userOfferMap = new Map<number, Set<number>>()
    
    for (const campaign of pausedCampaigns) {
      const userId = campaign.user_id
      const offerId = campaign.offer_id
      
      if (!userOfferMap.has(userId)) {
        userOfferMap.set(userId, new Set())
      }
      userOfferMap.get(userId)!.add(offerId)
    }

    // 3. 批量处理每个用户的 offer
    let totalOffersProcessed = 0
    let totalClickFarmTasksPaused = 0
    let totalUrlSwapTasksDisabled = 0
    const results: Array<{
      userId: number
      offerIds: number[]
      clickFarmTasksPaused: number
      urlSwapTasksDisabled: number
    }> = []

    for (const [userId, offerIds] of userOfferMap.entries()) {
      const offerIdArray = Array.from(offerIds)
      const batchResults = await pauseOfferTasksBatch(
        offerIdArray,
        userId,
        'campaign_paused_cron',
        '定时检测：关联广告系列已暂停，自动暂停任务'
      )

      let userClickFarmPaused = 0
      let userUrlSwapDisabled = 0

      for (const { result } of batchResults) {
        if (result.clickFarmTaskPaused) userClickFarmPaused++
        if (result.urlSwapTaskDisabled) userUrlSwapDisabled++
      }

      totalOffersProcessed += offerIdArray.length
      totalClickFarmTasksPaused += userClickFarmPaused
      totalUrlSwapTasksDisabled += userUrlSwapDisabled

      results.push({
        userId,
        offerIds: offerIdArray,
        clickFarmTasksPaused: userClickFarmPaused,
        urlSwapTasksDisabled: userUrlSwapDisabled,
      })

      console.log(`[Cron] 用户 ${userId}: 处理 ${offerIdArray.length} 个 offer, ` +
        `暂停 ${userClickFarmPaused} 个补点击任务，禁用 ${userUrlSwapDisabled} 个换链接任务`)
    }

    const duration = Date.now() - startTime

    console.log('[Cron] Paused campaign offer tasks check completed:', {
      duration: `${duration}ms`,
      totalPausedCampaigns: pausedCampaigns.length,
      totalOffersProcessed,
      totalClickFarmTasksPaused,
      totalUrlSwapTasksDisabled,
    })

    // 4. 创建执行日志
    try {
      await db.exec(
        `INSERT INTO sync_logs (sync_type, status, record_count, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['paused_campaign_task_check', 'success', totalOffersProcessed, duration, 
         new Date().toISOString(), new Date().toISOString()]
      )
    } catch (logError) {
      console.error('[Cron] Failed to create sync log:', logError)
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      summary: {
        totalPausedCampaigns: pausedCampaigns.length,
        totalOffersProcessed,
        clickFarmTasksPaused: totalClickFarmTasksPaused,
        urlSwapTasksDisabled: totalUrlSwapTasksDisabled,
      },
      details: results,
      message: `处理完成：检查 ${pausedCampaigns.length} 个暂停广告系列，处理 ${totalOffersProcessed} 个 offer，` +
        `暂停 ${totalClickFarmTasksPaused} 个补点击任务，禁用 ${totalUrlSwapTasksDisabled} 个换链接任务`,
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
