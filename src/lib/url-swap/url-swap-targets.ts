/**
 * Url-swap task target (multi-campaign) management.
 */
import { getDatabase } from '@/lib/db'
import type { UrlSwapTaskTarget } from './url-swap-types'
import {
  findGoogleAdsAccountIdByCustomerId,
  getOfferCampaignTargets,
  type UrlSwapTargetInput,
} from './url-swap-offer-lookup'
import { getUrlSwapTaskById, getUrlSwapTaskByOfferId } from './url-swap-queries'

/**
 * 获取任务的目标列表（多Campaign/多账号）
 */
export async function getUrlSwapTaskTargets(
  taskId: string,
  userId?: number,
  options?: { status?: UrlSwapTaskTarget['status'] | Array<UrlSwapTaskTarget['status']> }
): Promise<UrlSwapTaskTarget[]> {
  const db = await getDatabase()

  const params: any[] = []
  let userJoin = ''
  if (userId && userId > 0) {
    userJoin = 'INNER JOIN url_swap_tasks t ON t.id = ust.task_id AND t.user_id = ?'
    params.push(userId)
  }

  const statusList = options?.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : null

  params.push(taskId)

  let statusClause = ''
  if (statusList && statusList.length > 0) {
    statusClause = `AND ust.status IN (${statusList.map(() => '?').join(', ')})`
    params.push(...statusList)
  }

  const rows = await db.query<any>(
    `
    SELECT ust.*
    FROM url_swap_task_targets ust
    ${userJoin}
    WHERE ust.task_id = ?
    ${statusClause}
    ORDER BY ust.created_at DESC
  `,
    params
  )

  return rows.map((row: any) => ({
    id: row.id,
    task_id: row.task_id,
    offer_id: row.offer_id,
    google_ads_account_id: row.google_ads_account_id,
    google_customer_id: row.google_customer_id,
    google_campaign_id: row.google_campaign_id,
    status: row.status || 'active',
    consecutive_failures: row.consecutive_failures || 0,
    last_success_at: row.last_success_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}

/**
 * 为任务批量添加目标（多Campaign/多账号）
 */
export async function ensureUrlSwapTaskTargets(
  taskId: string,
  offerId: number,
  userId: number,
  targets: UrlSwapTargetInput[]
): Promise<number> {
  const db = await getDatabase()
  if (!targets || targets.length === 0) return 0

  const now = new Date().toISOString()
  let inserted = 0

  for (const target of targets) {
    if (!target.google_ads_account_id || !target.google_customer_id || !target.google_campaign_id) {
      continue
    }
    const result = await db.exec(
      `
        INSERT INTO url_swap_task_targets (
          task_id, offer_id, google_ads_account_id, google_customer_id, google_campaign_id,
          status, consecutive_failures, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)
        ON CONFLICT (task_id, google_ads_account_id, google_campaign_id) DO NOTHING
      `,
      [
        taskId,
        offerId,
        target.google_ads_account_id,
        target.google_customer_id,
        target.google_campaign_id,
        now,
        now,
      ]
    )
    if ((result as any)?.changes) inserted += Number((result as any).changes) || 0
  }

  return inserted
}

/**
 * 发布新Campaign后自动追加换链目标
 */
export async function addUrlSwapTargetForOfferCampaign(params: {
  offerId: number
  userId: number
  googleAdsAccountId: number
  googleCustomerId: string
  googleCampaignId: string
}): Promise<boolean> {
  const task = await getUrlSwapTaskByOfferId(params.offerId, params.userId)
  if (!task || task.is_deleted || task.status === 'completed') {
    return false
  }

  await ensureUrlSwapTaskTargets(task.id, params.offerId, params.userId, [
    {
      google_ads_account_id: params.googleAdsAccountId,
      google_customer_id: params.googleCustomerId,
      google_campaign_id: params.googleCampaignId,
    },
  ])

  if (!task.google_customer_id || !task.google_campaign_id) {
    const db = await getDatabase()
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET google_customer_id = ?, google_campaign_id = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
      [
        params.googleCustomerId,
        params.googleCampaignId,
        new Date().toISOString(),
        task.id,
        params.userId,
      ]
    )
  }

  return true
}

/**
 * 刷新任务目标（回填历史Campaign）
 */
export async function refreshUrlSwapTaskTargets(params: {
  taskId: string
  userId: number
  googleAdsAccountId?: number
}): Promise<{ inserted: number; totalTargets: number; candidateTargets: number }> {
  const task = await getUrlSwapTaskById(params.taskId, params.userId)
  if (!task) {
    throw new Error('任务不存在')
  }

  let targets = await getOfferCampaignTargets(task.offer_id, params.userId)
  if (params.googleAdsAccountId) {
    targets = targets.filter((t) => t.google_ads_account_id === params.googleAdsAccountId)
  }

  if (targets.length === 0 && task.google_customer_id && task.google_campaign_id) {
    const accountId = await findGoogleAdsAccountIdByCustomerId(
      task.google_customer_id,
      params.userId
    )
    if (accountId) {
      targets = [
        {
          google_ads_account_id: accountId,
          google_customer_id: task.google_customer_id,
          google_campaign_id: task.google_campaign_id,
        },
      ]
    }
  }

  const inserted = await ensureUrlSwapTaskTargets(task.id, task.offer_id, params.userId, targets)
  const totalTargets = (await getUrlSwapTaskTargets(task.id, params.userId)).length

  return {
    inserted,
    totalTargets,
    candidateTargets: targets.length,
  }
}

/**
 * 记录目标成功
 */
export async function markUrlSwapTargetSuccess(targetId: string): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.exec(
    `
    UPDATE url_swap_task_targets
    SET
      consecutive_failures = 0,
      last_error = NULL,
      last_success_at = ?,
      status = 'active',
      updated_at = ?
    WHERE id = ?
  `,
    [now, now, targetId]
  )
}

/**
 * 记录目标失败
 */
const URL_SWAP_TARGET_ERROR_THRESHOLD = 3

export async function markUrlSwapTargetFailure(
  targetId: string,
  errorMessage: string
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const row = await db.queryOne<{ consecutive_failures: number }>(
    `
    SELECT consecutive_failures
    FROM url_swap_task_targets
    WHERE id = ?
  `,
    [targetId]
  )
  const currentFailures = row?.consecutive_failures || 0
  const newFailures = currentFailures + 1
  const shouldPause = newFailures >= URL_SWAP_TARGET_ERROR_THRESHOLD

  await db.exec(
    `
    UPDATE url_swap_task_targets
    SET
      consecutive_failures = ?,
      last_error = ?,
      status = ?,
      updated_at = ?
    WHERE id = ?
  `,
    [newFailures, errorMessage, shouldPause ? 'paused' : 'active', now, targetId]
  )
}

/**
 * 批量暂停任务目标（按task_id）
 */
export async function pauseUrlSwapTargetsByTaskId(taskId: string): Promise<number> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'paused',
        updated_at = ?
    WHERE task_id = ?
      AND status NOT IN ('removed', 'invalid')
  `,
    [now, taskId]
  )
  return (result as any)?.changes ?? 0
}

/**
 * 批量暂停任务目标（按offer_id）
 */
export async function pauseUrlSwapTargetsByOfferId(offerId: number): Promise<number> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'paused',
        updated_at = ?
    WHERE offer_id = ?
      AND status NOT IN ('removed', 'invalid')
  `,
    [now, offerId]
  )
  return (result as any)?.changes ?? 0
}

/**
 * 批量暂停任务目标（按user_id集合）
 */
export async function pauseUrlSwapTargetsByUserIds(userIds: number[]): Promise<number> {
  if (!userIds || userIds.length === 0) return 0
  const db = await getDatabase()
  const now = new Date().toISOString()
  const placeholders = userIds.map(() => '?').join(', ')
  const isDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'

  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'paused',
        updated_at = ?
    WHERE status NOT IN ('removed', 'invalid')
      AND task_id IN (
        SELECT id FROM url_swap_tasks
        WHERE user_id IN (${placeholders})
          AND ${isDeletedCondition}
      )
  `,
    [now, ...userIds]
  )
  return (result as any)?.changes ?? 0
}

/**
 * 将指定Campaign对应的目标标记为已移除
 */
export async function markUrlSwapTargetsRemovedByCampaignId(
  campaignId: number,
  userId: number
): Promise<number> {
  const db = await getDatabase()
  const row = await db.queryOne<{
    offer_id: number
    google_ads_account_id: number
    google_campaign_id: string | null
  }>(
    `
    SELECT
      offer_id,
      google_ads_account_id,
      COALESCE(NULLIF(google_campaign_id, ''), NULLIF(campaign_id, '')) AS google_campaign_id
    FROM campaigns
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `,
    [campaignId, userId]
  )

  if (!row?.offer_id || !row?.google_ads_account_id || !row?.google_campaign_id) {
    return 0
  }

  const now = new Date().toISOString()
  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'removed',
        updated_at = ?
    WHERE offer_id = ?
      AND google_ads_account_id = ?
      AND google_campaign_id = ?
  `,
    [now, row.offer_id, row.google_ads_account_id, row.google_campaign_id]
  )
  return (result as any)?.changes ?? 0
}

/**
 * 将指定Offer+Ads账号下的目标标记为已移除
 */
export async function markUrlSwapTargetsRemovedByOfferAccount(
  offerId: number,
  googleAdsAccountId: number
): Promise<number> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'removed',
        updated_at = ?
    WHERE offer_id = ?
      AND google_ads_account_id = ?
  `,
    [now, offerId, googleAdsAccountId]
  )
  return (result as any)?.changes ?? 0
}

/**
 * 将指定Offer下的目标标记为已移除
 */
export async function markUrlSwapTargetsRemovedByOfferId(offerId: number): Promise<number> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const result = await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'removed',
        updated_at = ?
    WHERE offer_id = ?
  `,
    [now, offerId]
  )
  return (result as any)?.changes ?? 0
}
