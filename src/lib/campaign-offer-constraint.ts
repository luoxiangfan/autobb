import { getDatabase } from './db'

export const CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE =
  '该 Offer 已有关联的广告系列，一个 Offer 只能有一个广告系列'

const DEFAULT_STALE_PENDING_MINUTES = 60

export interface ActiveCampaignConflict {
  id: number
  campaign_name: string
  creation_status: string
  status: string
}

function activeCampaignNotDeletedSql(dbType: string, tableAlias?: string): string {
  const col = tableAlias ? `${tableAlias}.is_deleted` : 'is_deleted'
  return dbType === 'postgres' ? `${col} = FALSE` : `${col} = 0`
}

export function getStalePendingMinutes(): number {
  const raw = process.env.CAMPAIGN_PENDING_STALE_MINUTES
  if (raw === undefined || raw === '') {
    return DEFAULT_STALE_PENDING_MINUTES
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_STALE_PENDING_MINUTES
  }
  return Math.floor(parsed)
}

/** ISO 时间阈值：与 publish 写入的 updated_at（ISO 字符串）可比较。 */
export function getStaleUpdatedAtThresholdIso(staleMinutes?: number): string | null {
  const minutes = staleMinutes ?? getStalePendingMinutes()
  if (minutes <= 0) {
    return null
  }
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function stalePendingExcludeSql(tableAlias: string, staleThresholdIso: string | null): string {
  if (!staleThresholdIso) {
    return ''
  }
  const escaped = staleThresholdIso.replace(/'/g, "''")
  return `AND NOT (
    ${tableAlias}.creation_status = 'pending'
    AND ${tableAlias}.updated_at < '${escaped}'
  )`
}

/**
 * 仍占用 Offer 一对一槽位的过滤条件（不含 offer_id / user_id）。
 * 排除：已软删、发布失败、用户下线（REMOVED）、超时的 pending。
 */
export function offerOccupyingCampaignFilterSql(
  dbType: string,
  tableAlias = 'c',
  staleThresholdIso: string | null = getStaleUpdatedAtThresholdIso()
): string {
  const isDeletedCheck = activeCampaignNotDeletedSql(dbType, tableAlias)

  return `
    ${isDeletedCheck}
    AND ${tableAlias}.creation_status != 'failed'
    AND UPPER(COALESCE(${tableAlias}.status, '')) != 'REMOVED'
    ${stalePendingExcludeSql(tableAlias, staleThresholdIso)}
  `.trim().replace(/\s+/g, ' ')
}

/**
 * 参数化 WHERE：offer_id = ? AND user_id = ? AND [占用过滤]
 */
export function offerOccupyingCampaignWhereClause(dbType: string): string {
  return `
    offer_id = ? AND user_id = ? AND ${offerOccupyingCampaignFilterSql(dbType)}
  `.trim().replace(/\s+/g, ' ')
}

/**
 * 列表查询用：当前仍占用槽位的 campaign id 子查询（与发布 API 一致）。
 */
export function offerOccupyingCampaignIdSubquerySql(
  dbType: string,
  offerIdExpr: string,
  userIdExpr: string
): string {
  return `(
    SELECT c.id
    FROM campaigns c
    WHERE c.offer_id = ${offerIdExpr}
      AND c.user_id = ${userIdExpr}
      AND ${offerOccupyingCampaignFilterSql(dbType, 'c')}
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 1
  )`
}

const STALE_PENDING_ABANDON_REASON =
  '发布任务超时未完成，已自动释放 Offer 占用（可重新发布）'

/**
 * 软删除超时 pending 记录，释放 offer_id 唯一索引占用。
 */
export async function abandonStalePendingCampaignsForOffer(
  offerId: number,
  userId: number
): Promise<number> {
  const staleMinutes = getStalePendingMinutes()
  const staleThresholdIso = getStaleUpdatedAtThresholdIso(staleMinutes)
  if (!staleThresholdIso) {
    return 0
  }

  const db = await getDatabase()
  const isDeletedCheck = activeCampaignNotDeletedSql(db.type)
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const isDeletedSet = db.type === 'postgres' ? 'TRUE' : '1'

  const result = await db.exec(
    `
    UPDATE campaigns
    SET
      is_deleted = ${isDeletedSet},
      deleted_at = ${nowExpr},
      creation_status = 'failed',
      creation_error = ?,
      status = 'REMOVED',
      removed_reason = 'stale_pending_abandon',
      updated_at = ${nowExpr}
    WHERE offer_id = ?
      AND user_id = ?
      AND creation_status = 'pending'
      AND ${isDeletedCheck}
      AND updated_at < ?
  `,
    [STALE_PENDING_ABANDON_REASON, offerId, userId, staleThresholdIso]
  )

  const abandoned = result.changes || 0
  if (abandoned > 0) {
    console.log(
      `[CampaignOfferConstraint] 已放弃 ${abandoned} 条超时 pending campaign（offer=${offerId}，阈值=${staleMinutes}min）`
    )
  }

  return abandoned
}

/**
 * Offer ↔ Campaign 严格一对一：返回仍占用该 Offer 的 campaign（若有）。
 */
export async function getActiveCampaignConflictForOffer(
  offerId: number,
  userId: number
): Promise<ActiveCampaignConflict | null> {
  const db = await getDatabase()
  const occupyingWhere = offerOccupyingCampaignWhereClause(db.type)

  const row = await db.queryOne(
    `
    SELECT id, campaign_name, creation_status, status
    FROM campaigns
    WHERE ${occupyingWhere}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `,
    [offerId, userId]
  ) as ActiveCampaignConflict | undefined

  return row ?? null
}

export async function hasActiveCampaignForOffer(
  offerId: number,
  userId: number
): Promise<boolean> {
  return !!(await getActiveCampaignConflictForOffer(offerId, userId))
}

export async function findActiveCampaignIdForOffer(
  offerId: number,
  userId: number
): Promise<number | null> {
  const conflict = await getActiveCampaignConflictForOffer(offerId, userId)
  return conflict?.id ?? null
}

export async function assertNoActiveCampaignForOffer(
  offerId: number,
  userId: number
): Promise<void> {
  await abandonStalePendingCampaignsForOffer(offerId, userId)
  const conflict = await getActiveCampaignConflictForOffer(offerId, userId)
  if (conflict) {
    throw new Error(CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE)
  }
}

export function isCampaignOfferUniqueViolation(error: unknown): boolean {
  const message = String((error as any)?.message || error || '')
  return (
    message.includes('idx_campaigns_offer_id_active_unique')
    || message.includes('UNIQUE constraint failed: campaigns.offer_id')
    || message.includes('duplicate key value violates unique constraint')
  )
}

const DEFAULT_ENQUEUE_ROLLBACK_REASON = '发布任务入队失败，已回滚本地 Campaign 记录以释放 Offer 占用'

/**
 * 入队失败时软删除 pending campaign，释放 Offer 一对一占用，便于用户重新发布。
 * 仅作用于尚未成功入队、creation_status=pending 的记录。
 */
export async function rollbackPendingCampaignAfterEnqueueFailure(params: {
  campaignId: number
  offerId: number
  userId: number
  reason?: string
}): Promise<boolean> {
  const { campaignId, offerId, userId, reason = DEFAULT_ENQUEUE_ROLLBACK_REASON } = params
  const db = await getDatabase()
  const isDeletedCheck = activeCampaignNotDeletedSql(db.type)
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const isDeletedSet = db.type === 'postgres' ? 'TRUE' : '1'

  const result = await db.exec(
    `
    UPDATE campaigns
    SET
      is_deleted = ${isDeletedSet},
      deleted_at = ${nowExpr},
      creation_status = 'failed',
      creation_error = ?,
      updated_at = ${nowExpr}
    WHERE id = ?
      AND user_id = ?
      AND offer_id = ?
      AND creation_status = 'pending'
      AND ${isDeletedCheck}
  `,
    [reason, campaignId, userId, offerId]
  )

  const rolledBack = (result.changes || 0) > 0
  if (rolledBack) {
    console.log(
      `[CampaignOfferConstraint] 已回滚 pending campaign ${campaignId}（offer=${offerId}），释放一对一占用`
    )
  } else {
    console.warn(
      `[CampaignOfferConstraint] 入队失败但未能回滚 campaign ${campaignId}（可能已被处理或删除）`
    )
  }

  return rolledBack
}
