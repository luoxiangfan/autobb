import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * POST /api/admin/backups/cleanup-soft-deleted
 * 清理90天前的软删除数据（物理删除）
 *
 * 功能：
 * - 清理campaigns表中90天前软删除的记录
 * - 清理offers表中90天前软删除的记录
 * - 保留关联的performance数据（已由外键CASCADE处理）
 * - 需要管理员权限
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    // 验证管理员权限
    const db = await getDatabase()
    const user = await db.queryOne(
      'SELECT role FROM users WHERE id = ?',
      [authResult.user.userId]
    ) as any

    if (user?.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 获取请求参数
    const body = await request.json()
    const daysThreshold = body.daysThreshold || 90
    const preview = body.preview === true // 预览模式，不实际删除

    // 计算阈值日期
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() - daysThreshold)
    const thresholdDateStr = db.type === 'postgres'
      ? thresholdDate.toISOString()
      : thresholdDate.toISOString().split('T')[0]

    // 🔧 PostgreSQL/SQLite兼容性
    const isDeletedTrue = db.type === 'postgres' ? true : 1
    const dateComparison = db.type === 'postgres'
      ? "deleted_at < $1::timestamp"
      : "deleted_at < ?"

    // 1. 统计将要删除的数据
    const campaignsToDelete = await db.query(`
      SELECT id, campaign_name, deleted_at
      FROM campaigns
      WHERE is_deleted = ${isDeletedTrue}
        AND ${dateComparison}
      ORDER BY deleted_at ASC
      LIMIT 100
    `, [thresholdDateStr]) as any[]

    const offersToDelete = await db.query(`
      SELECT id, offer_name, deleted_at
      FROM offers
      WHERE is_deleted = ${isDeletedTrue}
        AND ${dateComparison}
      ORDER BY deleted_at ASC
      LIMIT 100
    `, [thresholdDateStr]) as any[]

    // 统计performance数据量
    const campaignIds = campaignsToDelete.map(c => c.id)
    let performanceCount = 0

    if (campaignIds.length > 0) {
      const placeholders = campaignIds.map((_, i) => db.type === 'postgres' ? `$${i + 1}` : '?').join(',')
      const perfData = await db.queryOne(`
        SELECT COUNT(*) as count
        FROM campaign_performance
        WHERE campaign_id IN (${placeholders})
      `, campaignIds) as any
      performanceCount = perfData?.count || 0
    }

    // 预览模式：只返回统计信息
    if (preview) {
      return NextResponse.json({
        success: true,
        preview: true,
        summary: {
          campaignsCount: campaignsToDelete.length,
          offersCount: offersToDelete.length,
          performanceRecordsAffected: performanceCount,
          thresholdDate: thresholdDateStr,
          daysThreshold
        },
        campaigns: campaignsToDelete.slice(0, 10),
        offers: offersToDelete.slice(0, 10)
      })
    }

    // 2. 执行物理删除（按顺序）
    let deletedCampaigns = 0
    let deletedOffers = 0

    if (campaignsToDelete.length > 0) {
      const result = await db.exec(`
        DELETE FROM campaigns
        WHERE is_deleted = ${isDeletedTrue}
          AND ${dateComparison}
      `, [thresholdDateStr])
      deletedCampaigns = result.changes || 0
    }

    if (offersToDelete.length > 0) {
      const result = await db.exec(`
        DELETE FROM offers
        WHERE is_deleted = ${isDeletedTrue}
          AND ${dateComparison}
      `, [thresholdDateStr])
      deletedOffers = result.changes || 0
    }

    // 3. 记录清理日志
    await db.exec(`
      INSERT INTO data_cleanup_logs (
        user_id,
        cleanup_type,
        records_deleted,
        threshold_date,
        created_at
      ) VALUES (?, ?, ?, ?, ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"})
    `, [
      authResult.user.userId,
      'soft_deleted_cleanup',
      deletedCampaigns + deletedOffers,
      thresholdDateStr
    ]).catch(() => {
      // 如果日志表不存在，忽略错误（可选功能）
    })

    return NextResponse.json({
      success: true,
      message: `成功清理 ${deletedCampaigns} 个campaigns和 ${deletedOffers} 个offers（${daysThreshold}天前软删除的数据）`,
      summary: {
        deletedCampaigns,
        deletedOffers,
        performanceRecordsAffected: performanceCount,
        thresholdDate: thresholdDateStr,
        daysThreshold
      }
    })

  } catch (error: any) {
    console.error('清理软删除数据失败:', error)
    return NextResponse.json(
      {
        error: '清理软删除数据失败',
        message: error.message
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/backups/cleanup-soft-deleted
 * 获取软删除数据统计信息
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    // 验证管理员权限
    const db = await getDatabase()
    const user = await db.queryOne(
      'SELECT role FROM users WHERE id = ?',
      [authResult.user.userId]
    ) as any

    if (user?.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // 🔧 PostgreSQL/SQLite兼容性
    const isDeletedTrue = db.type === 'postgres' ? true : 1

    // 统计软删除数据
    const stats = await db.queryOne(`
      SELECT
        (SELECT COUNT(*) FROM campaigns WHERE is_deleted = ${isDeletedTrue}) as deleted_campaigns,
        (SELECT COUNT(*) FROM offers WHERE is_deleted = ${isDeletedTrue}) as deleted_offers,
        (SELECT COUNT(DISTINCT cp.campaign_id)
         FROM campaign_performance cp
         INNER JOIN campaigns c ON cp.campaign_id = c.id
         WHERE c.is_deleted = ${isDeletedTrue}) as campaigns_with_performance
    `) as any

    // 按删除时间分组统计
    const campaignsByAge = await db.query(`
      SELECT
        CASE
          WHEN deleted_at >= ${db.type === 'postgres' ? "NOW() - INTERVAL '7 days'" : "date('now', '-7 days')"} THEN '7_days'
          WHEN deleted_at >= ${db.type === 'postgres' ? "NOW() - INTERVAL '30 days'" : "date('now', '-30 days')"} THEN '30_days'
          WHEN deleted_at >= ${db.type === 'postgres' ? "NOW() - INTERVAL '90 days'" : "date('now', '-90 days')"} THEN '90_days'
          ELSE 'over_90_days'
        END as age_group,
        COUNT(*) as count
      FROM campaigns
      WHERE is_deleted = ${isDeletedTrue}
      GROUP BY age_group
    `) as any[]

    return NextResponse.json({
      success: true,
      stats: {
        deletedCampaigns: stats?.deleted_campaigns || 0,
        deletedOffers: stats?.deleted_offers || 0,
        campaignsWithPerformance: stats?.campaigns_with_performance || 0
      },
      campaignsByAge: campaignsByAge.reduce((acc: any, row: any) => {
        acc[row.age_group] = row.count
        return acc
      }, {})
    })

  } catch (error: any) {
    console.error('获取软删除数据统计失败:', error)
    return NextResponse.json(
      {
        error: '获取软删除数据统计失败',
        message: error.message
      },
      { status: 500 }
    )
  }
}
