import { getDatabase } from './db'
import { isUniqueConstraintViolation } from './db-helpers'

export const CAMPAIGN_OFFER_ONE_TO_ONE_MESSAGE =
  '该 Offer 已有关联的广告系列，一个 Offer 只能有一个广告系列'

const DEFAULT_STALE_PENDING_MINUTES = 60

export interface ActiveCampaignConflict {
  id: number
  campaign_name: string
  creation_status: string
  status: string
}

function campaignColumn(tableAlias: string | undefined, column: string): string {
  return tableAlias ? `${tableAlias}.${column}` : column
}

function activeCampaignNotDeletedSql(tableAlias?: string): string {
  const col = campaignColumn(tableAlias, 'is_deleted')
  return `${col} = FALSE`
}

function getStalePendingMinutes(): number {
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

function stalePendingExcludeSql(
  tableAlias: string | undefined,
  staleThresholdIso: string | null
): string {
  if (!staleThresholdIso) {
    return ''
  }
  const escaped = staleThresholdIso.replace(/'/g, "''")
  const creationStatus = campaignColumn(tableAlias, 'creation_status')
  const updatedAt = campaignColumn(tableAlias, 'updated_at')
  return `AND NOT (
    ${creationStatus} = 'pending'
    AND ${updatedAt} < '${escaped}'
  )`
}

/**
 * 仍占用 Offer 一对一槽位的过滤条件（不含 offer_id / user_id）。
 * 排除：已软删、发布失败、用户下线（REMOVED）、超时的 pending。
 */
export function offerOccupyingCampaignFilterSql(
  tableAlias?: string,
  staleThresholdIso: string | null = getStaleUpdatedAtThresholdIso()
): string {
  const isDeletedCheck = activeCampaignNotDeletedSql(tableAlias)
  const creationStatus = campaignColumn(tableAlias, 'creation_status')
  const status = campaignColumn(tableAlias, 'status')

  return `
    ${isDeletedCheck}
    AND ${creationStatus} != 'failed'
    AND UPPER(COALESCE(${status}, '')) != 'REMOVED'
    ${stalePendingExcludeSql(tableAlias, staleThresholdIso)}
  `
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * 参数化 WHERE：offer_id = ? AND user_id = ? AND [占用过滤]
 */
export function offerOccupyingCampaignWhereClause(): string {
  // No table alias: used in `FROM campaigns` without `AS c` (Postgres rejects `c.*` here).
  return `
    offer_id = ? AND user_id = ? AND ${offerOccupyingCampaignFilterSql(undefined)}
  `
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * 列表查询用：当前仍占用槽位的 campaign id 子查询（与发布 API 一致）。
 */
export function offerOccupyingCampaignIdSubquerySql(
  offerIdExpr: string,
  userIdExpr: string
): string {
  return `(
    SELECT c.id
    FROM campaigns c
    WHERE c.offer_id = ${offerIdExpr}
      AND c.user_id = ${userIdExpr}
      AND ${offerOccupyingCampaignFilterSql('c')}
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 1
  )`
}

const STALE_PENDING_ABANDON_REASON = '发布任务超时未完成，已自动释放 Offer 占用（可重新发布）'

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
  const isDeletedCheck = activeCampaignNotDeletedSql()
  const nowExpr = 'NOW()'
  const isDeletedSet = 'TRUE'

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
 * 批量放弃多个 Offer 的超时 pending campaign（单次 UPDATE）。
 */
export async function abandonStalePendingCampaignsForOffers(
  offerIds: number[],
  userId: number
): Promise<number> {
  const uniqueOfferIds = [...new Set(offerIds)].filter((id) => Number.isInteger(id) && id > 0)
  if (uniqueOfferIds.length === 0) {
    return 0
  }

  const staleThresholdIso = getStaleUpdatedAtThresholdIso()
  if (!staleThresholdIso) {
    return 0
  }

  const db = await getDatabase()
  const isDeletedCheck = activeCampaignNotDeletedSql()
  const nowExpr = 'NOW()'
  const isDeletedSet = 'TRUE'
  const placeholders = uniqueOfferIds.map(() => '?').join(', ')

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
    WHERE user_id = ?
      AND offer_id IN (${placeholders})
      AND creation_status = 'pending'
      AND ${isDeletedCheck}
      AND updated_at < ?
  `,
    [STALE_PENDING_ABANDON_REASON, userId, ...uniqueOfferIds, staleThresholdIso]
  )

  const abandoned = result.changes || 0
  if (abandoned > 0) {
    console.log(
      `[CampaignOfferConstraint] 已批量放弃 ${abandoned} 条超时 pending campaign（offers=${uniqueOfferIds.length}，阈值=${getStalePendingMinutes()}min）`
    )
  }

  return abandoned
}

type ActiveCampaignConflictRow = ActiveCampaignConflict & { offer_id: number }

/**
 * 批量查询仍占用 Offer 的 campaign（每个 offer_id 至多一条，取 updated_at 最新）。
 */
export async function getActiveCampaignConflictsForOffers(
  offerIds: number[],
  userId: number
): Promise<Map<number, ActiveCampaignConflict>> {
  const uniqueOfferIds = [...new Set(offerIds)].filter((id) => Number.isInteger(id) && id > 0)
  const conflicts = new Map<number, ActiveCampaignConflict>()
  if (uniqueOfferIds.length === 0) {
    return conflicts
  }

  const db = await getDatabase()
  const placeholders = uniqueOfferIds.map(() => '?').join(', ')
  const occupyingFilter = offerOccupyingCampaignFilterSql(undefined)

  const rows = (await db.query(
    `
    SELECT id, offer_id, campaign_name, creation_status, status
    FROM campaigns
    WHERE user_id = ?
      AND offer_id IN (${placeholders})
      AND ${occupyingFilter}
    ORDER BY offer_id ASC, updated_at DESC, id DESC
  `,
    [userId, ...uniqueOfferIds]
  )) as ActiveCampaignConflictRow[]

  for (const row of rows) {
    if (!conflicts.has(row.offer_id)) {
      conflicts.set(row.offer_id, {
        id: row.id,
        campaign_name: row.campaign_name,
        creation_status: row.creation_status,
        status: row.status,
      })
    }
  }

  return conflicts
}

/**
 * Offer ↔ Campaign 严格一对一：返回仍占用该 Offer 的 campaign（若有）。
 */
export async function getActiveCampaignConflictForOffer(
  offerId: number,
  userId: number
): Promise<ActiveCampaignConflict | null> {
  const db = await getDatabase()
  const occupyingWhere = offerOccupyingCampaignWhereClause()

  const row = (await db.queryOne(
    `
    SELECT id, campaign_name, creation_status, status
    FROM campaigns
    WHERE ${occupyingWhere}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `,
    [offerId, userId]
  )) as ActiveCampaignConflict | undefined

  return row ?? null
}

export async function hasActiveCampaignForOffer(offerId: number, userId: number): Promise<boolean> {
  return !!(await getActiveCampaignConflictForOffer(offerId, userId))
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
  return isUniqueConstraintViolation(error, {
    constraint: 'idx_campaigns_offer_id_active_unique',
    table: 'campaigns',
  })
}

const DEFAULT_ENQUEUE_ROLLBACK_REASON =
  '发布任务入队失败，已回滚本地 Campaign 记录以释放 Offer 占用'

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
  const isDeletedCheck = activeCampaignNotDeletedSql()
  const nowExpr = 'NOW()'
  const isDeletedSet = 'TRUE'

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
