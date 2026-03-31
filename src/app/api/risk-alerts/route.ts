/**
 * GET /api/risk-alerts - 获取风险提示列表
 * POST /api/risk-alerts/check-links - 手动检查链接
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { withPerformanceMonitoring } from '@/lib/api-performance'
import {
  getUserRiskAlerts,
  getRiskStatistics,
  checkAllUserLinks
} from '@/lib/risk-alerts'

/**
 * GET - 获取风险提示列表
 */
async function get(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = auth.user.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') as any
    const limitRaw = searchParams.get('limit')
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined

    // 验证status参数
    if (status && !['active', 'acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status parameter' },
        { status: 400 }
      )
    }

    const [alerts, statistics] = await Promise.all([
      getUserRiskAlerts(userId, status),
      getRiskStatistics(userId),
    ])

    const normalizedLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : undefined
    const limitedAlerts = normalizedLimit ? alerts.slice(0, normalizedLimit) : alerts

    return NextResponse.json({
      alerts: limitedAlerts,
      statistics
    })

  } catch (error) {
    console.error('Get risk alerts error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST - 手动检查所有链接
 */
async function post(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 检查所有链接
    const result = await checkAllUserLinks(auth.user.userId)

    return NextResponse.json({
      success: true,
      result
    })

  } catch (error) {
    console.error('Check links error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const GET = withPerformanceMonitoring<any>(get, { path: '/api/risk-alerts' })
export const POST = withPerformanceMonitoring<any>(post, { path: '/api/risk-alerts' })
