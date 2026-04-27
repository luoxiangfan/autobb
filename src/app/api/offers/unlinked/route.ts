import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/offers/unlinked
 * 获取已解除关联的 Offer 列表
 * 
 * Query 参数：
 * - startDate: 开始日期（可选，YYYY-MM-DD）
 * - endDate: 结束日期（可选，YYYY-MM-DD）
 * - customerId: 指定 customer_id（可选）
 * - limit: 数量限制（可选，默认 100）
 * - offset: 偏移量（可选，默认 0）
 */
export const dynamic = 'force-dynamic'

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
    const customerId = searchParams.get('customerId')
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const db = await getDatabase()
    const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
    // 构建查询条件
    const whereConditions: string[] = [
      'o.user_id = ?',
      `o.is_deleted = ${isDeletedFalse}`,
      'o.last_unlinked_at IS NOT NULL',
      `NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.offer_id = o.id AND c.user_id = ? AND c.is_deleted = ${isDeletedFalse})`
    ]
    const params: any[] = [userId, userId]

    // 日期范围筛选
    if (startDate) {
      whereConditions.push('o.last_unlinked_at >= ?')
      params.push(startDate)
    }
    if (endDate) {
      whereConditions.push('o.last_unlinked_at <= ?')
      params.push(endDate)
    }

    // customer_id 筛选
    if (customerId) {
      whereConditions.push('o.unlinked_from_customer_ids LIKE ?')
      params.push(`%${customerId}%`)
    }

    const whereClause = whereConditions.join(' AND ')

    // 查询总数
    const countQuery = `SELECT COUNT(*) as count FROM offers o WHERE ${whereClause}`
    const countResult = await db.queryOne(countQuery, params) as { count: number }

    // 查询 Offer 列表
    const query = `
      SELECT 
        o.id,
        o.offer_name,
        o.brand,
        o.url as offer_url,
        o.affiliate_link,
        o.target_country,
        o.last_unlinked_at,
        o.unlinked_from_customer_ids,
        0 as active_campaign_count
      FROM offers o
      WHERE ${whereClause}
      ORDER BY o.last_unlinked_at DESC
      LIMIT ? OFFSET ?
    `

    const offers = await db.query(query, [...params, limit, offset]) as Array<{
      id: number
      offer_name: string
      brand: string
      offer_url: string
      affiliate_link: string
      target_country: string
      last_unlinked_at: string
      unlinked_from_customer_ids: string
      active_campaign_count: number
    }>

    // 解析 unlinked_from_customer_ids
    const parsedOffers = offers.map(offer => ({
      ...offer,
      unlinkedFromCustomerIds: (() => {
        try {
          return JSON.parse(offer.unlinked_from_customer_ids || '[]')
        } catch {
          return []
        }
      })(),
    }))

    return NextResponse.json({
      success: true,
      total: countResult.count,
      offers: parsedOffers,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('获取已解除关联的 Offer 列表失败:', error)
    return NextResponse.json(
      { error: error.message || '获取列表失败' },
      { status: 500 }
    )
  }
}
