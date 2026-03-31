/**
 * POST /api/cron/daily-link-check
 * 每日定时任务：检查所有用户的链接可用性
 *
 * 调用方式：
 * 1. 本地测试：直接POST请求
 * 2. 生产环境：配置Vercel Cron或Cloud Scheduler
 */

import { NextRequest, NextResponse } from 'next/server'
import { dailyLinkCheck } from '@/lib/risk-alerts'

export async function POST(request: NextRequest) {
  try {
    // 验证Cron密钥（生产环境保护）
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting daily link check...')

    // 执行链接检查
    const result = await dailyLinkCheck()

    console.log('[Cron] Daily link check completed:', result)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalUsers: result.totalUsers,
        totalLinks: result.totalLinks,
        totalAlerts: result.totalAlerts
      },
      details: result.results
    })

  } catch (error) {
    console.error('[Cron] Daily link check error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

// 允许GET请求用于健康检查
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    service: 'daily-link-check-cron',
    status: 'healthy',
    schedule: 'Every day 00:00 UTC',
    timestamp: new Date().toISOString()
  })
}
