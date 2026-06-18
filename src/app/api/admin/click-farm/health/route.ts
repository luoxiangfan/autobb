/**
 * 补点击系统监控 API
 * GET /api/admin/click-farm/health
 */

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getClickFarmHealth, getClickFarmMetricsHistory } from '@/lib/click-farm'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams
    const includeMetrics = searchParams.get('metrics') === 'true'
    const metricsHours = parseInt(searchParams.get('hours') || '24', 10)

    const health = await getClickFarmHealth()

    let metrics = null
    if (includeMetrics) {
      metrics = await getClickFarmMetricsHistory(metricsHours)
    }

    return NextResponse.json({
      success: true,
      data: {
        health,
        metrics,
        timestamp: new Date().toISOString(),
      },
    })
  },
  { requireAdmin: true }
)
