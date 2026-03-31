import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getUrlSwapHealth } from '@/lib/url-swap/monitoring'

/**
 * GET /api/admin/url-swap/health
 * 获取URL Swap系统健康状态
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 检查管理员权限
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 获取健康状态
    const health = await getUrlSwapHealth()

    return NextResponse.json({
      success: true,
      data: health,
    })
  } catch (error) {
    console.error('获取URL Swap健康状态失败:', error)
    return NextResponse.json(
      {
        error: '获取健康状态失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/url-swap/health/auto-fix
 * 执行健康检查并自动修复
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 检查管理员权限
    if (authResult.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 执行健康检查和自动修复
    const { performHealthCheckAndAutoFix } = await import('@/lib/url-swap/monitoring')
    const result = await performHealthCheckAndAutoFix()

    return NextResponse.json({
      success: true,
      data: result,
      message: `健康检查完成。修复了 ${result.fixed.stuckTasks} 个卡住的任务，禁用了 ${result.fixed.disabledTasks} 个高失败率任务。`,
    })
  } catch (error) {
    console.error('执行健康检查失败:', error)
    return NextResponse.json(
      {
        error: '执行健康检查失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
