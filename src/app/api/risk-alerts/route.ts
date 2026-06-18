/**
 * GET /api/risk-alerts - 获取风险提示列表
 * POST /api/risk-alerts/check-links - 手动检查链接
 */

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { withPerformanceMonitoring } from '@/lib/common/server'
import {
  getUserRiskAlerts,
  getRiskStatistics,
  checkAllUserLinks,
} from '@/lib/campaign/optimization'

const get = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') as any
    const limitRaw = searchParams.get('limit')
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined
    const includeStatistics = searchParams.get('includeStatistics') !== 'false'
    const normalizedLimit =
      limit && Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : undefined

    if (status && !['active', 'acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status parameter' }, { status: 400 })
    }

    const alertsPromise = getUserRiskAlerts(userId, status, normalizedLimit)
    const statisticsPromise = includeStatistics
      ? getRiskStatistics(userId)
      : Promise.resolve(undefined)

    const [alerts, statistics] = await Promise.all([alertsPromise, statisticsPromise])

    return NextResponse.json({
      alerts,
      statistics,
    })
  } catch (error) {
    console.error('Get risk alerts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

const post = withAuth(async (request, user) => {
  try {
    const result = await checkAllUserLinks(user.userId)

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('Check links error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const GET = withPerformanceMonitoring<any>(get as any, { path: '/api/risk-alerts' })
export const POST = withPerformanceMonitoring<any>(post as any, { path: '/api/risk-alerts' })
