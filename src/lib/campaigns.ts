import { getDatabase } from './db'
import { getInsertedId } from './db-helpers'
import { markUrlSwapTargetsRemovedByCampaignId } from './url-swap'
import { applyCampaignTransition } from './campaign-state-machine'

export interface Campaign {
  id: number
  userId: number
  offerId: number
  googleAdsAccountId: number
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa: number | null
  maxCpc: number | null
  status: string
  startDate: string | null
  endDate: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCampaignInput {
  userId: number
  offerId: number
  googleAdsAccountId: number
  campaignName: string
  budgetAmount: number
  budgetType?: string
  targetCpa?: number
  maxCpc?: number
  status?: string
  startDate?: string
  endDate?: string
}

/**
 * 创建广告系列
 */
export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const db = await getDatabase()

  const result = await db.exec(`
    INSERT INTO campaigns (
      user_id, offer_id, google_ads_account_id,
      campaign_name, budget_amount, budget_type,
      target_cpa, max_cpc, status,
      start_date, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.offerId,
    input.googleAdsAccountId,
    input.campaignName,
    input.budgetAmount,
    input.budgetType || 'DAILY',
    input.targetCpa || null,
    input.maxCpc || null,
    input.status || 'PAUSED',
    input.startDate || null,
    input.endDate || null
  ])

  const insertedId = getInsertedId(result, db.type)
  return (await findCampaignById(insertedId, input.userId))!
}

/**
 * 查找广告系列（带权限验证）
 */
export async function findCampaignById(id: number, userId: number): Promise<Campaign | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM campaigns
    WHERE id = ? AND user_id = ?
  `, [id, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 根据Google Ads campaign_id查找
 */
export async function findCampaignByGoogleId(campaignId: string, userId: number): Promise<Campaign | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM campaigns
    WHERE campaign_id = ? AND user_id = ?
  `, [campaignId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToCampaign(row)
}

/**
 * 查找Offer的所有广告系列（排除已删除）
 */
export async function findCampaignsByOfferId(offerId: number, userId: number): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: PostgreSQL兼容性 - 使用BOOLEAN类型字面量直接嵌入SQL
  // 避免 prepared statement 中的 boolean = integer 类型不匹配问题
  const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  const rows = await db.query(`
    SELECT * FROM campaigns
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `, [offerId, userId]) as any[]

  return rows.map(mapRowToCampaign)
}

/**
 * 查找用户的所有广告系列（排除已删除）
 */
export async function findCampaignsByUserId(userId: number, limit?: number): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: PostgreSQL兼容性 - 使用BOOLEAN类型字面量直接嵌入SQL
  const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  let sql = `
    SELECT * FROM campaigns
    WHERE user_id = ? AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const rows = await db.query(sql, [userId]) as any[]
  return rows.map(mapRowToCampaign)
}

/**
 * 查找Google Ads账号的所有广告系列（排除已删除）
 */
export async function findCampaignsByAccountId(
  googleAdsAccountId: number,
  userId: number
): Promise<Campaign[]> {
  const db = await getDatabase()

  // 🔧 修复: PostgreSQL兼容性 - 使用BOOLEAN类型字面量直接嵌入SQL
  const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  const rows = await db.query(`
    SELECT * FROM campaigns
    WHERE google_ads_account_id = ? AND user_id = ? AND ${isDeletedCheck}
    ORDER BY created_at DESC
  `, [googleAdsAccountId, userId]) as any[]

  return rows.map(mapRowToCampaign)
}

/**
 * 更新广告系列
 */
export async function updateCampaign(
  id: number,
  userId: number,
  updates: Partial<
    Pick<
      Campaign,
      | 'campaignName'
      | 'budgetAmount'
      | 'budgetType'
      | 'targetCpa'
      | 'maxCpc'
      | 'status'
      | 'startDate'
      | 'endDate'
      | 'campaignId'
      | 'creationStatus'
      | 'creationError'
      | 'lastSyncAt'
    >
  >
): Promise<Campaign | null> {
  const db = await getDatabase()

  // 验证权限
  const campaign = await findCampaignById(id, userId)
  if (!campaign) {
    return null
  }

  const fields: string[] = []
  const values: any[] = []
  const nextStatus = updates.status !== undefined ? String(updates.status).toUpperCase() : null
  const currentStatus = String(campaign.status || '').toUpperCase()
  const shouldMarkRemoved = nextStatus === 'REMOVED' && currentStatus !== 'REMOVED'

  if (updates.campaignName !== undefined) {
    fields.push('campaign_name = ?')
    values.push(updates.campaignName)
  }
  if (updates.budgetAmount !== undefined) {
    fields.push('budget_amount = ?')
    values.push(updates.budgetAmount)
  }
  if (updates.budgetType !== undefined) {
    fields.push('budget_type = ?')
    values.push(updates.budgetType)
  }
  if (updates.targetCpa !== undefined) {
    fields.push('target_cpa = ?')
    values.push(updates.targetCpa)
  }
  if (updates.maxCpc !== undefined) {
    fields.push('max_cpc = ?')
    values.push(updates.maxCpc)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?')
    values.push(updates.status)
  }
  if (updates.startDate !== undefined) {
    fields.push('start_date = ?')
    values.push(updates.startDate)
  }
  if (updates.endDate !== undefined) {
    fields.push('end_date = ?')
    values.push(updates.endDate)
  }
  if (updates.campaignId !== undefined) {
    fields.push('campaign_id = ?')
    values.push(updates.campaignId)
  }
  if (updates.creationStatus !== undefined) {
    fields.push('creation_status = ?')
    values.push(updates.creationStatus)
  }
  if (updates.creationError !== undefined) {
    fields.push('creation_error = ?')
    values.push(updates.creationError)
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?')
    values.push(updates.lastSyncAt)
  }

  if (fields.length === 0) {
    return campaign
  }

  // 🔧 修复: PostgreSQL兼容性 - 使用NOW()而非datetime('now')
  const db_type = db.type
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime("now")'
  fields.push(`updated_at = ${nowFunc}`)
  values.push(id, userId)

  await db.exec(`
    UPDATE campaigns
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  if (shouldMarkRemoved) {
    await markUrlSwapTargetsRemovedByCampaignId(id, userId)
  }

  return findCampaignById(id, userId)
}

export type DeleteCampaignResult =
  | { success: true }
  | {
      success: false
      reason: 'NOT_FOUND' | 'NOT_DRAFT' | 'ALREADY_DELETED'
    }

/**
 * 删除广告系列
 * - 草稿广告系列：软删除（保留历史）
 * - 已移除广告系列：永久删除（不再出现在列表）
 * - Ads 账号不可用/已解绑：仅本地下线并删除（不再调用 Google Ads）
 */
export async function deleteCampaign(id: number, userId: number): Promise<DeleteCampaignResult> {
  const db = await getDatabase()

  const campaign = await db.queryOne(
    `
      SELECT
        c.creation_status,
        c.is_deleted,
        c.status,
        c.google_ads_account_id,
        gaa.id AS ads_account_id,
        gaa.is_active AS ads_account_is_active,
        gaa.is_deleted AS ads_account_is_deleted
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.id = ? AND c.user_id = ?
      LIMIT 1
    `,
    [id, userId]
  ) as
    | {
        creation_status: string | null
        is_deleted: any
        status: string | null
        google_ads_account_id: number | null
        ads_account_id: number | null
        ads_account_is_active: any
        ads_account_is_deleted: any
      }
    | undefined

  if (!campaign) {
    return { success: false, reason: 'NOT_FOUND' }
  }

  const normalizedStatus = String(campaign.status || '').trim().toUpperCase()

  // 与 /api/campaigns/performance 对齐：Ads 账号可用 = 账号存在且为激活状态
  const hasLinkedAdsAccountId =
    campaign.google_ads_account_id !== null && campaign.google_ads_account_id !== undefined
  const hasAccountRow = campaign.ads_account_id !== null && campaign.ads_account_id !== undefined
  const adsAccountIsActive =
    campaign.ads_account_is_active === true || campaign.ads_account_is_active === 1
  const adsAccountIsDeleted =
    campaign.ads_account_is_deleted === true || campaign.ads_account_is_deleted === 1
  const adsAccountAvailable =
    hasLinkedAdsAccountId && hasAccountRow && adsAccountIsActive && !adsAccountIsDeleted
  const canDeleteDueToAdsUnavailable = !adsAccountAvailable

  // 情况一：已移除广告系列，直接物理删除（保留现有行为）
  if (normalizedStatus === 'REMOVED') {
    const result = await db.exec(
      `
        DELETE FROM campaigns
        WHERE id = ? AND user_id = ?
      `,
      [id, userId]
    )

    if ((result.changes || 0) <= 0) {
      return { success: false, reason: 'NOT_FOUND' }
    }

    return { success: true }
  }

  const isDeleted = campaign.is_deleted === true || campaign.is_deleted === 1
  if (isDeleted) {
    return { success: false, reason: 'ALREADY_DELETED' }
  }

  const creationStatus = String(campaign.creation_status || '').toLowerCase()

  // 情况二：草稿广告系列 → 软删除（沿用原有状态机）
  if (creationStatus === 'draft') {
    const transitionResult = await applyCampaignTransition({
      userId,
      campaignId: id,
      action: 'DRAFT_DELETE',
    })

    if (transitionResult.updatedCount <= 0) {
      return { success: false, reason: 'NOT_FOUND' }
    }

    return { success: true }
  }

  // 情况三：Ads 账号已解绑/不可用 → 仅本地下线并删除
  if (canDeleteDueToAdsUnavailable) {
    // 本地状态机标记为 REMOVED（不会触发任何 Google Ads 调用）
    await applyCampaignTransition({
      userId,
      campaignId: id,
      action: 'OFFLINE',
      payload: { removedReason: 'offline' },
    })

    const result = await db.exec(
      `
        DELETE FROM campaigns
        WHERE id = ? AND user_id = ?
      `,
      [id, userId]
    )

    if ((result.changes || 0) <= 0) {
      return { success: false, reason: 'NOT_FOUND' }
    }

    return { success: true }
  }

  // 其他情况：保持原有保护逻辑
  return { success: false, reason: 'NOT_DRAFT' }
}

/**
 * 更新广告系列状态
 */
export async function updateCampaignStatus(
  id: number,
  userId: number,
  status: string
): Promise<Campaign | null> {
  const normalizedStatus = String(status || '').trim().toUpperCase()

  if (normalizedStatus === 'ENABLED' || normalizedStatus === 'PAUSED') {
    await applyCampaignTransition({
      userId,
      campaignId: id,
      action: 'TOGGLE_STATUS',
      payload: { status: normalizedStatus as 'ENABLED' | 'PAUSED' },
    })

    return findCampaignById(id, userId)
  }

  return updateCampaign(id, userId, { status })
}

/**
 * 数据库行映射为Campaign对象
 */
function mapRowToCampaign(row: any): Campaign {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    googleAdsAccountId: row.google_ads_account_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    budgetAmount: row.budget_amount,
    budgetType: row.budget_type,
    targetCpa: row.target_cpa,
    maxCpc: row.max_cpc,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    creationStatus: row.creation_status,
    creationError: row.creation_error,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
