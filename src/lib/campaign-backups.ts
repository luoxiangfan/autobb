/**
 * 广告系列备份服务
 * 
 * 功能：
 * 1. 创建广告系列时自动备份
 * 2. Google Ads 同步时备份（初始 + 第 7 天）
 * 3. 通过备份快速创建广告系列
 * 
 * 🔧 更新 (2026-04-20): 新增 campaign_config 字段备份
 */

import { getDatabase, type DatabaseType } from './db'
import { getInsertedId } from './db-helpers'
import { parseJsonField, toDbJsonObjectField } from './json-field'

/** 历史 publish 来源与 autoads 等价（发布时会归一为 autoads） */
export function isAutoadsLikeBackupSource(source: string): boolean {
  return source === 'autoads' || source === 'publish'
}

/** campaign_backups JSON 列：SQLite TEXT，PostgreSQL JSONB */
export function toDbCampaignBackupJsonField(
  value: unknown,
  dbType: DatabaseType
): unknown {
  return toDbJsonObjectField(value, dbType, null)
}

function parseCampaignBackupJsonField(value: unknown): unknown | null {
  if (value == null) return null
  return parseJsonField(value, null)
}

export function backupHasCampaignConfig(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return false
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0
    } catch {
      return false
    }
  }
  return typeof value === 'object' && Object.keys(value as object).length > 0
}

/**
 * 广告系列备份数据接口
 */
export interface CampaignBackup {
  id: number
  userId: number
  offerId: number
  campaignData: any  // JSON 格式的完整广告系列数据
  campaignConfig: any | null  // 🔧 新增：广告系列配置
  backupType: 'auto' | 'manual'
  backupSource: 'autoads' | 'google_ads'
  backupVersion: number  // 1=初始备份，2=第 7 天备份
  customName: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa: number | null
  maxCpc: number | null
  status: string
  googleAdsAccountId: number | null
  createdAt: string
  updatedAt: string
  adCreativeId?: number | null  // 🔧 新增：广告创意 ID
}

/**
 * 创建备份的输入参数
 */
export interface CreateCampaignBackupInput {
  userId: number
  offerId: number
  campaignData: any
  campaignConfig?: any | null  // 🔧 新增：广告系列配置
  backupType?: 'auto' | 'manual'
  backupSource?: 'autoads' | 'google_ads'
  backupVersion?: number
  customName?: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa?: number | null
  maxCpc?: number | null
  status: string
  googleAdsAccountId?: number | null
  adCreativeId?: number | null
}

/**
 * 查询备份的选项
 */
export interface CampaignBackupFilters {
  userId?: number
  offerId?: number
  backupSource?: 'autoads' | 'google_ads'
  backupVersion?: number
  limit?: number
  offset?: number
}

/**
 * 创建广告系列备份
 */
export async function createCampaignBackup(input: CreateCampaignBackupInput): Promise<CampaignBackup> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const campaignDataDb = toDbCampaignBackupJsonField(input.campaignData, db.type)
  const campaignConfigDb = toDbCampaignBackupJsonField(input.campaignConfig, db.type)

  const result = await db.exec(`
    INSERT INTO campaign_backups (
      user_id, offer_id, campaign_data, campaign_config,
      backup_type, backup_source, backup_version,
      custom_name, campaign_name,
      budget_amount, budget_type,
      target_cpa, max_cpc,
      status, google_ads_account_id,
      created_at, updated_at, ad_creative_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.offerId,
    campaignDataDb,
    campaignConfigDb,
    input.backupType || 'auto',
    input.backupSource || 'autoads',
    input.backupVersion || 1,
    input.customName || null,
    input.campaignName,
    input.budgetAmount,
    input.budgetType,
    input.targetCpa || null,
    input.maxCpc || null,
    input.status,
    input.googleAdsAccountId || null,
    now,
    now,
    input.adCreativeId || null,  // 🔧 新增：广告创意 ID
  ])

  const backupId = getInsertedId(result, db.type)
  return await getCampaignBackupById(backupId, input.userId)
}

/**
 * 根据 ID 获取备份
 */
export async function getCampaignBackupById(id: number, userId: number): Promise<CampaignBackup> {
  const db = await getDatabase()

  const backup = await db.queryOne(`
    SELECT * FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `, [id, userId]) as any

  if (!backup) {
    throw new Error('备份不存在或无权访问')
  }

  return parseCampaignBackup(backup)
}

/**
 * 查询备份列表
 */
export async function listCampaignBackups(
  filters: CampaignBackupFilters
): Promise<{ backups: CampaignBackup[]; total: number }> {
  const db = await getDatabase()
  const whereConditions: string[] = []
  const params: any[] = []

  if (filters.userId !== undefined) {
    whereConditions.push('user_id = ?')
    params.push(filters.userId)
  }

  if (filters.offerId !== undefined) {
    whereConditions.push('offer_id = ?')
    params.push(filters.offerId)
  }

  if (filters.backupSource === 'autoads') {
    whereConditions.push("(backup_source = 'autoads' OR backup_source = 'publish')")
  } else if (filters.backupSource === 'google_ads') {
    whereConditions.push('backup_source = ?')
    params.push('google_ads')
  }

  if (filters.backupVersion !== undefined) {
    whereConditions.push('backup_version = ?')
    params.push(filters.backupVersion)
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

  // 查询总数
  const countQuery = `SELECT COUNT(*) as count FROM campaign_backups ${whereClause}`
  const countResult = await db.queryOne<{ count: number }>(countQuery, params)
  const total = countResult?.count || 0

  // 查询列表
  const limit = filters.limit || 20
  const offset = filters.offset || 0
  const listQuery = `
    SELECT * FROM campaign_backups ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `

  const backups = await db.query(listQuery, [...params, limit, offset]) as any[]
  return {
    backups: backups.map(parseCampaignBackup),
    total,
  }
}

/** 与 dedup 脚本一致的备份优先级排序（用于 SQL ORDER BY） */
export function getBackupRankOrderSql(dbType: DatabaseType, tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : ''
  const hasConfig =
    dbType === 'postgres'
      ? `${p}campaign_config IS NOT NULL AND ${p}campaign_config::text NOT IN ('null', '{}')`
      : `${p}campaign_config IS NOT NULL AND TRIM(${p}campaign_config) NOT IN ('', '{}', 'null')`
  return `
    ${p}backup_version DESC,
    CASE WHEN ${hasConfig} THEN 0 ELSE 1 END,
    ${p}updated_at DESC,
    ${p}id DESC
  `
}

export async function getLatestBackupForOffer(offerId: number, userId: number): Promise<CampaignBackup | null> {
  const db = await getDatabase()
  const rankOrder = getBackupRankOrderSql(db.type)

  const backup = await db.queryOne(`
    SELECT * FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    ORDER BY ${rankOrder}
    LIMIT 1
  `, [offerId, userId]) as any

  if (!backup) {
    return null
  }

  return parseCampaignBackup(backup)
}

export interface UpsertCampaignBackupAfterPublishInput {
  userId: number
  offerId: number
  adCreativeId: number
  campaignData: Record<string, unknown>
  campaignConfig: unknown
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa?: number | null
  maxCpc?: number | null
  googleAdsAccountId: number | null
  customName?: string | null
  status?: string
}

/**
 * 发布完成后 upsert 备份：每个 Offer 仅保留一条，写入完整 campaign_config
 */
async function findAutoadsLikeBackupId(
  offerId: number,
  userId: number
): Promise<number | null> {
  const db = await getDatabase()
  const rankOrder = getBackupRankOrderSql(db.type)
  const row = (await db.queryOne(
    `
    SELECT id FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
      AND (backup_source = 'autoads' OR backup_source = 'publish')
    ORDER BY ${rankOrder}
    LIMIT 1
  `,
    [offerId, userId]
  )) as { id: number } | undefined
  return row?.id ?? null
}

export async function hasAutoadsLikeBackupForOffer(
  offerId: number,
  userId: number
): Promise<boolean> {
  const db = await getDatabase()
  const row = await db.queryOne(
    `
    SELECT id FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
      AND (backup_source = 'autoads' OR backup_source = 'publish')
    LIMIT 1
  `,
    [offerId, userId]
  )
  return row != null
}

export async function findLatestGoogleAdsBackupForOffer(
  offerId: number,
  userId: number
): Promise<{ id: number; backup_version: number } | null> {
  const db = await getDatabase()
  const rankOrder = getBackupRankOrderSql(db.type)
  const row = (await db.queryOne(
    `
    SELECT id, backup_version FROM campaign_backups
    WHERE offer_id = ? AND user_id = ? AND backup_source = 'google_ads'
    ORDER BY ${rankOrder}
    LIMIT 1
  `,
    [offerId, userId]
  )) as { id: number; backup_version: number } | undefined
  return row ?? null
}

async function deleteDuplicateAutoadsLikeBackups(
  offerId: number,
  userId: number,
  keepId: number
): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
    DELETE FROM campaign_backups
    WHERE offer_id = ? AND user_id = ? AND id != ?
      AND (backup_source = 'autoads' OR backup_source = 'publish')
  `,
    [offerId, userId, keepId]
  )
}

/**
 * 按统一排名保留 canonical 与 google_ads v2+ 最终备份，删除其余重复行
 */
export async function pruneCampaignBackupsForOffer(
  offerId: number,
  userId: number
): Promise<number> {
  const db = await getDatabase()
  const rankOrder = getBackupRankOrderSql(db.type)

  const canonical = (await db.queryOne(
    `
    SELECT id FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    ORDER BY ${rankOrder}
    LIMIT 1
  `,
    [offerId, userId]
  )) as { id: number } | undefined

  if (!canonical) {
    return 0
  }

  const keepRows = (await db.query(
    `
    SELECT id FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
      AND (
        id = ?
        OR (backup_source = 'google_ads' AND backup_version >= 2)
      )
  `,
    [offerId, userId, canonical.id]
  )) as Array<{ id: number }>

  const keepIds = [...new Set(keepRows.map((r) => r.id))]
  if (keepIds.length === 0) {
    return 0
  }

  const placeholders = keepIds.map(() => '?').join(', ')
  const deleteResult = await db.exec(
    `
    DELETE FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
      AND id NOT IN (${placeholders})
  `,
    [offerId, userId, ...keepIds]
  )

  await db.exec(
    `
    UPDATE campaign_backups
    SET backup_source = 'autoads', updated_at = ?
    WHERE offer_id = ? AND user_id = ?
      AND backup_source = 'publish'
      AND id IN (${placeholders})
  `,
    [new Date().toISOString(), offerId, userId, ...keepIds]
  )

  return deleteResult.changes ?? 0
}

export async function upsertCampaignBackupAfterPublish(
  input: UpsertCampaignBackupAfterPublishInput
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const campaignDataDb = toDbCampaignBackupJsonField(input.campaignData, db.type)
  const campaignConfigDb = toDbCampaignBackupJsonField(input.campaignConfig, db.type)

  const autoadsBackupId = await findAutoadsLikeBackupId(input.offerId, input.userId)

  if (autoadsBackupId) {
    await db.exec(
      `
      UPDATE campaign_backups
      SET
        ad_creative_id = ?,
        campaign_data = ?,
        campaign_config = ?,
        backup_type = 'auto',
        backup_source = 'autoads',
        custom_name = ?,
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        target_cpa = ?,
        max_cpc = ?,
        status = ?,
        google_ads_account_id = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
      [
        input.adCreativeId,
        campaignDataDb,
        campaignConfigDb,
        input.customName ?? null,
        input.campaignName,
        input.budgetAmount,
        input.budgetType,
        input.targetCpa ?? null,
        input.maxCpc ?? null,
        input.status ?? 'PAUSED',
        input.googleAdsAccountId,
        now,
        autoadsBackupId,
        input.userId,
      ]
    )

    await deleteDuplicateAutoadsLikeBackups(input.offerId, input.userId, autoadsBackupId)
    const pruned = await pruneCampaignBackupsForOffer(input.offerId, input.userId)

    console.log(
      `[Publish Backup] Updated autoads backup id=${autoadsBackupId} for offer=${input.offerId}, pruned=${pruned}`
    )
    return
  }

  const googleBackup = await findLatestGoogleAdsBackupForOffer(input.offerId, input.userId)
  if (googleBackup && googleBackup.backup_version >= 2) {
    const pruned = await pruneCampaignBackupsForOffer(input.offerId, input.userId)
    console.log(
      `[Publish Backup] Skip: google_ads backup v${googleBackup.backup_version} is final for offer=${input.offerId}, pruned=${pruned}`
    )
    return
  }

  await createCampaignBackup({
    userId: input.userId,
    offerId: input.offerId,
    campaignData: input.campaignData,
    campaignConfig: input.campaignConfig,
    backupType: 'auto',
    backupSource: 'autoads',
    backupVersion: 1,
    customName: input.customName ?? null,
    campaignName: input.campaignName,
    budgetAmount: input.budgetAmount,
    budgetType: input.budgetType,
    targetCpa: input.targetCpa ?? null,
    maxCpc: input.maxCpc ?? null,
    status: input.status ?? 'PAUSED',
    googleAdsAccountId: input.googleAdsAccountId,
    adCreativeId: input.adCreativeId,
  })

  const pruned = await pruneCampaignBackupsForOffer(input.offerId, input.userId)
  console.log(
    `[Publish Backup] Created backup for offer=${input.offerId}, pruned=${pruned}`
  )
}

/**
 * 删除备份
 */
export async function deleteCampaignBackup(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return result.changes > 0
}

/**
 * 解析备份数据（DB 行或已解析对象）
 */
export function parseCampaignBackup(row: any): CampaignBackup {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    campaignData: parseCampaignBackupJsonField(row.campaign_data) ?? {},
    campaignConfig: parseCampaignBackupJsonField(row.campaign_config),
    backupType: row.backup_type,
    backupSource: row.backup_source,
    backupVersion: row.backup_version,
    customName: row.custom_name,
    campaignName: row.campaign_name,
    budgetAmount: row.budget_amount,
    budgetType: row.budget_type,
    targetCpa: row.target_cpa,
    maxCpc: row.max_cpc,
    status: row.status,
    googleAdsAccountId: row.google_ads_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adCreativeId: row.ad_creative_id,  // 🔧 新增：广告创意 ID
  }
}

/**
 * 自动备份广告系列（创建时调用）
 */
export async function autoBackupCampaign(params: {
  userId: number
  offerId: number
  campaignId: string | number
  backupSource: 'autoads' | 'google_ads'
}): Promise<void> {
  const db = await getDatabase()

  let sqlStr = `
    SELECT * FROM campaigns
    WHERE campaign_id = ? AND user_id = ?
  `
  if (typeof params.campaignId === 'number') {
    sqlStr = `
      SELECT * FROM campaigns
      WHERE id = ? AND user_id = ?
    `
  }
  // 获取广告系列数据
  const campaign = await db.queryOne(sqlStr, [params.campaignId, params.userId]) as any

  if (!campaign) {
    console.error('[Auto Backup] Campaign not found:', params.campaignId)
    return
  }

  if (await hasAutoadsLikeBackupForOffer(campaign.offer_id, params.userId)) {
    console.log('[Auto Backup] Skip update: autoads backup is immutable after creation:', params.campaignId)
    return
  }

  const googleBackup = await findLatestGoogleAdsBackupForOffer(
    campaign.offer_id,
    params.userId
  )

  if (!googleBackup) {
    console.log('[Auto Backup] Creating new backup for campaign:', params.campaignId)

    await createCampaignBackup({
      userId: params.userId,
      offerId: campaign.offer_id,
      campaignData: campaign,
      campaignConfig: campaign.campaign_config,
      backupType: 'auto',
      backupSource: params.backupSource,
      backupVersion: 1,
      customName: campaign.custom_name,
      campaignName: campaign.campaign_name,
      budgetAmount: campaign.budget_amount,
      budgetType: campaign.budget_type,
      targetCpa: campaign.target_cpa,
      maxCpc: campaign.max_cpc,
      status: campaign.status,
      googleAdsAccountId: campaign.google_ads_account_id,
      adCreativeId: campaign.ad_creative_id,
    })
    await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
    return
  }

  if (googleBackup.backup_version >= 2) {
    console.log('[Auto Backup] Skip update: google_ads backup already upgraded to version 2:', params.campaignId)
    return
  }

  const googleRow = await db.queryOne<{ created_at: string }>(
    `
    SELECT created_at FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `,
    [googleBackup.id, params.userId]
  )

  const createdAtMs = googleRow ? new Date(googleRow.created_at).getTime() : NaN
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const elapsedMs = Date.now() - createdAtMs
  const hasReachedDay7 = Number.isFinite(createdAtMs) && elapsedMs >= sevenDaysMs

  if (!hasReachedDay7) {
    console.log('[Auto Backup] Skip update: google_ads backup has not reached day 7 yet:', params.campaignId)
    return
  }

  console.log('[Auto Backup] Day-7 update for google_ads backup:', params.campaignId)
  await db.exec(
    `
    UPDATE campaign_backups
    SET campaign_data = ?,
        campaign_config = ?,
        backup_source = ?,
        backup_version = 2,
        updated_at = ?
    WHERE id = ? AND user_id = ?
  `,
    [
      toDbCampaignBackupJsonField(campaign, db.type),
      toDbCampaignBackupJsonField(campaign.campaign_config, db.type),
      'google_ads',
      new Date().toISOString(),
      googleBackup.id,
      params.userId,
    ]
  )
  await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
}
