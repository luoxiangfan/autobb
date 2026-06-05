// GET /api/admin/click-farm/tasks - 所有用户任务列表

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { estimateTraffic } from '@/lib/click-farm/distribution'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId
    if (!userId || authResult.user.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden', message: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    const db = await getDatabase()

    // 获取总数
    const countResult = await db.queryOne<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM click_farm_tasks
      WHERE IS_DELETED_FALSE
    `,
      []
    )

    const total = countResult?.count || 0

    // 获取任务列表
    const tasks = await db.query<any>(
      `
      SELECT
        t.*,
        u.username,
        o.offer_name
      FROM click_farm_tasks t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN offers o ON t.offer_id = o.id
      WHERE t.IS_DELETED_FALSE
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
      traffic: estimateTraffic(task.total_clicks), // 🔧 统一使用估算函数
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
  } catch (error) {
    console.error('获取所有任务失败:', error)
    return NextResponse.json(
      { error: 'server_error', message: '获取任务列表失败' },
      { status: 500 }
    )
  }
}
