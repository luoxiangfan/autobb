import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/export/offers
 * 导出用户的Offers数据
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

    // 获取用户的所有Offers
    const offers = await db.query(`
      SELECT
        id,
        product_name,
        product_url,
        affiliate_link,
        brand,
        target_country,
        target_language,
        offer_type,
        payout,
        cpc_estimate,
        product_price,
        commission_payout,
        description,
        keywords,
        is_active,
        scrape_status,
        created_at,
        updated_at
      FROM offers
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [parseInt(userId, 10)]) as any[]

    if (format === 'csv') {
      // 生成CSV
      const headers = [
        'id',
        'product_name',
        'product_url',
        'affiliate_link',
        'brand',
        'target_country',
        'target_language',
        'offer_type',
        'payout',
        'cpc_estimate',
        'product_price',
        'commission_payout',
        'description',
        'keywords',
        'is_active',
        'scrape_status',
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
        ...offers.map(offer =>
          headers.map(h => escapeCSV(offer[h])).join(',')
        )
      ]

      const csvContent = csvLines.join('\n')

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="offers_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } else {
      // JSON格式
      return new NextResponse(JSON.stringify(offers, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="offers_${new Date().toISOString().split('T')[0]}.json"`,
        },
      })
    }
  } catch (error: any) {
    console.error('导出Offers失败:', error)
    return NextResponse.json(
      { error: error.message || '导出失败' },
      { status: 500 }
    )
  }
}
