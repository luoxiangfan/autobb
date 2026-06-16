import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import {
  listAffiliateProducts,
  upsertAffiliateProducts } from '@/lib/openclaw/affiliate-products'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const productSchema = z.object({
  platform: z.string().min(1, zErr.required).max(50, zErr.maxChars(50)),
  external_product_id: z.string().max(100, zErr.maxChars(100)).optional().nullable(),
  asin: z.string().max(20, zErr.maxChars(20)).optional().nullable(),
  product_name: z.string().max(500, zErr.maxChars(500)).optional().nullable(),
  brand_name: z.string().max(200, zErr.maxChars(200)).optional().nullable(),
  category: z.string().max(200, zErr.maxChars(200)).optional().nullable(),
  price: z.number().optional().nullable(),
  currency: z.string().max(10, zErr.maxChars(10)).optional().default('USD'),
  commission_rate: z.number().optional().nullable(),
  discount_percent: z.number().optional().nullable(),
  rating: z.number().optional().nullable(),
  review_count: z.number().int(zErr.int).optional().default(0),
  availability: z.string().max(50, zErr.maxChars(50)).optional().nullable(),
  image_url: z.string().max(1000, zErr.maxChars(1000)).optional().nullable(),
  product_url: z.string().max(2000, zErr.maxChars(2000)).optional().nullable(),
  tracking_url: z.string().max(2000, zErr.maxChars(2000)).optional().nullable(),
  raw_data: z.any().optional().nullable() })

const syncSchema = z.object({
  products: z.array(productSchema).min(1, zErr.minItems(1)).max(500, zErr.maxItems(500)) })

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const limit = Number(searchParams.get('limit')) || 50
  const platform = searchParams.get('platform') || undefined

  const data = await listAffiliateProducts(auth.userId, { limit, platform })
  return NextResponse.json({ success: true, data })
}

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = syncSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  try {
    const result = await upsertAffiliateProducts(auth.userId, parsed.data.products)
    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to sync affiliate products' },
      { status: 500 }
    )
  }
}
