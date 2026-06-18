import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * GET /api/sync/scheduler
 *
 * 获取数据同步调度状态（统一调度模式）
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async () => {
  try {
    const status = {
      isRunning: true,
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
      enabled: true,
      mode: 'external_scheduler_process',
      details: '由独立 scheduler 进程执行（src/scheduler.ts）',
    }

    return NextResponse.json({
      success: true,
      status,
    })
  } catch (error: any) {
    console.error('Get scheduler status error:', error)
    return NextResponse.json({ error: error.message || '获取调度器状态失败' }, { status: 500 })
  }
})

/**
 * POST /api/sync/scheduler
 *
 * 兼容保留：不再支持通过 API 启停遗留调度器
 */
export const POST = withAuth(async () => {
  try {
    return NextResponse.json(
      {
        success: false,
        error: '该接口不再支持启停调度器；请通过独立 scheduler 进程（supervisord）管理',
        mode: 'external_scheduler_process',
      },
      { status: 409 }
    )
  } catch (error: any) {
    console.error('Control scheduler error:', error)
    return NextResponse.json({ error: error.message || '控制调度器失败' }, { status: 500 })
  }
})
