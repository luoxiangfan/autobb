import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { withPerformanceMonitoring } from '@/lib/common/server'
import { countUrlSwapUrgentAlerts, queryUrlSwapUrgentAlerts } from '@/lib/url-swap/alerts'

export const dynamic = 'force-dynamic'

const getUrgentAlerts = withAuth(async (request: NextRequest, user) => {
  const limitRaw = request.nextUrl.searchParams.get('limit')
  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : 5
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 5

  const [alerts, total] = await Promise.all([
    queryUrlSwapUrgentAlerts(user.userId, limit),
    countUrlSwapUrgentAlerts(user.userId),
  ])

  return NextResponse.json({
    success: true,
    alerts,
    total,
  })
})

export const GET = withPerformanceMonitoring(
  getUrgentAlerts as (request: NextRequest) => Promise<NextResponse>,
  { path: '/api/url-swap/urgent-alerts' }
)
