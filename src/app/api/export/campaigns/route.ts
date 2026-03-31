import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/export/campaigns
 * 导出用户的Campaigns数据
 * Query参数:
 * - format: json | csv (默认 json)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json'

    const db = await getDatabase()

    // 获取用户的所有Campaigns（包含Offer和Account信息）
    const campaigns = await db.query(`
      SELECT
        c.id,
        c.google_campaign_id,
        c.campaign_name,
        c.campaign_type,
        c.status,
        c.daily_budget,
        c.start_date,
        c.end_date,
        c.target_locations,
        c.target_languages,
        c.bidding_strategy,
        c.created_at,
        c.updated_at,
        o.product_name as offer_name,
        o.product_url as offer_url,
        ga.customer_id as google_ads_account_id
      FROM campaigns c
      LEFT JOIN offers o ON c.offer_id = o.id
      LEFT JOIN google_ads_accounts ga ON c.google_ads_account_id = ga.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `, [parseInt(userId, 10)]) as any[]

    if (format === 'csv') {
      // 生成CSV
      const headers = [
        'id',
        'google_campaign_id',
        'campaign_name',
        'campaign_type',
        'status',
        'daily_budget',
        'start_date',
        'end_date',
        'target_locations',
        'target_languages',
        'bidding_strategy',
        'offer_name',
        'offer_url',
        'google_ads_account_id',
        'created_at',
        'updated_at'
      ]

      const escapeCSV = (value: any) => {
        if (value === null || value === undefined) return ''
        const str = String(value)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const csvLines = [
        headers.join(','),
        ...campaigns.map(campaign =>
          headers.map(h => escapeCSV(campaign[h])).join(',')
        )
      ]

      const csvContent = csvLines.join('\n')

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="campaigns_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } else {
      // JSON格式
      return new NextResponse(JSON.stringify(campaigns, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="campaigns_${new Date().toISOString().split('T')[0]}.json"`,
        },
      })
    }
  } catch (error: any) {
    console.error('导出Campaigns失败:', error)
    return NextResponse.json(
      { error: error.message || '导出失败' },
      { status: 500 }
    )
  }
}
