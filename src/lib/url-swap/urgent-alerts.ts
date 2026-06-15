/**
 * Urgent url-swap alerts for active (ENABLED) campaigns only.
 * Used by AppLayout banner, risk alerts, and dashboard insights filters.
 */

import { getDatabase } from '@/lib/db'
import { boolParam, nowFunc } from '@/lib/db'
import { createRiskAlertWithDedupMeta, refreshActiveRiskAlertContent } from '@/lib/optimization'
import type { UrlSwapErrorType } from '@/lib/url-swap'

export interface UrlSwapUrgentAlert {
  taskId: string
  offerId: number
  offerName: string
  errorMessage: string
  errorSummary: string
  errorAt: string
  consecutiveFailures: number
}

const URL_SWAP_URGENT_ALERT_TYPE = 'url_swap_error'
const URL_SWAP_URGENT_LOOKBACK_HOURS = 72

/** 排除已禁用的换链接任务（无论关联广告系列是否启用）。 */
export function excludeDisabledUrlSwapTasksSql(): string {
  return `
          AND t.status <> 'disabled'`
}

/** 仅关联 Offer 存在启用中广告系列时才纳入通知。 */
export function requireEnabledCampaignForOfferSql(): string {
  return `
          AND EXISTS (
            SELECT 1
            FROM campaigns c
            WHERE c.user_id = t.user_id
              AND c.offer_id = t.offer_id
              AND c.status IN ('ENABLED', 'ACTIVE')
              AND c.is_deleted = FALSE
          )`
}

function lookbackSql(): string {
  return `t.error_at >= CURRENT_TIMESTAMP - INTERVAL '${URL_SWAP_URGENT_LOOKBACK_HOURS} hours'`
}

function buildUrgentAlertsBaseWhere(): string {
  return `
    WHERE t.user_id = ?
      AND t.status = 'error'
      AND t.is_deleted = FALSE
      AND ${lookbackSql()}
      ${requireEnabledCampaignForOfferSql()}
      ${excludeDisabledUrlSwapTasksSql()}
  `
}

export function summarizeUrlSwapErrorMessage(errorMessage: string | null | undefined): string {
  const raw = String(errorMessage || '').trim()
  if (!raw) return '换链接任务执行失败'

  const detailMatch = raw.match(/错误详情:\s*([\s\S]*?)(?:\n\n建议操作：|$)/)
  if (detailMatch?.[1]) {
    const firstLine = detailMatch[1].trim().split('\n').find(Boolean)
    if (firstLine) return firstLine.slice(0, 240)
  }

  return raw.split('\n').find(Boolean)?.slice(0, 240) || '换链接任务执行失败'
}

function mapUrgentAlertRow(row: {
  task_id: string
  offer_id: number
  offer_name: string
  error_message: string | null
  error_at: string
  consecutive_failures: number
}): UrlSwapUrgentAlert {
  const errorMessage = row.error_message || ''
  return {
    taskId: row.task_id,
    offerId: row.offer_id,
    offerName: row.offer_name,
    errorMessage,
    errorSummary: summarizeUrlSwapErrorMessage(errorMessage),
    errorAt: row.error_at,
    consecutiveFailures: row.consecutive_failures,
  }
}

export async function queryUrlSwapUrgentAlerts(
  userId: number,
  limit = 5
): Promise<UrlSwapUrgentAlert[]> {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(limit, 20))
  const rows = (await db.query(
    `
    SELECT
      t.id as task_id,
      t.offer_id,
      t.error_message,
      t.error_at,
      t.consecutive_failures,
      o.offer_name
    FROM url_swap_tasks t
    INNER JOIN offers o ON t.offer_id = o.id
    ${buildUrgentAlertsBaseWhere()}
    ORDER BY t.error_at DESC
    LIMIT ${safeLimit}
  `,
    [userId]
  )) as Array<{
    task_id: string
    offer_id: number
    offer_name: string
    error_message: string | null
    error_at: string
    consecutive_failures: number
  }>

  return rows.map(mapUrgentAlertRow)
}

export async function countUrlSwapUrgentAlerts(userId: number): Promise<number> {
  const db = await getDatabase()
  const row = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM url_swap_tasks t
    ${buildUrgentAlertsBaseWhere()}
  `,
    [userId]
  )
  return Number(row?.count ?? 0)
}

async function offerHasEnabledCampaign(userId: number, offerId: number): Promise<boolean> {
  const db = await getDatabase()
  const row = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM campaigns c
    WHERE c.user_id = ?
      AND c.offer_id = ?
      AND c.status IN ('ENABLED', 'ACTIVE')
      AND c.is_deleted = ${boolParam(false)}
  `,
    [userId, offerId]
  )
  return Number(row?.count ?? 0) > 0
}

export async function syncUrlSwapUrgentRiskAlert(params: {
  taskId: string
  userId: number
  offerId: number
  offerName: string
  errorMessage: string
  errorType: UrlSwapErrorType
}): Promise<void> {
  const db = await getDatabase()
  const taskStatus = await db.queryOne<{ status: string }>(
    `
    SELECT status
    FROM url_swap_tasks
    WHERE id = ? AND user_id = ?
  `,
    [params.taskId, params.userId]
  )
  if (!taskStatus || taskStatus.status === 'disabled') return

  const hasEnabledCampaign = await offerHasEnabledCampaign(params.userId, params.offerId)
  if (!hasEnabledCampaign) return

  const severity = params.errorType === 'link_resolution' ? 'critical' : 'warning'
  const summary = summarizeUrlSwapErrorMessage(params.errorMessage)
  const title = `换链接失败: ${params.offerName}`
  const message =
    `Offer "${params.offerName}" 的换链接任务已连续失败并进入错误状态。` +
    `原因：${summary}。请在换链接任务页查看详情并重新启用。`

  const meta = await createRiskAlertWithDedupMeta(
    params.userId,
    URL_SWAP_URGENT_ALERT_TYPE,
    severity,
    title,
    message,
    {
      resourceType: 'offer',
      resourceId: params.offerId,
      details: {
        taskId: params.taskId,
        errorType: params.errorType,
        errorSummary: summary,
      },
    }
  )

  if (!meta.created && meta.id > 0) {
    await refreshActiveRiskAlertContent(
      params.userId,
      meta.id,
      URL_SWAP_URGENT_ALERT_TYPE,
      title,
      message,
      {
        taskId: params.taskId,
        errorType: params.errorType,
        errorSummary: summary,
      }
    )
  }
}

export async function resolveUrlSwapUrgentRiskAlertsForOffer(
  userId: number,
  offerId: number,
  note = '换链接任务已重新启用'
): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
    UPDATE risk_alerts
    SET status = 'resolved',
        resolved_at = ${nowFunc()},
        resolution_note = ?,
        updated_at = ${nowFunc()}
    WHERE user_id = ?
      AND alert_type = ?
      AND resource_type = 'offer'
      AND resource_id = ?
      AND status = 'active'
  `,
    [note, userId, URL_SWAP_URGENT_ALERT_TYPE, offerId]
  )
}
