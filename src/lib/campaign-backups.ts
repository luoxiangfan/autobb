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

import { getDatabase } from './db'
import { createCampaignToGoogleAds } from './google-ads-create'
import { getInsertedId } from './db-helpers'

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

  const result = await db.exec(`
    INSERT INTO campaign_backups (
      user_id, offer_id, campaign_data, campaign_config,
      backup_type, backup_source, backup_version,
      custom_name, campaign_name,
      budget_amount, budget_type,
      target_cpa, max_cpc,
      status, google_ads_account_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.offerId,
    JSON.stringify(input.campaignData),
    input.campaignConfig ? JSON.stringify(input.campaignConfig) : null,  // 🔧 新增
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

  if (filters.backupSource !== undefined) {
    whereConditions.push('backup_source = ?')
    params.push(filters.backupSource)
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

/**
 * 获取 Offer 的最新备份
 */
export async function getLatestBackupForOffer(offerId: number, userId: number): Promise<CampaignBackup | null> {
  const db = await getDatabase()

  const backup = await db.queryOne(`
    SELECT * FROM campaign_backups
    WHERE offer_id = ? AND user_id = ?
    ORDER BY backup_version DESC, created_at DESC
    LIMIT 1
  `, [offerId, userId]) as any

  if (!backup) {
    return null
  }

  return parseCampaignBackup(backup)
}

/**
 * 通过备份创建广告系列
 */
export async function createCampaignFromBackup(
  backupId: number,
  userId: number,
  overrides?: Partial<{
    campaignName: string
    budgetAmount: number
    budgetType: string
    targetCpa: number
    maxCpc: number
    googleAdsAccountId: number
    campaignConfig: any
    createToGoogle?: boolean  // 🔧 新增：是否创建到 Google Ads
  }>
): Promise<{
  campaignId: number
  googleCampaignId?: string
  success: boolean
  errors?: Array<{ type: string; message: string }>
}> {
  const db = await getDatabase()
  const backup = await getCampaignBackupById(backupId, userId)

  if (!backup) {
    throw new Error('备份不存在或无权访问')
  }

  // 解析备份数据
  const campaignData = typeof backup.campaignData === 'string'
    ? JSON.parse(backup.campaignData)
    : backup.campaignData
  
  const campaignConfig = typeof backup.campaignConfig === 'string'
    ? JSON.parse(backup.campaignConfig)
    : backup.campaignConfig

  // 合并覆盖值
  const campaignName = overrides?.campaignName || campaignData.campaign_name || backup.campaignName
  const budgetAmount = overrides?.budgetAmount ?? campaignData.budget_amount ?? backup.budgetAmount
  const budgetType = overrides?.budgetType || campaignData.budget_type || backup.budgetType
  const targetCpa = overrides?.targetCpa ?? campaignData.target_cpa ?? backup.targetCpa
  const maxCpc = overrides?.maxCpc ?? campaignData.max_cpc ?? backup.maxCpc
  const googleAdsAccountId = overrides?.googleAdsAccountId ?? campaignData.google_ads_account_id ?? backup.googleAdsAccountId
  const finalCampaignConfig = overrides?.campaignConfig ?? campaignConfig  // 🔧 新增

  // 创建广告系列
  const result = await db.exec(`
    INSERT INTO campaigns (
      user_id, offer_id, google_ads_account_id,
      campaign_id, campaign_name, custom_name,
      budget_amount, budget_type,
      target_cpa, max_cpc,
      campaign_config,  -- 🔧 新增：恢复配置
      status, creation_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `, [
    userId,
    backup.offerId,
    googleAdsAccountId,
    null,  // campaign_id (Google Ads ID，初始为 null)
    campaignName,
    backup.customName,  // 🔧 保留自定义名称
    budgetAmount,
    budgetType,
    targetCpa,
    maxCpc,
    finalCampaignConfig ? JSON.stringify(finalCampaignConfig) : null,  // 🔧 恢复配置
    'PAUSED',  // 初始状态为暂停
    new Date(),
    new Date(),
  ])

  const campaignId = getInsertedId(result, db.type)

  // 记录备份使用日志
  await db.exec(`
    UPDATE campaign_backups
    SET updated_at = ?
    WHERE id = ?
  `, [new Date().toISOString(), backupId])

  // 🔧 如果指定了创建到 Google Ads，调用 Google Ads API
  let googleCampaignId: string | undefined
  let createErrors: Array<{ type: string; message: string }> = []

  if (overrides?.createToGoogle && googleAdsAccountId && finalCampaignConfig) {
    try {
      // 获取 Google Ads customer_id
      const account = await db.queryOne(
        'SELECT customer_id FROM google_ads_accounts WHERE id = ? AND user_id = ?',
        [googleAdsAccountId, userId]
      ) as { customer_id: string } | undefined

      if (account?.customer_id) {
        const createResult = await createCampaignToGoogleAds(
          userId,
          account.customer_id,
          finalCampaignConfig
        )

        if (createResult.success && createResult.campaignId) {
          googleCampaignId = createResult.campaignId

          // 更新 campaigns 表的 campaign_id 字段
          await db.exec(`
            UPDATE campaigns
            SET campaign_id = ?,
                creation_status = 'published',
                updated_at = ?
            WHERE id = ?
          `, [googleCampaignId, new Date(), campaignId])

          console.log(`[Create from Backup] Created campaign to Google Ads: ${googleCampaignId}`)
        } else {
          createErrors = createResult.errors || []
          console.error('[Create from Backup] Failed to create to Google Ads:', createErrors)
        }
      }
    } catch (error: any) {
      createErrors.push({
        type: 'error',
        message: error.message,
      })
      console.error('[Create from Backup] Error:', error)
    }
  }

  return {
    campaignId,
    googleCampaignId,
    success: true,
    errors: createErrors.length > 0 ? createErrors : undefined,
  }
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
 * 解析备份数据
 */
function parseCampaignBackup(row: any): CampaignBackup {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    campaignData: typeof row.campaign_data === 'string' ? JSON.parse(row.campaign_data) : row.campaign_data,
    campaignConfig: row.campaign_config ? (typeof row.campaign_config === 'string' ? JSON.parse(row.campaign_config) : row.campaign_config) : null,  // 🔧 新增
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
  }
}

/**
 * 自动备份广告系列（创建时调用）
 */
export async function autoBackupCampaign(params: {
  userId: number
  offerId: number
  campaignId: number
  backupSource: 'autoads' | 'google_ads'
}): Promise<void> {
  const db = await getDatabase()

  // 获取广告系列数据
  const campaign = await db.queryOne(`
    SELECT * FROM campaigns
    WHERE id = ? AND user_id = ?
  `, [params.campaignId, params.userId]) as any

  if (!campaign) {
    console.error('[Auto Backup] Campaign not found:', params.campaignId)
    return
  }

  // 对于 Google Ads 同步的广告系列，检查是否已有备份
  if (params.backupSource === 'google_ads') {
    const existingBackup = await db.queryOne(`
      SELECT backup_version FROM campaign_backups
      WHERE offer_id = ? AND user_id = ? AND backup_source = 'google_ads'
      ORDER BY backup_version DESC
      LIMIT 1
    `, [campaign.offer_id, params.userId]) as any

    // 如果已有 version 2 的备份，说明已经备份过两次，不再重复备份
    if (existingBackup?.backup_version === 2) {
      console.log('[Auto Backup] Already backed up twice for Google Ads campaign:', params.campaignId)
      return
    }

    // 确定备份版本
    const backupVersion = existingBackup ? 2 : 1
    console.log(`[Auto Backup] Creating Google Ads backup version ${backupVersion} for campaign:`, params.campaignId)

    await createCampaignBackup({
      userId: params.userId,
      offerId: campaign.offer_id,
      campaignData: campaign,
      campaignConfig: campaign.campaign_config,  // 🔧 新增：备份配置
      backupType: 'auto',
      backupSource: 'google_ads',
      backupVersion: backupVersion,
      customName: campaign.custom_name,
      campaignName: campaign.campaign_name,
      budgetAmount: campaign.budget_amount,
      budgetType: campaign.budget_type,
      targetCpa: campaign.target_cpa,
      maxCpc: campaign.max_cpc,
      status: campaign.status,
      googleAdsAccountId: campaign.google_ads_account_id,
    })
  } else {
    // autoads 创建的广告系列，只备份一次
    console.log('[Auto Backup] Creating autoads backup for campaign:', params.campaignId)

    await createCampaignBackup({
      userId: params.userId,
      offerId: campaign.offer_id,
      campaignData: campaign,
      campaignConfig: campaign.campaign_config,  // 🔧 新增：备份配置
      backupType: 'auto',
      backupSource: 'autoads',
      backupVersion: 1,
      customName: campaign.custom_name,
      campaignName: campaign.campaign_name,
      budgetAmount: campaign.budget_amount,
      budgetType: campaign.budget_type,
      targetCpa: campaign.target_cpa,
      maxCpc: campaign.max_cpc,
      status: campaign.status,
      googleAdsAccountId: campaign.google_ads_account_id,
    })
  }
}
