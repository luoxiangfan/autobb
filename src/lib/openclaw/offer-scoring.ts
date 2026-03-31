import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { toDbJsonObjectField } from '@/lib/json-field'

// Offer评分引擎 - 从联盟平台数据评估Offer盈利概率
// 评分维度：佣金收益(30%) + 市场需求(25%) + 竞争程度(25%) + 转化概率(20%)

export type AffiliateProduct = {
  asin?: string | null
  product_name?: string | null
  price?: number | null
  commission_rate?: number | null
  rating?: number | null
  review_count?: number | null
  discount_percent?: number | null
  brand?: string | null
  category?: string | null
  marketplace?: string | null
  has_promo_code?: boolean | null
  platform?: string | null
  offer_id?: number | null
}

export type OfferScore = {
  asin: string | null
  offer_id: number | null
  score_total: number
  score_commission: number
  score_demand: number
  score_competition: number
  score_conversion: number
  profit_probability: 'high' | 'medium' | 'low'
  priority: 'P0' | 'P1' | 'P2' | 'SKIP'
  suggested_cpc_min: number | null
  suggested_cpc_max: number | null
  estimated_roas: number | null
}

const WEIGHT_COMMISSION = 0.30
const WEIGHT_DEMAND = 0.25
const WEIGHT_COMPETITION = 0.25
const WEIGHT_CONVERSION = 0.20

// 高竞争类目
const HIGH_COMPETITION_CATEGORIES = new Set([
  'electronics', 'computers', 'cell phones', 'laptops', 'tablets',
])
const MEDIUM_COMPETITION_CATEGORIES = new Set([
  'home', 'kitchen', 'furniture', 'appliances',
])
// 知名品牌（高CPC竞争）
const HIGH_BRAND_COMPETITION = new Set([
  'apple', 'samsung', 'sony', 'microsoft', 'google', 'lg', 'dell', 'hp',
  'lenovo', 'bose', 'nike', 'adidas',
])

function scoreCommission(commissionRate: number | null | undefined): number {
  const rate = commissionRate ?? 0
  if (rate > 10) return 100
  if (rate >= 5) return 80
  if (rate >= 2) return 60
  return 30
}

function scoreDemand(reviewCount: number | null | undefined): number {
  const count = reviewCount ?? 0
  if (count > 1000) return 100
  if (count >= 500) return 80
  if (count >= 100) return 60
  return 30
}

function scoreCompetition(
  category: string | null | undefined,
  brand: string | null | undefined
): number {
  const cat = (category || '').toLowerCase()
  const br = (brand || '').toLowerCase()

  let brandScore = 80 // default: moderate competition
  if (HIGH_BRAND_COMPETITION.has(br)) {
    brandScore = 30 // high competition = low score
  } else if (br && !HIGH_BRAND_COMPETITION.has(br)) {
    brandScore = 90 // niche brand = low competition = high score
  }

  let catScore = 70
  if (HIGH_COMPETITION_CATEGORIES.has(cat)) {
    catScore = 30
  } else if (MEDIUM_COMPETITION_CATEGORIES.has(cat)) {
    catScore = 60
  } else if (cat) {
    catScore = 85
  }

  return Math.round(brandScore * 0.5 + catScore * 0.5)
}

function scoreConversion(rating: number | null | undefined): number {
  const r = rating ?? 0
  if (r > 4.5) return 100
  if (r >= 4.0) return 80
  if (r >= 3.5) return 60
  return 30
}

function derivePriority(total: number): 'P0' | 'P1' | 'P2' | 'SKIP' {
  if (total >= 80) return 'P0'
  if (total >= 60) return 'P1'
  if (total >= 40) return 'P2'
  return 'SKIP'
}

function deriveProfitProbability(total: number): 'high' | 'medium' | 'low' {
  if (total >= 75) return 'high'
  if (total >= 50) return 'medium'
  return 'low'
}

function estimateCpcRange(
  commissionRate: number | null | undefined,
  price: number | null | undefined,
  total: number
): { min: number; max: number } {
  const commission = ((price ?? 0) * (commissionRate ?? 0)) / 100
  // Break-even CPC at 3% conversion rate
  const breakEvenCpc = commission * 0.03
  if (total >= 80) return { min: Math.max(0.10, breakEvenCpc * 0.3), max: Math.max(0.30, breakEvenCpc * 0.7) }
  if (total >= 60) return { min: Math.max(0.10, breakEvenCpc * 0.2), max: Math.max(0.25, breakEvenCpc * 0.5) }
  return { min: 0.10, max: 0.20 }
}

function estimateRoas(
  commissionRate: number | null | undefined,
  price: number | null | undefined,
  total: number
): number {
  const commission = ((price ?? 0) * (commissionRate ?? 0)) / 100
  if (commission <= 0) return 0
  // Rough estimate: higher score = better ROAS
  if (total >= 80) return Math.round((commission / 0.30) * 0.03 * 100) / 100
  if (total >= 60) return Math.round((commission / 0.40) * 0.03 * 100) / 100
  return Math.round((commission / 0.50) * 0.03 * 100) / 100
}

export function scoreOffer(product: AffiliateProduct): OfferScore {
  const sc = scoreCommission(product.commission_rate)
  const sd = scoreDemand(product.review_count)
  const scomp = scoreCompetition(product.category, product.brand)
  const sconv = scoreConversion(product.rating)

  const total = Math.round(
    sc * WEIGHT_COMMISSION +
    sd * WEIGHT_DEMAND +
    scomp * WEIGHT_COMPETITION +
    sconv * WEIGHT_CONVERSION
  )

  const cpcRange = estimateCpcRange(product.commission_rate, product.price, total)

  return {
    asin: product.asin ?? null,
    offer_id: product.offer_id ?? null,
    score_total: total,
    score_commission: sc,
    score_demand: sd,
    score_competition: scomp,
    score_conversion: sconv,
    profit_probability: deriveProfitProbability(total),
    priority: derivePriority(total),
    suggested_cpc_min: cpcRange.min,
    suggested_cpc_max: cpcRange.max,
    estimated_roas: estimateRoas(product.commission_rate, product.price, total),
  }
}

export function batchScoreOffers(products: AffiliateProduct[]): OfferScore[] {
  return products.map(scoreOffer)
}

export function rankOffers(scores: OfferScore[], limit: number): OfferScore[] {
  return [...scores]
    .sort((a, b) => b.score_total - a.score_total)
    .slice(0, limit)
}

export async function saveOfferScore(
  userId: number,
  product: AffiliateProduct,
  score: OfferScore
): Promise<number> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  const result = await db.exec(
    `INSERT INTO openclaw_offer_scores
     (user_id, offer_id, asin, platform, commission_rate, product_rating,
      review_count, discount_percent, category, brand,
      score_total, score_commission, score_demand, score_competition, score_conversion,
      profit_probability, suggested_cpc_min, suggested_cpc_max, estimated_roas,
      priority, raw_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})`,
    [
      userId,
      product.offer_id ?? null,
      product.asin ?? null,
      product.platform ?? null,
      product.commission_rate ?? null,
      product.rating ?? null,
      product.review_count ?? 0,
      product.discount_percent ?? null,
      product.category ?? null,
      product.brand ?? null,
      score.score_total,
      score.score_commission,
      score.score_demand,
      score.score_competition,
      score.score_conversion,
      score.profit_probability,
      score.suggested_cpc_min,
      score.suggested_cpc_max,
      score.estimated_roas,
      score.priority,
      toDbJsonObjectField(product, db.type, null),
    ]
  )

  return getInsertedId(result, db.type)
}

export async function batchSaveOfferScores(
  userId: number,
  products: AffiliateProduct[]
): Promise<OfferScore[]> {
  const scores = batchScoreOffers(products)
  for (let i = 0; i < scores.length; i++) {
    await saveOfferScore(userId, products[i], scores[i])
  }
  return scores
}
