import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

function toNumber(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const limit = Math.min(toNumber(searchParams.get('limit'), 50), 200)
  const inputLimit = Math.min(toNumber(searchParams.get('inputLimit'), 20), 100)
  const status = (searchParams.get('status') || '').trim()

  const db = await getDatabase()

  const inputs = await db.query<any>(
    `
      SELECT id, source, filename, file_type, file_size, status, total_items, parsed_items, error_message, created_at
      FROM openclaw_asin_inputs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [auth.userId, inputLimit]
  )

  const items = await db.query<any>(
    `
      SELECT id, input_id, asin, country_code, price, brand, title, affiliate_link, product_url, priority,
             status, offer_id, error_message, created_at, updated_at
      FROM openclaw_asin_items
      WHERE user_id = ?
        ${status ? 'AND status = ?' : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    status ? [auth.userId, status, limit] : [auth.userId, limit]
  )

  const statsRows = await db.query<{ status: string; count: number }>(
    `
      SELECT status, COUNT(*) as count
      FROM openclaw_asin_items
      WHERE user_id = ?
      GROUP BY status
    `,
    [auth.userId]
  )

  const stats = statsRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = Number(row.count) || 0
    return acc
  }, {})

  return NextResponse.json({
    success: true,
    inputs,
    items,
    stats,
  })
}
