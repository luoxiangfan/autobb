import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUrlSwapHealth } from '@/lib/url-swap/alerts'

/**
 * GET /api/admin/url-swap/health
 * 获取 URL Swap 系统健康状态
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const health = await getUrlSwapHealth()

    return NextResponse.json({
      success: true,
      data: health,
    })
  },
  { requireAdmin: true }
)

/**
 * POST /api/admin/url-swap/health
 * 执行健康检查并自动修复
 */
export const POST = withAuth(
  async () => {
    const { performHealthCheckAndAutoFix } = await import('@/lib/url-swap/alerts')
    const result = await performHealthCheckAndAutoFix()

    return NextResponse.json({
      success: true,
      data: result,
      message: `健康检查完成。修复了 ${result.fixed.stuckTasks} 个卡住的任务，禁用了 ${result.fixed.disabledTasks} 个高失败率任务。`,
    })
  },
  { requireAdmin: true }
)
