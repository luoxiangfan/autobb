import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/optimization/top-creatives
 * 获取用户表现最好的创意（基于5维度评分）
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

    // 获取limit参数，默认5
    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '5', 10)

    const db = await getDatabase()

    // 获取表现最好的创意（基于performance数据和score）
    // 使用ad_creative_performance表聚合最近30天数据
    const topCreatives = await db.query(`
      SELECT
        ac.id as creativeId,
        ac.headlines,
        ac.score,
        COALESCE(SUM(acp.impressions), 0) as impressions,
        COALESCE(SUM(acp.clicks), 0) as clicks,
        CASE
          WHEN COALESCE(SUM(acp.impressions), 0) > 0
          THEN CAST(COALESCE(SUM(acp.clicks), 0) AS REAL) / SUM(acp.impressions)
          ELSE 0
        END as ctr
      FROM ad_creatives ac
      LEFT JOIN ad_creative_performance acp ON ac.id = acp.ad_creative_id
        AND acp.sync_date >= date('now', '-30 days')
      WHERE ac.user_id = ?
        AND ac.is_selected = TRUE
      GROUP BY ac.id
      ORDER BY
        CASE
          WHEN COALESCE(SUM(acp.impressions), 0) >= 100 THEN ac.score
          ELSE 0
        END DESC,
        COALESCE(SUM(acp.impressions), 0) DESC
      LIMIT ?
    `, [parseInt(userId, 10), limit]) as any[]

    // 转换为前端需要的格式
    const creatives = topCreatives.map((creative) => {
      // 解析headlines JSON获取第一个标题
      let headline = '创意标题'
      try {
        const headlines = JSON.parse(creative.headlines || '[]')
        if (Array.isArray(headlines) && headlines.length > 0) {
          headline = headlines[0]
        }
      } catch {
        // 如果解析失败，使用默认值
      }

      // 根据score计算rating
      const score = creative.score || 0
      let rating = 'poor'
      if (score >= 90) rating = 'excellent'
      else if (score >= 75) rating = 'good'
      else if (score >= 60) rating = 'average'

      return {
        creativeId: creative.creativeId,
        headline,
        score: Math.round(score),
        rating,
        ctr: creative.ctr || 0,
        impressions: creative.impressions || 0
      }
    })

    return NextResponse.json({
      success: true,
      creatives
    })
  } catch (error: any) {
    console.error('获取创意排行失败:', error)
    return NextResponse.json(
      { error: error.message || '获取创意排行失败' },
      { status: 500 }
    )
  }
}
