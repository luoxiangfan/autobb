import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { frontendErrorMonitor, performanceMonitor, webVitalsMonitor } from '@/lib/common/server'
import { apiCache } from '@/lib/common/server'

/**
 * GET /api/admin/performance
 * 获取API性能统计（仅管理员）
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    try {
      const overallStats = performanceMonitor.getStats()
      const recentMetrics = performanceMonitor.getRecentMetrics(50)
      const webVitalsSummary = webVitalsMonitor.getSummary()
      const recentWebVitals = webVitalsMonitor.getRecentMetrics(50)
      const frontendErrorSummary = frontendErrorMonitor.getSummary()
      const recentFrontendErrors = frontendErrorMonitor.getRecentMetrics(50)

      const cacheStats = apiCache.getStats()

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
  },
  { requireAdmin: true }
)

/**
 * DELETE /api/admin/performance
 * 清除性能统计数据（仅管理员）
 */
export const DELETE = withAuth(
  async () => {
    try {
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
  },
  { requireAdmin: true }
)
