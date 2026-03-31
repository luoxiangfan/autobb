import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'

/**
 * GET /api/optimization/metrics
 * 获取用户的优化指标（过去7天变化）
 * 数据通过 user_id 隔离
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()

    // 获取过去7天和前7天的性能数据进行对比
    const today = new Date()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date(today)
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const todayStr = today.toISOString().split('T')[0]
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0]

    // 获取最近7天的汇总数据
    const recentStats = await db.queryOne(`
      SELECT
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.cost), 0) as cost,
        CASE
          WHEN SUM(cp.impressions) > 0
          THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
          ELSE 0
        END as ctr,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN CAST(SUM(cp.cost) AS REAL) / SUM(cp.clicks)
          ELSE 0
        END as cpc
      FROM campaign_performance cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
    `, [parseInt(userId, 10), sevenDaysAgoStr, todayStr]) as any

    // 获取前7天的汇总数据
    const previousStats = await db.queryOne(`
      SELECT
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.cost), 0) as cost,
        CASE
          WHEN SUM(cp.impressions) > 0
          THEN CAST(SUM(cp.clicks) AS REAL) / SUM(cp.impressions)
          ELSE 0
        END as ctr,
        CASE
          WHEN SUM(cp.clicks) > 0
          THEN CAST(SUM(cp.cost) AS REAL) / SUM(cp.clicks)
          ELSE 0
        END as cpc
      FROM campaign_performance cp
      JOIN campaigns c ON cp.campaign_id = c.id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date < ?
    `, [parseInt(userId, 10), fourteenDaysAgoStr, sevenDaysAgoStr]) as any

    // 计算变化率（确保返回数字，不是null）
    const calcChange = (recent: number | null | undefined, previous: number | null | undefined): number => {
      const r = toNumber(recent, 0)
      const p = toNumber(previous, 0)
      if (p === 0) return r > 0 ? 100 : 0
      return ((r - p) / p) * 100
    }

    const recentCtr = toNumber(recentStats?.ctr, 0)
    const previousCtr = toNumber(previousStats?.ctr, 0)
    const recentCpc = toNumber(recentStats?.cpc, 0)
    const previousCpc = toNumber(previousStats?.cpc, 0)
    const recentImpressions = toNumber(recentStats?.impressions, 0)
    const previousImpressions = toNumber(previousStats?.impressions, 0)
    const recentClicks = toNumber(recentStats?.clicks, 0)
    const previousClicks = toNumber(previousStats?.clicks, 0)

    const ctrChange = calcChange(recentCtr, previousCtr)
    const cpcChange = calcChange(recentCpc, previousCpc)
    const impressionsChange = calcChange(recentImpressions, previousImpressions)
    const clicksChange = calcChange(recentClicks, previousClicks)

    // 获取优化任务统计（user_id 隔离）
    const taskStats = await db.queryOne(`
      SELECT
        COUNT(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 END) as pending_tasks,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks
      FROM optimization_tasks
      WHERE user_id = ?
    `, [parseInt(userId, 10)]) as any

    // 计算成本节省（基于CPC下降）
    const recentCost = toNumber(recentStats?.cost, 0)
    const costSavings = cpcChange < 0 ? Math.abs(cpcChange) * recentCost / 100 : 0
    const pendingTasks = toNumber(taskStats?.pending_tasks, 0)
    const completedTasks = toNumber(taskStats?.completed_tasks, 0)

    return NextResponse.json({
      success: true,
      metrics: {
        ctrChange: parseFloat(ctrChange.toFixed(2)),
        cpcChange: parseFloat(cpcChange.toFixed(2)),
        impressionsChange: parseFloat(impressionsChange.toFixed(2)),
        clicksChange: parseFloat(clicksChange.toFixed(2)),
        pendingTasks,
        completedTasks,
        costSavings: parseFloat(costSavings.toFixed(2)),
        lastUpdated: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('获取优化指标失败:', error)
    return NextResponse.json(
      { error: error.message || '获取优化指标失败' },
      { status: 500 }
    )
  }
}
