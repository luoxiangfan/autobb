/**
 * Batch-fix irrelevant competitors for an offer ID range.
 *
 * Strategy:
 * 1) Detect irrelevant competitors using the same relevance filter logic used in runtime.
 * 2) For impacted offers:
 *    - If all competitors are irrelevant: clear competitor_analysis + ai_competitive_edges.
 *    - Otherwise: keep relevant competitors only, reset derived competitor insights
 *      to avoid stale guidance from the old competitor set.
 *
 * Usage:
 *   npx tsx scripts/fix-irrelevant-competitors-range.ts \
 *     --database-url='postgresql://...' \
 *     --user-id=1 --from=3732 --to=3787 --dry-run
 *
 *   npx tsx scripts/fix-irrelevant-competitors-range.ts \
 *     --database-url='postgresql://...' \
 *     --user-id=1 --from=3732 --to=3787 --apply
 */

import postgres from 'postgres'
import {
  createCompetitorRelevanceContext,
  filterRelevantCompetitors,
} from '../src/lib/competitor-relevance-filter'
import type { CompetitorProduct } from '../src/lib/competitor-analyzer'

interface Args {
  databaseUrl: string
  userId: number
  from: number
  to: number
  apply: boolean
}

interface OfferRow {
  id: number
  offer_name: string | null
  category: string | null
  scraped_data: string | null
  competitor_analysis: string | null
}

interface OfferPlan {
  id: number
  offerName: string
  mode: string
  requiredSignals: string[]
  originalCount: number
  keptCount: number
  removedCount: number
  removedPreview: string[]
  action: 'clear' | 'rewrite'
  newCompetitorAnalysis: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    userId: 1,
    from: 3732,
    to: 3787,
    apply: false,
  }

  for (const arg of argv) {
    if (arg.startsWith('--database-url=')) {
      out.databaseUrl = arg.slice('--database-url='.length)
    } else if (arg.startsWith('--user-id=')) {
      out.userId = Number(arg.slice('--user-id='.length))
    } else if (arg.startsWith('--from=')) {
      out.from = Number(arg.slice('--from='.length))
    } else if (arg.startsWith('--to=')) {
      out.to = Number(arg.slice('--to='.length))
    } else if (arg === '--apply') {
      out.apply = true
    } else if (arg === '--dry-run') {
      out.apply = false
    }
  }

  if (!out.databaseUrl) {
    out.databaseUrl = process.env.DATABASE_URL || ''
  }

  if (!out.databaseUrl) {
    throw new Error('Missing --database-url (or DATABASE_URL env)')
  }
  if (!Number.isInteger(out.userId) || (out.userId || 0) <= 0) {
    throw new Error(`Invalid --user-id: ${String(out.userId)}`)
  }
  if (!Number.isInteger(out.from) || !Number.isInteger(out.to) || (out.from || 0) > (out.to || 0)) {
    throw new Error(`Invalid range: from=${String(out.from)}, to=${String(out.to)}`)
  }

  return out as Args
}

function safeParseObject(input: string | null | undefined): Record<string, any> | null {
  if (!input) return null
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

function toStringArray(input: any): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)
}

function normalizeCompetitor(input: any): CompetitorProduct | null {
  if (!input || typeof input !== 'object') return null

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null

  const sourceRaw = typeof input.source === 'string' ? input.source : 'related_products'
  const source: CompetitorProduct['source'] =
    sourceRaw === 'amazon_compare' ||
    sourceRaw === 'amazon_also_viewed' ||
    sourceRaw === 'amazon_similar' ||
    sourceRaw === 'same_category' ||
    sourceRaw === 'related_products'
      ? sourceRaw
      : 'related_products'

  return {
    asin: typeof input.asin === 'string' ? input.asin : null,
    name,
    brand: typeof input.brand === 'string' ? input.brand : null,
    price: typeof input.price === 'number' ? input.price : null,
    priceText: typeof input.priceText === 'string' ? input.priceText : null,
    rating: typeof input.rating === 'number' ? input.rating : null,
    reviewCount: typeof input.reviewCount === 'number' ? input.reviewCount : null,
    imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl : null,
    source,
    similarityScore: typeof input.similarityScore === 'number' ? input.similarityScore : undefined,
    features: toStringArray(input.features),
    productUrl: typeof input.productUrl === 'string' ? input.productUrl : null,
  }
}

function buildRewrittenCompetitorAnalysis(
  original: Record<string, any>,
  competitors: CompetitorProduct[]
): string {
  const now = new Date().toISOString()
  const rewritten = {
    ...original,
    competitors,
    totalCompetitors: competitors.length,
    // Reset derived outputs because they are based on old competitor sets.
    pricePosition: null,
    ratingPosition: null,
    featureComparison: [],
    uniqueSellingPoints: [],
    competitorAdvantages: [],
    competitorWeaknesses: [],
    analyzedAt: now,
    repairedBy: 'competitor_relevance_filter_2026_02_23',
  }

  return JSON.stringify(rewritten)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sql = postgres(args.databaseUrl, {
    max: 1,
    prepare: true,
  })

  try {
    const rows = await sql<OfferRow[]>`
      SELECT id, offer_name, category, scraped_data, competitor_analysis
      FROM offers
      WHERE user_id = ${args.userId}
        AND id BETWEEN ${args.from} AND ${args.to}
      ORDER BY id
    `

    const plans: OfferPlan[] = []

    for (const row of rows) {
      const analysisObj = safeParseObject(row.competitor_analysis)
      if (!analysisObj) continue

      const rawCompetitors = Array.isArray(analysisObj.competitors) ? analysisObj.competitors : []
      if (rawCompetitors.length === 0) continue

      const competitors = rawCompetitors
        .map((c) => normalizeCompetitor(c))
        .filter((c): c is CompetitorProduct => c !== null)

      if (competitors.length === 0) continue

      const scraped = safeParseObject(row.scraped_data)
      const context = createCompetitorRelevanceContext({
        productName: (scraped?.productName as string | null | undefined) || row.offer_name || null,
        category: (scraped?.category as string | null | undefined) || row.category || null,
        productCategory: row.category || null,
        features: toStringArray(scraped?.features),
        aboutThisItem: toStringArray(scraped?.aboutThisItem),
      })

      const { kept, removed } = filterRelevantCompetitors(competitors, context)
      if (removed.length === 0) continue

      const action: OfferPlan['action'] = kept.length === 0 ? 'clear' : 'rewrite'
      plans.push({
        id: row.id,
        offerName: row.offer_name || `Offer #${row.id}`,
        mode: context.mode,
        requiredSignals: context.requiredSignals,
        originalCount: competitors.length,
        keptCount: kept.length,
        removedCount: removed.length,
        removedPreview: removed.slice(0, 3).map((c) => c.name),
        action,
        newCompetitorAnalysis: action === 'rewrite'
          ? buildRewrittenCompetitorAnalysis(analysisObj, kept)
          : null,
      })
    }

    const clearCount = plans.filter((p) => p.action === 'clear').length
    const rewriteCount = plans.filter((p) => p.action === 'rewrite').length
    const removedTotal = plans.reduce((sum, p) => sum + p.removedCount, 0)

    console.log(`\n[range] user_id=${args.userId}, offers=${args.from}-${args.to}`)
    console.log(`[scan] total offers in range: ${rows.length}`)
    console.log(`[scan] impacted offers: ${plans.length}`)
    console.log(`[scan] total removed competitors: ${removedTotal}`)
    console.log(`[plan] clear=${clearCount}, rewrite=${rewriteCount}`)

    if (plans.length > 0) {
      console.log('\n[impacted offers]')
      for (const p of plans) {
        console.log(
          `- #${p.id} ${p.offerName} | mode=${p.mode} | ${p.originalCount} -> ${p.keptCount} (removed ${p.removedCount}) | action=${p.action}`
        )
        if (p.removedPreview.length > 0) {
          console.log(`  removed sample: ${p.removedPreview.join(' | ')}`)
        }
      }
    }

    if (!args.apply) {
      console.log('\n[dry-run] no data updated. re-run with --apply to execute fixes.')
      return
    }

    if (plans.length === 0) {
      console.log('\n[apply] no impacted offers. nothing to update.')
      return
    }

    await sql.begin(async (tx) => {
      for (const p of plans) {
        if (p.action === 'clear') {
          await tx`
            UPDATE offers
            SET competitor_analysis = NULL,
                ai_competitive_edges = NULL,
                updated_at = NOW()
            WHERE id = ${p.id}
              AND user_id = ${args.userId}
          `
        } else {
          await tx`
            UPDATE offers
            SET competitor_analysis = ${p.newCompetitorAnalysis},
                ai_competitive_edges = NULL,
                updated_at = NOW()
            WHERE id = ${p.id}
              AND user_id = ${args.userId}
          `
        }
      }
    })

    console.log(`\n[apply] updated offers: ${plans.length} (clear=${clearCount}, rewrite=${rewriteCount})`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[fatal]', error?.message || error)
  process.exit(1)
})
