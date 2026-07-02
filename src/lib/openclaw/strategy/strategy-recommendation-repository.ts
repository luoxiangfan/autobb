import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  normalizeRecommendationReportDate,
  normalizeStrategyRecommendationStatus,
  safeParseObject,
  toNumber,
} from './strategy-recommendation-utils'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

async function listRecommendations(params: {
  userId: number
  reportDate: string
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const db = await getDatabase()
  const rows = await db.query<any>(
    `
      SELECT
        id,
        user_id,
        report_date,
        campaign_id,
        google_campaign_id,
        snapshot_hash,
        recommendation_type,
        title,
        summary,
        reason,
        priority_score,
        status,
        data_json,
        executed_at,
        execution_result_json,
        created_at,
        updated_at
      FROM strategy_center_recommendations
      WHERE user_id = ?
        AND report_date = ?
      ORDER BY priority_score DESC, created_at DESC
      LIMIT ?
    `,
    [params.userId, params.reportDate, params.limit || 200]
  )

  return rows.map((row: any) => ({
    id: String(row.id),
    userId: Number(row.user_id),
    reportDate: normalizeRecommendationReportDate(row.report_date),
    campaignId: Number(row.campaign_id),
    googleCampaignId: row.google_campaign_id ? String(row.google_campaign_id) : null,
    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
    recommendationType: String(row.recommendation_type) as StrategyRecommendationType,
    title: String(row.title || ''),
    summary: row.summary ? String(row.summary) : null,
    reason: row.reason ? String(row.reason) : null,
    priorityScore: toNumber(row.priority_score, 0),
    status: normalizeStrategyRecommendationStatus(row.status),
    data: safeParseObject(row.data_json) as StrategyRecommendationData,
    executedAt: row.executed_at ? String(row.executed_at) : null,
    executionResult: safeParseObject(row.execution_result_json),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || '') }))
}

async function appendRecommendationEvent(params: {
  recommendationId: string
  userId: number
  eventType: string
  actorUserId?: number | null
  eventJson?: unknown
}) {
  const db = await getDatabase()
  await db.exec(
    `
      INSERT INTO strategy_center_recommendation_events
        (recommendation_id, user_id, event_type, actor_user_id, event_json)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      params.recommendationId,
      params.userId,
      params.eventType,
      params.actorUserId || null,
      toDbJsonObjectField(params.eventJson ?? null, null),
    ]
  )
}

async function getRecommendationById(params: {
  userId: number
  recommendationId: string
}): Promise<StrategyRecommendation | null> {
  const db = await getDatabase()
  const row = await db.queryOne<any>(
    `
      SELECT
        id,
        user_id,
        report_date,
        campaign_id,
        google_campaign_id,
        snapshot_hash,
        recommendation_type,
        title,
        summary,
        reason,
        priority_score,
        status,
        data_json,
        executed_at,
        execution_result_json,
        created_at,
        updated_at
      FROM strategy_center_recommendations
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    [params.recommendationId, params.userId]
  )

  if (!row) return null

  return {
    id: String(row.id),
    userId: Number(row.user_id),
    reportDate: normalizeRecommendationReportDate(row.report_date),
    campaignId: Number(row.campaign_id),
    googleCampaignId: row.google_campaign_id ? String(row.google_campaign_id) : null,
    snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
    recommendationType: String(row.recommendation_type) as StrategyRecommendationType,
    title: String(row.title || ''),
    summary: row.summary ? String(row.summary) : null,
    reason: row.reason ? String(row.reason) : null,
    priorityScore: toNumber(row.priority_score, 0),
    status: normalizeStrategyRecommendationStatus(row.status),
    data: safeParseObject(row.data_json) as StrategyRecommendationData,
    executedAt: row.executed_at ? String(row.executed_at) : null,
    executionResult: safeParseObject(row.execution_result_json),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || '') }
}
export { listRecommendations, appendRecommendationEvent, getRecommendationById }
