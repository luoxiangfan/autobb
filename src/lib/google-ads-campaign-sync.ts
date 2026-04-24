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
import { autoBackupCampaign } from './campaign-backups'
import { syncAdComponentsFromGoogleAds, updateCampaignConfig } from './google-ads-api-sync'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB, trackOAuthApiCall } from './google-ads-api'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId, nowFunc } from './db-helpers'
import { createRiskAlert } from './risk-alerts'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

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
  cpc_bid_ceiling_micros?: number
  final_url_suffix?: string
  campaign_config?: {
    biddingStrategy?: string
    marketingObjective?: string
    finalUrlSuffix?: string
    [key: string]: any
  }
  start_date_time?: string
  end_date_time?: string
  target_country?: string
  target_language?: string
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

    // // 1. 获取用户的 Google Ads 账户凭证（单个对象）
    // const credentials = await getGoogleAdsCredentialsFromDB(userId)
    // if (!credentials) {
    //   result.warnings.push('用户未配置 Google Ads 凭证')
    //   return result
    // }

    // 2. 获取该用户的所有活跃 Google Ads 账户（数组）
    const isActiveCondition = db.type === 'postgres' ? 'is_active = TRUE' : 'is_active = 1'
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = FALSE' : 'is_manager_account = 0'
    const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
    let customerIds: string = ','
    if (userId == 2) {
      customerIds = `'3647422686','3530335491'`
    }
    if (userId == 3) {
      customerIds = `'3087435596','8642496427','8623761154'`
    }
    const accounts = await db.query(
      `SELECT id, customer_id, account_name, refresh_token, auth_type, service_account_id FROM google_ads_accounts
       WHERE user_id = ? AND ${isActiveCondition} AND ${isManagerCondition} AND ${isDeletedCondition} AND status = 'ENABLED' AND customer_id IS NOT NULL AND customer_id != '' AND customer_id in (${customerIds})
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
          authType: account.auth_type || 'oauth',
          serviceAccountId: account.auth_type === 'service_account' ? account.service_account_id || undefined : undefined,
          refreshToken: account.refresh_token,
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
            // 🆕 修复：使用事务确保广告系列和 Offer 的原子性
            // 先创建 Offer，再保存广告系列并关联 offer_id
            const offerResult = await createOfferFirst({
              userId,
              campaign,
            })

            // 保存广告系列并关联 offer_id
            const campaignId = await saveCampaignToDatabase({
              userId,
              googleAdsAccountId: account.id,
              campaign,
              offerId: offerResult.offerId,
            })

            result.syncedCount++
            if (offerResult.created) {
              result.createdOffersCount++
            }

            console.log(`[GoogleAds Sync] Synced campaign: ${campaign.campaign_name} (${campaign.campaign_id}), offer: ${offerResult.created ? 'created' : 'linked'} (offer_id=${offerResult.offerId})`)

            // 🔧 备份广告系列（包含 campaign_config）
            try {
              await autoBackupCampaign({
                userId,
                offerId: offerResult.offerId,
                campaignId: campaignId,
                backupSource: 'google_ads',
              })
              console.log(`[GoogleAds Sync] Auto backed up campaign ${campaignId}`)
            } catch (error) {
              console.error('[GoogleAds Sync] Failed to auto backup campaign:', error)
              // 备份失败不影响同步，只记录日志
            }

            // 🔧 通过 Google Ads API 同步广告组件并保存为 campaign_config
            try {
              const apiSyncResult = await syncAdComponentsFromGoogleAds(
                userId,
                account.customer_id,
                campaign.campaign_id,
                account.service_account_id!,
                {
                  finalUrlSuffix: campaign.final_url_suffix,
                  campaignName: campaign.campaign_name,
                  budgetAmount: campaign.budget_amount,
                  budgetType: campaign.budget_type,
                  marketingObjective: 'WEB_TRAFFIC',
                  biddingStrategy: 'MAXIMIZE_CLICKS',
                  targetCountry: 'US',
                  targetLanguage: 'English'
                }
              )
              
              if (apiSyncResult.campaignConfig && Object.keys(apiSyncResult.campaignConfig).length > 0) {
                // 🔧 更新 campaign_config（只更新从 Google 同步的广告系列）
                const updated = await updateCampaignConfig(campaignId, apiSyncResult.campaignConfig)
                
                if (updated) {
                  // 同时更新备份中的 campaign_config
                  const db = await getDatabase()
                  await db.exec(`
                    UPDATE campaign_backups
                    SET campaign_config = ?,
                        updated_at = ?
                    WHERE offer_id = ? AND user_id = ?
                    ORDER BY created_at DESC LIMIT 1
                  `, [
                    JSON.stringify(apiSyncResult.campaignConfig),
                    new Date(),
                    offerResult.offerId,
                    userId
                  ])
                  
                  console.log(`[GoogleAds Sync] Updated campaign_config from API`)
                }
              }
            } catch (error) {
              console.error('[GoogleAds Sync] Failed to sync from Google Ads API:', error)
              // API 同步失败不影响主流程，只记录日志
            }
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
  authType: string
  serviceAccountId?: string,
  refreshToken: string | null
}): Promise<GoogleAdsCampaign[]> {
  const { userId, customerId, authType, serviceAccountId, refreshToken } = params

  // 使用 GAQL 查询广告系列
  const query = `
    SELECT 
      campaign.id,
      campaign.name,
      campaign_budget.amount_micros,
      campaign.target_spend.cpc_bid_ceiling_micros,
      campaign_budget.type,
      campaign.status,
      campaign.final_url_suffix
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `

  try {
    let results: any[] = []
    if (authType === 'service_account') {
      const result = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query,
      })
      results = result.results || []
    } else {
      const customer = await getCustomerWithCredentials({
        userId,
        customerId,
        refreshToken: refreshToken || undefined,
      })
      results = await trackOAuthApiCall(
        userId,
        customerId,
        ApiOperationType.SEARCH,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    // 转换结果为结构化数据
    return results.map((row: any) => ({
      campaign_id: String(row.campaign?.id || ''),
      campaign_name: row.campaign?.name || `Campaign_${row.campaign?.id}`,
      budget_amount: Number(row.campaign_budget?.amount_micros || 0) / 1000000, // 转换为元
      cpc_bid_ceiling_micros: Number(row.campaign?.target_spend?.cpc_bid_ceiling_micros || 0) / 1000000, // 转换为元
      budget_type: (row.campaign_budget?.type || 'DAILY') as 'DAILY' | 'TOTAL',
      status: (row.campaign?.status || 'PAUSED') as 'ENABLED' | 'PAUSED' | 'REMOVED',
      customer_id: customerId,
      final_url_suffix: row.final_url_suffix
      // account_name: row.customer_client?.descriptive_name,
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
  offerId?: number  // 🆕 可选的 offer_id
}): Promise<number> {
  const { userId, googleAdsAccountId, campaign, offerId } = params
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(
    'SELECT campaign_id FROM campaigns WHERE campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existing) {
    console.log(`[GoogleAds Sync] Updating Campaign ${campaign.campaign_id} for User ${userId}`)
    // 更新现有广告系列
    await db.exec(
      `UPDATE campaigns SET
        max_cpc = ?,
        campaign_name = ?,
        budget_amount = ?,
        budget_type = ?,
        status = ?,
        google_ads_account_id = ?,
        synced_from_google_ads = ${db.type === 'postgres' ? 'TRUE' : '1'},
        updated_at = ?
      WHERE campaign_id = ?`,
      [
        campaign.cpc_bid_ceiling_micros || null,  // 🆕 可选的 max_cpc 字段
        campaign.campaign_name,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        googleAdsAccountId,
        new Date(),
        existing.campaign_id,
      ]
    )
    console.log(`[GoogleAds Sync] Updated Campaign ${campaign.campaign_id} for User ${userId}`)
    return existing.campaign_id
  } else {
    console.log(`[GoogleAds Sync] Creating Campaign ${campaign.campaign_id} for User ${userId}`)
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
        offer_id,
        needs_offer_completion,
        max_cpc,
        google_campaign_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ${db.type === 'postgres' ? 'TRUE' : '1'}, ?, ?, ?, ?)`,
      [
        userId,
        googleAdsAccountId,
        campaign.campaign_id,
        campaignName,
        campaign.budget_amount,
        campaign.budget_type,
        campaign.status,
        offerId || null,  // 🆕 如果提供了 offerId，则关联
        campaign.cpc_bid_ceiling_micros || null,  // 🆕 可选的 max_cpc 字段
        campaign.campaign_id,  // google_campaign_id
        new Date(),
        new Date(),
      ]
    )
    console.log(`[GoogleAds Sync] Created Campaign ${campaign.campaign_id} for User ${userId}`)
    return Number(campaign.campaign_id + '')
  }
}

/**
 * 🆕 修复：先创建 Offer，返回 offer_id
 */
async function createOfferFirst(params: {
  userId: number
  campaign: GoogleAdsCampaign
}): Promise<{ offerId: number; created: boolean }> {
  const { userId, campaign } = params
  const db = await getDatabase()

  // 1. 检查是否已存在关联的 Offer（通过 google_ads_campaign_id）
  const existingOffer = await db.queryOne(
    'SELECT id FROM offers WHERE google_ads_campaign_id = ? AND user_id = ?',
    [campaign.campaign_id, userId]
  )

  if (existingOffer) {
    console.log(`[GoogleAds Sync] Found existing offer ${existingOffer.id} for campaign ${campaign.campaign_id}`)
    return { offerId: existingOffer.id, created: false }
  }

  // 2. 创建新 Offer
  console.log(`[GoogleAds Sync] Creating new offer for campaign ${campaign.campaign_id}`)
  
  // 生成唯一的 offer_name
  const offerName = `${campaign.campaign_name}_US_01`
  
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
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      '',  // URL 需要用户后续完善
      campaign.campaign_name,
      'US',  // 默认国家，需要用户完善
      'English',  // 默认语言
      offerName,
      campaign.campaign_id,
      'google_ads_sync',
      db.type === 'postgres' ? 'TRUE' : '1',  // 新创建的 Offer 标记为需要完善
      'pending',
      db.type === 'postgres' ? 'TRUE' : '1',
    ]
  )

  const offerId = getInsertedId(result, db.type)
  console.log(`[GoogleAds Sync] Created offer ${offerId} for campaign ${campaign.campaign_id}`)
  
  return { offerId, created: true }
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
    `SELECT id FROM users WHERE role != 'admin' AND is_active = ${db.type === 'postgres' ? 'TRUE' : '1'}`
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
