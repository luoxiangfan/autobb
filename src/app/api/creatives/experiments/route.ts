import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getDatabase } from '@/lib/db'

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

function parseJsonValue(value: unknown): any {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const dynamic = 'force-dynamic'

/**
 * GET /api/creatives/experiments
 * Query:
 * - campaignId: number (optional)
 * - status: string (optional)
 * - limit: number (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(parsePositiveInt(searchParams.get('limit'), 50), 200)
    const campaignId = parseOptionalInt(searchParams.get('campaignId'))
    const status = searchParams.get('status')?.trim() || null

    const db = await getDatabase()

    const conditions: string[] = ['er.user_id = ?']
    const params: any[] = [auth.userId]

    if (campaignId) {
      conditions.push('er.campaign_id = ?')
      params.push(campaignId)
    }

    if (status) {
      conditions.push("LOWER(COALESCE(er.status, '')) = ?")
      params.push(status.toLowerCase())
    }

    params.push(limit)

    const rows = await db.query<any>(
      `
        SELECT
          er.id,
          er.experiment_name,
          er.experiment_type,
          er.offer_id,
          er.campaign_id,
          er.variant_a,
          er.variant_b,
          er.metrics_a,
          er.metrics_b,
          er.winner,
          er.confidence,
          er.conclusion,
          er.status,
          er.started_at,
          er.ended_at,
          er.created_at,
          c.campaign_name,
          c.google_campaign_id,
          c.ad_creative_id,
          o.brand as offer_brand,
          o.offer_name,
          ac.headlines as creative_headlines,
          ac.descriptions as creative_descriptions,
          ac.score as creative_score
        FROM openclaw_experiment_results er
        LEFT JOIN campaigns c ON er.campaign_id = c.id AND c.user_id = er.user_id
        LEFT JOIN offers o ON er.offer_id = o.id
        LEFT JOIN ad_creatives ac ON c.ad_creative_id = ac.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY er.created_at DESC
        LIMIT ?
      `,
      params
    )

    const data = (rows || []).map((row: any) => ({
      id: Number(row.id),
      experimentName: row.experiment_name,
      experimentType: row.experiment_type,
      status: row.status,
      winner: row.winner,
      confidence: row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
      conclusion: row.conclusion || null,
      startedAt: row.started_at || null,
      endedAt: row.ended_at || null,
      createdAt: row.created_at || null,
      offer: row.offer_id
        ? {
          offerId: Number(row.offer_id),
          brand: row.offer_brand || null,
          offerName: row.offer_name || null,
        }
        : null,
      campaign: row.campaign_id
        ? {
          campaignId: Number(row.campaign_id),
          campaignName: row.campaign_name || null,
          googleCampaignId: row.google_campaign_id || null,
        }
        : null,
      creativeContext: row.ad_creative_id
        ? {
          creativeId: Number(row.ad_creative_id),
          score: row.creative_score === null || row.creative_score === undefined
            ? null
            : Number(row.creative_score),
          headlines: parseJsonValue(row.creative_headlines),
          descriptions: parseJsonValue(row.creative_descriptions),
        }
        : null,
      variants: {
        a: parseJsonValue(row.variant_a),
        b: parseJsonValue(row.variant_b),
      },
      metrics: {
        a: parseJsonValue(row.metrics_a),
        b: parseJsonValue(row.metrics_b),
      },
    }))

    const summary = {
      total: data.length,
      running: data.filter((item) => String(item.status || '').toLowerCase() === 'running').length,
      completed: data.filter((item) => String(item.status || '').toLowerCase() === 'completed').length,
      withWinner: data.filter((item) => Boolean(item.winner)).length,
    }

    return NextResponse.json({
      success: true,
      data,
      summary,
      filters: {
        campaignId,
        status,
        limit,
      },
      meta: {
        source: 'openclaw_experiment_results',
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '创意实验结果查询失败' },
      { status: 500 }
    )
  }
}
