import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  buildDailyBudgetUpdatePayload,
  normalizeGoogleCampaignId,
  parseExecutionResultObject,
  safeParseObject,
  toNumber,
} from './strategy-recommendation-utils'
import {
  appendRecommendationEvent,
  getRecommendationById,
} from './strategy-recommendation-repository'
import { assertStrategyRecommendationReadyForExecution } from './strategy-recommendation-lifecycle'
import { fetchAutoadsJson } from '@/lib/openclaw/runtime/autoads-client'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

async function persistStrategyRecommendationExecutionRuntime(params: {
  userId: number
  recommendationId: string
  executionResult: Record<string, any>
}): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
      UPDATE strategy_center_recommendations
      SET execution_result_json = ?,
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
    `,
    [
      toDbJsonObjectField(params.executionResult || {}, params.executionResult || {}),
      params.recommendationId,
      params.userId,
    ]
  )
}

type ExecuteActionResult = {
  route: string
  response: unknown
}

function normalizeNonNegativeInt(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function isAlreadyOfflineCampaignError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '')
  return message.includes('该广告系列已下线/删除')
}

function assertRecommendationActionResult(params: {
  recommendationType: StrategyRecommendationType
  response: unknown
}) {
  const payload = safeParseObject(params.response)
  if (payload.success === false) {
    throw new Error(String(payload.error || '执行失败'))
  }

  const failures = Array.isArray(payload.failures) ? payload.failures.filter(Boolean) : []
  const addedCount = normalizeNonNegativeInt(payload.addedCount)
  if (
    (
      params.recommendationType === 'expand_keywords'
      || params.recommendationType === 'add_negative_keywords'
      || params.recommendationType === 'optimize_match_type'
    )
    && failures.length > 0
    && addedCount <= 0
  ) {
    const firstFailure = safeParseObject(failures[0])
    const firstMessage = String(firstFailure.message || '').trim()
    throw new Error(
      firstMessage
        ? `执行存在失败项（${failures.length}条）：${firstMessage}`
        : `执行存在失败项（${failures.length}条），请修复后重试`
    )
  }

  if (params.recommendationType === 'offline_campaign') {
    const googleAds = safeParseObject(payload.googleAds)
    const queued = googleAds.queued === true
    if (queued) {
      throw new Error('下线执行仍在异步处理中，未返回最终结果')
    }

    const failed = normalizeNonNegativeInt(googleAds.failed)
    if (failed > 0) {
      throw new Error(`下线执行失败：Google Ads 失败 ${failed} 条`)
    }

    const planned = normalizeNonNegativeInt(googleAds.planned)
    if (planned > 0) {
      const action = String(googleAds.action || '').trim().toUpperCase()
      const pausedFallback = normalizeNonNegativeInt(googleAds.pausedFallback)
      if (action === 'REMOVE') {
        const removed = normalizeNonNegativeInt(googleAds.removed)
        if (removed + pausedFallback < planned) {
          throw new Error(
            `下线执行不完整：计划删除 ${planned} 条，成功删除 ${removed} 条，降级暂停 ${pausedFallback} 条`
          )
        }
      } else {
        const paused = normalizeNonNegativeInt(googleAds.paused)
        if (paused + pausedFallback < planned) {
          throw new Error(`下线执行不完整：计划暂停 ${planned} 条，成功 ${paused + pausedFallback} 条`)
        }
      }
    }
  }
}

async function executeRecommendationAction(params: {
  userId: number
  recommendation: StrategyRecommendation
}): Promise<ExecuteActionResult> {
  const recommendation = params.recommendation
  const data = recommendation.data || ({} as StrategyRecommendationData)

  if (recommendation.recommendationType === 'adjust_cpc') {
    const googleCampaignId = normalizeGoogleCampaignId(
      data.googleCampaignId,
      recommendation.googleCampaignId
    )
    const newCpc = toNumber(data.recommendedCpc, 0)
    if (!googleCampaignId) {
      throw new Error('缺少Google Campaign ID，无法执行CPC调整')
    }
    if (!(newCpc > 0)) {
      throw new Error('建议CPC无效，无法执行')
    }

    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${googleCampaignId}/update-cpc`,
      method: 'PUT',
      body: { newCpc } })
    return {
      route: `/api/campaigns/${googleCampaignId}/update-cpc`,
      response }
  }

  if (recommendation.recommendationType === 'adjust_budget') {
    const googleCampaignId = normalizeGoogleCampaignId(
      data.googleCampaignId,
      recommendation.googleCampaignId
    )
    if (!googleCampaignId) {
      throw new Error('缺少Google Campaign ID，无法执行预算调整')
    }
    const payload = buildDailyBudgetUpdatePayload(data.recommendedBudget)

    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${googleCampaignId}/update-budget`,
      method: 'PUT',
      body: payload })
    return {
      route: `/api/campaigns/${googleCampaignId}/update-budget`,
      response }
  }

  if (recommendation.recommendationType === 'offline_campaign') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行下线')
    }
    const body = {
      removeGoogleAdsCampaign: true,
      pauseClickFarmTasks: true,
      pauseUrlSwapTasks: true,
      waitRemote: true }
    let response: unknown
    try {
      response = await fetchAutoadsJson({
        userId: params.userId,
        path: `/api/campaigns/${campaignId}/offline`,
        method: 'POST',
        body })
    } catch (error: any) {
      if (!isAlreadyOfflineCampaignError(error)) {
        throw error
      }
      // 幂等处理：本地已经下线时视为执行完成，避免重复执行导致策略任务误判失败。
      response = {
        success: true,
        message: '广告系列已处于下线状态（幂等）',
        data: {
          campaignId,
          offlineCount: 1,
          alreadyOffline: true },
        googleAds: {
          queued: false,
          planned: 0,
          paused: 0,
          removed: 0,
          pausedFallback: 0,
          failed: 0,
          errors: [],
          skippedReason: 'campaign_already_offline',
          action: 'REMOVE' } }
    }
    return {
      route: `/api/campaigns/${campaignId}/offline`,
      response }
  }

  if (recommendation.recommendationType === 'expand_keywords') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行关键词扩量')
    }
    const keywordPlan = Array.isArray(data.keywordPlan)
      ? data.keywordPlan
      : []
    if (keywordPlan.length === 0) {
      throw new Error('建议中缺少关键词计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/add`,
      method: 'POST',
      body: {
        keywords: keywordPlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.matchType || 'PHRASE').toUpperCase() })) } })
    return {
      route: `/api/campaigns/${campaignId}/keywords/add`,
      response }
  }

  if (recommendation.recommendationType === 'add_negative_keywords') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行否词优化')
    }
    const negativeKeywordPlan = Array.isArray(data.negativeKeywordPlan)
      ? data.negativeKeywordPlan
      : []
    if (negativeKeywordPlan.length === 0) {
      throw new Error('建议中缺少否词计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/negatives/add`,
      method: 'POST',
      body: {
        keywords: negativeKeywordPlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.matchType || 'EXACT').toUpperCase() })) } })
    return {
      route: `/api/campaigns/${campaignId}/keywords/negatives/add`,
      response }
  }

  if (recommendation.recommendationType === 'optimize_match_type') {
    const campaignId = Number(data.campaignId || recommendation.campaignId)
    if (!Number.isFinite(campaignId)) {
      throw new Error('缺少Campaign ID，无法执行匹配类型优化')
    }
    const matchTypePlan = Array.isArray(data.matchTypePlan)
      ? data.matchTypePlan
      : []
    if (matchTypePlan.length === 0) {
      throw new Error('建议中缺少匹配类型计划，无法执行')
    }
    const response = await fetchAutoadsJson({
      userId: params.userId,
      path: `/api/campaigns/${campaignId}/keywords/match-type/add`,
      method: 'POST',
      body: {
        keywords: matchTypePlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.recommendedMatchType || 'PHRASE').toUpperCase() })),
        oldKeywords: matchTypePlan.map((item) => ({
          text: String(item.text || '').trim(),
          matchType: String(item.currentMatchType || 'PHRASE').toUpperCase() })),
        replaceMode: String(data.matchTypeReplaceMode || 'pause_existing') } })
    return {
      route: `/api/campaigns/${campaignId}/keywords/match-type/add`,
      response }
  }

  throw new Error(`不支持的建议类型: ${recommendation.recommendationType}`)
}

async function executeStrategyRecommendation(params: {
  userId: number
  recommendationId: string
  confirm: boolean
  queueTaskId?: string | null
}): Promise<StrategyRecommendation> {
  const recommendation = await assertStrategyRecommendationReadyForExecution({
    userId: params.userId,
    recommendationId: params.recommendationId,
    confirm: params.confirm })
  if (recommendation.status === 'executed') {
    return recommendation
  }

  const db = await getDatabase()
  const existingExecutionResult = parseExecutionResultObject(recommendation.executionResult)
  const queueTaskId = String(params.queueTaskId || existingExecutionResult.queueTaskId || '').trim() || null

  try {
    const actionResult = await executeRecommendationAction({
      userId: params.userId,
      recommendation })
    assertRecommendationActionResult({
      recommendationType: recommendation.recommendationType,
      response: actionResult.response })
    const executedAt = new Date().toISOString()
    const successPayload = {
      ...existingExecutionResult,
      queued: false,
      queueTaskId,
      queueTaskStatus: 'completed',
      queueTaskError: null,
      success: true,
      route: actionResult.route,
      response: actionResult.response,
      queueUpdatedAt: executedAt,
      executedAt }

    await db.exec(
      `
        UPDATE strategy_center_recommendations
        SET status = 'executed',
            executed_at = NOW(),
            execution_result_json = ?,
            updated_at = NOW()
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(
          successPayload, successPayload
        ),
        params.recommendationId,
        params.userId,
      ]
    )

    await appendRecommendationEvent({
      recommendationId: params.recommendationId,
      userId: params.userId,
      eventType: 'executed',
      actorUserId: params.userId,
      eventJson: {
        route: actionResult.route,
        queueTaskId } })
  } catch (error: any) {
    const message = error?.message || '执行失败'
    const failedAt = new Date().toISOString()
    const failedPayload = {
      ...existingExecutionResult,
      queued: false,
      queueTaskId,
      queueTaskStatus: 'failed',
      queueTaskError: message,
      success: false,
      error: message,
      queueUpdatedAt: failedAt,
      failedAt }
    await db.exec(
      `
        UPDATE strategy_center_recommendations
        SET status = 'failed',
            execution_result_json = ?,
            updated_at = NOW()
        WHERE id = ?
          AND user_id = ?
      `,
      [
        toDbJsonObjectField(
          failedPayload, failedPayload
        ),
        params.recommendationId,
        params.userId,
      ]
    )

    await appendRecommendationEvent({
      recommendationId: params.recommendationId,
      userId: params.userId,
      eventType: 'execute_failed',
      actorUserId: params.userId,
      eventJson: {
        error: message,
        queueTaskId } })
    throw error
  }

  const latest = await getRecommendationById({
    userId: params.userId,
    recommendationId: params.recommendationId })
  if (!latest) {
    throw new Error('执行后读取建议失败')
  }
  return latest
}
export {
  persistStrategyRecommendationExecutionRuntime,
  executeStrategyRecommendation,
  assertRecommendationActionResult,
  isAlreadyOfflineCampaignError,
}
