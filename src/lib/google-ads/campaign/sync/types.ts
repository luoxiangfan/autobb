/**
 * 从 Google Ads campaign_name 提取 offer brand。
 * 若名称中不含 `@`，不做解析，直接返回 trim 后的原文。
 * 含 `@` 时依次尝试：
 * - {字母}{数字}-{brand}@后缀（例：B0023-{brand}@xxx）
 * - {纯字母前缀}-{brand}@后缀（例：PB-{brand}@xxx）
 * - {brand}_国家码_数字_数字_数字（行尾地理后缀形态）
 * - {字母}{数字}-{brand}（整串剩余段，作兜底）
 * 仍无法识别时返回原文。
 */
export function extractBrandFromGoogleAdsCampaignName(campaignName: string): string {
  const raw = (campaignName ?? '').trim()
  if (!raw) return raw
  if (!raw.includes('@')) return raw

  // {字母}{数字}-{brand}@…
  const letterNumAt = raw.match(/^[A-Za-z]\d+-(.+)@[^@]+$/i)
  if (letterNumAt?.[1]) {
    const inner = letterNumAt[1].trim()
    if (inner) return inner
  }

  // {纯字母前缀}-{brand}@…（须放在「字母+数字-」之后，避免 B0023-… 被吞成 B-0023…）
  const lettersPrefixAt = raw.match(/^[A-Za-z]+-(.+)@[^@]+$/i)
  if (lettersPrefixAt?.[1]) {
    const inner = lettersPrefixAt[1].trim()
    if (inner) return inner
  }

  // {brand}_US_77_106_20260407152617037
  const geoSuffix = raw.match(/^(.+)_[A-Z]{2}_\d+_\d+_\d+$/i)
  if (geoSuffix?.[1]) {
    const inner = geoSuffix[1].trim()
    if (inner) return inner
  }

  // {字母}{数字}-{brand}（无 @ 段）
  const letterNum = raw.match(/^[A-Za-z]\d+-(.+)$/i)
  if (letterNum?.[1]) {
    const inner = letterNum[1].trim()
    if (inner) return inner
  }

  return raw
}

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
    finalUrls?: string[]
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
  skippedOffersCount: number // 已有关联 Offer，跳过创建/更新
  errors: Array<{
    campaignId: string
    campaignName: string
    error: string
  }>
  warnings: string[]
}

export interface CampaignSyncAuditInsert {
  userId: number
  googleAdsAccountId: number
  customerId: string
  campaignId: string
  campaignName: string
  query1Rows: number
  query2Rows: number
  query3Rows: number
  query4Rows: number
  aggregatedAdGroups: number
  aggregatedAds: number
  aggregatedKeywords: number
  aggregatedCallouts: number
  aggregatedSitelinks: number
  aggregatedLocations: number
  auditPayload: Record<string, any>
}

const languageMap: { [key: string]: string } = {
  english: 'en',
  'chinese (simplified)': 'zh-cn',
  'chinese (traditional)': 'zh-tw',
  chinese: 'zh',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  italian: 'it',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
  dutch: 'nl',
  thai: 'th',
  vietnamese: 'vi',
  turkish: 'tr',
  swedish: 'sv',
  danish: 'da',
  finnish: 'fi',
  norwegian: 'no',
  polish: 'pl',
  czech: 'cs',
  hungarian: 'hu',
  greek: 'el',
  hebrew: 'he',
  indonesian: 'id',
  malay: 'ms',
}

/**
 * 🔧 将语言代码转换为语言名称
 */
export function getLanguageName(languageCode: string): string {
  return languageMap[languageCode] || languageCode
}
