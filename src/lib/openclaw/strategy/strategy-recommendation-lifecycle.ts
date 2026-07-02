import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationQueueTaskData,
  StrategyRecommendationType,
  StrategyPostReviewStatus,
  QueueStrategyRecommendationExecutionResult,
} from './strategy-recommendation-types'
import {
  T_MINUS_1_EXECUTION_ALLOWED_TYPES,
  T_MINUS_1_EXECUTION_ALLOWED_TYPES_TEXT,
  MS_PER_DAY,
  POST_REVIEW_DEFAULT_WINDOW_DAYS,
  POST_REVIEW_MIN_CLICKS,
  POST_REVIEW_MIN_COST,
  POST_REVIEW_MIN_IMPRESSIONS,
  POST_REVIEW_MIN_OBSERVED_DAYS,
} from './strategy-recommendation-types'
import {
  buildDeterministicRecommendationExecuteTaskId,
  formatLocalDate,
  hasSignalSample,
  parseExecutionResultObject,
  parseReviewWindowDays,
  roundTo2,
  shiftIsoDate,
  toIsoTimestampFromEpoch,
  toNumber,
} from './strategy-recommendation-utils'
import {
  appendRecommendationEvent,
  getRecommendationById,
} from './strategy-recommendation-repository'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

async function dismissStrategyRecommendation(params: {
  userId: number
  recommendationId: string
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const existing = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!existing) {
    throw new Error('建议不存在或无权限访问')
  }
  if (existing.status === 'executed') {
    throw new Error('已执行建议不支持暂不执行')
  }

  await db.exec(
    `
      UPDATE strategy_center_recommendations
      SET status = 'dismissed',
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [params.recommendationId, params.userId]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'dismissed',
    actorUserId: params.userId,
    eventJson: {
      snapshotHash: existing.snapshotHash || null } })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!latest) {
    throw new Error('建议设为暂不执行后读取失败')
  }
  return latest
}

async function assertStrategyRecommendationReadyForExecution(params: {
  userId: number
  recommendationId: string
  confirm: boolean
}): Promise<StrategyRecommendation> {
  if (!params.confirm) {
    throw new Error('执行前需要二次确认')
  }

  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }
  const serverDate = formatLocalDate(new Date())
  const recommendationDate = String(recommendation.reportDate || '').trim()
  const tMinus1Date = shiftIsoDate(serverDate, -1)
  const allowTMinus1Execution =
    recommendationDate === tMinus1Date
    && T_MINUS_1_EXECUTION_ALLOWED_TYPES.has(recommendation.recommendationType)
  if (recommendationDate !== serverDate && !allowTMinus1Execution) {
    if (recommendationDate === tMinus1Date) {
      throw new Error(
        `T-1建议仅支持执行以下类型（${tMinus1Date}）：${T_MINUS_1_EXECUTION_ALLOWED_TYPES_TEXT}；当前类型 ${recommendation.recommendationType} 仅支持当天（${serverDate}）执行`
      )
    }
    throw new Error(`仅支持执行当天策略建议（${serverDate}）；历史建议仅开放T-1（${tMinus1Date}）部分类型执行`)
  }
  if (recommendation.status === 'executed') {
    return recommendation
  }
  if (recommendation.status === 'dismissed') {
    throw new Error('建议已暂不执行，请重新分析后再执行')
  }
  if (recommendation.status === 'stale') {
    throw new Error('建议内容已更新，请重新分析后再执行')
  }

  return recommendation
}

async function markStrategyRecommendationQueued(params: {
  userId: number
  recommendationId: string
  taskId: string
  queuedAt?: string
  taskStatus?: string
  retryCount?: number
  taskError?: string | null
  taskCreatedAt?: number | null
  taskStartedAt?: number | null
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }

  const queuedAt = params.queuedAt || new Date().toISOString()
  const retryCount = Number(params.retryCount)
  const normalizedRetryCount = Number.isFinite(retryCount) && retryCount >= 0
    ? Math.floor(retryCount)
    : undefined
  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...existingExecutionResult,
    // 重新入队时清理上一次失败态，避免前端继续展示旧错误。
    error: null,
    failedAt: null,
    queued: true,
    queueTaskId: params.taskId,
    queueTaskStatus: String(params.taskStatus || 'pending'),
    queuedAt,
    queueUpdatedAt: queuedAt,
    queueRetryCount: normalizedRetryCount,
    queueTaskError: params.taskError ? String(params.taskError) : null,
    queueTaskCreatedAt:
      toIsoTimestampFromEpoch(params.taskCreatedAt)
      || existingExecutionResult.queueTaskCreatedAt
      || null,
    queueTaskStartedAt:
      toIsoTimestampFromEpoch(params.taskStartedAt)
      || existingExecutionResult.queueTaskStartedAt
      || null }

  await db.exec(
    `
      UPDATE strategy_center_recommendations
      SET status = 'pending',
          execution_result_json = ?,
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextExecutionResult, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'execute_queued',
    actorUserId: params.userId,
    eventJson: {
      taskId: params.taskId,
      queuedAt } })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!latest) {
    throw new Error('写入执行队列状态失败')
  }
  return latest
}

async function markStrategyRecommendationReviewQueued(params: {
  userId: number
  recommendationId: string
  taskId: string
  scheduledAt: string
}) {
  const db = await getDatabase()
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }

  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...existingExecutionResult,
    postReviewTaskId: params.taskId,
    postReviewScheduledAt: params.scheduledAt }
  const nextData: StrategyRecommendationData = {
    ...(recommendation.data || ({} as StrategyRecommendationData)),
    postReviewStatus: 'pending_window' }

  await db.exec(
    `
      UPDATE strategy_center_recommendations
      SET data_json = ?,
          execution_result_json = ?,
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextData, nextData),
      toDbJsonObjectField(nextExecutionResult, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'post_review_queued',
    actorUserId: params.userId,
    eventJson: {
      taskId: params.taskId,
      scheduledAt: params.scheduledAt } })
}

function computeReviewDateRange(params: {
  executedAtMs: number
  reviewWindowDays: number
  nowMs: number
}) {
  const baselineStartDate = formatLocalDate(new Date(params.executedAtMs - params.reviewWindowDays * MS_PER_DAY))
  const baselineEndDate = formatLocalDate(new Date(params.executedAtMs - MS_PER_DAY))
  const afterStartDate = formatLocalDate(new Date(params.executedAtMs))
  const afterWindowEndMs = params.executedAtMs + params.reviewWindowDays * MS_PER_DAY - MS_PER_DAY
  const afterEndMs = Math.min(params.nowMs, afterWindowEndMs)
  const afterEndDate = formatLocalDate(new Date(afterEndMs))
  return {
    baselineStartDate,
    baselineEndDate,
    afterStartDate,
    afterEndDate,
    afterEndMs }
}

async function aggregateCampaignWindow(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  userId: number
  campaignId: number
  startDate: string
  endDate: string
}) {
  const perf = await params.db.queryOne<{
    impressions: number
    clicks: number
    cost: number
  }>(
    `
      SELECT
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(cost), 0) AS cost
      FROM campaign_performance
      WHERE user_id = ?
        AND campaign_id = ?
        AND date >= ?
        AND date <= ?
    `,
    [params.userId, params.campaignId, params.startDate, params.endDate]
  )

  const commission = await params.db.queryOne<{ commission: number }>(
    `
      SELECT COALESCE(SUM(commission_amount), 0) AS commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND campaign_id = ?
        AND report_date >= ?
        AND report_date <= ?
    `,
    [params.userId, params.campaignId, params.startDate, params.endDate]
  )

  const impressions = toNumber(perf?.impressions, 0)
  const clicks = toNumber(perf?.clicks, 0)
  const cost = roundTo2(toNumber(perf?.cost, 0))
  const commissionAmount = roundTo2(toNumber(commission?.commission, 0))

  return {
    impressions,
    clicks,
    cost,
    ctrPct: impressions > 0 ? roundTo2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? roundTo2(cost / clicks) : 0,
    commission: commissionAmount,
    roas: cost > 0 ? roundTo2(commissionAmount / cost) : null as number | null }
}

function pctChange(after: number, before: number): number | null {
  if (!(before > 0)) return null
  return roundTo2(((after - before) / before) * 100)
}

function evaluatePostReviewStatus(params: {
  recommendationType: StrategyRecommendationType
  observedDays?: number
  reviewWindowDays?: number
  baseline: {
    impressions: number
    clicks: number
    cost: number
    ctrPct: number
    roas: number | null
  }
  after: {
    impressions: number
    clicks: number
    cost: number
    ctrPct: number
    roas: number | null
  }
}): StrategyPostReviewStatus {
  const observedDays = Math.max(1, Math.floor(toNumber(params.observedDays, 1)))
  const reviewWindowDays = Math.max(1, Math.floor(toNumber(params.reviewWindowDays, observedDays)))
  const minObservedDays = Math.min(POST_REVIEW_MIN_OBSERVED_DAYS, reviewWindowDays)
  if (observedDays < minObservedDays) {
    return 'pending_window'
  }

  const noData = params.baseline.impressions <= 0
    && params.baseline.clicks <= 0
    && params.baseline.cost <= 0
    && params.after.impressions <= 0
    && params.after.clicks <= 0
    && params.after.cost <= 0
  if (noData) {
    return 'no_data'
  }

  const baselineHasSample = hasSignalSample({
    impressions: params.baseline.impressions,
    clicks: params.baseline.clicks,
    cost: params.baseline.cost,
    minImpressions: POST_REVIEW_MIN_IMPRESSIONS,
    minClicks: POST_REVIEW_MIN_CLICKS,
    minCost: POST_REVIEW_MIN_COST })
  const afterHasSample = hasSignalSample({
    impressions: params.after.impressions,
    clicks: params.after.clicks,
    cost: params.after.cost,
    minImpressions: POST_REVIEW_MIN_IMPRESSIONS,
    minClicks: POST_REVIEW_MIN_CLICKS,
    minCost: POST_REVIEW_MIN_COST })
  if (!baselineHasSample && !afterHasSample) {
    return 'no_data'
  }

  const costPct = pctChange(params.after.cost, params.baseline.cost)
  const clicksPct = pctChange(params.after.clicks, params.baseline.clicks)
  const roasDiff =
    params.after.roas !== null && params.baseline.roas !== null
      ? roundTo2(params.after.roas - params.baseline.roas)
      : null

  if (params.recommendationType === 'offline_campaign') {
    if (params.after.cost <= params.baseline.cost * 0.35) return 'effective'
    if (params.after.cost <= params.baseline.cost * 0.6) return 'mixed'
    return 'ineffective'
  }

  if (params.recommendationType === 'adjust_budget' || params.recommendationType === 'expand_keywords') {
    if ((clicksPct !== null && clicksPct >= 15) && (roasDiff === null || roasDiff >= -0.1)) {
      return 'effective'
    }
    if ((clicksPct !== null && clicksPct >= 5) || (costPct !== null && costPct >= 5)) {
      return 'mixed'
    }
    return 'ineffective'
  }

  if ((costPct !== null && costPct <= -10) && (clicksPct === null || clicksPct >= -20)) {
    return 'effective'
  }
  if ((costPct !== null && costPct <= -5) || (clicksPct !== null && clicksPct >= 0)) {
    return 'mixed'
  }
  return 'ineffective'
}

async function reviewStrategyRecommendationEffect(params: {
  userId: number
  recommendationId: string
  force?: boolean
}): Promise<StrategyRecommendation> {
  const db = await getDatabase()
  const recommendation = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!recommendation) {
    throw new Error('建议不存在或无权限访问')
  }
  if (recommendation.status !== 'executed') {
    return recommendation
  }

  const executedAtMs = Date.parse(String(recommendation.executedAt || ''))
  if (!Number.isFinite(executedAtMs)) {
    return recommendation
  }

  const reviewWindowDays = parseReviewWindowDays(
    recommendation.data?.impactWindowDays,
    POST_REVIEW_DEFAULT_WINDOW_DAYS
  )
  const nowMs = Date.now()
  const reviewDueAtMs = executedAtMs + reviewWindowDays * MS_PER_DAY
  const reviewedAt = new Date().toISOString()

  if (!params.force && nowMs < reviewDueAtMs) {
    const pendingData: StrategyRecommendationData = {
      ...(recommendation.data || ({} as StrategyRecommendationData)),
      postReviewStatus: 'pending_window' }
    await db.exec(
      `
        UPDATE strategy_center_recommendations
        SET data_json = ?,
            updated_at = NOW()
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(pendingData, pendingData),
        params.recommendationId,
        params.userId,
      ]
    )
    const latest = await getRecommendationById({
      userId: params.userId,
      recommendationId: params.recommendationId })
    if (!latest) {
      throw new Error('复盘状态写入失败')
    }
    return latest
  }

  const dateRange = computeReviewDateRange({
    executedAtMs,
    reviewWindowDays,
    nowMs })
  if (dateRange.afterEndMs < executedAtMs) {
    return recommendation
  }

  const baseline = await aggregateCampaignWindow({
    db,
    userId: params.userId,
    campaignId: recommendation.campaignId,
    startDate: dateRange.baselineStartDate,
    endDate: dateRange.baselineEndDate })
  const after = await aggregateCampaignWindow({
    db,
    userId: params.userId,
    campaignId: recommendation.campaignId,
    startDate: dateRange.afterStartDate,
    endDate: dateRange.afterEndDate })
  const observedDays = Math.max(
    1,
    Math.floor((Date.parse(`${dateRange.afterEndDate}T00:00:00.000Z`) - Date.parse(`${dateRange.afterStartDate}T00:00:00.000Z`)) / MS_PER_DAY) + 1
  )

  const status = evaluatePostReviewStatus({
    recommendationType: recommendation.recommendationType,
    observedDays,
    reviewWindowDays,
    baseline: {
      impressions: baseline.impressions,
      clicks: baseline.clicks,
      cost: baseline.cost,
      ctrPct: baseline.ctrPct,
      roas: baseline.roas },
    after: {
      impressions: after.impressions,
      clicks: after.clicks,
      cost: after.cost,
      ctrPct: after.ctrPct,
      roas: after.roas } })

  const postReviewSummary: StrategyRecommendationData['postReviewSummary'] = {
    reviewedAt,
    reviewWindowDays,
    baseline: {
      impressions: baseline.impressions,
      clicks: baseline.clicks,
      cost: baseline.cost,
      ctrPct: baseline.ctrPct,
      cpc: baseline.cpc,
      roas: baseline.roas,
      commission: baseline.commission },
    after: {
      impressions: after.impressions,
      clicks: after.clicks,
      cost: after.cost,
      ctrPct: after.ctrPct,
      cpc: after.cpc,
      roas: after.roas,
      commission: after.commission,
      observedDays },
    delta: {
      impressionsPct: pctChange(after.impressions, baseline.impressions),
      clicksPct: pctChange(after.clicks, baseline.clicks),
      costPct: pctChange(after.cost, baseline.cost),
      ctrPctDiff: roundTo2(after.ctrPct - baseline.ctrPct),
      cpcPct: pctChange(after.cpc, baseline.cpc),
      roasDiff:
        after.roas !== null && baseline.roas !== null
          ? roundTo2(after.roas - baseline.roas)
          : null } }

  const nextData: StrategyRecommendationData = {
    ...(recommendation.data || ({} as StrategyRecommendationData)),
    postReviewStatus: status,
    postReviewSummary }
  const executionResult = parseExecutionResultObject(recommendation.executionResult)
  const nextExecutionResult = {
    ...executionResult,
    postReview: {
      status,
      reviewedAt,
      reviewWindowDays,
      observedDays } }

  await db.exec(
    `
      UPDATE strategy_center_recommendations
      SET data_json = ?,
          execution_result_json = ?,
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(nextData, nextData),
      toDbJsonObjectField(nextExecutionResult, nextExecutionResult),
      params.recommendationId,
      params.userId,
    ]
  )

  await appendRecommendationEvent({
    recommendationId: params.recommendationId,
    userId: params.userId,
    eventType: 'post_reviewed',
    actorUserId: params.userId,
    eventJson: {
      status,
      reviewWindowDays,
      observedDays } })

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!latest) {
    throw new Error('复盘后读取建议失败')
  }
  return latest
}

async function queueStrategyRecommendationExecution(params: {
  userId: number
  recommendationId: string
  confirm: boolean
  parentRequestId?: string | null
}): Promise<QueueStrategyRecommendationExecutionResult> {
  const recommendation = await assertStrategyRecommendationReadyForExecution({
    userId: params.userId,
    recommendationId: params.recommendationId,
    confirm: params.confirm })
  if (recommendation.status === 'executed') {
    throw new Error('建议已执行，无需重复执行')
  }

  const queue = getQueueManagerForTaskType('openclaw-strategy')
  await queue.initialize()

  const executionResult = parseExecutionResultObject(recommendation.executionResult)
  const existingTaskId = String(executionResult.queueTaskId || '').trim()
  if (existingTaskId) {
    const task = await queue.getTask(existingTaskId).catch(() => null)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      const latest = await markStrategyRecommendationQueued({
        userId: params.userId,
        recommendationId: params.recommendationId,
        taskId: existingTaskId,
        taskStatus: task.status,
        retryCount: task.retryCount,
        taskError: task.error || null,
        taskCreatedAt: task.createdAt,
        taskStartedAt: task.startedAt || null })
      return {
        queued: true,
        deduplicated: true,
        taskId: existingTaskId,
        recommendation: latest }
    }
  }

  const deterministicTaskId = buildDeterministicRecommendationExecuteTaskId({
    recommendationId: params.recommendationId,
    snapshotHash: recommendation.snapshotHash })
  const deterministicTask = await queue.getTask(deterministicTaskId).catch(() => null)
  if (deterministicTask && (deterministicTask.status === 'pending' || deterministicTask.status === 'running')) {
    const latest = await markStrategyRecommendationQueued({
      userId: params.userId,
      recommendationId: params.recommendationId,
      taskId: deterministicTaskId,
      taskStatus: deterministicTask.status,
      retryCount: deterministicTask.retryCount,
      taskError: deterministicTask.error || null,
      taskCreatedAt: deterministicTask.createdAt,
      taskStartedAt: deterministicTask.startedAt || null })
    return {
      queued: true,
      deduplicated: true,
      taskId: deterministicTaskId,
      recommendation: latest }
  }

  const taskPayload: StrategyRecommendationQueueTaskData = {
    userId: params.userId,
    mode: 'manual',
    trigger: 'strategy_recommendation_execute',
    kind: 'execute_recommendation',
    recommendationId: params.recommendationId,
    confirm: true }

  const taskId = await queue.enqueue(
    'openclaw-strategy',
    taskPayload,
    params.userId,
    {
      priority: 'high',
      maxRetries: 0,
      taskId: deterministicTaskId,
      parentRequestId: params.parentRequestId || undefined }
  )
  const task = await queue.getTask(taskId).catch(() => null)
  const latest = await markStrategyRecommendationQueued({
    userId: params.userId,
    recommendationId: params.recommendationId,
    taskId,
    taskStatus: task?.status || 'pending',
    retryCount: task?.retryCount,
    taskError: task?.error || null,
    taskCreatedAt: task?.createdAt || null,
    taskStartedAt: task?.startedAt || null })

  return {
    queued: true,
    deduplicated: false,
    taskId,
    recommendation: latest }
}
export {
  dismissStrategyRecommendation,
  assertStrategyRecommendationReadyForExecution,
  markStrategyRecommendationQueued,
  markStrategyRecommendationReviewQueued,
  reviewStrategyRecommendationEffect,
  queueStrategyRecommendationExecution,
}
