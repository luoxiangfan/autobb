// GET /api/admin/click-farm/tasks - 所有用户任务列表

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { estimateTraffic } from '@/lib/click-farm/distribution'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async (request: NextRequest) => {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    const db = await getDatabase()

    const countResult = await db.queryOne<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM click_farm_tasks
      WHERE is_deleted = FALSE
    `,
      []
    )

    const total = countResult?.count || 0

    const tasks = await db.query<any>(
      `
      SELECT
        t.*,
        u.username,
        o.offer_name
      FROM click_farm_tasks t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN offers o ON t.offer_id = o.id
      WHERE t.is_deleted = FALSE
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    )

    const result = tasks.map((task: any) => ({
      id: task.id,
      userId: task.user_id,
      username: task.username,
      offerId: task.offer_id,
      offerName: task.offer_name,
      dailyClickCount: task.daily_click_count,
      status: task.status,
      progress: task.progress,
      totalClicks: task.total_clicks,
      successRate:
        task.total_clicks > 0
          ? parseFloat(((task.success_clicks / task.total_clicks) * 100).toFixed(1))
          : 0,
      traffic: estimateTraffic(task.total_clicks),
      createdAt: task.created_at,
    }))

    return NextResponse.json({
      success: true,
      data: {
        tasks: result,
        total,
        page,
        limit,
      },
    })
  },
  { requireAdmin: true }
)
