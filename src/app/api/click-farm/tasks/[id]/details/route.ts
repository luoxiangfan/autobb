// GET /api/click-farm/tasks/[id]/details - 获取任务详情（包含历史记录和offer信息）

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { estimateTraffic } from '@/lib/click-farm/distribution'

export const dynamic = 'force-dynamic'

function safeParseJSON(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback
  if (value === 'null' || value === 'undefined') return fallback

  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return value
  }

  if (typeof value !== 'string') return fallback
  try {
    let parsed: any = JSON.parse(value)
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        // ignore
      }
    }
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export const GET = withAuth(async (_request, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const db = getDatabase()

  const task = await db.queryOne<any>(
    `
      SELECT
        t.*,
        o.offer_name,
        o.brand,
        o.target_country,
        o.affiliate_link
      FROM click_farm_tasks t
      LEFT JOIN offers o ON t.offer_id = o.id
      WHERE t.id = ? AND t.user_id = ? AND t.is_deleted = FALSE
    `,
    [id, user.userId]
  )

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const hourlyDistribution = safeParseJSON(task.hourly_distribution, [])
  const dailyHistory = safeParseJSON(task.daily_history, [])
  const refererConfig = safeParseJSON(task.referer_config, null)

  const successRate = task.total_clicks > 0 ? (task.success_clicks / task.total_clicks) * 100 : 0
  const totalTraffic = estimateTraffic(task.total_clicks)

  const startDate = task.started_at ? new Date(task.started_at) : null
  const endDate = task.completed_at
    ? new Date(task.completed_at)
    : task.status === 'running'
      ? new Date()
      : null
  const durationMs = startDate && endDate ? endDate.getTime() - startDate.getTime() : 0
  const durationDays = durationMs > 0 ? Math.floor(durationMs / (1000 * 60 * 60 * 24)) : 0
  const durationHours =
    durationMs > 0 ? Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) : 0

  const response = {
    task: {
      ...task,
      hourly_distribution: hourlyDistribution,
      daily_history: dailyHistory,
      referer_config: refererConfig,
      is_deleted: Boolean(task.is_deleted),
    },
    statistics: {
      success_rate: parseFloat(successRate.toFixed(2)),
      total_traffic: totalTraffic,
      duration_days: durationDays,
      duration_hours: durationHours,
      avg_daily_clicks:
        dailyHistory.length > 0
          ? Math.round(
              dailyHistory.reduce((sum: number, day: any) => sum + day.actual, 0) /
                dailyHistory.length
            )
          : 0,
      best_day:
        dailyHistory.length > 0
          ? dailyHistory.reduce(
              (max: any, day: any) => (day.actual > (max?.actual || 0) ? day : max),
              null
            )
          : null,
      worst_day:
        dailyHistory.length > 0
          ? dailyHistory.reduce(
              (min: any, day: any) => (day.actual < (min?.actual || Infinity) ? day : min),
              null
            )
          : null,
    },
    offer: {
      id: task.offer_id,
      name: task.offer_name,
      brand: task.brand,
      target_country: task.target_country,
      affiliate_link: task.affiliate_link,
    },
  }

  return NextResponse.json({ success: true, data: response })
})
