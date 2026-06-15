// GET /api/admin/click-farm/hourly-distribution - 全局时间分布

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseJsonField } from '@/lib/db'

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

    const db = await getDatabase()

    // 获取所有运行中任务的配置分布（汇总）
    const tasks = await db.query<any>(
      `
      SELECT hourly_distribution
      FROM click_farm_tasks
      WHERE is_deleted = FALSE AND status IN ('running', 'completed')
    `,
      []
    )

    const hourlyConfigured = new Array(24).fill(0)
    tasks.forEach((task: any) => {
      const distribution = parseJsonField<number[]>(task.hourly_distribution, [])
      if (!Array.isArray(distribution)) return
      distribution.forEach((count: number, hour: number) => {
        hourlyConfigured[hour] += Number(count) || 0
      })
    })

    // 实际执行分布（简化版，实际应从daily_history中提取）
    const hourlyActual = new Array(24).fill(0)

    return NextResponse.json({
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        hourlyActual,
        hourlyConfigured,
      },
    })
  } catch (error) {
    console.error('获取全局时间分布失败:', error)
    return NextResponse.json(
      { error: 'server_error', message: '获取时间分布失败' },
      { status: 500 }
    )
  }
}
