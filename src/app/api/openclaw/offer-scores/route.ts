import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listOfferScores, createOfferScore } from '@/lib/openclaw/offer-scores'
import { scoreOffer, batchScoreOffers, rankOffers, type AffiliateProduct } from '@/lib/openclaw/offer-scoring'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  offer_id: z.number().int().optional().nullable(),
  asin: z.string().max(20).optional().nullable(),
  platform: z.string().max(50).optional().nullable(),
  commission_rate: z.number().optional().nullable(),
  product_rating: z.number().optional().nullable(),
  review_count: z.number().int().optional().default(0),
  discount_percent: z.number().optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  brand: z.string().max(200).optional().nullable(),
  score_total: z.number().optional().default(0),
  score_commission: z.number().optional().default(0),
  score_demand: z.number().optional().default(0),
  score_competition: z.number().optional().default(0),
  score_conversion: z.number().optional().default(0),
  profit_probability: z.string().optional().default('low'),
  suggested_cpc_min: z.number().optional().nullable(),
  suggested_cpc_max: z.number().optional().nullable(),
  estimated_roas: z.number().optional().nullable(),
  priority: z.string().optional().default('P2'),
  raw_data: z.any().optional().nullable(),
})

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
  const priority = searchParams.get('priority') || undefined
  const orderBy = searchParams.get('orderBy') || undefined

  const data = await listOfferScores(auth.userId, {
    limit,
    priority,
    orderBy,
  })
  return NextResponse.json({ success: true, data })
}

const autoScoreSchema = z.object({
  mode: z.literal('auto-score'),
  products: z.array(z.object({
    asin: z.string().max(20).optional().nullable(),
    product_name: z.string().optional().nullable(),
    price: z.number().optional().nullable(),
    commission_rate: z.number().optional().nullable(),
    rating: z.number().optional().nullable(),
    review_count: z.number().int().optional().nullable(),
    discount_percent: z.number().optional().nullable(),
    brand: z.string().max(200).optional().nullable(),
    category: z.string().max(100).optional().nullable(),
    marketplace: z.string().optional().nullable(),
    has_promo_code: z.boolean().optional().nullable(),
    platform: z.string().max(50).optional().nullable(),
    offer_id: z.number().int().optional().nullable(),
  })).min(1).max(100),
  top: z.number().int().min(1).max(100).optional(),
})

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  // Auto-score mode: score products using the scoring engine
  if (body.mode === 'auto-score') {
    const parsed = autoScoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }

    try {
      const scores = batchScoreOffers(parsed.data.products as AffiliateProduct[])
      const ranked = parsed.data.top
        ? rankOffers(scores, parsed.data.top)
        : scores.sort((a, b) => b.score_total - a.score_total)

      // Persist scores
      for (let i = 0; i < ranked.length; i++) {
        const product = parsed.data.products.find(
          p => p.asin === ranked[i].asin || p.offer_id === ranked[i].offer_id
        ) || parsed.data.products[i]
        if (product) {
          await createOfferScore(auth.userId, {
            offer_id: product.offer_id ?? undefined,
            asin: product.asin ?? undefined,
            platform: product.platform ?? undefined,
            commission_rate: product.commission_rate ?? undefined,
            product_rating: product.rating ?? undefined,
            review_count: product.review_count ?? undefined,
            discount_percent: product.discount_percent ?? undefined,
            category: product.category ?? undefined,
            brand: product.brand ?? undefined,
            score_total: ranked[i].score_total,
            score_commission: ranked[i].score_commission,
            score_demand: ranked[i].score_demand,
            score_competition: ranked[i].score_competition,
            score_conversion: ranked[i].score_conversion,
            profit_probability: ranked[i].profit_probability,
            suggested_cpc_min: ranked[i].suggested_cpc_min,
            suggested_cpc_max: ranked[i].suggested_cpc_max,
            estimated_roas: ranked[i].estimated_roas,
            priority: ranked[i].priority,
            raw_data: product,
          })
        }
      }

      return NextResponse.json({ success: true, data: ranked })
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to score offers' },
        { status: 500 }
      )
    }
  }

  // Default mode: create a single score record directly
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  try {
    const record = await createOfferScore(auth.userId, parsed.data)
    return NextResponse.json({ success: true, data: record })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create offer score' },
      { status: 500 }
    )
  }
}
