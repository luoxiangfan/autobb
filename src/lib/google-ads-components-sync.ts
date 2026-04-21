/**
 * Google Ads 广告组件同步服务
 * 
 * 功能：
 * 1. 同步广告组 (Ad Groups)
 * 2. 同步广告 (Ads)
 * 3. 同步关键词 (Keywords)
 * 4. 同步否定关键词 (Negative Keywords)
 * 
 * @module google-ads-components-sync
 */

import { getDatabase } from './db'
import { getInsertedId } from './db-helpers'

/**
 * 广告组数据接口
 */
export interface AdGroupData {
  google_ad_group_id: string
  ad_group_name: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  max_cpc_bid?: number | null
}

/**
 * 广告数据接口
 */
export interface AdData {
  google_ad_id: string  // 格式：ad_group_id~ad_id
  ad_type?: string
  status?: 'ENABLED' | 'PAUSED' | 'REMOVED'
  headlines?: Array<{ text: string }>
  descriptions?: Array<{ text: string }>
  final_urls?: string[]
  callouts?: Array<{ text: string }>
  sitelinks?: Array<{ text: string; url: string; description?: string }>
}

/**
 * 关键词数据接口
 */
export interface KeywordData {
  keyword_text: string
  match_type: 'EXACT' | 'PHRASE' | 'BROAD'
  status?: 'ENABLED' | 'PAUSED' | 'REMOVED'
  search_volume?: number
  low_top_page_bid?: number
  high_top_page_bid?: number
  cpc_bid?: number
}

/**
 * 否定关键词数据接口
 */
export interface NegativeKeywordData {
  keyword_text: string
  match_type: 'EXACT' | 'PHRASE' | 'BROAD'
  level: 'campaign' | 'ad_group'
  ad_group_id?: number
}

/**
 * 同步结果
 */
export interface ComponentsSyncResult {
  adGroupsSynced: number
  adsSynced: number
  keywordsSynced: number
  negativeKeywordsSynced: number
  errors: Array<{
    type: string
    id: string
    error: string
  }>
}

/**
 * 同步广告组
 */
export async function syncAdGroups(
  userId: number,
  campaignId: number,
  adGroups: AdGroupData[]
): Promise<number> {
  const db = await getDatabase()
  let syncedCount = 0

  for (const adGroup of adGroups) {
    try {
      // 检查是否已存在
      const existing = await db.queryOne(
        'SELECT id FROM ad_groups WHERE google_ad_group_id = ? AND campaign_id = ?',
        [adGroup.google_ad_group_id, campaignId]
      )

      if (existing) {
        // 更新现有广告组
        await db.exec(`
          UPDATE ad_groups SET
            ad_group_name = ?,
            status = ?,
            max_cpc_bid = ?,
            updated_at = ?
          WHERE google_ad_group_id = ? AND campaign_id = ?
        `, [
          adGroup.ad_group_name,
          adGroup.status,
          adGroup.max_cpc_bid || null,
          new Date(),
          adGroup.google_ad_group_id,
          campaignId,
        ])
        console.log(`[Ad Group Sync] Updated: ${adGroup.ad_group_name}`)
      } else {
        // 创建新广告组
        const result = await db.exec(`
          INSERT INTO ad_groups (
            user_id, campaign_id, google_ad_group_id,
            ad_group_name, status, max_cpc_bid,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          campaignId,
          adGroup.google_ad_group_id,
          adGroup.ad_group_name,
          adGroup.status,
          adGroup.max_cpc_bid || null,
          new Date(),
          new Date(),
        ])
        syncedCount++
        console.log(`[Ad Group Sync] Created: ${adGroup.ad_group_name}`)
      }
    } catch (error: any) {
      console.error(`[Ad Group Sync] Error syncing ${adGroup.ad_group_name}:`, error)
    }
  }

  return syncedCount
}

/**
 * 同步广告
 */
export async function syncAds(
  userId: number,
  adGroupId: number,
  ads: AdData[]
): Promise<number> {
  const db = await getDatabase()
  let syncedCount = 0

  for (const ad of ads) {
    try {
      // 检查是否已存在
      const existing = await db.queryOne(
        'SELECT id FROM ads WHERE google_ad_id = ? AND ad_group_id = ?',
        [ad.google_ad_id, adGroupId]
      )

      if (existing) {
        // 更新现有广告
        await db.exec(`
          UPDATE ads SET
            ad_type = ?,
            status = ?,
            headlines = ?,
            descriptions = ?,
            final_urls = ?,
            callouts = ?,
            sitelinks = ?,
            updated_at = ?
          WHERE google_ad_id = ? AND ad_group_id = ?
        `, [
          ad.ad_type || 'RESPONSIVE_SEARCH_AD',
          ad.status || 'ENABLED',
          ad.headlines ? JSON.stringify(ad.headlines) : null,
          ad.descriptions ? JSON.stringify(ad.descriptions) : null,
          ad.final_urls ? JSON.stringify(ad.final_urls) : null,
          ad.callouts ? JSON.stringify(ad.callouts) : null,
          ad.sitelinks ? JSON.stringify(ad.sitelinks) : null,
          new Date(),
          ad.google_ad_id,
          adGroupId,
        ])
        console.log(`[Ad Sync] Updated: ${ad.google_ad_id}`)
      } else {
        // 创建新广告
        const result = await db.exec(`
          INSERT INTO ads (
            user_id, ad_group_id, google_ad_id,
            ad_type, status,
            headlines, descriptions, final_urls, callouts, sitelinks,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          adGroupId,
          ad.google_ad_id,
          ad.ad_type || 'RESPONSIVE_SEARCH_AD',
          ad.status || 'ENABLED',
          ad.headlines ? JSON.stringify(ad.headlines) : null,
          ad.descriptions ? JSON.stringify(ad.descriptions) : null,
          ad.final_urls ? JSON.stringify(ad.final_urls) : null,
          ad.callouts ? JSON.stringify(ad.callouts) : null,
          ad.sitelinks ? JSON.stringify(ad.sitelinks) : null,
          new Date(),
          new Date(),
        ])
        syncedCount++
        console.log(`[Ad Sync] Created: ${ad.google_ad_id}`)
      }
    } catch (error: any) {
      console.error(`[Ad Sync] Error syncing ${ad.google_ad_id}:`, error)
    }
  }

  return syncedCount
}

/**
 * 同步关键词
 */
export async function syncKeywords(
  userId: number,
  adGroupId: number,
  keywords: KeywordData[]
): Promise<number> {
  const db = await getDatabase()
  let syncedCount = 0

  for (const keyword of keywords) {
    try {
      // 检查是否已存在
      const existing = await db.queryOne(
        'SELECT id FROM keywords WHERE keyword_text = ? AND ad_group_id = ? AND match_type = ?',
        [keyword.keyword_text, adGroupId, keyword.match_type]
      )

      if (existing) {
        // 更新现有关键词
        await db.exec(`
          UPDATE keywords SET
            status = ?,
            search_volume = ?,
            low_top_page_bid = ?,
            high_top_page_bid = ?,
            cpc_bid = ?,
            updated_at = ?
          WHERE keyword_text = ? AND ad_group_id = ? AND match_type = ?
        `, [
          keyword.status || 'ENABLED',
          keyword.search_volume || 0,
          keyword.low_top_page_bid || null,
          keyword.high_top_page_bid || null,
          keyword.cpc_bid || null,
          new Date(),
          keyword.keyword_text,
          adGroupId,
          keyword.match_type,
        ])
        console.log(`[Keyword Sync] Updated: ${keyword.keyword_text} (${keyword.match_type})`)
      } else {
        // 创建新关键词
        const result = await db.exec(`
          INSERT INTO keywords (
            user_id, ad_group_id, keyword_text,
            match_type, status,
            search_volume, low_top_page_bid, high_top_page_bid, cpc_bid,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          adGroupId,
          keyword.keyword_text,
          keyword.match_type,
          keyword.status || 'ENABLED',
          keyword.search_volume || 0,
          keyword.low_top_page_bid || null,
          keyword.high_top_page_bid || null,
          keyword.cpc_bid || null,
          new Date(),
          new Date(),
        ])
        syncedCount++
        console.log(`[Keyword Sync] Created: ${keyword.keyword_text} (${keyword.match_type})`)
      }
    } catch (error: any) {
      console.error(`[Keyword Sync] Error syncing ${keyword.keyword_text}:`, error)
    }
  }

  return syncedCount
}

/**
 * 同步否定关键词
 */
export async function syncNegativeKeywords(
  userId: number,
  campaignId: number | null,
  adGroupId: number | null,
  negativeKeywords: NegativeKeywordData[]
): Promise<number> {
  const db = await getDatabase()
  let syncedCount = 0

  for (const nk of negativeKeywords) {
    try {
      const targetCampaignId = nk.level === 'campaign' ? campaignId : null
      const targetAdGroupId = nk.level === 'ad_group' ? (nk.ad_group_id || adGroupId) : null

      // 检查是否已存在
      const existing = await db.queryOne(
        `SELECT id FROM negative_keywords 
         WHERE keyword_text = ? AND match_type = ? 
         AND ${targetCampaignId ? 'campaign_id = ?' : 'ad_group_id = ?'}`,
        targetCampaignId 
          ? [nk.keyword_text, nk.match_type, targetCampaignId]
          : [nk.keyword_text, nk.match_type, targetAdGroupId]
      )

      if (!existing) {
        // 创建新否定关键词
        const result = await db.exec(`
          INSERT INTO negative_keywords (
            user_id, campaign_id, ad_group_id,
            keyword_text, match_type,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          userId,
          targetCampaignId,
          targetAdGroupId,
          nk.keyword_text,
          nk.match_type,
          new Date(),
        ])
        syncedCount++
        console.log(`[Negative Keyword Sync] Created: ${nk.keyword_text} (${nk.match_type})`)
      }
    } catch (error: any) {
      console.error(`[Negative Keyword Sync] Error syncing ${nk.keyword_text}:`, error)
    }
  }

  return syncedCount
}

/**
 * 从 campaign_config 解析广告组件数据
 */
export function parseAdComponentsFromConfig(campaignConfig: any): {
  adGroups: AdGroupData[]
  ads: AdData[]
  keywords: KeywordData[]
  negativeKeywords: NegativeKeywordData[]
} {
  const adGroups: AdGroupData[] = []
  const ads: AdData[] = []
  const keywords: KeywordData[] = []
  const negativeKeywords: NegativeKeywordData[] = []

  if (!campaignConfig) {
    return { adGroups, ads, keywords, negativeKeywords }
  }

  // 解析广告组
  if (campaignConfig.adGroupName) {
    adGroups.push({
      google_ad_group_id: campaignConfig.adGroupId || `ag_${Date.now()}`,
      ad_group_name: campaignConfig.adGroupName,
      status: 'ENABLED',
      max_cpc_bid: campaignConfig.maxCpcBid,
    })
  }

  // 解析关键词
  if (Array.isArray(campaignConfig.keywords)) {
    for (const kw of campaignConfig.keywords) {
      keywords.push({
        keyword_text: kw.text,
        match_type: kw.match_type || 'EXACT',
        status: 'ENABLED',
        search_volume: kw.search_volume || 0,
        low_top_page_bid: kw.lowTopPageBid,
        high_top_page_bid: kw.highTopPageBid,
        cpc_bid: kw.cpcBid,
      })
    }
  }

  // 解析否定关键词
  if (Array.isArray(campaignConfig.negativeKeywords)) {
    const matchTypeMap = campaignConfig.negativeKeywordMatchType || {}
    for (const nkText of campaignConfig.negativeKeywords) {
      negativeKeywords.push({
        keyword_text: nkText,
        match_type: matchTypeMap[nkText] || 'BROAD',
        level: 'campaign',
      })
    }
  }

  // 解析广告
  if (campaignConfig.adName || campaignConfig.headlines) {
    ads.push({
      google_ad_id: `ad_${Date.now()}`,
      ad_type: 'RESPONSIVE_SEARCH_AD',
      status: 'ENABLED',
      headlines: Array.isArray(campaignConfig.headlines) 
        ? campaignConfig.headlines.map((h: string) => ({ text: h }))
        : [],
      descriptions: Array.isArray(campaignConfig.descriptions)
        ? campaignConfig.descriptions.map((d: string) => ({ text: d }))
        : [],
      final_urls: campaignConfig.finalUrls || [],
      callouts: Array.isArray(campaignConfig.callouts)
        ? campaignConfig.callouts.map((c: string) => ({ text: c }))
        : [],
      sitelinks: campaignConfig.sitelinks || [],
    })
  }

  return { adGroups, ads, keywords, negativeKeywords }
}

/**
 * 完整的广告组件同步（从 campaign_config）
 */
export async function syncAdComponentsFromConfig(
  userId: number,
  campaignId: number,
  campaignConfig: any
): Promise<ComponentsSyncResult> {
  const result: ComponentsSyncResult = {
    adGroupsSynced: 0,
    adsSynced: 0,
    keywordsSynced: 0,
    negativeKeywordsSynced: 0,
    errors: [],
  }

  try {
    // 解析配置
    const { adGroups, ads, keywords, negativeKeywords } = parseAdComponentsFromConfig(campaignConfig)

    // 获取广告组 ID（用于关联广告和关键词）
    let adGroupId: number | null = null

    // 同步广告组
    if (adGroups.length > 0) {
      result.adGroupsSynced = await syncAdGroups(userId, campaignId, adGroups)
      
      // 获取第一个广告组的 ID
      const db = await getDatabase()
      const adGroupRow = await db.queryOne(
        'SELECT id FROM ad_groups WHERE campaign_id = ? ORDER BY id DESC LIMIT 1',
        [campaignId]
      )
      adGroupId = adGroupRow?.id || null
    }

    // 同步广告
    if (ads.length > 0 && adGroupId) {
      result.adsSynced = await syncAds(userId, adGroupId, ads)
    }

    // 同步关键词
    if (keywords.length > 0 && adGroupId) {
      result.keywordsSynced = await syncKeywords(userId, adGroupId, keywords)
    }

    // 同步否定关键词
    if (negativeKeywords.length > 0) {
      result.negativeKeywordsSynced = await syncNegativeKeywords(
        userId,
        campaignId,
        adGroupId,
        negativeKeywords
      )
    }

    console.log(`[Components Sync] Completed for campaign ${campaignId}:`, result)
  } catch (error: any) {
    console.error('[Components Sync] Error:', error)
    result.errors.push({
      type: 'general',
      id: String(campaignId),
      error: error.message,
    })
  }

  return result
}
