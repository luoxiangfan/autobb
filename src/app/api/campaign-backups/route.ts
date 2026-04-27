import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/campaign-backups
 * 获取广告系列备份列表
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const backupSource = searchParams.get('backupSource')
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    const db = await getDatabase()

    // 构建查询条件
    const whereConditions: string[] = ['cb.user_id = ?']
    const params: any[] = [userId]

    // 日期范围筛选
    if (startDate) {
      whereConditions.push('cb.created_at >= ?')
      params.push(startDate)
    }
    if (endDate) {
      whereConditions.push('cb.created_at <= ?')
      params.push(endDate)
    }

    // 备份来源筛选
    if (backupSource && backupSource !== 'all') {
      whereConditions.push('cb.backup_source = ?')
      params.push(backupSource)
    }

    const whereClause = whereConditions.join(' AND ')

    // 查询备份列表（关联 Offer 和广告创意信息）
    const backups = await db.query(`
      SELECT 
        cb.id,
        cb.user_id,
        cb.offer_id,
        cb.ad_creative_id,
        cb.campaign_data,
        cb.campaign_config,
        cb.backup_type,
        cb.backup_source,
        cb.backup_version,
        cb.custom_name,
        cb.campaign_name,
        cb.budget_amount,
        cb.budget_type,
        cb.created_at,
        cb.updated_at,
        o.offer_name,
        o.brand
      FROM campaign_backups cb
      LEFT JOIN offers o ON cb.offer_id = o.id
      WHERE ${whereClause}
      ORDER BY cb.created_at DESC
      LIMIT ?
    `, [...params, limit]) as any[]

    // 解析 JSON 字段
    const parsedBackups = backups.map(backup => ({
      ...backup,
      campaign_data: typeof backup.campaign_data === 'string' 
        ? JSON.parse(backup.campaign_data) 
        : backup.campaign_data,
      campaign_config: typeof backup.campaign_config === 'string'
        ? JSON.parse(backup.campaign_config)
        : backup.campaign_config,
    }))

    return NextResponse.json({
      success: true,
      backups: parsedBackups,
      total: parsedBackups.length,
    })
  } catch (error: any) {
    console.error('获取备份列表失败:', error)
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    )
  }
}
