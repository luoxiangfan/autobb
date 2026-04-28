/**
 * Google Ads API 同步服务
 * 
 * 功能：
 * 1. 通过 Google Ads API 同步广告组
 * 2. 通过 Google Ads API 同步广告
 * 3. 通过 Google Ads API 同步关键词
 * 4. 通过 Google Ads API 同步否定关键词
 * 5. 保存为 campaign_config JSON
 * 
 * @module google-ads-api-sync
 */

import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from './google-ads-api'
import { executeGAQLQueryPython } from './python-ads-client'
import { getDatabase } from './db'

/**
 * Google Ads 广告组数据（来自 API）
 */
export interface GoogleAdsAdGroup {
  ad_group_id: string
  ad_group_name: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  max_cpc_bid_micros?: number
  campaign_id: string
}

/**
 * Google Ads 广告数据（来自 API）
 */
export interface GoogleAdsAd {
  ad_id: string
  ad_group_id: string
  ad_type: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  responsive_search_ad?: {
    headlines: Array<{ text: string }>
    descriptions: Array<{ text: string }>
  }
  final_urls?: string[]
  final_url?: string
  final_url_suffix?: string
  callouts?: string[]
  sitelinks?: Array<{
    text?: string
    url?: string
    description?: string
  }>
}

/**
 * Google Ads 关键词数据（来自 API）
 */
export interface GoogleAdsKeyword {
  ad_group_id: string
  text: string
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  cpc_bid_micros?: number
  search_volume?: number
  low_top_page_bid_micros?: number
  high_top_page_bid_micros?: number
}

/**
 * Google Ads 否定关键词数据（来自 API）
 */
export interface GoogleAdsNegativeKeyword {
  text: string
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  level: 'campaign' | 'ad_group'
  campaign_id?: string
  ad_group_id?: string
}

/**
 * 同步结果
 */
export interface ApiSyncResult {
  adGroupsCount: number
  adsCount: number
  keywordsCount: number
  negativeKeywordsCount: number
  campaignConfig: any
  errors: Array<{
    type: string
    id: string
    error: string
  }>
}

/**
 * 通过 Google Ads API 同步广告组件
 */
export async function syncAdComponentsFromGoogleAds(
  userId: number,
  customerId: string,
  campaignId: string,
  serviceAccountId?: string,
  campaignBasicInfo?: {
    campaignName?: string
    budgetAmount?: number
    budgetType?: string
    targetCountry?: string
    targetLanguage?: string
    biddingStrategy?: string
    marketingObjective?: string
    finalUrlSuffix?: string
  }
): Promise<ApiSyncResult> {
  const result: ApiSyncResult = {
    adGroupsCount: 0,
    adsCount: 0,
    keywordsCount: 0,
    negativeKeywordsCount: 0,
    campaignConfig: {},
    errors: [],
  }

  try {
    // 1. 同步广告组
    const adGroups = await syncAdGroupsFromApi(userId, customerId, campaignId, serviceAccountId)
    result.adGroupsCount = adGroups.length

    // 2. 同步广告
    const ads = await syncAdsFromApi(userId, customerId, adGroups, serviceAccountId)
    result.adsCount = ads.length

    // 3. 同步关键词
    const keywords = await syncKeywordsFromApi(userId, customerId, adGroups, serviceAccountId)
    result.keywordsCount = keywords.length

    // 4. 同步否定关键词
    const negativeKeywords = await syncNegativeKeywordsFromApi(
      userId,
      customerId,
      campaignId,
      adGroups,
      serviceAccountId
    )
    result.negativeKeywordsCount = negativeKeywords.length

    // 6. 🔧 通过 campaign_criterion 获取定位信息（国家、语言）
    const targetingInfo = await syncTargetingFromApi(userId, customerId, campaignId, serviceAccountId)

    // 7. 🔧 从广告系列层级获取 callouts 和 sitelinks
    const campaignAssets = await syncCampaignAssetsFromApi(
      userId,
      customerId,
      campaignId,
      serviceAccountId
    )
    
    // 8. 构建 campaign_config
    result.campaignConfig = buildCampaignConfig(
      adGroups, 
      ads, 
      keywords, 
      negativeKeywords,
      campaignAssets,  // 🔧 传递广告系列层级的扩展资源
      {
        ...campaignBasicInfo,
        targetCountry: targetingInfo.targetCountry,
        targetLanguage: targetingInfo.targetLanguage,
      },
    )

    console.log(`[Google Ads API Sync] Completed for campaign ${campaignId}:`, {
      adGroups: result.adGroupsCount,
      ads: result.adsCount,
      keywords: result.keywordsCount,
      negativeKeywords: result.negativeKeywordsCount,
    })
  } catch (error: any) {
    console.error('[Google Ads API Sync] Error:', error)
    result.errors.push({
      type: 'general',
      id: campaignId,
      error: error.message,
    })
  }

  return result
}

/**
 * 从 Google Ads API 同步广告组
 */
async function syncAdGroupsFromApi(
  userId: number,
  customerId: string,
  campaignId: string,
  serviceAccountId?: string
): Promise<GoogleAdsAdGroup[]> {
  try {
    const query = `
      SELECT 
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.cpc_bid_micros,
        campaign.id
      FROM ad_group
      WHERE campaign.id = ${campaignId}
    `

    const rows = await executeGAQLQueryPython({
      userId,
      customerId,
      query,
      serviceAccountId
    })

    return (rows?.results || []).map((row: any) => ({
      ad_group_id: row.ad_group?.id || '',
      ad_group_name: row.ad_group?.name || '',
      status: row.ad_group?.status || 'ENABLED',
      max_cpc_bid_micros: row.ad_group?.cpc_bid_micros,
      campaign_id: row.campaign?.id || campaignId,
    }))
  } catch (error: any) {
    console.error('[Sync Ad Groups] Error:', error)
    return []
  }
}

/**
 * 从 Google Ads API 同步广告
 */
async function syncAdsFromApi(
  userId: number,
  customerId: string,
  adGroups: GoogleAdsAdGroup[],
  serviceAccountId?: string
): Promise<GoogleAdsAd[]> {
  const ads: GoogleAdsAd[] = []

  for (const adGroup of adGroups) {
    try {
      const query = `
        SELECT 
          ad_group_ad.ad.id,
          ad_group_ad.ad.type,
          ad_group_ad.status,
          ad_group.id,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.responsive_search_ad.path1,
          ad_group_ad.ad.responsive_search_ad.path2,
          ad_group_ad.ad.final_urls,
          ad_group_ad.ad.final_url_suffix
        FROM ad_group_ad
        WHERE ad_group.id = ${adGroup.ad_group_id}
      `

      const rows = await executeGAQLQueryPython({
        userId,
        customerId,
        query,
        serviceAccountId
      })

      for (const row of (rows?.results || [])) {
        ads.push({
          ad_id: row.ad_group_ad?.ad?.id || '',
          ad_group_id: row.ad_group?.id || adGroup.ad_group_id,
          ad_type: row.ad_group_ad?.ad?.type || 'RESPONSIVE_SEARCH_AD',
          status: row.ad_group_ad?.status || 'ENABLED',
          responsive_search_ad: row.ad_group_ad?.ad?.responsive_search_ad,
          final_urls: row.ad_group_ad?.ad?.final_urls,
          final_url_suffix: row.ad_group_ad?.ad?.final_url_suffix,
          final_url: (row.ad_group_ad?.ad?.final_urls ?? [])[0],
        })
      }
    } catch (error: any) {
      console.error(`[Sync Ads] Error for ad group ${adGroup.ad_group_id}:`, error)
    }
  }

  return ads
}

/**
 * 从 Google Ads API 同步关键词
 */
async function syncKeywordsFromApi(
  userId: number,
  customerId: string,
  adGroups: GoogleAdsAdGroup[],
  serviceAccountId?: string
): Promise<GoogleAdsKeyword[]> {
  const keywords: GoogleAdsKeyword[] = []

  for (const adGroup of adGroups) {
    try {
      const query = `
        SELECT 
          ad_group_criterion.status,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.cpc_bid_micros
        FROM ad_group_criterion
        WHERE ad_group.id = ${adGroup.ad_group_id}
      `

      const rows = await executeGAQLQueryPython({
        userId,
        customerId,
        query,
        serviceAccountId
      })

      for (const row of (rows?.results || [])) {
        keywords.push({
          ad_group_id: adGroup.ad_group_id,
          text: row.ad_group_criterion?.keyword?.text || '',
          matchType: row.ad_group_criterion?.keyword?.match_type || 'EXACT',
          status: row.ad_group_criterion?.status || 'ENABLED',
          cpc_bid_micros: row.ad_group_criterion?.cpc_bid_micros
        })
      }
    } catch (error: any) {
      console.error(`[Sync Keywords] Error for ad group ${adGroup.ad_group_id}:`, error)
    }
  }

  return keywords
}

/**
 * 从 Google Ads API 同步否定关键词
 */
async function syncNegativeKeywordsFromApi(
  userId: number,
  customerId: string,
  campaignId: string,
  adGroups: GoogleAdsAdGroup[],
  serviceAccountId?: string
): Promise<GoogleAdsNegativeKeyword[]> {
  const negativeKeywords: GoogleAdsNegativeKeyword[] = []

  // 同步广告系列级别的否定关键词
  try {
    const query = `
      SELECT 
        campaign_criterion.criterion_id,
        campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type,
        campaign_criterion.status
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId}
        AND campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = TRUE
    `

    const rows = await executeGAQLQueryPython({
      userId,
      customerId,
      query,
      serviceAccountId
    })

    for (const row of (rows?.results || [])) {
      negativeKeywords.push({
        text: row.campaign_criterion?.keyword?.text || '',
        matchType: row.campaign_criterion?.keyword?.match_type || 'BROAD',
        level: 'campaign',
        campaign_id: campaignId,
      })
    }
  } catch (error: any) {
    console.error('[Sync Campaign Negative Keywords] Error:', error)
  }

  // 同步广告组级别的否定关键词
  for (const adGroup of adGroups) {
    try {
      const query = `
        SELECT 
          ad_group_criterion.criterion_id,
          ad_group_criterion.status,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type
        FROM ad_group_criterion
        WHERE ad_group.id = ${adGroup.ad_group_id}
          AND ad_group_criterion.negative = TRUE
      `

      const rows = await executeGAQLQueryPython({
        userId,
        customerId,
        query,
        serviceAccountId
      })

      for (const row of (rows?.results || [])) {
        negativeKeywords.push({
          text: row.ad_group_criterion?.keyword?.text || '',
          matchType: row.ad_group_criterion?.keyword?.match_type || 'BROAD',
          level: 'ad_group',
          ad_group_id: adGroup.ad_group_id,
        })
      }
    } catch (error: any) {
      console.error(`[Sync Ad Group Negative Keywords] Error for ${adGroup.ad_group_id}:`, error)
    }
  }

  return negativeKeywords
}

/**
 * 🔧 通过 campaign_criterion 获取定位信息（国家、语言）
 */
async function syncTargetingFromApi(
  userId: number,
  customerId: string,
  campaignId: string,
  serviceAccountId?: string
): Promise<{
  targetCountry?: string
  targetLanguage?: string
}> {
  const targetingInfo: {
    targetCountry?: string
    targetLanguage?: string
  } = {}

  try {
    // 🔧 合并查询：一次性获取地理位置和语言定位
    const query = `
      SELECT 
        campaign_criterion.criterion_id,
        campaign_criterion.status,
        campaign_criterion.display_name,
        campaign_criterion.negative,
        campaign_criterion.location.geo_target_constant,
        campaign_criterion.language.language_constant
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId}
        AND campaign_criterion.status = 'ENABLED'
        AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE')
      LIMIT 10
    `

    const rows = await executeGAQLQueryPython({
      userId,
      customerId,
      query: query,
      serviceAccountId
    })

    // 遍历结果，提取国家和语言信息
    for (const row of (rows?.results || [])) {
      // 提取国家代码
      if (!targetingInfo.targetCountry && row.campaign_criterion?.location?.geo_target_constant) {
        targetingInfo.targetCountry = getCountryName(row.campaign_criterion.location.geo_target_constant?.split('/')?.pop())
      }

      // 提取语言代码并转换为语言名称
      if (!targetingInfo.targetLanguage && row.campaign_criterion?.language?.language_constant) {
        targetingInfo.targetLanguage = getLanguageName(row.campaign_criterion.display_name)
      }

      // 如果已获取到国家和语言，提前退出
      if (targetingInfo.targetCountry && targetingInfo.targetLanguage) {
        break
      }
    }
  } catch (error: any) {
    console.error('[Sync Targeting] Error:', error)
  }

  return targetingInfo
}

/**
 * 🔧 从 Google Ads API 同步广告系列层级的扩展资源（callouts 和 sitelinks）
 */
async function syncCampaignAssetsFromApi(
  userId: number,
  customerId: string,
  campaignId: string,
  serviceAccountId?: string
): Promise<{
  final_url?: string
  callouts: string[]
  sitelinks: Array<{
    text: string
    url?: string
    description?: string
  }>
}> {
  const campaignAssets: {
    final_url?: string
    callouts: string[]
    sitelinks: Array<{
      text: string
      url?: string
      description?: string
    }>
  } = {
    callouts: [],
    sitelinks: [],
  }

  try {
    // 🔧 查询广告系列层级的 callout 和 sitelink 扩展
    const query = `
      SELECT 
        campaign.id,
        campaign.name,
        assets.callout_asset,
        assets.sitelink_asset
      FROM campaign
      LEFT JOIN campaign_asset ON campaign.id = campaign_asset.campaign
      LEFT JOIN asset ON campaign_asset.asset = asset.id
      WHERE campaign.id = ${campaignId}
        AND campaign_asset.status = 'ENABLED'
        AND (
          asset.type = 'CALLOUT'
          OR asset.type = 'SITELINK'
        )
    `

    const rows = await executeGAQLQueryPython({
      userId,
      customerId,
      query: query,
      serviceAccountId
    })

    // 遍历结果，提取 callouts 和 sitelinks
    for (const row of (rows?.results || [])) {
      // 提取 callouts
      if (row.asset?.callout_asset) {
        campaignAssets.callouts.push(String(row.asset.callout_asset?.callout_text || ''))
      }
      if (row?.asset?.type === 'SITELINK') {
        campaignAssets.final_url = row.asset.final_urls[0] || undefined
      }
      // 提取 sitelinks
      if (row.asset?.sitelink_asset) {
        campaignAssets.sitelinks.push({
          text: String(row.asset.sitelink_asset?.link_text || ''),
          url: String(row.asset.final_urls?.[0] || ''),
          description: String(row.asset.sitelink_asset.description1 || row.asset.sitelink_asset.description2 || ''),
        })
      }
    }

    console.log(`[Sync Campaign Assets] Found ${campaignAssets.callouts.length} callouts and ${campaignAssets.sitelinks.length} sitelinks for campaign ${campaignId}`)
  } catch (error: any) {
    console.error('[Sync Campaign Assets] Error:', error)
  }

  return campaignAssets
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
 * 构建 campaign_config JSON
 */
function buildCampaignConfig(
  adGroups: GoogleAdsAdGroup[],
  ads: GoogleAdsAd[],
  keywords: GoogleAdsKeyword[],
  negativeKeywords: GoogleAdsNegativeKeyword[],
  campaignAssets: {
    final_url?: string
    callouts: string[]
    sitelinks: Array<{
      text: string
      url?: string
      description?: string
    }>
  },
  campaignBasicInfo?: {
    campaignName?: string
    budgetAmount?: number
    budgetType?: string
    targetCountry?: string
    targetLanguage?: string
    biddingStrategy?: string
    marketingObjective?: string
    finalUrlSuffix?: string
  }
): any {
  const config: any = {}

  // 🔧 基本信息（从参数传入）
  if (campaignBasicInfo) {
    config.campaignName = campaignBasicInfo.campaignName
    config.budgetAmount = campaignBasicInfo.budgetAmount
    config.budgetType = campaignBasicInfo.budgetType
    config.targetCountry = campaignBasicInfo.targetCountry
    config.targetLanguage = campaignBasicInfo.targetLanguage
    config.biddingStrategy = campaignBasicInfo.biddingStrategy
    config.marketingObjective = campaignBasicInfo.marketingObjective
    config.finalUrlSuffix = campaignBasicInfo.finalUrlSuffix
  }

  // 广告组信息（取第一个）
  if (adGroups.length > 0) {
    const firstAdGroup = adGroups[0]
    config.adGroupName = firstAdGroup.ad_group_name
    config.adGroupId = firstAdGroup.ad_group_id
    config.maxCpcBid = firstAdGroup.max_cpc_bid_micros 
      ? Number(firstAdGroup.max_cpc_bid_micros) / 1000000 
      : undefined
  }

  // 关键词
  if (keywords.length > 0) {
    config.keywords = keywords.map(kw => ({
      text: kw.text,
      matchType: kw.matchType,
      searchVolume: kw.search_volume || 0,
      lowTopPageBid: kw.low_top_page_bid_micros 
        ? Number(kw.low_top_page_bid_micros) / 1000000 
        : 0,
      highTopPageBid: kw.high_top_page_bid_micros 
        ? Number(kw.high_top_page_bid_micros) / 1000000 
        : 0,
    }))
  }

  // 否定关键词
  const negativeKeywordTexts = negativeKeywords.map(nk => nk.text)
  const negativeKeywordMatchType: any = {}
  
  for (const nk of negativeKeywords) {
    negativeKeywordMatchType[nk.text] = nk.matchType
  }

  if (negativeKeywordTexts.length > 0) {
    config.negativeKeywords = negativeKeywordTexts
    config.negativeKeywordMatchType = negativeKeywordMatchType
  }

  // 广告信息（取第一个）
  if (ads.length > 0) {
    const firstAd = ads[0]
    config.adName = `RSA_${firstAd.ad_id}`
    
    if (firstAd.responsive_search_ad) {
      config.headlines = firstAd.responsive_search_ad.headlines?.map((h: any) => h.text) || []
      config.descriptions = firstAd.responsive_search_ad.descriptions?.map((d: any) => d.text) || []
    }
    
    config.finalUrls = firstAd.final_urls || []
    config.finalUrl = firstAd.final_url || ''
    config.finalUrlSuffix = firstAd.final_url_suffix || ''
    config.callouts = campaignAssets.callouts
    config.sitelinks = campaignAssets.sitelinks
    config.finalUrls = [campaignAssets.final_url]
    // 🔧 处理 callouts 和 sitelinks（广告系列层级配置）
    // callouts 的 asset.type 是 CALLOUT
    // sitelinks 的 asset.type 是 SITELINK，url 为 asset.final_urls[0]
    // if (firstAd.callouts) {
    //   config.calloutAssets = firstAd.callouts.map((c: any) => ({
    //     type: 'CALLOUT',
    //     text: c.text || '',
    //   }))
    //   // 同时保留 callouts 数组用于兼容
    //   config.callouts = firstAd.callouts.map((c: any) => c.text)
    // }
    
    // if (firstAd.sitelinks) {
    //   config.sitelinkAssets = firstAd.sitelinks
    //     .filter((s: any) => s.sitelink_asset)
    //     .map((s: any) => ({
    //       type: 'SITELINK',
    //       text: s.sitelink_asset?.text || '',
    //       final_urls: [s.sitelink_asset?.final_urls?.[0] || s.sitelink_asset?.url || ''],
    //       description: s.sitelink_asset?.description || '',
    //     }))
    //   // 同时保留 sitelinks 数组用于兼容
    //   config.sitelinks = firstAd.sitelinks
    //     .filter((s: any) => s.sitelink_asset)
    //     .map((s: any) => ({
    //       text: s.sitelink_asset?.text || '',
    //       url: s.sitelink_asset?.final_urls?.[0] || s.sitelink_asset?.url || '',
    //       description: s.sitelink_asset?.description || '',
    //     }))
    // }
  }

  return config
}

/**
 * 更新广告系列的 campaign_config
 * 🔧 修改 (2026-04-21): 只更新从 Google 同步的广告系列
 */
export async function updateCampaignConfig(
  campaignId: string,
  campaignConfig: any
): Promise<boolean> {
  const db = await getDatabase()
  
  // 🔧 检查广告系列是否存在且是从 Google 同步的
  const campaign = await db.queryOne(`
    SELECT id, synced_from_google_ads, campaign_config
    FROM campaigns
    WHERE campaign_id = ?
  `, [campaignId]) as { id: number; synced_from_google_ads: number | boolean, campaign_config: string | null } | undefined
  
  if (!campaign) {
    console.log(`[Campaign Config] Campaign ${campaignId} not found, skipping config update`)
    return false
  }
  
  // 🔧 检查 synced_from_google_ads 字段
  const isSyncedFromGoogle = campaign.synced_from_google_ads === true || campaign.synced_from_google_ads === 1
  const haveConfig = campaign.campaign_config && campaign.campaign_config != null && campaign.campaign_config != ''
  
  if (!isSyncedFromGoogle || haveConfig) {
    console.log(`[Campaign Config] Campaign ${campaignId} is not synced from Google Ads, skipping config update`)
    return false
  }
  
  // 更新 campaign_config
  await db.exec(`
    UPDATE campaigns
    SET campaign_config = ?,
        updated_at = ?
    WHERE campaign_id = ?
  `, [
    JSON.stringify(campaignConfig),
    new Date(),
    campaignId,
  ])
  
  console.log(`[Campaign Config] Updated for campaign ${campaignId}`)
  return true
}
