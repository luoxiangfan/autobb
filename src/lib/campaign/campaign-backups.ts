/**
 * 广告系列备份服务
 *
 * 功能：
 * 1. 创建广告系列时自动备份
 * 2. Google Ads 同步时备份（初始 + 第 7 天）
 * 3. 通过备份快速创建广告系列
 *
 * 策略：每个 (user_id, offer_id) 仅一条备份（与 backup_source 无关），由 DB 唯一索引约束。
 *
 * 🔧 更新 (2026-04-20): 新增 campaign_config 字段备份
 */

import { getDatabase } from '../db'
import { getInsertedId, isUniqueConstraintViolation } from '../db'
import { offerOccupyingCampaignIdSubquerySql } from './campaign-offer-constraint'
import { parseJsonField, toDbJsonObjectField } from '../db'

export { backupHasCampaignConfig } from './campaign-backup-config'

/** 写入备份的 campaign_data 快照（与发布 upsert 字段对齐，不含 campaigns 表元数据） */
export function buildCampaignBackupDataFromRow(campaign: {
  campaign_id?: string | null
  offer_id: number
  google_ads_account_id?: number | null
  campaign_name?: string | null
  budget_amount?: number | null
  budget_type?: string | null
  max_cpc?: number | null
  target_cpa?: number | null
  status?: string | null
}): Record<string, unknown> {
  return {
    campaign_id: campaign.campaign_id ?? null,
    offer_id: campaign.offer_id,
    google_ads_account_id: campaign.google_ads_account_id ?? null,
    campaign_name: campaign.campaign_name ?? null,
    budget_amount: campaign.budget_amount ?? null,
    budget_type: campaign.budget_type ?? null,
    max_cpc: campaign.max_cpc ?? null,
    target_cpa: campaign.target_cpa ?? null,
    status: campaign.status ?? null,
  }
}

/** 历史 publish 来源与 autoads 等价（发布时会归一为 autoads） */
export function isAutoadsLikeBackupSource(source: string): boolean {
  return source === 'autoads' || source === 'publish'
}

/** campaign_backups.campaign_data / campaign_config（PostgreSQL JSONB） */
export function toDbCampaignBackupJsonField(value: unknown): unknown {
  return toDbJsonObjectField(value, null)
}

/** campaigns.campaign_config 列为 TEXT */
export { toDbJsonTextField as toDbCampaignConfigTextField } from '../db'

function parseCampaignBackupJsonField(value: unknown): unknown | null {
  if (value == null) return null
  return parseJsonField(value, null)
}

/** 发布任务侧最终快照（优先于 campaigns 表内可能滞后的 campaign_config） */
export type PublishedCampaignBackupSnapshot = {
  campaignName?: string
  campaignConfig?: Record<string, unknown>
  creative?: {
    id?: number
    headlines?: string[]
    descriptions?: string[]
    finalUrl?: string
    finalUrlSuffix?: string
    path1?: string
    path2?: string
    callouts?: string[]
    sitelinks?: Array<{
      text: string
      url: string
      description?: string
    }>
  }
  adGroupName?: string
  adName?: string
  googleCampaignId?: string
  googleAdGroupId?: string
  googleAdId?: string
}

/**
 * 将 DB campaign_config 与发布任务最终配置合并（任务字段覆盖 DB，用于备份回写）。
 */
export function mergeCampaignConfigForBackupSync(
  baseConfig: unknown,
  snapshot: PublishedCampaignBackupSnapshot
): Record<string, unknown> | null {
  const base: Record<string, unknown> =
    baseConfig && typeof baseConfig === 'object' && !Array.isArray(baseConfig)
      ? { ...(baseConfig as Record<string, unknown>) }
      : {}

  if (snapshot.campaignConfig && typeof snapshot.campaignConfig === 'object') {
    Object.assign(base, snapshot.campaignConfig)
  }

  if (snapshot.campaignName) {
    base.campaignName = snapshot.campaignName
  }
  if (snapshot.adGroupName) {
    base.adGroupName = snapshot.adGroupName
  }
  if (snapshot.adName) {
    base.adName = snapshot.adName
  }

  const creative = snapshot.creative
  if (creative) {
    if (creative.headlines) base.headlines = creative.headlines
    if (creative.descriptions) base.descriptions = creative.descriptions
    if (creative.finalUrl) base.finalUrl = creative.finalUrl
    if (creative.finalUrlSuffix !== undefined) {
      base.finalUrlSuffix = creative.finalUrlSuffix
    }
    if (creative.path1 !== undefined) base.path1 = creative.path1
    if (creative.path2 !== undefined) base.path2 = creative.path2
    if (creative.callouts) base.callouts = creative.callouts
    if (creative.sitelinks) base.sitelinks = creative.sitelinks
    if (creative.id != null) base.adCreativeId = creative.id
  }

  return Object.keys(base).length > 0 ? base : null
}

/** 备份表标量字段：合并后的 campaign_config 优先，其次 campaigns 行 */
export function resolveBackupScalarFieldsForSync(
  campaign: Record<string, unknown>,
  campaignConfig: Record<string, unknown> | null
): {
  budgetAmount: number
  budgetType: string
  maxCpc: number | null
  targetCpa: number | null
} {
  const cfg = campaignConfig ?? {}

  const budgetAmountRaw = cfg.budgetAmount ?? campaign.budget_amount ?? 0
  const budgetTypeRaw = cfg.budgetType ?? campaign.budget_type ?? 'DAILY'
  const maxCpcRaw = cfg.maxCpcBid ?? cfg.max_cpc ?? campaign.max_cpc ?? null
  const targetCpaRaw = cfg.targetCpa ?? cfg.target_cpa ?? campaign.target_cpa ?? null

  const budgetAmount = Number(budgetAmountRaw)
  const maxCpcNum = Number(maxCpcRaw)
  const targetCpaNum = Number(targetCpaRaw)

  return {
    budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : 0,
    budgetType: String(budgetTypeRaw || 'DAILY'),
    maxCpc: Number.isFinite(maxCpcNum) && maxCpcNum > 0 ? maxCpcNum : null,
    targetCpa: Number.isFinite(targetCpaNum) && targetCpaNum > 0 ? targetCpaNum : null,
  }
}

/** 从 campaign-publish 任务上下文构建备份回写快照 */
export function buildPublishedCampaignBackupSnapshot(input: {
  campaignName: string
  campaignConfig: Record<string, unknown>
  creative: PublishedCampaignBackupSnapshot['creative']
  naming?: {
    adGroupName?: string
    adName?: string
    campaignName?: string
  }
  googleCampaignId?: string
  googleAdGroupId?: string
  googleAdId?: string
}): PublishedCampaignBackupSnapshot {
  return {
    campaignName: input.campaignName,
    campaignConfig: input.campaignConfig,
    creative: input.creative,
    adGroupName: input.naming?.adGroupName,
    adName: input.naming?.adName,
    googleCampaignId: input.googleCampaignId,
    googleAdGroupId: input.googleAdGroupId,
    googleAdId: input.googleAdId,
  }
}

/**
 * 广告系列备份数据接口
 */
export interface CampaignBackup {
  id: number
  userId: number
  offerId: number
  campaignData: any // JSON 格式的完整广告系列数据
  campaignConfig: any | null // 🔧 新增：广告系列配置
  backupType: 'auto' | 'manual'
  backupSource: 'autoads' | 'google_ads'
  backupVersion: number // 1=初始备份，2=第 7 天备份
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
  adCreativeId?: number | null // 🔧 新增：广告创意 ID
}

/**
 * 创建备份的输入参数
 */
export interface CreateCampaignBackupInput {
  userId: number
  offerId: number
  campaignData: any
  campaignConfig?: any | null // 🔧 新增：广告系列配置
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
  userId: number
  offerId?: number
  backupSource?: 'autoads' | 'google_ads' | 'all'
  backupVersion?: number
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
  /** 关联 offers 表，返回 offer_name / brand（列表 API 使用） */
  withOfferInfo?: boolean
}

/** 列表 API / 页面使用的备份行（snake_case，含 JSON 已解析字段） */
export interface CampaignBackupListItem {
  id: number
  user_id: number
  offer_id: number
  ad_creative_id: number | null
  campaign_data: unknown
  campaign_config: unknown | null
  backup_type: string
  backup_source: string
  backup_version: number
  custom_name: string | null
  campaign_name: string
  budget_amount: number
  budget_type: string
  created_at: string
  updated_at: string
  offer_name?: string | null
  brand?: string | null
  /** Offer 是否已有占用槽位的 campaign（不可再从该备份创建） */
  has_active_campaign?: boolean
  active_campaign_id?: number | null
}

function mapRowToCampaignBackupListItem(row: Record<string, unknown>): CampaignBackupListItem {
  return {
    id: row.id as number,
    user_id: row.user_id as number,
    offer_id: row.offer_id as number,
    ad_creative_id: (row.ad_creative_id as number | null) ?? null,
    campaign_data: parseCampaignBackupJsonField(row.campaign_data) ?? {},
    campaign_config: parseCampaignBackupJsonField(row.campaign_config),
    backup_type: row.backup_type as string,
    backup_source: row.backup_source as string,
    backup_version: row.backup_version as number,
    custom_name: (row.custom_name as string | null) ?? null,
    campaign_name: row.campaign_name as string,
    budget_amount: row.budget_amount as number,
    budget_type: row.budget_type as string,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    ...(row.offer_name !== undefined ? { offer_name: row.offer_name as string | null } : {}),
    ...(row.brand !== undefined ? { brand: row.brand as string | null } : {}),
    ...(row.active_campaign_id !== undefined
      ? {
          active_campaign_id: (row.active_campaign_id as number | null) ?? null,
          has_active_campaign: row.active_campaign_id != null,
        }
      : {}),
  }
}

/** 并发 INSERT 撞上 (user_id, offer_id) 唯一索引时的错误识别 */
export function isCampaignBackupOfferUniqueViolation(error: unknown): boolean {
  return isUniqueConstraintViolation(error, {
    constraint: 'idx_campaign_backups_user_offer_unique',
    table: 'campaign_backups',
  })
}

async function updateCampaignBackupFromInput(
  db: Awaited<ReturnType<typeof getDatabase>>,
  backupId: number,
  input: CreateCampaignBackupInput
): Promise<CampaignBackup> {
  await updateCampaignBackupSnapshot(db, {
    backupId,
    userId: input.userId,
    adCreativeId: input.adCreativeId ?? null,
    campaignData: input.campaignData,
    campaignConfig: input.campaignConfig,
    campaignName: input.campaignName,
    budgetAmount: input.budgetAmount,
    budgetType: input.budgetType,
    targetCpa: input.targetCpa ?? null,
    maxCpc: input.maxCpc ?? null,
    status: input.status,
    googleAdsAccountId: input.googleAdsAccountId ?? null,
    customName: input.customName ?? null,
    backupSource: input.backupSource,
    backupVersion: input.backupVersion,
  })
  return await getCampaignBackupById(backupId, input.userId)
}

/**
 * 创建广告系列备份
 */
export async function createCampaignBackup(
  input: CreateCampaignBackupInput
): Promise<CampaignBackup> {
  const db = await getDatabase()
  const existingId = await findCampaignBackupIdForOffer(input.offerId, input.userId)
  if (existingId != null) {
    return await updateCampaignBackupFromInput(db, existingId, input)
  }

  const now = new Date().toISOString()

  const campaignDataDb = toDbCampaignBackupJsonField(input.campaignData)
  const campaignConfigDb = toDbCampaignBackupJsonField(input.campaignConfig)

  try {
    const result = await db.exec(
      `
      INSERT INTO campaign_backups (
        user_id, offer_id, campaign_data, campaign_config,
        backup_type, backup_source, backup_version,
        custom_name, campaign_name,
        budget_amount, budget_type,
        target_cpa, max_cpc,
        status, google_ads_account_id,
        created_at, updated_at, ad_creative_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
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
        input.adCreativeId || null,
      ]
    )

    const backupId = getInsertedId(result)
    return await getCampaignBackupById(backupId, input.userId)
  } catch (error) {
    if (!isCampaignBackupOfferUniqueViolation(error)) {
      throw error
    }
    const racedId = await findCampaignBackupIdForOffer(input.offerId, input.userId)
    if (racedId == null) {
      throw error
    }
    return await updateCampaignBackupFromInput(db, racedId, input)
  }
}

/**
 * 根据 ID 获取备份
 */
async function getCampaignBackupById(id: number, userId: number): Promise<CampaignBackup> {
  const db = await getDatabase()

  const backup = (await db.queryOne(
    `
    SELECT * FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `,
    [id, userId]
  )) as any

  if (!backup) {
    throw new Error('备份不存在或无权访问')
  }

  return parseCampaignBackup(backup)
}

/**
 * 查询备份列表（分页、筛选；可选关联 Offer）
 */
export async function listCampaignBackups(filters: CampaignBackupFilters): Promise<{
  backups: CampaignBackupListItem[]
  total: number
  limit: number
  offset: number
}> {
  const db = await getDatabase()
  const p = filters.withOfferInfo ? 'cb.' : ''
  const fromClause = filters.withOfferInfo
    ? 'campaign_backups cb LEFT JOIN offers o ON cb.offer_id = o.id'
    : 'campaign_backups'

  const whereConditions: string[] = [`${p}user_id = ?`]
  const params: unknown[] = [filters.userId]

  if (filters.offerId !== undefined) {
    whereConditions.push(`${p}offer_id = ?`)
    params.push(filters.offerId)
  }

  if (filters.startDate) {
    whereConditions.push(`${p}created_at >= ?`)
    params.push(`${filters.startDate} 00:00:00.000`)
  }
  if (filters.endDate) {
    whereConditions.push(`${p}created_at <= ?`)
    params.push(`${filters.endDate} 23:59:59.999`)
  }

  if (filters.backupSource === 'autoads') {
    whereConditions.push(`(${p}backup_source = 'autoads' OR ${p}backup_source = 'publish')`)
  } else if (filters.backupSource === 'google_ads') {
    whereConditions.push(`${p}backup_source = ?`)
    params.push('google_ads')
  }

  if (filters.backupVersion !== undefined) {
    whereConditions.push(`${p}backup_version = ?`)
    params.push(filters.backupVersion)
  }

  const whereClause = `WHERE ${whereConditions.join(' AND ')}`
  const limit = filters.limit ?? 20
  const offset = filters.offset ?? 0

  const countResult = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${fromClause} ${whereClause}`,
    params
  )
  const total = countResult?.count ?? 0

  const occupyingCampaignSubquery = filters.withOfferInfo
    ? offerOccupyingCampaignIdSubquerySql('cb.offer_id', 'cb.user_id')
    : null

  const selectColumns = filters.withOfferInfo
    ? `
        cb.id,
        cb.user_id,
        cb.offer_id,
        cb.ad_creative_id,
        cb.campaign_data,
        cb.campaign_config,
        cb.backup_type,
        cb.backup_source,
        cb.backup_version,
        cb.custom_name,
        cb.campaign_name,
        cb.budget_amount,
        cb.budget_type,
        cb.created_at,
        cb.updated_at,
        o.offer_name,
        o.brand,
        ${occupyingCampaignSubquery} AS active_campaign_id
      `
    : '*'

  const rows = (await db.query(
    `
    SELECT ${selectColumns}
    FROM ${fromClause}
    ${whereClause}
    ORDER BY ${p}created_at DESC
    LIMIT ? OFFSET ?
  `,
    [...params, limit, offset]
  )) as Record<string, unknown>[]

  return {
    backups: rows.map(mapRowToCampaignBackupListItem),
    total,
    limit,
    offset,
  }
}

/** 与 dedup 脚本一致的备份优先级排序（用于 SQL ORDER BY） */
export function getBackupRankOrderSql(tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : ''
  const hasConfig = `${p}campaign_config IS NOT NULL AND ${p}campaign_config::text NOT IN ('null', '{}')`
  return `
    ${p}backup_version DESC,
    CASE WHEN ${hasConfig} THEN 0 ELSE 1 END,
    ${p}updated_at DESC,
    ${p}id DESC
  `
}

export interface UpsertCampaignBackupAfterPublishInput {
  userId: number
  offerId: number
  adCreativeId?: number | null
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

/** 每个 (user_id, offer_id) 仅允许一条备份时，取排名最高的一条 id */
async function findCampaignBackupIdForOffer(
  offerId: number,
  userId: number
): Promise<number | null> {
  const db = await getDatabase()
  const rankOrder = getBackupRankOrderSql()
  const row = (await db.queryOne(
    `
    SELECT id FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    ORDER BY ${rankOrder}
    LIMIT 1
  `,
    [offerId, userId]
  )) as { id: number } | undefined
  return row?.id ?? null
} /** 唯一备份行是否为 autoads / publish 来源（用于 Google 同步跳过覆写） */
export async function hasAutoadsLikeBackupForOffer(
  offerId: number,
  userId: number
): Promise<boolean> {
  const db = await getDatabase()
  const row = (await db.queryOne(
    `
    SELECT backup_source FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    LIMIT 1
  `,
    [offerId, userId]
  )) as { backup_source: string } | undefined
  return row != null && isAutoadsLikeBackupSource(row.backup_source)
}

export async function findLatestGoogleAdsBackupForOffer(
  offerId: number,
  userId: number
): Promise<{ id: number; backup_version: number } | null> {
  const db = await getDatabase()
  const row = (await db.queryOne(
    `
    SELECT id, backup_version, backup_source FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    LIMIT 1
  `,
    [offerId, userId]
  )) as { id: number; backup_version: number; backup_source: string } | undefined
  if (!row || row.backup_source !== 'google_ads') {
    return null
  }
  return { id: row.id, backup_version: row.backup_version }
}

/**
 * 每个 (user_id, offer_id) 仅保留排名最高的一条备份（与 backup_source 无关）
 */
export async function pruneCampaignBackupsForOffer(
  offerId: number,
  userId: number
): Promise<number> {
  const db = await getDatabase()
  const keepId = await findCampaignBackupIdForOffer(offerId, userId)
  if (keepId == null) {
    return 0
  }

  const deleteResult = await db.exec(
    `
    DELETE FROM campaign_backups
    WHERE offer_id = ? AND user_id = ? AND id != ?
  `,
    [offerId, userId, keepId]
  )

  await db.exec(
    `
    UPDATE campaign_backups
    SET backup_source = 'autoads', updated_at = ?
    WHERE offer_id = ? AND user_id = ?
      AND backup_source = 'publish'
      AND id = ?
  `,
    [new Date().toISOString(), offerId, userId, keepId]
  )

  return deleteResult.changes ?? 0
}

async function updateCampaignBackupSnapshot(
  db: Awaited<ReturnType<typeof getDatabase>>,
  params: {
    backupId: number
    userId: number
    adCreativeId: number | null
    campaignData: Record<string, unknown>
    campaignConfig: unknown
    campaignName: string
    budgetAmount: number
    budgetType: string
    targetCpa: number | null
    maxCpc: number | null
    status: string
    googleAdsAccountId: number | null
    customName: string | null
    backupSource?: 'autoads' | 'google_ads'
    backupVersion?: number
  }
): Promise<void> {
  const now = new Date().toISOString()
  const campaignDataDb = toDbCampaignBackupJsonField(params.campaignData)
  const campaignConfigDb = toDbCampaignBackupJsonField(params.campaignConfig)

  await db.exec(
    `
    UPDATE campaign_backups
    SET
      ad_creative_id = ?,
      campaign_data = ?,
      campaign_config = ?,
      backup_type = 'auto',
      backup_source = ?,
      backup_version = ?,
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
      params.adCreativeId,
      campaignDataDb,
      campaignConfigDb,
      params.backupSource ?? 'autoads',
      params.backupVersion ?? 1,
      params.customName,
      params.campaignName,
      params.budgetAmount,
      params.budgetType,
      params.targetCpa,
      params.maxCpc,
      params.status,
      params.googleAdsAccountId,
      now,
      params.backupId,
      params.userId,
    ]
  )
}

type PublishedCampaignBackupPayload = {
  offerId: number
  adCreativeId: number | null
  campaignData: Record<string, unknown>
  campaignConfig: unknown
  campaignName: string
  budgetAmount: number
  budgetType: string
  targetCpa: number | null
  maxCpc: number | null
  status: string
  googleAdsAccountId: number | null
  customName: string | null
}

/** 从已发布 campaign 行 + 任务快照构建备份写入载荷 */
async function buildPublishedCampaignBackupPayload(params: {
  userId: number
  campaignId: number
  publishedSnapshot?: PublishedCampaignBackupSnapshot
}): Promise<PublishedCampaignBackupPayload | null> {
  const db = await getDatabase()

  const campaign = (await db.queryOne(
    `
    SELECT *
    FROM campaigns
    WHERE id = ? AND user_id = ?
  `,
    [params.campaignId, params.userId]
  )) as Record<string, unknown> | undefined

  if (!campaign) {
    console.warn('[Backup Sync] Campaign not found:', params.campaignId)
    return null
  }

  const offerId = campaign.offer_id as number
  const snapshot = params.publishedSnapshot
  const campaignConfig = snapshot
    ? mergeCampaignConfigForBackupSync(campaign.campaign_config, snapshot)
    : parseCampaignBackupJsonField(campaign.campaign_config)

  const resolvedCampaignName = snapshot?.campaignName
    ? String(snapshot.campaignName)
    : String(campaign.campaign_name ?? 'Campaign')

  const resolvedGoogleCampaignId =
    snapshot?.googleCampaignId?.trim() ||
    (campaign.campaign_id as string | null) ||
    (campaign.google_campaign_id as string | null) ||
    null

  const resolvedAdCreativeId =
    snapshot?.creative?.id ?? (campaign.ad_creative_id as number | null) ?? null

  const configRecord =
    campaignConfig && typeof campaignConfig === 'object' && !Array.isArray(campaignConfig)
      ? (campaignConfig as Record<string, unknown>)
      : null
  const scalars = resolveBackupScalarFieldsForSync(campaign, configRecord)

  return {
    offerId,
    adCreativeId: resolvedAdCreativeId,
    campaignData: buildCampaignBackupDataFromRow({
      campaign_id: resolvedGoogleCampaignId,
      offer_id: offerId,
      google_ads_account_id: (campaign.google_ads_account_id as number | null) ?? null,
      campaign_name: resolvedCampaignName,
      budget_amount: scalars.budgetAmount,
      budget_type: scalars.budgetType,
      max_cpc: scalars.maxCpc,
      target_cpa: scalars.targetCpa,
      status: (campaign.status as string | null) ?? null,
    }),
    campaignConfig,
    campaignName: resolvedCampaignName,
    budgetAmount: scalars.budgetAmount,
    budgetType: scalars.budgetType,
    targetCpa: scalars.targetCpa,
    maxCpc: scalars.maxCpc,
    status: String(campaign.status ?? 'PAUSED'),
    googleAdsAccountId: (campaign.google_ads_account_id as number | null) ?? null,
    customName: (campaign.custom_name as string | null) ?? null,
  }
}

/**
 * 发布成功后回写备份：以 campaigns 表为准，并用 publishedSnapshot 覆盖任务内最终配置。
 */
export async function syncCampaignBackupAfterPublish(params: {
  backupId: number
  userId: number
  campaignId: number
  publishedSnapshot?: PublishedCampaignBackupSnapshot
}): Promise<void> {
  const db = await getDatabase()
  const payload = await buildPublishedCampaignBackupPayload({
    userId: params.userId,
    campaignId: params.campaignId,
    publishedSnapshot: params.publishedSnapshot,
  })
  if (!payload) {
    return
  }

  const backupRow = (await db.queryOne(
    `
    SELECT id, offer_id
    FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `,
    [params.backupId, params.userId]
  )) as { id: number; offer_id: number } | undefined

  if (!backupRow) {
    console.warn('[Backup Sync] Backup not found:', params.backupId)
    return
  }

  if (backupRow.offer_id !== payload.offerId) {
    console.warn(
      `[Backup Sync] Offer mismatch: backup.offer_id=${backupRow.offer_id}, campaign.offer_id=${payload.offerId}`
    )
    return
  }

  await updateCampaignBackupSnapshot(db, {
    backupId: params.backupId,
    userId: params.userId,
    adCreativeId: payload.adCreativeId,
    campaignData: payload.campaignData,
    campaignConfig: payload.campaignConfig,
    campaignName: payload.campaignName,
    budgetAmount: payload.budgetAmount,
    budgetType: payload.budgetType,
    targetCpa: payload.targetCpa,
    maxCpc: payload.maxCpc,
    status: payload.status,
    googleAdsAccountId: payload.googleAdsAccountId,
    customName: payload.customName,
    backupSource: 'autoads',
    backupVersion: 1,
  })

  await pruneCampaignBackupsForOffer(payload.offerId, params.userId)
  console.log(
    `[Backup Sync] Updated backup id=${params.backupId} from published campaign id=${params.campaignId}`
  )
}

/**
 * 发布成功后回写备份（失败路径不调用）：更新已有备份，或首次成功发布时创建。
 */
export async function trySyncCampaignBackupAfterPublish(params: {
  userId: number
  campaignId: number
  offerId: number
  sourceBackupId?: number | null
  publishedSnapshot?: PublishedCampaignBackupSnapshot
}): Promise<void> {
  let backupId: number | null = null

  const explicit = params.sourceBackupId
  if (explicit != null && Number.isInteger(explicit) && explicit > 0) {
    backupId = explicit
  } else {
    backupId = await findCampaignBackupIdForOffer(params.offerId, params.userId)
  }

  try {
    if (backupId != null) {
      await syncCampaignBackupAfterPublish({
        backupId,
        userId: params.userId,
        campaignId: params.campaignId,
        publishedSnapshot: params.publishedSnapshot,
      })
      return
    }

    const payload = await buildPublishedCampaignBackupPayload({
      userId: params.userId,
      campaignId: params.campaignId,
      publishedSnapshot: params.publishedSnapshot,
    })
    if (!payload) {
      return
    }
    if (payload.offerId !== params.offerId) {
      console.warn(
        `[Backup Sync] Offer mismatch: task.offerId=${params.offerId}, campaign.offer_id=${payload.offerId}`
      )
      return
    }

    await upsertCampaignBackupAfterPublish({
      userId: params.userId,
      offerId: payload.offerId,
      adCreativeId: payload.adCreativeId,
      campaignData: payload.campaignData,
      campaignConfig: payload.campaignConfig,
      campaignName: payload.campaignName,
      budgetAmount: payload.budgetAmount,
      budgetType: payload.budgetType,
      targetCpa: payload.targetCpa,
      maxCpc: payload.maxCpc,
      googleAdsAccountId: payload.googleAdsAccountId,
      customName: payload.customName,
      status: payload.status,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Backup Sync] Failed after publish backupId=${backupId ?? 'new'}:`, message)
  }
}

async function upsertCampaignBackupAfterPublish(
  input: UpsertCampaignBackupAfterPublishInput
): Promise<void> {
  const db = await getDatabase()

  const existingBackupId = await findCampaignBackupIdForOffer(input.offerId, input.userId)

  if (existingBackupId) {
    await updateCampaignBackupSnapshot(db, {
      backupId: existingBackupId,
      userId: input.userId,
      adCreativeId: input.adCreativeId ?? null,
      campaignData: input.campaignData,
      campaignConfig: input.campaignConfig,
      campaignName: input.campaignName,
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      targetCpa: input.targetCpa ?? null,
      maxCpc: input.maxCpc ?? null,
      status: input.status ?? 'PAUSED',
      googleAdsAccountId: input.googleAdsAccountId,
      customName: input.customName ?? null,
      backupSource: 'autoads',
      backupVersion: 1,
    })

    const pruned = await pruneCampaignBackupsForOffer(input.offerId, input.userId)

    console.log(
      `[Publish Backup] Updated backup id=${existingBackupId} for offer=${input.offerId}, pruned=${pruned}`
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
  console.log(`[Publish Backup] Created backup for offer=${input.offerId}, pruned=${pruned}`)
} /**
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
    adCreativeId: row.ad_creative_id, // 🔧 新增：广告创意 ID
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
  const campaign = (await db.queryOne(sqlStr, [params.campaignId, params.userId])) as any

  if (!campaign) {
    console.error('[Auto Backup] Campaign not found:', params.campaignId)
    return
  }

  const existingBackupId = await findCampaignBackupIdForOffer(campaign.offer_id, params.userId)

  if (existingBackupId == null) {
    console.log('[Auto Backup] Creating new backup for campaign:', params.campaignId)
    await createCampaignBackup({
      userId: params.userId,
      offerId: campaign.offer_id,
      campaignData: buildCampaignBackupDataFromRow(campaign),
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

  const existingRow = (await db.queryOne(
    `
    SELECT backup_source, backup_version, created_at
    FROM campaign_backups
    WHERE id = ? AND user_id = ?
  `,
    [existingBackupId, params.userId]
  )) as
    | {
        backup_source: string
        backup_version: number
        created_at: string
      }
    | undefined

  if (!existingRow) {
    return
  }

  if (isAutoadsLikeBackupSource(existingRow.backup_source)) {
    if (params.backupSource === 'google_ads') {
      console.log(
        '[Auto Backup] Skip google_ads backup: autoads-like backup already exists for offer',
        campaign.offer_id
      )
      return
    }
    await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
    console.log(
      '[Auto Backup] Skip update: autoads backup is immutable after creation:',
      params.campaignId
    )
    return
  }

  if (params.backupSource === 'autoads') {
    const now = new Date().toISOString()
    await db.exec(
      `
      UPDATE campaign_backups
      SET
        campaign_data = ?,
        campaign_config = ?,
        backup_type = 'auto',
        backup_source = 'autoads',
        backup_version = 1,
        custom_name = ?,
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        target_cpa = ?,
        max_cpc = ?,
        status = ?,
        google_ads_account_id = ?,
        ad_creative_id = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
      [
        toDbCampaignBackupJsonField(buildCampaignBackupDataFromRow(campaign)),
        toDbCampaignBackupJsonField(campaign.campaign_config),
        campaign.custom_name,
        campaign.campaign_name,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.target_cpa,
        campaign.max_cpc,
        campaign.status,
        campaign.google_ads_account_id,
        campaign.ad_creative_id,
        now,
        existingBackupId,
        params.userId,
      ]
    )
    await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
    return
  }

  if (existingRow.backup_version >= 2) {
    await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
    console.log(
      '[Auto Backup] Skip update: google_ads backup already upgraded to version 2:',
      params.campaignId
    )
    return
  }

  const createdAtMs = new Date(existingRow.created_at).getTime()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const hasReachedDay7 = Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= sevenDaysMs

  if (!hasReachedDay7) {
    await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
    console.log(
      '[Auto Backup] Skip update: google_ads backup has not reached day 7 yet:',
      params.campaignId
    )
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
      toDbCampaignBackupJsonField(buildCampaignBackupDataFromRow(campaign)),
      toDbCampaignBackupJsonField(campaign.campaign_config),
      'google_ads',
      new Date().toISOString(),
      existingBackupId,
      params.userId,
    ]
  )
  await pruneCampaignBackupsForOffer(campaign.offer_id, params.userId)
}
