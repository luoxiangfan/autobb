import { getDatabase } from '@/lib/db'
import { datetimeMinusHours, datetimeMinusMinutes } from '@/lib/db-helpers'
import { normalizeTimestampToIso, parseDbDateTimeAsUtc } from '@/lib/db-datetime'
import { createRiskAlert } from '@/lib/risk-alerts'

export interface CreativePublishTimeoutCheckOptions {
  thresholdMinutes?: number
  lookbackHours?: number
  limit?: number
}

export interface CreativePublishTimeoutCheckResult {
  thresholdMinutes: number
  lookbackHours: number
  scannedOffers: number
  stalledOffers: number
  alertsTriggered: number
  skippedWithPublishRequest: number
  stalledOfferIds: number[]
}

interface CandidateRow {
  offer_id: number
  user_id: number
  latest_completed_at: unknown
  latest_task_id: string | null
  latest_creative_id: number | null
}

interface PublishLogRow {
  request_body_json: string | null
  created_at: unknown
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string') {
    const parsed = parseDbDateTimeAsUtc(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (value === null || value === undefined) return null
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function extractOfferIdFromPublishBody(rawBody: string | null): number | null {
  const body = String(rawBody || '').trim()
  if (!body) return null

  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null
    if (parsed && typeof parsed === 'object') {
      return toPositiveInt(parsed.offerId ?? parsed.offer_id)
    }
  } catch {
    // 兼容异常日志格式：尝试正则兜底提取 offerId
  }

  const match = body.match(/"offer(?:Id|_id)"\s*:\s*(\d+)/)
  if (!match?.[1]) return null
  return toPositiveInt(match[1])
}

function clampPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.floor(parsed)
  if (normalized < min) return min
  if (normalized > max) return max
  return normalized
}

/**
 * 检查“创意已完成但迟迟未发布”的可疑链路断点，并写入风险提示。
 */
export async function checkCreativePublishTimeouts(
  options: CreativePublishTimeoutCheckOptions = {}
): Promise<CreativePublishTimeoutCheckResult> {
  const db = await getDatabase()

  const thresholdMinutes = clampPositiveInt(options.thresholdMinutes, 90, 10, 24 * 60)
  const lookbackHours = clampPositiveInt(options.lookbackHours, 48, 1, 30 * 24)
  const limit = clampPositiveInt(options.limit, 500, 1, 5000)

  const staleBeforeExpr = datetimeMinusMinutes(thresholdMinutes, db.type)
  const lookbackExpr = datetimeMinusHours(lookbackHours, db.type)
  const isDeletedFalse = db.type === 'postgres' ? false : 0

  const candidates = await db.query<CandidateRow>(
    `
    WITH latest_completed AS (
      SELECT
        ct.offer_id,
        o.user_id,
        ct.completed_at AS latest_completed_at,
        ct.id AS latest_task_id,
        ROW_NUMBER() OVER (
          PARTITION BY ct.offer_id, o.user_id
          ORDER BY ct.completed_at DESC, ct.created_at DESC, ct.id DESC
        ) AS row_num
      FROM creative_tasks ct
      INNER JOIN offers o ON o.id = ct.offer_id
      WHERE ct.status = 'completed'
        AND ct.completed_at IS NOT NULL
        AND ct.completed_at >= ${lookbackExpr}
        AND ct.completed_at <= ${staleBeforeExpr}
        AND (o.is_deleted = ? OR o.is_deleted IS NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM campaigns c
          WHERE c.offer_id = ct.offer_id
            AND c.user_id = o.user_id
            AND (c.is_deleted = ? OR c.is_deleted IS NULL)
        )
    )
    SELECT
      lc.offer_id,
      lc.user_id,
      lc.latest_completed_at,
      lc.latest_task_id,
      (
        SELECT ac.id
        FROM ad_creatives ac
        WHERE ac.offer_id = lc.offer_id
          AND ac.user_id = lc.user_id
        ORDER BY ac.created_at DESC, ac.id DESC
        LIMIT 1
      ) AS latest_creative_id
    FROM latest_completed lc
    WHERE lc.row_num = 1
    ORDER BY lc.latest_completed_at ASC
    LIMIT ?
    `,
    [isDeletedFalse, isDeletedFalse, limit]
  )

  const publishLogs = await db.query<PublishLogRow>(
    `
    SELECT request_body_json, created_at
    FROM openclaw_command_runs
    WHERE request_path = '/api/campaigns/publish'
      AND request_body_json IS NOT NULL
      AND request_body_json != ''
      AND created_at >= ${lookbackExpr}
    `
  )

  const latestPublishByOffer = new Map<number, Date>()
  for (const log of publishLogs) {
    const offerId = extractOfferIdFromPublishBody(log.request_body_json)
    if (!offerId) continue
    const createdAt = toDate(log.created_at)
    if (!createdAt) continue

    const existing = latestPublishByOffer.get(offerId)
    if (!existing || createdAt.getTime() > existing.getTime()) {
      latestPublishByOffer.set(offerId, createdAt)
    }
  }

  let stalledOffers = 0
  let alertsTriggered = 0
  let skippedWithPublishRequest = 0
  const stalledOfferIds: number[] = []

  for (const row of candidates) {
    const completedAt = toDate(row.latest_completed_at)
    if (!completedAt) continue

    const latestPublishAt = latestPublishByOffer.get(row.offer_id)
    if (latestPublishAt && latestPublishAt.getTime() >= completedAt.getTime()) {
      skippedWithPublishRequest += 1
      continue
    }

    stalledOffers += 1
    stalledOfferIds.push(row.offer_id)

    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - completedAt.getTime()) / (1000 * 60)))
    const alertId = await createRiskAlert(
      row.user_id,
      'creative_publish_timeout',
      'warning',
      `创意完成后未发布 - Offer #${row.offer_id}`,
      `Offer #${row.offer_id} 创意已完成 ${elapsedMinutes} 分钟，但尚未检测到发布请求`,
      {
        resourceType: 'offer',
        resourceId: row.offer_id,
        details: {
          offerId: row.offer_id,
          latestCreativeTaskId: row.latest_task_id,
          latestCreativeId: row.latest_creative_id,
          latestCreativeTaskCompletedAt: normalizeTimestampToIso(row.latest_completed_at),
          latestPublishRequestAt: normalizeTimestampToIso(latestPublishAt),
          thresholdMinutes,
          lookbackHours,
        },
      }
    )

    if (alertId > 0) {
      alertsTriggered += 1
    }
  }

  return {
    thresholdMinutes,
    lookbackHours,
    scannedOffers: candidates.length,
    stalledOffers,
    alertsTriggered,
    skippedWithPublishRequest,
    stalledOfferIds,
  }
}
