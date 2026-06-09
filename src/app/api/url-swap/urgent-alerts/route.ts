import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { withPerformanceMonitoring } from '@/lib/api-performance'
import { countUrlSwapUrgentAlerts, queryUrlSwapUrgentAlerts } from '@/lib/url-swap/urgent-alerts'

export const dynamic = 'force-dynamic'

async function get(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : 5
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 5

    const userId = auth.user.userId
    const [alerts, total] = await Promise.all([
      queryUrlSwapUrgentAlerts(userId, limit),
      countUrlSwapUrgentAlerts(userId),
    ])

    return NextResponse.json({
      success: true,
      alerts,
      total,
    })
  } catch (error) {
    console.error('[url-swap] urgent-alerts GET failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withPerformanceMonitoring<any>(get, { path: '/api/url-swap/urgent-alerts' })
