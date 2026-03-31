import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { frontendErrorMonitor, performanceMonitor, webVitalsMonitor } from '@/lib/api-performance'
import { apiCache } from '@/lib/api-cache'

/**
 * GET /api/admin/performance
 * 获取API性能统计（仅管理员）
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

    // 获取性能统计
    const overallStats = performanceMonitor.getStats()
    const recentMetrics = performanceMonitor.getRecentMetrics(50)
    const webVitalsSummary = webVitalsMonitor.getSummary()
    const recentWebVitals = webVitalsMonitor.getRecentMetrics(50)
    const frontendErrorSummary = frontendErrorMonitor.getSummary()
    const recentFrontendErrors = frontendErrorMonitor.getRecentMetrics(50)

    // 获取缓存统计
    const cacheStats = apiCache.getStats()

    // 按路径分组统计
    const pathStats: Record<string, any> = {}
    const paths = Array.from(new Set(recentMetrics.map((m) => m.path)))

    paths.forEach((path) => {
      pathStats[path] = performanceMonitor.getStats(path)
    })

    return NextResponse.json({
      success: true,
      data: {
        overall: overallStats,
        cache: cacheStats,
        byPath: pathStats,
        recentRequests: recentMetrics.slice(0, 20),
        frontendVitals: webVitalsSummary,
        recentFrontendVitals: recentWebVitals.slice(0, 20),
        frontendErrors: frontendErrorSummary,
        recentFrontendErrors: recentFrontendErrors.slice(0, 20),
      },
    })
  } catch (error) {
    console.error('获取性能统计失败:', error)
    return NextResponse.json(
      {
        error: '获取性能统计失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/performance
 * 清除性能统计数据（仅管理员）
 */
export async function DELETE(request: NextRequest) {
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

    performanceMonitor.clear()
    webVitalsMonitor.clear()
    frontendErrorMonitor.clear()

    return NextResponse.json({
      success: true,
      message: '性能统计已清除',
    })
  } catch (error) {
    console.error('清除性能统计失败:', error)
    return NextResponse.json(
      {
        error: '清除性能统计失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
