import { getDatabase } from '@/lib/db'
import { getInsertedId, generateUpsertSql } from '@/lib/db-helpers'
import { toDbJsonObjectField } from '@/lib/json-field'

export type AffiliateProductRecord = {
  id: number
  user_id: number
  platform: string
  external_product_id: string | null
  asin: string | null
  product_name: string | null
  brand_name: string | null
  category: string | null
  price: number | null
  currency: string
  commission_rate: number | null
  discount_percent: number | null
  rating: number | null
  review_count: number
  availability: string | null
  image_url: string | null
  product_url: string | null
  tracking_url: string | null
  raw_data: unknown
  synced_at: string
  created_at: string
  updated_at: string
}

export async function listAffiliateProducts(
  userId: number,
  opts?: { limit?: number; platform?: string }
): Promise<AffiliateProductRecord[]> {
  const db = await getDatabase()
  const limit = Math.min(opts?.limit || 50, 200)
  const conditions: string[] = ['user_id = ?']
  const params: any[] = [userId]

  if (opts?.platform) {
    conditions.push('platform = ?')
    params.push(opts.platform)
  }

  params.push(limit)

  return db.query<AffiliateProductRecord>(
    `SELECT * FROM openclaw_affiliate_products
     WHERE ${conditions.join(' AND ')}
     ORDER BY synced_at DESC
     LIMIT ?`,
    params
  )
}

export async function upsertAffiliateProducts(
  userId: number,
  products: Array<{
    platform: string
    external_product_id?: string | null
    asin?: string | null
    product_name?: string | null
    brand_name?: string | null
    category?: string | null
    price?: number | null
    currency?: string
    commission_rate?: number | null
    discount_percent?: number | null
    rating?: number | null
    review_count?: number
    availability?: string | null
    image_url?: string | null
    product_url?: string | null
    tracking_url?: string | null
    raw_data?: any
  }>
): Promise<{ synced: number }> {
  const db = await getDatabase()
  let synced = 0

  for (const p of products) {
    const rawData = toDbJsonObjectField(p.raw_data ?? null, db.type, null)
    const sql = generateUpsertSql(
      'openclaw_affiliate_products',
      ['user_id', 'platform', 'COALESCE(asin, external_product_id)'],
      [
        'user_id', 'platform', 'external_product_id', 'asin', 'product_name',
        'brand_name', 'category', 'price', 'currency', 'commission_rate',
        'discount_percent', 'rating', 'review_count', 'availability',
        'image_url', 'product_url', 'tracking_url', 'raw_data', 'synced_at',
      ],
      [
        'product_name', 'brand_name', 'category', 'price', 'currency',
        'commission_rate', 'discount_percent', 'rating', 'review_count',
        'availability', 'image_url', 'product_url', 'tracking_url',
        'raw_data', 'synced_at', 'updated_at',
      ],
      db.type
    )

    await db.exec(sql, [
      userId,
      p.platform,
      p.external_product_id ?? null,
      p.asin ?? null,
      p.product_name ?? null,
      p.brand_name ?? null,
      p.category ?? null,
      p.price ?? null,
      p.currency ?? 'USD',
      p.commission_rate ?? null,
      p.discount_percent ?? null,
      p.rating ?? null,
      p.review_count ?? 0,
      p.availability ?? null,
      p.image_url ?? null,
      p.product_url ?? null,
      p.tracking_url ?? null,
      rawData,
      new Date().toISOString(),
    ])
    synced++
  }

  return { synced }
}
