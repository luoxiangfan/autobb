import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/export/offers
 * 导出用户的Offers数据
 * Query参数
 * format: json | csv (默认 json)
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json'

    const db = await getDatabase()

    // 获取用户的所有Offers
    const offers = (await db.query(
      `
      SELECT
        id,
        product_name,
        affiliate_link,
        brand,
        target_country,
        target_language,
        product_price,
        commission_payout,
        brand_description,
        extracted_keywords,
        is_active,
        scrape_status,
        created_at,
        updated_at
      FROM offers
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
      [userId]
    )) as any[]

    if (format === 'csv') {
      // 生成CSV
      const headers = [
        'id',
        'product_name',
        'affiliate_link',
        'brand',
        'target_country',
        'target_language',
        'product_price',
        'commission_payout',
        'brand_description',
        'extracted_keywords',
        'is_active',
        'scrape_status',
        'created_at',
        'updated_at',
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
        ...offers.map((offer) => headers.map((h) => escapeCSV(offer[h])).join(',')),
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
    return NextResponse.json({ error: error.message || '导出失败' }, { status: 500 })
  }
})
