import type {
  CampaignKeywordInventory,
  CampaignRow,
  CreativeRow,
  KeywordInventoryRow,
  SearchTermAgg,
  StrategyRecommendation,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import { refreshRecommendationsInflight } from './strategy-recommendation-refresh-state'
import { SEARCH_TERM_LOOKBACK_DAYS } from './strategy-recommendation-types'
import {
  buildPerfMap,
  extractCampaignConfigKeywordSet,
  formatLocalDate,
  normalizeBoolean,
  normalizeKeywordMatchType,
  roundTo2,
  sanitizeKeyword,
  shiftIsoDate,
  toNumber,
} from './strategy-recommendation-utils'
import {
  buildRecommendationDrafts,
  buildCooldownUntilByKey,
} from './strategy-recommendation-planners'
import { listRecommendations, appendRecommendationEvent } from './strategy-recommendation-repository'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'
import { normalizeOpenclawReportDate } from '@/lib/openclaw/runtime/report-date'

async function refreshStrategyRecommendations(params: {
  userId: number
  reportDate?: string
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const requestedReportDate = params.reportDate || formatLocalDate(new Date())
  const reportDate = normalizeOpenclawReportDate(requestedReportDate)
  const limit = params.limit || 200
  const inflightKey = `${params.userId}:${reportDate}:${limit}`
  const existingInflight = refreshRecommendationsInflight.get(inflightKey)
  if (existingInflight) {
    return existingInflight
  }

  const task = (async () => {
    const db = await getDatabase()
    const adsAccountIsActiveCondition = 'gaa.is_active = true'
    const adsAccountIsDeletedCondition = 'gaa.is_deleted = false'

    const campaigns = await db.query<CampaignRow>(
      `
        SELECT
          c.id,
          c.campaign_name,
          c.campaign_id,
          c.google_campaign_id,
          c.max_cpc,
          c.budget_amount,
          c.budget_type,
          c.created_at,
          c.published_at,
          c.offer_id,
          c.ad_creative_id,
          o.product_price,
          o.commission_payout,
          o.target_country,
          o.brand,
          o.category,
          o.product_name,
          COALESCE(gaa.currency, 'USD') AS currency,
          c.campaign_config
        FROM campaigns c
        LEFT JOIN offers o ON c.offer_id = o.id
        LEFT JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
        WHERE c.user_id = ?
          AND c.status = 'ENABLED'
          AND c.is_deleted = false
          AND (
            c.google_ads_account_id IS NULL
            OR (gaa.id IS NOT NULL AND ${adsAccountIsActiveCondition} AND ${adsAccountIsDeletedCondition})
          )
        ORDER BY c.created_at DESC
      `,
      [params.userId]
    )

    const endDate = reportDate
    const startDate7 = shiftIsoDate(endDate, -6)
    const startDateSearchTerm = shiftIsoDate(endDate, -(SEARCH_TERM_LOOKBACK_DAYS - 1))

    const [perf7Rows, perfTotalRows, commissionRows, keywordRows, searchTermRows, historicalSearchTermRows] = await Promise.all([
      db.query<{ campaign_id: number; impressions: number; clicks: number; cost: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, startDate7, endDate]
      ),
      db.query<{ campaign_id: number; impressions: number; clicks: number; cost: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS cost
          FROM campaign_performance
          WHERE user_id = ?
            AND date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, endDate]
      ),
      db.query<{ campaign_id: number; commission: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(SUM(commission_amount), 0) AS commission
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND campaign_id IS NOT NULL
            AND report_date <= ?
          GROUP BY campaign_id
        `,
        [params.userId, endDate]
      ),
      db.query<KeywordInventoryRow>(
        `
          SELECT
            ag.campaign_id,
            k.keyword_text,
            k.match_type,
            k.is_negative
          FROM ad_groups ag
          INNER JOIN keywords k ON k.ad_group_id = ag.id AND k.user_id = ?
          WHERE ag.user_id = ?
        `,
        [params.userId, params.userId]
      ),
      db.query<{
        campaign_id: number
        search_term: string
        impressions: number
        clicks: number
        conversions: number
        cost: number
      }>(
        `
          SELECT
            campaign_id,
            search_term,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(conversions), 0) AS conversions,
            COALESCE(SUM(cost), 0) AS cost
          FROM search_term_reports
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
          GROUP BY campaign_id, search_term
        `,
        [params.userId, startDateSearchTerm, endDate]
      ),
      db.query<{
        campaign_id: number
        search_term: string
        impressions_total: number
        clicks_total: number
        conversions_total: number
        cost_total: number
        impressions_recent: number
        clicks_recent: number
        conversions_recent: number
        cost_recent: number
        last_seen_date: string | null
      }>(
        `
          SELECT
            campaign_id,
            search_term,
            COALESCE(SUM(impressions), 0) AS impressions_total,
            COALESCE(SUM(clicks), 0) AS clicks_total,
            COALESCE(SUM(conversions), 0) AS conversions_total,
            COALESCE(SUM(cost), 0) AS cost_total,
            COALESCE(SUM(CASE WHEN date >= ? THEN impressions ELSE 0 END), 0) AS impressions_recent,
            COALESCE(SUM(CASE WHEN date >= ? THEN clicks ELSE 0 END), 0) AS clicks_recent,
            COALESCE(SUM(CASE WHEN date >= ? THEN conversions ELSE 0 END), 0) AS conversions_recent,
            COALESCE(SUM(CASE WHEN date >= ? THEN cost ELSE 0 END), 0) AS cost_recent,
            MAX(date) AS last_seen_date
          FROM search_term_reports
          WHERE user_id = ?
            AND date <= ?
          GROUP BY campaign_id, search_term
          HAVING COALESCE(SUM(clicks), 0) > 0
        `,
        [startDateSearchTerm, startDateSearchTerm, startDateSearchTerm, startDateSearchTerm, params.userId, endDate]
      ),
    ])

    const perf7dByCampaign = buildPerfMap(perf7Rows || [])
    const perfTotalByCampaign = buildPerfMap(perfTotalRows || [])
    const commissionByCampaign = new Map<number, number>()
    for (const row of commissionRows || []) {
      const id = Number(row.campaign_id)
      if (!Number.isFinite(id)) continue
      commissionByCampaign.set(id, roundTo2(toNumber(row.commission, 0)))
    }

    const keywordInventoryByCampaign = new Map<number, CampaignKeywordInventory[]>()
    const keywordsByCampaign = new Map<number, Set<string>>()
    for (const row of (keywordRows || []) as KeywordInventoryRow[]) {
      const campaignId = Number(row.campaign_id)
      const keywordText = sanitizeKeyword(String(row.keyword_text || ''))
      if (!Number.isFinite(campaignId) || !keywordText) continue
      const matchType = normalizeKeywordMatchType(row.match_type) || 'PHRASE'
      const isNegative = normalizeBoolean(row.is_negative)
      const inventory = keywordInventoryByCampaign.get(campaignId) || []
      inventory.push({
        text: keywordText,
        matchType,
        isNegative })
      keywordInventoryByCampaign.set(campaignId, inventory)
      if (isNegative) {
        continue
      }
      const normalized = keywordText.toLowerCase()
      const set = keywordsByCampaign.get(campaignId) || new Set<string>()
      set.add(normalized)
      keywordsByCampaign.set(campaignId, set)
    }

    const searchTermsByCampaign = new Map<number, SearchTermAgg[]>()
    for (const row of searchTermRows || []) {
      const campaignId = Number(row.campaign_id)
      const searchTerm = sanitizeKeyword(String(row.search_term || ''))
      if (!Number.isFinite(campaignId) || !searchTerm) continue
      const bucket = searchTermsByCampaign.get(campaignId) || []
      bucket.push({
        searchTerm,
        impressions: toNumber(row.impressions, 0),
        clicks: toNumber(row.clicks, 0),
        conversions: toNumber(row.conversions, 0),
        cost: roundTo2(toNumber(row.cost, 0)) })
      searchTermsByCampaign.set(campaignId, bucket)
    }

    const historicalSearchTermsByCampaign = new Map<number, SearchTermAgg[]>()
    for (const row of historicalSearchTermRows || []) {
      const campaignId = Number(row.campaign_id)
      const searchTerm = sanitizeKeyword(String(row.search_term || ''))
      if (!Number.isFinite(campaignId) || !searchTerm) continue
      const bucket = historicalSearchTermsByCampaign.get(campaignId) || []
      bucket.push({
        searchTerm,
        impressions: toNumber(row.impressions_total, 0),
        clicks: toNumber(row.clicks_total, 0),
        conversions: toNumber(row.conversions_total, 0),
        cost: roundTo2(toNumber(row.cost_total, 0)),
        recentImpressions: toNumber(row.impressions_recent, 0),
        recentClicks: toNumber(row.clicks_recent, 0),
        recentConversions: toNumber(row.conversions_recent, 0),
        recentCost: roundTo2(toNumber(row.cost_recent, 0)),
        lastSeenDate: row.last_seen_date || null })
      historicalSearchTermsByCampaign.set(campaignId, bucket)
    }

    const creativeIds = Array.from(
      new Set(campaigns
        .map((campaign) => Number(campaign.ad_creative_id))
        .filter((id) => Number.isFinite(id) && id > 0))
    )
    const creativeById = new Map<number, CreativeRow>()
    if (creativeIds.length > 0) {
      const placeholders = creativeIds.map(() => '?').join(', ')
      const rows = await db.query<CreativeRow>(
        `
          SELECT id, headlines, descriptions, keywords, keywords_with_volume
          FROM ad_creatives
          WHERE user_id = ?
            AND id IN (${placeholders})
        `,
        [params.userId, ...creativeIds]
      )
      for (const row of rows) {
        creativeById.set(Number(row.id), row)
      }
    }

    for (const campaign of campaigns) {
      const campaignId = Number(campaign.id)
      if (!Number.isFinite(campaignId)) continue
      const inventoryKeywordSet = keywordsByCampaign.get(campaignId) || new Set<string>()
      const configKeywordSet = extractCampaignConfigKeywordSet(campaign.campaign_config)
      const keywordSet = new Set<string>(configKeywordSet)
      for (const item of inventoryKeywordSet) {
        keywordSet.add(item)
      }
      if (keywordSet.size > 0) {
        keywordsByCampaign.set(campaignId, keywordSet)
      }
    }

    const executedRecommendationRows = await db.query<{
      campaign_id: number
      recommendation_type: string
      executed_at: string | null
    }>(
      `
        SELECT campaign_id, recommendation_type, executed_at
        FROM strategy_center_recommendations
        WHERE user_id = ?
          AND status = 'executed'
          AND executed_at IS NOT NULL
        ORDER BY executed_at DESC
        LIMIT 1000
      `,
      [params.userId]
    )
    const cooldownUntilByKey = buildCooldownUntilByKey(executedRecommendationRows || [])

    const drafts = buildRecommendationDrafts({
      campaigns,
      perf7dByCampaign,
      perfTotalByCampaign,
      commissionByCampaign,
      keywordsByCampaign,
      keywordInventoryByCampaign,
      searchTermsByCampaign,
      historicalSearchTermsByCampaign,
      creativeById,
      cooldownUntilByKey,
      nowMs: Date.now() })

    const existingRows = await db.query<{
      id: string
      campaign_id: number
      recommendation_type: StrategyRecommendationType
      snapshot_hash: string | null
    }>(
      `
        SELECT id, campaign_id, recommendation_type, snapshot_hash
        FROM strategy_center_recommendations
        WHERE user_id = ?
          AND report_date = ?
      `,
      [params.userId, reportDate]
    )

    const existingByKey = new Map<string, {
      id: string
      snapshotHash: string | null
    }>()
    for (const row of existingRows || []) {
      existingByKey.set(`${row.campaign_id}:${row.recommendation_type}`, {
        id: row.id,
        snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null })
    }

    const generatedIds: string[] = []
    for (const draft of drafts) {
      const existing = existingByKey.get(draft.key)
      const recommendationId = existing?.id || crypto.randomUUID()
      generatedIds.push(recommendationId)
      const snapshotHash = draft.data.snapshotHash || null
      const shouldAppendGeneratedEvent = !existing || String(existing.snapshotHash || '') !== String(snapshotHash || '')

      await db.exec(
        `
          INSERT INTO strategy_center_recommendations
            (
              id,
              user_id,
              report_date,
              campaign_id,
              google_campaign_id,
              recommendation_type,
              title,
              summary,
              reason,
              priority_score,
              status,
              snapshot_hash,
              data_json,
              created_at,
              updated_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON CONFLICT(user_id, report_date, campaign_id, recommendation_type)
          DO UPDATE SET
            google_campaign_id = excluded.google_campaign_id,
            title = excluded.title,
            summary = excluded.summary,
            reason = excluded.reason,
            priority_score = excluded.priority_score,
            snapshot_hash = excluded.snapshot_hash,
            data_json = CASE
              WHEN strategy_center_recommendations.status = 'executed'
                THEN strategy_center_recommendations.data_json
              ELSE excluded.data_json
            END,
            status = CASE
              WHEN strategy_center_recommendations.status = 'executed' THEN strategy_center_recommendations.status
              WHEN strategy_center_recommendations.status = 'dismissed'
                AND strategy_center_recommendations.snapshot_hash = excluded.snapshot_hash
                THEN strategy_center_recommendations.status
              ELSE excluded.status
            END,
            updated_at = NOW()
        `,
        [
          recommendationId,
          params.userId,
          reportDate,
          draft.campaignId,
          draft.googleCampaignId,
          draft.recommendationType,
          draft.title,
          draft.summary,
          draft.reason,
          draft.priorityScore,
          'pending',
          snapshotHash,
          toDbJsonObjectField(draft.data, draft.data),
        ]
      )

      if (shouldAppendGeneratedEvent) {
        await appendRecommendationEvent({
          recommendationId,
          userId: params.userId,
          eventType: 'generated',
          actorUserId: params.userId,
          eventJson: {
            recommendationType: draft.recommendationType,
            priorityScore: draft.priorityScore,
            snapshotHash } })
      }
    }

    if (generatedIds.length > 0) {
      const placeholders = generatedIds.map(() => '?').join(', ')
      await db.exec(
        `
          DELETE FROM strategy_center_recommendations
          WHERE user_id = ?
            AND report_date = ?
            AND status = 'pending'
            AND id NOT IN (${placeholders})
        `,
        [params.userId, reportDate, ...generatedIds]
      )

      // 对于当次未再命中的建议，标记为 stale（待重算），避免继续执行历史结果。
      await db.exec(
        `
          UPDATE strategy_center_recommendations
          SET status = 'stale',
              updated_at = NOW()
          WHERE user_id = ?
            AND report_date = ?
            AND status NOT IN ('pending', 'executed', 'dismissed', 'stale')
            AND id NOT IN (${placeholders})
        `,
        [params.userId, reportDate, ...generatedIds]
      )
    } else {
      await db.exec(
        `
          DELETE FROM strategy_center_recommendations
          WHERE user_id = ?
            AND report_date = ?
            AND status = 'pending'
        `,
        [params.userId, reportDate]
      )

      await db.exec(
        `
          UPDATE strategy_center_recommendations
          SET status = 'stale',
              updated_at = NOW()
          WHERE user_id = ?
            AND report_date = ?
            AND status NOT IN ('pending', 'executed', 'dismissed', 'stale')
        `,
        [params.userId, reportDate]
      )
    }

    return listRecommendations({
      userId: params.userId,
      reportDate,
      limit: params.limit })
  })()

  refreshRecommendationsInflight.set(inflightKey, task)
  try {
    return await task
  } finally {
    if (refreshRecommendationsInflight.get(inflightKey) === task) {
      refreshRecommendationsInflight.delete(inflightKey)
    }
  }
}

async function getStrategyRecommendations(params: {
  userId: number
  reportDate?: string
  forceRefresh?: boolean
  limit?: number
}): Promise<StrategyRecommendation[]> {
  const requestedReportDate = params.reportDate || formatLocalDate(new Date())
  const reportDate = normalizeOpenclawReportDate(requestedReportDate)
  if (params.forceRefresh) {
    return refreshStrategyRecommendations({
      userId: params.userId,
      reportDate,
      limit: params.limit })
  }

  const existing = await listRecommendations({
    userId: params.userId,
    reportDate,
    limit: params.limit })
  if (existing.length > 0) {
    return existing
  }

  return refreshStrategyRecommendations({
    userId: params.userId,
    reportDate,
    limit: params.limit })
}
export { refreshStrategyRecommendations, getStrategyRecommendations }
