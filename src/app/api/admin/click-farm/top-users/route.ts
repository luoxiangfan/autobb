// GET /api/admin/click-farm/top-users - Top 10用户排行

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { estimateTraffic } from '@/lib/click-farm/distribution'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async () => {
    const db = await getDatabase()

    const topUsers = await db.query<any>(
      `
      SELECT
        u.id as user_id,
        u.username,
        COALESCE(SUM(t.total_clicks), 0) as total_clicks,
        COALESCE(SUM(t.success_clicks), 0) as success_clicks,
        COALESCE(SUM(t.failed_clicks), 0) as failed_clicks
      FROM users u
      LEFT JOIN click_farm_tasks t ON t.user_id = u.id
      GROUP BY u.id, u.username
      HAVING COALESCE(SUM(t.total_clicks), 0) > 0
      ORDER BY total_clicks DESC
      LIMIT 10
    `,
      []
    )

    const result = topUsers.map((user: any) => ({
      userId: user.user_id,
      username: user.username,
      totalClicks: user.total_clicks,
      successRate:
        user.total_clicks > 0
          ? parseFloat(((user.success_clicks / user.total_clicks) * 100).toFixed(1))
          : 0,
      traffic: estimateTraffic(user.total_clicks),
    }))

    return NextResponse.json({
      success: true,
      data: result,
    })
  },
  { requireAdmin: true }
)
