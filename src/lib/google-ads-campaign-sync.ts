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
import { getCustomerWithCredentials, trackOAuthApiCall } from './google-ads-api'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId } from './db-helpers'
import { createRiskAlert } from './risk-alerts'
import { ApiOperationType } from './google-ads-api-tracker'

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

export const LanguageCodeMap = {
    'en': 1000,      // English
    'zh': 1017,      // Chinese (Simplified)
    'zh-cn': 1017,   // Chinese (Simplified)
    'zh-tw': 1018,   // Chinese (Traditional)
    'ja': 1005,      // Japanese
    'de': 1001,      // German
    'fr': 1002,      // French
    'es': 1003,      // Spanish
    'it': 1004,      // Italian
    'ko': 1012,      // Korean
    'ru': 1031,      // Russian
    'pt': 1014,      // Portuguese
    'ar': 1019,      // Arabic
    'hi': 1023,      // Hindi
    'nl': 1020,      // Dutch
    'th': 1033,      // Thai
    'vi': 1044,      // Vietnamese
    'tr': 1037,      // Turkish
    'sv': 1032,      // Swedish
    'da': 1009,      // Danish
    'fi': 1011,      // Finnish
    'no': 1013,      // Norwegian
    'pl': 1021,      // Polish
    'cs': 1008,      // Czech
    'hu': 1024,      // Hungarian
    'el': 1022,      // Greek
    'he': 1025,      // Hebrew
    'id': 1027,      // Indonesian
    'ms': 1019,      // Malay
    'tl': 1034,      // Tagalog
}

export const languageMap: { [key: string]: string } = {
  'english': 'en',
  'chinese (simplified)': 'zh-cn',
  'chinese (traditional)': 'zh-tw',
  'chinese': 'zh',
  'spanish': 'es',
  'french': 'fr',
  'german': 'de',
  'japanese': 'ja',
  'korean': 'ko',
  'portuguese': 'pt',
  'italian': 'it',
  'russian': 'ru',
  'arabic': 'ar',
  'hindi': 'hi',
  'dutch': 'nl',
  'thai': 'th',
  'vietnamese': 'vi',
  'turkish': 'tr',
  'swedish': 'sv',
  'danish': 'da',
  'finnish': 'fi',
  'norwegian': 'no',
  'polish': 'pl',
  'czech': 'cs',
  'hungarian': 'hu',
  'greek': 'el',
  'hebrew': 'he',
  'indonesian': 'id',
  'malay': 'ms',
}

export const geoTargetMAP: { [key: string]: number } = {
  // 北美
  'US': 2840,   // United States
  'CA': 2124,   // Canada
  'MX': 2484,   // Mexico

  // 欧洲
  'GB': 2826,   // United Kingdom
  'UK': 2826,   // United Kingdom (alias)
  'DE': 2276,   // Germany
  'FR': 2250,   // France
  'IT': 2380,   // Italy
  'ES': 2724,   // Spain
  'PT': 2620,   // Portugal
  'NL': 2528,   // Netherlands
  'BE': 2056,   // Belgium
  'AT': 2040,   // Austria
  'CH': 2756,   // Switzerland
  'SE': 2752,   // Sweden
  'NO': 2578,   // Norway
  'DK': 2208,   // Denmark
  'FI': 2246,   // Finland
  'PL': 2616,   // Poland
  'CZ': 2203,   // Czech Republic
  'HU': 2348,   // Hungary
  'GR': 2300,   // Greece
  'IE': 2372,   // Ireland
  'RO': 2642,   // Romania
  'BG': 2100,   // Bulgaria
  'HR': 2191,   // Croatia
  'RS': 2688,   // Serbia
  'SI': 2705,   // Slovenia
  'SK': 2703,   // Slovakia
  'UA': 2804,   // Ukraine
  'EE': 2233,   // Estonia
  'LV': 2428,   // Latvia
  'LT': 2440,   // Lithuania
  'RU': 2643,   // Russia

  // 亚洲
  'CN': 2156,   // China
  'JP': 2392,   // Japan
  'KR': 2410,   // South Korea
  'IN': 2356,   // India
  'ID': 2360,   // Indonesia
  'TH': 2764,   // Thailand
  'VN': 2704,   // Vietnam
  'PH': 2608,   // Philippines
  'MY': 2458,   // Malaysia
  'SG': 2702,   // Singapore
  'HK': 2344,   // Hong Kong
  'TW': 2158,   // Taiwan
  'BD': 2050,   // Bangladesh
  'PK': 2586,   // Pakistan

  // 中东
  'TR': 2792,   // Turkey
  'SA': 2682,   // Saudi Arabia
  'AE': 2784,   // United Arab Emirates
  'IL': 2376,   // Israel
  'EG': 2818,   // Egypt
  'IR': 2364,   // Iran
  'IQ': 2368,   // Iraq
  'QA': 2634,   // Qatar
  'KW': 2414,   // Kuwait

  // 大洋洲
  'AU': 2036,   // Australia
  'NZ': 2554,   // New Zealand

  // 南美
  'BR': 2076,   // Brazil
  'AR': 2032,   // Argentina
  'CO': 2170,   // Colombia
  'CL': 2152,   // Chile
  'PE': 2604,   // Peru
  'VE': 2862,   // Venezuela

  // 非洲
  'ZA': 2710,   // South Africa
  'NG': 2566,   // Nigeria
  'KE': 2404,   // Kenya
  'MA': 2504,   // Morocco
}

/**
 * 🔧 将语言代码转换为语言名称
 */
function getLanguageName(languageCode: string): string {
  return languageMap[languageCode] || languageCode
}

function getCountryName(countryCode: string): string {
  return Object.keys(geoTargetMAP).find(key => geoTargetMAP[key] == Number(countryCode)) || countryCode
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

    // 2. 🔧 获取该用户的所有活跃 Google Ads 账户（支持 MCC 过滤）
    const isActiveCondition = db.type === 'postgres' ? 'is_active = TRUE' : 'is_active = 1'
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = FALSE' : 'is_manager_account = 0'
    const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
    
    // 🔧 获取用户分配的 MCC 账号列表
    let mccCustomerIds: string[] = []
    const mccAssignments = await db.query(`
      SELECT mcc_customer_id FROM user_mcc_assignments
      WHERE user_id = ?
    `, [userId]) as Array<{ mcc_customer_id: string }>
    
    if (mccAssignments.length > 0) {
      mccCustomerIds = mccAssignments.map(a => a.mcc_customer_id)
      console.log(`[GoogleAds Sync] User ${userId} has ${mccCustomerIds.length} assigned MCCs: ${mccCustomerIds.join(', ')}`)
    }
    
    // 🔧 构建 customer_id 过滤条件
    let customerIdsFilter = ''
    if (mccCustomerIds.length > 0) {
      // 如果分配了 MCC，只获取这些 MCC 下的 customer_id
      // 需要查询 google_ads_accounts 表中 parent_mcc_id 在 MCC 列表中的账户
      const mccPlaceholders = mccCustomerIds.map(() => '?').join(',')
      customerIdsFilter = `AND parent_mcc_id IN (${mccPlaceholders})`
    } else {
      // 如果没有分配 MCC，使用硬编码的 customerIds（向后兼容）
      let customerIds: string = ','
      if (userId == 2) {
        customerIds = `'3647422686','3530335491'`
      }
      if (userId == 3) {
        customerIds = `'3087435596','8642496427','8623761154'`
      }
      customerIdsFilter = `AND customer_id IN (${customerIds})`
    }
    
    const accounts = await db.query(
      `SELECT id, customer_id, account_name, parent_mcc_id, refresh_token, auth_type, service_account_id FROM google_ads_accounts
       WHERE user_id = ? AND ${isActiveCondition} AND ${isManagerCondition} AND ${isDeletedCondition} AND status = 'ENABLED' AND customer_id IS NOT NULL AND customer_id != '' ${customerIdsFilter}
       ORDER BY id`,
      [userId, ...(mccCustomerIds.length > 0 ? mccCustomerIds : [])]
    ) as Array<{
      id: number
      customer_id: string
      account_name: string | null
      parent_mcc_id: string | null
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
        // 4. 从 Google Ads API 获取广告系列列表（聚合后的完整数据）
        const campaigns = await fetchCampaignsFromGoogleAds({
          userId,
          customerId: account.customer_id,
          authType: account.auth_type || 'oauth',
          serviceAccountId: account.auth_type === 'service_account' ? account.service_account_id || undefined : undefined,
          refreshToken: account.refresh_token,
        })

        console.log(`[GoogleAds Sync] Found ${campaigns.length} campaigns for account ${account.customer_id}`)

        // 5. 保存广告系列到数据库并创建关联 Offer
        for (const { campaign, campaign_config } of campaigns) {
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

            const existingBackup = await db.queryOne(`
              SELECT backup_source, backup_version
              FROM campaign_backups
              WHERE offer_id = ? AND user_id = ?
              ORDER BY created_at DESC
              LIMIT 1
            `, [offerResult.offerId, userId]) as { backup_source: string; backup_version: number } | undefined
              
            let shouldSyncComponents = true

            if (existingBackup) {
              // 情况一：backup_source='autoads'，不需要备份
              if (existingBackup.backup_source === 'autoads') {
                shouldSyncComponents = false
                console.log(`[GoogleAds Sync] Skip sync for campaign ${campaignId}: existing backup with backup_source='autoads'`)
              }
              // 情况二：backup_source='google_ads' 并且 backup_version>=2，不需要备份
              else if (existingBackup.backup_source === 'google_ads' && existingBackup.backup_version >= 2) {
                shouldSyncComponents = false
                console.log(`[GoogleAds Sync] Skip sync for campaign ${campaignId}: existing backup with backup_version=${existingBackup.backup_version}`)
              }
            }
            if (shouldSyncComponents) {
              // 🔧 通过 Google Ads API 同步广告组件并保存为 campaign_config
              try {
                if (campaign_config && Object.keys(campaign_config).length > 0) {
                  // 🔧 更新 campaign_config（只更新从 Google 同步的广告系列）
                  const updated = await updateCampaignConfig(campaignId, campaign_config)
                  
                  if (updated) {
                    // 同时更新备份中的 campaign_config
                    const dbCheck = await getDatabase()
                    const latestBackup = await dbCheck.queryOne(`
                      SELECT id FROM campaign_backups 
                      WHERE offer_id = ? AND user_id = ? 
                      ORDER BY created_at DESC 
                      LIMIT 1
                    `, [offerResult.offerId, userId])
                    
                    if (latestBackup) {
                      await dbCheck.exec(`
                        UPDATE campaign_backups
                        SET campaign_config = ?, updated_at = ?
                        WHERE id = ?
                      `, [
                        JSON.stringify(campaign_config),
                        new Date(),
                        latestBackup.id
                      ])
                      
                      console.log(`[GoogleAds Sync] Updated campaign_config from API`)
                    }
                  }
                }
              } catch (error) {
                console.error('[GoogleAds Sync] Failed to sync from Google Ads API:', error)
                // API 同步失败不影响主流程，只记录日志
              }
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
 * 🔧 优化：使用 4 个独立的 GAQL 查询获取所有数据，然后在内存中聚合成完整广告系列数据
 * GAQL 不支持 JOIN 和子查询，需要拆分查询
 */
async function fetchAllDataFromGoogleAds(params: {
  userId: number
  customerId: string
  authType: string
  serviceAccountId?: string,
  refreshToken: string | null
}): Promise<any[]> {
  const { userId, customerId, authType, serviceAccountId, refreshToken } = params

  try {
    // 🔧 查询 1：获取广告、广告组、广告系列及预算数据
    const query1 = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.final_url_suffix,
        campaign_budget.amount_micros,
        campaign_budget.type,
        campaign.target_spend.cpc_bid_ceiling_micros,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls
      FROM ad_group_ad
      WHERE campaign.status != 'REMOVED'
        AND ad_group.status != 'REMOVED'
        AND ad_group_ad.status != 'REMOVED'
    `

    // 🔧 查询 2：获取关键词数据
    const query2 = `
      SELECT
        campaign.id,
        ad_group.id,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND campaign.status != 'REMOVED'
        AND ad_group.status != 'REMOVED'
        AND ad_group_criterion.status != 'REMOVED'
    `

    // 🔧 查询 3：获取素材资源（Assets）数据
    const query3 = `
      SELECT
        campaign.id,
        asset.type,
        asset.final_urls,
        asset.callout_asset.callout_text,
        asset.sitelink_asset.link_text,
        asset.sitelink_asset.description1,
        asset.sitelink_asset.description2
      FROM campaign_asset
      WHERE campaign.status != 'REMOVED'
        AND campaign_asset.status != 'REMOVED'
        AND asset.type IN ('CALLOUT', 'SITELINK')
    `

    // 🔧 查询 4：获取广告系列层级的定位（国家/语言）
    const query4 = `
      SELECT
        campaign.id,
        campaign_criterion.criterion_id,
        campaign_criterion.type,
        campaign_criterion.display_name,
        campaign_criterion.language.language_constant,
        campaign_criterion.location.geo_target_constant,
        campaign_criterion.negative
      FROM campaign_criterion
      WHERE campaign.status != 'REMOVED'
        AND campaign_criterion.type IN ('LANGUAGE', 'LOCATION')
        AND campaign_criterion.status != 'REMOVED'
    `

    // 🔧 执行四个查询（串行，间隔 1 秒，避免 API 限流）
    let results1: any[] = []
    let results2: any[] = []
    let results3: any[] = []
    let results4: any[] = []

    if (authType === 'service_account') {
      // 查询 1
      const r1 = await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query: query1 })
      results1 = r1?.results || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 2
      const r2 = await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query: query2 })
      results2 = r2?.results || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 3
      const r3 = await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query: query3 })
      results3 = r3?.results || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 4
      const r4 = await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query: query4 })
      results4 = r4?.results || []
    } else {
      const customer = await getCustomerWithCredentials({
        userId,
        customerId,
        refreshToken: refreshToken || undefined,
      })
      
      // 查询 1
      const r1 = await trackOAuthApiCall(userId, customerId, ApiOperationType.SEARCH, '/api/google-ads/query', () => customer.query(query1))
      results1 = r1 || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 2
      const r2 = await trackOAuthApiCall(userId, customerId, ApiOperationType.SEARCH, '/api/google-ads/query', () => customer.query(query2))
      results2 = r2 || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 3
      const r3 = await trackOAuthApiCall(userId, customerId, ApiOperationType.SEARCH, '/api/google-ads/query', () => customer.query(query3))
      results3 = r3 || []
      
      // 🔧 等待 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // 查询 4
      const r4 = await trackOAuthApiCall(userId, customerId, ApiOperationType.SEARCH, '/api/google-ads/query', () => customer.query(query4))
      results4 = r4 || []
    }

    // 🔧 在内存中处理数据，按 ID 分组
    const campaignMap = new Map<string, GoogleAdsCampaign>()
    const adGroupsMap = new Map<string, any[]>()  // key: ad_group_id
    const adsMap = new Map<string, any[]>()       // key: ad_group_id
    const keywordsMap = new Map<string, any[]>()  // key: ad_group_id
    const calloutsMap = new Map<string, any[]>()  // key: campaign_id
    const sitelinksMap = new Map<string, any[]>() // key: campaign_id
    const locationsMap = new Map<string, any[]>() // key: campaign_id

    // 处理查询 1 结果（广告系列、广告组、广告）
    for (const row of results1) {
      const campaignId = String(row.campaign?.id || '')
      
      // 添加广告系列
      if (!campaignMap.has(campaignId)) {
        campaignMap.set(campaignId, {
          campaign_id: campaignId,
          campaign_name: row.campaign?.name || `Campaign_${campaignId}`,
          budget_amount: Number(row.campaign_budget?.amount_micros || 0) / 1000000,
          cpc_bid_ceiling_micros: Number(row.campaign?.target_spend?.cpc_bid_ceiling_micros || 0) / 1000000,
          budget_type: (row.campaign_budget?.type || 'DAILY') as 'DAILY' | 'TOTAL',
          status: (row.campaign?.status || 'PAUSED') as 'ENABLED' | 'PAUSED' | 'REMOVED',
          customer_id: customerId,
          final_url_suffix: row.campaign?.final_url_suffix || '',
        })
      }

      // 添加广告组
      const adGroupId = String(row.ad_group?.id || '')
      if (adGroupId) {
        if (!adGroupsMap.has(adGroupId)) {
          adGroupsMap.set(adGroupId, [{
            ad_group_id: adGroupId,
            ad_group_name: row.ad_group?.name,
            campaign_id: campaignId,
          }])
        }
        
        // 添加广告
        const adId = String(row.ad_group_ad?.ad?.id || '')
        if (adId) {
          const ads = adsMap.get(adGroupId) || []
          ads.push({
            ad_id: adId,
            ad_type: row.ad_group_ad?.ad?.type,
            headlines: row.ad_group_ad?.ad?.responsive_search_ad?.headlines,
            descriptions: row.ad_group_ad?.ad?.responsive_search_ad?.descriptions,
            final_urls: row.ad_group_ad?.ad?.responsive_search_ad?.final_urls,
          })
          adsMap.set(adGroupId, ads)
        }
      }
    }

    // 处理查询 2 结果（关键词）
    for (const row of results2) {
      const adGroupId = String(row.ad_group?.id || '')
      const keywordId = String(row.ad_group_criterion?.criterion_id || '')
      
      if (keywordId && row.ad_group_criterion?.keyword?.text) {
        const keywords = keywordsMap.get(adGroupId) || []
        keywords.push({
          keyword_id: keywordId,
          keyword_text: row.ad_group_criterion?.keyword?.text,
          keyword_match_type: row.ad_group_criterion?.keyword?.match_type,
        })
        keywordsMap.set(adGroupId, keywords)
      }
    }

    // 处理查询 3 结果（素材资源）
    for (const row of results3) {
      const campaignId = String(row.campaign?.id || '')
      const assetType = String(row.asset?.type || '')
      
      if (assetType === 'CALLOUT' && row.asset?.callout_asset?.callout_text) {
        const callouts = calloutsMap.get(campaignId) || []
        callouts.push({ text: row.asset.callout_asset.callout_text })
        calloutsMap.set(campaignId, callouts)
      } else if (assetType === 'SITELINK' && row.asset?.sitelink_asset?.link_text) {
        const sitelinks = sitelinksMap.get(campaignId) || []
        sitelinks.push({
          text: row.asset?.sitelink_asset?.link_text || '',
          url: (row.asset?.sitelink_asset?.final_urls ?? [])?.[0] || '',
          description: row.asset?.sitelink_asset?.description1 || row.asset?.sitelink_asset?.description2 || '',
        })
        sitelinksMap.set(campaignId, sitelinks)
      }
    }

      // 处理查询 4 结果（定位）
    for (const row of results4) {
      const campaignId = String(row.campaign?.id || '')
      if (campaignId) {
        const locations = locationsMap.get(campaignId) || []
        locations.push({
          criterion_id: row.campaign_criterion?.criterion_id,
          type: row.campaign_criterion?.type,
          display_name: row.campaign_criterion?.display_name,
          language: row.campaign_criterion?.language?.language_constant,
          location: row.campaign_criterion?.location?.geo_target_constant,
          negative: row.campaign_criterion?.negative,
        })
        locationsMap.set(campaignId, locations)
      }
    }

    // 🔧 聚合成完整的广告系列数据并返回
    const campaigns: any[] = []
    
    for (const [campaignId, campaign] of campaignMap.entries()) {
      const adGroupId = Array.from(adGroupsMap.keys()).find(key => 
        adGroupsMap.get(key)?.[0]?.campaign_id === campaignId
      )
      
      const adGroup = adGroupId ? adGroupsMap.get(adGroupId)?.[0] : null
      const ads = adGroupId ? (adsMap.get(adGroupId) || []) : []
      const keywords = adGroupId ? (keywordsMap.get(adGroupId) || []) : []
      const callouts = calloutsMap.get(campaignId) || []
      const sitelinks = sitelinksMap.get(campaignId) || []
      const locations = locationsMap.get(campaignId) || []
      
      // 提取否定关键词
      const negativeKeywords: string[] = []
      const negativeKeywordMatchType: any = {}
      for (const kw of keywords) {
        if (kw.negative) {
          negativeKeywords.push(kw.keyword_text)
          negativeKeywordMatchType[kw.keyword_text] = kw.keyword_match_type
        }
      }
      
      // 过滤正关键词
      const positiveKeywords = keywords.filter(kw => !kw.negative).map(kw => ({
        text: kw.keyword_text,
        matchType: kw.keyword_match_type,
      }))
      
      // 构建广告系列对象
      campaigns.push({
        campaign,
        campaign_config: {
          campaignName: campaign.campaign_name,
          budgetAmount: campaign.budget_amount,
          budgetType: campaign.budget_type,
          targetCountry: getCountryName(locations.find((loc: any) => loc.type === 'LOCATION')?.geo_target_constant?.split('/')?.pop()) || 'US',
          targetLanguage: getLanguageName(locations.find((loc: any) => loc.type === 'LANGUAGE')?.display_name) || 'English',
          biddingStrategy: (campaign as any).bidding_strategy || 'MAXIMIZE_CLICKS',
          marketingObjective: 'WEB_TRAFFIC',
          finalUrlSuffix: campaign.final_url_suffix || '',
          adGroupName: adGroup?.ad_group_name || '',
          maxCpcBid: campaign.cpc_bid_ceiling_micros,
          keywords: positiveKeywords,
          negativeKeywords: negativeKeywords,
          negativeKeywordMatchType: negativeKeywordMatchType,
          adName: ads[0]?.ad_name || `RSA_${campaign.campaign_name}`,
          headlines: ads[0]?.headlines?.map((h: any) => h.text) || [],
          descriptions: ads[0]?.descriptions?.map((d: any) => d.text) || [],
          finalUrls: ads[0]?.final_urls || [],
          callouts: callouts.map((c: any) => c.text),
          sitelinks: sitelinks.map((s: any) => ({
            text: s.text,
            url: s.url,
            description: s.description,
          })),
        }
      })
    }
    
    console.log(`[GoogleAds Sync] Aggregated ${campaigns.length} complete campaigns`)
    
    return campaigns
  } catch (error: any) {
    console.error('[GoogleAds Sync] Failed to fetch data:', error)
    throw new Error(`获取广告数据失败：${error.message}`)
  }
}

/**
 * 从 Google Ads API 获取广告系列列表（兼容旧接口）
 */
async function fetchCampaignsFromGoogleAds(params: {
  userId: number
  customerId: string
  authType: string
  serviceAccountId?: string,
  refreshToken: string | null
}): Promise<any[]> {
  return await fetchAllDataFromGoogleAds(params)
}

/**
 * 保存广告系列到数据库
 */
async function saveCampaignToDatabase(params: {
  userId: number
  googleAdsAccountId: number
  campaign: GoogleAdsCampaign
  offerId?: number  // 🆕 可选的 offer_id
}): Promise<string> {
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
        synced_from_google_ads = ${db.type === 'postgres' ? 'FALSE' : '0'},
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
    return campaign.campaign_id
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
  const offerName = campaign.campaign_name
  
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
