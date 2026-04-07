/**
 * Google Ads 广告系列同步服务
 * 
 * 功能：
 * 1. 定时从 Google Ads 账户同步广告系列到数据库
 * 2. 为每个同步的广告系列创建关联的 Offer
 * 3. 标记这些 Offer 需要完善相关信息
 * 
 * @module google-ads-campaign-sync
 */

import { getDatabase } from './db'
import { getGoogleAdsCredentialsFromDB } from './google-ads-api'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId, nowFunc } from './db-helpers'
import { createRiskAlert } from './risk-alerts'

/**
 * Google Ads 广告系列数据
 */
export interface GoogleAdsCampaign {
  campaign_id: string
  campaign_name: string
  budget_amount: number
  budget_type: 'DAILY' | 'TOTAL'
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  customer_id: string
  account_name?: string
}

/**
 * 同步结果
 */
export interface SyncResult {
  syncedCount: number
  createdOffersCount: number
  updatedOffersCount: number
  skippedOffersCount: number  // 已有关联 Offer，跳过创建/更新
  errors: Array<{
    campaignId: string
    campaignName: string
    error: string
  }>
  warnings: string[]
}

/**
 * 从 Google Ads 同步广告系列
 * 
 * @param userId - 用户 ID
 * @param options - 同步选项
 * @returns 同步结果
 */
export async function syncCampaignsFromGoogleAds(
  userId: number,
  options?: {
    customerId?: string  // 指定同步特定账户
    dryRun?: boolean     // 仅预览，不实际写入数据库
  }
): Promise<SyncResult> {
  const db = await getDatabase()
  const result: SyncResult = {
    syncedCount: 0,
    createdOffersCount: 0,
    updatedOffersCount: 0,
    skippedOffersCount: 0,
    errors: [],
    warnings: [],
  }

  try {
    console.log(`[GoogleAds Sync] Starting sync for user ${userId}...`)

    // 1. 获取用户的 Google Ads 账户凭证（单个对象）
    const credentials = await getGoogleAdsCredentialsFromDB(userId)
    if (!credentials) {
      result.warnings.push('用户未配置 Google Ads 凭证')
      return result
    }

    // 2. 获取该用户的所有活跃 Google Ads 账户（数组）
    const isActiveCondition = db.type === 'postgres' ? 'is_active = TRUE' : 'is_active = 1'
    const accounts = await db.query(
      `SELECT id, customer_id, account_name, refresh_token, auth_type, service_account_id FROM google_ads_accounts
       WHERE user_id = ? AND ${isActiveCondition} AND customer_id IS NOT NULL AND customer_id != ''
       ORDER BY id`,
      [userId]
    ) as Array<{
      id: number
      customer_id: string
      account_name: string | null
      refresh_token: string | null
      auth_type: string | null
      service_account_id: string | null
    }>

    if (accounts.length === 0) {
      result.warnings.push('没有活跃的 Google Ads 账户')
      return result
    }

    // 3. 对每个账户执行同步
    for (const account of accounts) {
      // 如果指定了 customerId，只同步该账户
      if (options?.customerId && account.customer_id !== options.customerId) {
        continue
      }

      console.log(`[GoogleAds Sync] Syncing account: ${account.customer_id} (${account.account_name || 'N/A'})`)

      try {
        // 4. 从 Google Ads API 获取广告系列列表
        const campaigns = await fetchCampaignsFromGoogleAds({
          userId,
          customerId: account.customer_id,
          serviceAccountId: account.auth_type === 'service_account' ? account.service_account_id || undefined : undefined,
        })

        console.log(`[GoogleAds Sync] Found ${campaigns.length} campaigns for account ${account.customer_id}`)

        // 5. 保存广告系列到数据库并创建关联 Offer
        for (const campaign of campaigns) {
          if (options?.dryRun) {
            console.log(`[Dry Run] Would sync campaign: ${campaign.campaign_name} (${campaign.campaign_id})`)
            result.syncedCount++
            continue
          }

          try {
            // 保存广告系列
            const campaignId = await saveCampaignToDatabase({
              userId,
              googleAdsAccountId: account.id,
              campaign,
            })

            // 创建或更新关联的 Offer
            const offerResult = await createOrUpdateOfferForCampaign({
              userId,
              campaignId,
              campaign,
            })

            result.syncedCount++
            if (offerResult.created) {
              result.createdOffersCount++
            } else if (offerResult.updated) {
              result.updatedOffersCount++
            } else if (offerResult.skipped) {
              result.skippedOffersCount++
              console.log(`[GoogleAds Sync] Skipped offer for campaign ${campaign.campaign_id} (already has offer_id=${offerResult.offerId})`)
            }

            console.log(`[GoogleAds Sync] Synced campaign: ${campaign.campaign_name} (${campaign.campaign_id}), offer: ${offerResult.created ? 'created' : offerResult.skipped ? 'skipped' : 'linked'}`)
          } catch (error: any) {
            result.errors.push({
              campaignId: campaign.campaign_id,
              campaignName: campaign.campaign_name,
              error: error.message || 'Unknown error',
            })
            console.error(`[GoogleAds Sync] Error syncing campaign ${campaign.campaign_id}:`, error)
          }
        }
      } catch (error: any) {
        const errorMsg = `同步账户 ${account.customer_id} 失败：${error.message}`
        result.errors.push({
          campaignId: account.customer_id,
          campaignName: account.account_name || 'N/A',
          error: errorMsg,
        })
        console.error(`[GoogleAds Sync] Error syncing account ${account.customer_id}:`, error)

        // 创建风险预警
        await createRiskAlert(
          userId,
          'google_ads_sync_failed',
          'warning',
          'Google Ads 广告系列同步失败',
          errorMsg,
          {
            resourceType: 'campaign',
            resourceId: account.id,
          }
        )
      }
    }

    console.log(`[GoogleAds Sync] Sync completed for user ${userId}:`, {
      synced: result.syncedCount,
      created: result.createdOffersCount,
      updated: result.updatedOffersCount,
      errors: result.errors.length,
    })
  } catch (error: any) {
    console.error('[GoogleAds Sync] Fatal error:', error)
    result.errors.push({
      campaignId: 'N/A',
      campaignName: 'N/A',
      error: `同步服务异常：${error.message}`,
    })
  }

  return result
}

/**
 * 从 Google Ads API 获取广告系列列表
 */
async function fetchCampaignsFromGoogleAds(params: {
  userId: number
  customerId: string
  serviceAccountId?: string
}): Promise<GoogleAdsCampaign[]> {
  const { userId, customerId, serviceAccountId } = params

  // 使用 GAQL 查询广告系列
  const query = `
    SELECT 
      campaign.id,
      campaign.name,
      campaign.budget_amount_micros,
      campaign.budget_type,
      campaign.status,
      customer_client.id,
      customer_client.descriptive_name
    FROM campaign
    WHERE campaign.status NOT IN ('REMOVED')
  `

  try {
    const results = await executeGAQLQueryPython({
      customerId,
      query,
      userId,
      serviceAccountId
    })
    // ? await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })
    //       : await executeOAuthQueryWithTracking({
    //         userId,
    //         customerId,
    //         customer,
    //         query,
    //         operationType: ApiOperationType.REPORT,
    //       })

    // 转换结果为结构化数据
    return results.map((row: any) => ({
      campaign_id: String(row.campaign?.id || ''),
      campaign_name: row.campaign?.name || `Campaign_${row.campaign?.id}`,
      budget_amount: Number(row.campaign?.budget_amount_micros || 0) / 1_000_000, // 转换为元
      budget_type: (row.campaign?.budget_type || 'DAILY') as 'DAILY' | 'TOTAL',
      status: (row.campaign?.status || 'PAUSED') as 'ENABLED' | 'PAUSED' | 'REMOVED',
      customer_id: customerId,
      account_name: row.customer_client?.descriptive_name,
    }))
  } catch (error: any) {
    console.error('[GoogleAds Sync] Failed to fetch campaigns:', error)
    throw new Error(`获取广告系列失败：${error.message}`)
  }
}

/**
 * 保存广告系列到数据库
 */
async function saveCampaignToDatabase(params: {
  userId: number
  googleAdsAccountId: number
  campaign: GoogleAdsCampaign
}): Promise<number> {
  const { userId, googleAdsAccountId, campaign } = params
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(
    'SELECT id FROM campaigns WHERE campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existing) {
    // 更新现有广告系列
    await db.exec(
      `UPDATE campaigns SET
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        status = ?,
        google_ads_account_id = ?,
        synced_from_google_ads = ${db.type === 'postgres' ? 'TRUE' : '1'},
        last_sync_at = ?
      WHERE id = ?`,
      [
        campaign.campaign_name,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        googleAdsAccountId,
        nowFunc(db.type),
        existing.id,
      ]
    )
    return existing.id
  } else {
    // 创建新广告系列
    const campaignName = campaign.campaign_name
    const result = await db.exec(
      `INSERT INTO campaigns (
        user_id,
        google_ads_account_id,
        campaign_id,
        campaign_name,
        budget_amount,
        budget_type,
        status,
        creation_status,
        synced_from_google_ads,
        needs_offer_completion,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ${db.type === 'postgres' ? 'TRUE' : '1'}, ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ?)`,
      [
        userId,
        googleAdsAccountId,
        campaign.campaign_id,
        campaignName,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        nowFunc(db.type),
        nowFunc(db.type),
      ]
    )
    return getInsertedId(result, db.type)
  }
}

/**
 * 为广告系列创建或更新关联的 Offer
 * 
 * 优化逻辑：
 * 1. 如果广告系列已有关联的 offer_id，则不创建或更新 Offer
 * 2. 只有当广告系列没有关联 Offer 时，才创建新 Offer
 */
async function createOrUpdateOfferForCampaign(params: {
  userId: number
  campaignId: number
  campaign: GoogleAdsCampaign
}): Promise<{ created: boolean; updated: boolean; offerId?: number; skipped: boolean }> {
  const { userId, campaignId, campaign } = params
  const db = await getDatabase()

  // 1. 首先检查广告系列是否已有关联的 offer_id
  const campaignRecord = await db.queryOne(
    'SELECT offer_id FROM campaigns WHERE id = ? AND user_id = ?',
    [campaignId, userId]
  )

  if (!campaignRecord) {
    console.warn(`[GoogleAds Sync] Campaign ${campaignId} not found for user ${userId}`)
    return { created: false, updated: false, skipped: false }
  }

  // 2. 如果广告系列已有关联的 Offer，跳过创建/更新
  if (campaignRecord.offer_id) {
    console.log(`[GoogleAds Sync] Campaign ${campaignId} already has offer_id=${campaignRecord.offer_id}, skipping offer creation/update`)
    return { 
      created: false, 
      updated: false, 
      skipped: true,
      offerId: campaignRecord.offer_id 
    }
  }

  // 3. 检查是否已存在关联的 Offer（通过 google_ads_campaign_id）
  const existingOffer = await db.queryOne(
    'SELECT id FROM offers WHERE google_ads_campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existingOffer) {
    // 4. 如果存在 Offer 但未关联到 campaign，建立关联
    console.log(`[GoogleAds Sync] Linking existing offer ${existingOffer.id} to campaign ${campaignId}`)
    
    // 更新 campaign 关联 offer_id
    await db.exec(
      `UPDATE campaigns SET offer_id = ?, needs_offer_completion = ${db.type === 'postgres' ? 'FALSE' : '0'} WHERE id = ?`,
      [existingOffer.id, campaignId]
    )

    // 更新 Offer 标记
    await db.exec(
      `UPDATE offers SET
        sync_source = 'google_ads_sync',
        updated_at = ?
      WHERE id = ?`,
      [nowFunc(db.type), existingOffer.id]
    )

    return { 
      created: false, 
      updated: false,  // 不修改 needs_completion，保持用户设置的状态
      skipped: false,
      offerId: existingOffer.id 
    }
  }

  // 5. 创建新 Offer
  console.log(`[GoogleAds Sync] Creating new offer for campaign ${campaignId}`)
  
  // 生成唯一的 offer_name
  const offerName = `GA_${campaign.campaign_id}_01`
  
  const result = await db.exec(
    `INSERT INTO offers (
      user_id,
      url,
      brand,
      target_country,
      target_language,
      offer_name,
      google_ads_campaign_id,
      sync_source,
      needs_completion,
      scrape_status,
      is_active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ?)`,
    [
      userId,
      '',  // URL 需要用户后续完善
      extractBrandFromCampaignName(campaign.campaign_name),  // 从广告系列名称提取品牌
      'US',  // 默认国家，需要用户完善
      'English',  // 默认语言
      offerName,
      campaign.campaign_id,
      'google_ads_sync',
      db.type === 'postgres' ? 'TRUE' : '1',  // 新创建的 Offer 标记为需要完善
      nowFunc(db.type),
      nowFunc(db.type),
    ]
  )

  const offerId = getInsertedId(result, db.type)

  // 更新 campaign 关联 offer_id
  await db.exec(
    `UPDATE campaigns SET offer_id = ?, needs_offer_completion = ${db.type === 'postgres' ? 'TRUE' : '1'} WHERE id = ?`,
    [offerId, campaignId]
  )

  return { created: true, updated: false, skipped: false, offerId }
}

/**
 * 从广告系列名称提取品牌名称（简单启发式）
 */
function extractBrandFromCampaignName(campaignName: string): string {
  // 简单策略：取第一个单词或下划线前的部分
  const parts = campaignName.split(/[_\s-]+/)
  return parts[0] || 'Unknown_Brand'
}

/**
 * 批量同步所有用户的 Google Ads 广告系列
 * 用于定时任务
 */
export async function syncAllUsersCampaigns(): Promise<{
  totalUsers: number
  totalSynced: number
  totalCreated: number
  totalSkipped: number  // 已有关联 Offer，跳过创建/更新
  totalErrors: number
}> {
  const db = await getDatabase()
  
  // 获取所有活跃用户
  const users = await db.query(
    `SELECT id FROM users WHERE is_active = ${db.type === 'postgres' ? 'TRUE' : '1'}`
  )

  let totalSynced = 0
  let totalCreated = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const user of users) {
    try {
      const result = await syncCampaignsFromGoogleAds(user.id)
      totalSynced += result.syncedCount
      totalCreated += result.createdOffersCount
      totalSkipped += result.skippedOffersCount
      totalErrors += result.errors.length
    } catch (error: any) {
      console.error(`[GoogleAds Sync] Error syncing user ${user.id}:`, error)
      totalErrors++
    }
  }

  return {
    totalUsers: users.length,
    totalSynced,
    totalCreated,
    totalSkipped,
    totalErrors,
  }
}
