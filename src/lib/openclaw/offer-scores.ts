import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { toDbJsonObjectField } from '@/lib/json-field'

export type OfferScoreRecord = {
  id: number
  user_id: number
  offer_id: number | null
  asin: string | null
  platform: string | null
  commission_rate: number | null
  product_rating: number | null
  review_count: number
  discount_percent: number | null
  category: string | null
  brand: string | null
  score_total: number
  score_commission: number
  score_demand: number
  score_competition: number
  score_conversion: number
  profit_probability: string
  suggested_cpc_min: number | null
  suggested_cpc_max: number | null
  estimated_roas: number | null
  priority: string
  raw_data: unknown
  created_at: string
  updated_at: string
}

export async function listOfferScores(
  userId: number,
  opts?: { limit?: number; priority?: string; orderBy?: string }
): Promise<OfferScoreRecord[]> {
  const db = await getDatabase()
  const limit = Math.min(opts?.limit || 50, 200)
  const conditions: string[] = ['user_id = ?']
  const params: any[] = [userId]

  if (opts?.priority) {
    conditions.push('priority = ?')
    params.push(opts.priority)
  }

  const orderBy = opts?.orderBy === 'created_at'
    ? 'created_at DESC'
    : 'score_total DESC'

  params.push(limit)

  return db.query<OfferScoreRecord>(
    `SELECT * FROM openclaw_offer_scores
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT ?`,
    params
  )
}

export async function createOfferScore(
  userId: number,
  data: {
    offer_id?: number | null
    asin?: string | null
    platform?: string | null
    commission_rate?: number | null
    product_rating?: number | null
    review_count?: number
    discount_percent?: number | null
    category?: string | null
    brand?: string | null
    score_total?: number
    score_commission?: number
    score_demand?: number
    score_competition?: number
    score_conversion?: number
    profit_probability?: string
    suggested_cpc_min?: number | null
    suggested_cpc_max?: number | null
    estimated_roas?: number | null
    priority?: string
    raw_data?: unknown
  }
): Promise<OfferScoreRecord> {
  const db = await getDatabase()
  const rawData = toDbJsonObjectField(data.raw_data ?? null, db.type, null)

  const result = await db.exec(
    `INSERT INTO openclaw_offer_scores
     (user_id, offer_id, asin, platform, commission_rate, product_rating, review_count,
      discount_percent, category, brand, score_total, score_commission, score_demand,
      score_competition, score_conversion, profit_probability, suggested_cpc_min,
      suggested_cpc_max, estimated_roas, priority, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      data.offer_id ?? null,
      data.asin ?? null,
      data.platform ?? null,
      data.commission_rate ?? null,
      data.product_rating ?? null,
      data.review_count ?? 0,
      data.discount_percent ?? null,
      data.category ?? null,
      data.brand ?? null,
      data.score_total ?? 0,
      data.score_commission ?? 0,
      data.score_demand ?? 0,
      data.score_competition ?? 0,
      data.score_conversion ?? 0,
      data.profit_probability ?? 'low',
      data.suggested_cpc_min ?? null,
      data.suggested_cpc_max ?? null,
      data.estimated_roas ?? null,
      data.priority ?? 'P2',
      rawData,
    ]
  )

  const insertedId = getInsertedId(result, db.type)
  const record = await db.queryOne<OfferScoreRecord>(
    'SELECT * FROM openclaw_offer_scores WHERE id = ?',
    [insertedId]
  )

  if (!record) {
    throw new Error('Failed to create offer score record')
  }

  return record
}
