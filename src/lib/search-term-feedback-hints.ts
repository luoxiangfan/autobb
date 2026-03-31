import { getDatabase } from './db'
import { containsPureBrand, getPureBrandKeywords } from './brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'

export interface SearchTermFeedbackHints {
  hardNegativeTerms: string[]
  softSuppressTerms: string[]
  highPerformingTerms: string[]
  lookbackDays: number
  sourceRows: number
}

export interface SearchTermFeedbackAggregateRow {
  search_term: string
  impressions: number
  clicks: number
  cost: number
  conversions?: number
  conversion_value?: number
}

export interface SearchTermFeedbackClassifyResult {
  hardNegativeTerms: string[]
  softSuppressTerms: string[]
  highPerformingTerms: string[]
  sourceRows: number
}

interface CurrencyAggregateRow {
  currency: string
  campaign_count: number
}

interface AdaptiveThresholds {
  hardMinClicks: number
  softMinClicks: number
  hardMinCost: number
  softMinCost: number
  hardMinCpc: number
  softMinCpc: number
  hardMaxCtr: number
  softMaxCtr: number
  medianCpc: number
  medianCtr: number
  dominantCurrency: string
}

const DEFAULT_MAX_TERMS = 24

// 负向反馈阈值
const HARD_MIN_CLICKS = 10
const HARD_MIN_IMPRESSIONS_FOR_CTR = 400
const HARD_MAX_CTR = 0.012 // 1.2%

const SOFT_MIN_CLICKS = 6
const SOFT_MIN_IMPRESSIONS_FOR_CTR = 250
const SOFT_MAX_CTR = 0.018 // 1.8%

// 🆕 正向反馈阈值
const HIGH_PERFORMING_MIN_CLICKS = 5
const HIGH_PERFORMING_MIN_CTR = 0.03 // 3%
const HIGH_PERFORMING_MIN_CONVERSIONS = 2
const HIGH_PERFORMING_MIN_CONVERSION_RATE = 0.05 // 5%

const DEFAULT_FALLBACK_CPC_BY_CURRENCY: Record<string, number> = {
  USD: 0.9,
  EUR: 0.85,
  GBP: 0.75,
  CAD: 0.95,
  AUD: 1.0,
  CNY: 5.0,
  JPY: 120,
  KRW: 1200,
  INR: 45,
  BRL: 4.0,
  MXN: 16,
  SGD: 1.2,
  HKD: 7.0,
  TWD: 32,
  THB: 28,
  VND: 16000,
  IDR: 13000,
  PHP: 52,
  MYR: 4.2,
  AED: 3.6,
  SAR: 3.6,
  TRY: 32,
  RUB: 90,
  ZAR: 16
}

const BRAND_PRODUCT_FAMILY_ALIAS_MAP: Record<string, string[]> = {
  'our place': ['always pan', 'always pan 2.0', 'wonder oven', 'dream cooker'],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const ratio = clamp(p, 0, 1)
  const pos = (sorted.length - 1) * ratio
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) return sorted[lower]
  const weight = pos - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

function resolveFallbackCpcByCurrency(currency: string): number {
  const normalized = String(currency || 'USD').trim().toUpperCase()
  return DEFAULT_FALLBACK_CPC_BY_CURRENCY[normalized] || DEFAULT_FALLBACK_CPC_BY_CURRENCY.USD
}

function buildAdaptiveThresholds(
  rows: SearchTermFeedbackAggregateRow[],
  dominantCurrency: string
): AdaptiveThresholds {
  const cpcSamples = rows
    .map((row) => {
      const clicks = Number(row.clicks || 0)
      const cost = Number(row.cost || 0)
      if (clicks <= 0 || cost <= 0) return 0
      return cost / clicks
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  const ctrSamples = rows
    .map((row) => {
      const impressions = Number(row.impressions || 0)
      const clicks = Number(row.clicks || 0)
      if (impressions < 100 || clicks <= 0) return 0
      return clicks / impressions
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  const medianCpc = percentile(cpcSamples, 0.5)
  const p75Cpc = percentile(cpcSamples, 0.75)
  const p90Cpc = percentile(cpcSamples, 0.9)
  const medianCtr = percentile(ctrSamples, 0.5)
  const fallbackCpc = resolveFallbackCpcByCurrency(dominantCurrency)

  const softMinCpc = round2(
    Math.max(
      medianCpc > 0
        ? Math.max(p75Cpc, medianCpc * 1.15)
        : fallbackCpc * 1.2,
      fallbackCpc * 0.8
    )
  )

  const hardMinCpc = round2(
    Math.max(
      medianCpc > 0
        ? Math.max(p90Cpc, medianCpc * 1.45)
        : fallbackCpc * 1.7,
      softMinCpc * 1.15
    )
  )

  const softMinCost = round2(
    Math.max(
      SOFT_MIN_CLICKS * softMinCpc,
      fallbackCpc * SOFT_MIN_CLICKS
    )
  )

  const hardMinCost = round2(
    Math.max(
      HARD_MIN_CLICKS * hardMinCpc,
      fallbackCpc * HARD_MIN_CLICKS,
      softMinCost * 1.4
    )
  )

  const softMaxCtr = medianCtr > 0
    ? clamp(medianCtr * 0.65, 0.006, 0.03)
    : SOFT_MAX_CTR

  const hardMaxCtr = medianCtr > 0
    ? clamp(medianCtr * 0.45, 0.004, softMaxCtr * 0.9)
    : HARD_MAX_CTR

  return {
    hardMinClicks: HARD_MIN_CLICKS,
    softMinClicks: SOFT_MIN_CLICKS,
    hardMinCost,
    softMinCost,
    hardMinCpc,
    softMinCpc,
    hardMaxCtr,
    softMaxCtr,
    medianCpc: round2(medianCpc),
    medianCtr: round2(medianCtr),
    dominantCurrency
  }
}

function sanitizeSearchTerm(term: string): string {
  return String(term || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsableSearchTerm(term: string): boolean {
  if (!term) return false
  if (term.length < 2) return false
  if (term.length > 80) return false
  if (/^\d+$/.test(term)) return false
  return /[\p{L}\p{N}]/u.test(term)
}

function isBrandRelatedSearchTerm(term: string, pureBrandKeywords: string[]): boolean {
  if (!pureBrandKeywords.length) return true
  if (containsPureBrand(term, pureBrandKeywords)) return true

  const normalizedTerm = normalizeGoogleAdsKeyword(term)
  if (!normalizedTerm) return false
  const normalizedTermCompact = normalizedTerm.replace(/\s+/g, '')
  const haystack = ` ${normalizedTerm} `

  for (const pureBrand of pureBrandKeywords) {
    const brandKey = normalizeGoogleAdsKeyword(pureBrand)
    if (!brandKey) continue
    const aliases = BRAND_PRODUCT_FAMILY_ALIAS_MAP[brandKey] || []
    for (const alias of aliases) {
      const normalizedAlias = normalizeGoogleAdsKeyword(alias)
      if (!normalizedAlias) continue
      if (haystack.includes(` ${normalizedAlias} `)) return true
      const compactAlias = normalizedAlias.replace(/\s+/g, '')
      if (compactAlias && normalizedTermCompact.includes(compactAlias)) return true
    }
  }

  return false
}

function filterBrandRelatedTerms(terms: string[], pureBrandKeywords: string[], maxTerms?: number): string[] {
  const seen = new Set<string>()
  const filtered: string[] = []
  const hardCap = typeof maxTerms === 'number' ? Math.max(1, maxTerms) : Number.POSITIVE_INFINITY

  for (const term of terms) {
    const sanitized = sanitizeSearchTerm(term)
    if (!isUsableSearchTerm(sanitized)) continue
    if (!isBrandRelatedSearchTerm(sanitized, pureBrandKeywords)) continue

    const dedupeKey = sanitized.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    filtered.push(sanitized)

    if (filtered.length >= hardCap) break
  }

  return filtered
}

function mergeTermsWithCap(base: string[], additions: string[], maxTerms: number): {
  merged: string[]
  addedCount: number
} {
  const cap = Math.max(1, maxTerms)
  const merged: string[] = []
  const seen = new Set<string>()
  const append = (term: string): boolean => {
    const sanitized = sanitizeSearchTerm(term)
    if (!isUsableSearchTerm(sanitized)) return false
    const key = sanitized.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    merged.push(sanitized)
    return true
  }

  for (const term of base) {
    append(term)
    if (merged.length >= cap) {
      return { merged, addedCount: 0 }
    }
  }

  let addedCount = 0
  for (const term of additions) {
    if (append(term)) {
      addedCount += 1
      if (merged.length >= cap) break
    }
  }

  return { merged, addedCount }
}

export function classifySearchTermFeedbackTerms(
  rows: SearchTermFeedbackAggregateRow[],
  params?: {
    dominantCurrency?: string
    maxTerms?: number
  }
): SearchTermFeedbackClassifyResult {
  const maxTerms = Math.max(5, Math.min(100, params?.maxTerms ?? DEFAULT_MAX_TERMS))
  const dominantCurrency = String(params?.dominantCurrency || 'USD').trim().toUpperCase()
  const thresholds = buildAdaptiveThresholds(rows, dominantCurrency)

  const hardNegativeTerms: string[] = []
  const softSuppressTerms: string[] = []
  const highPerformingTerms: string[] = []

  for (const row of rows) {
    const term = sanitizeSearchTerm(row.search_term)
    if (!isUsableSearchTerm(term)) continue

    const impressions = Number(row.impressions || 0)
    const clicks = Number(row.clicks || 0)
    const cost = Number(row.cost || 0)
    const conversions = Number(row.conversions || 0)
    const cpc = clicks > 0 ? cost / clicks : 0
    const ctr = impressions > 0 ? clicks / impressions : 0
    const conversionRate = clicks > 0 ? conversions / clicks : 0

    // 🆕 High performing: strong CTR and conversion signals
    const highByCtr =
      clicks >= HIGH_PERFORMING_MIN_CLICKS &&
      ctr >= HIGH_PERFORMING_MIN_CTR
    const highByConversion =
      conversions >= HIGH_PERFORMING_MIN_CONVERSIONS &&
      conversionRate >= HIGH_PERFORMING_MIN_CONVERSION_RATE

    if (highByCtr || highByConversion) {
      highPerformingTerms.push(term)
      continue // Skip negative classification for high performers
    }

    // Hard negative: high spend/click volume with clearly weak efficiency signal.
    const hardByCpc =
      clicks >= thresholds.hardMinClicks &&
      cost >= thresholds.hardMinCost &&
      cpc >= thresholds.hardMinCpc
    const hardByCtr =
      impressions >= HARD_MIN_IMPRESSIONS_FOR_CTR &&
      clicks >= thresholds.hardMinClicks &&
      ctr <= thresholds.hardMaxCtr
    if (hardByCpc || hardByCtr) {
      hardNegativeTerms.push(term)
      continue
    }

    // Soft suppression: moderate inefficiency, keep as guidance not hard block.
    const softByCpc =
      clicks >= thresholds.softMinClicks &&
      cost >= thresholds.softMinCost &&
      cpc >= thresholds.softMinCpc
    const softByCtr =
      impressions >= SOFT_MIN_IMPRESSIONS_FOR_CTR &&
      clicks >= thresholds.softMinClicks &&
      ctr <= thresholds.softMaxCtr
    if (softByCpc || softByCtr) {
      softSuppressTerms.push(term)
    }
  }

  const dedupe = (list: string[]) => Array.from(new Set(list.map(sanitizeSearchTerm))).filter(isUsableSearchTerm)
  const hard = dedupe(hardNegativeTerms).slice(0, maxTerms)
  const soft = dedupe(softSuppressTerms)
    .filter(term => !hard.includes(term))
    .slice(0, maxTerms)
  const high = dedupe(highPerformingTerms).slice(0, maxTerms)

  return {
    hardNegativeTerms: hard,
    softSuppressTerms: soft,
    highPerformingTerms: high,
    sourceRows: rows.length
  }
}

/**
 * 🆕 阶段1: 获取用户品牌级别高性能搜索词
 * 从同一用户的其他 Offer（同品牌）中获取高性能搜索词
 */
async function getUserBrandLevelHighPerformingTerms(params: {
  userId: number
  brandName: string
  excludeOfferId: number
  targetCountry?: string
  maxTerms?: number
}): Promise<string[]> {
  const db = await getDatabase()
  const maxTerms = Math.max(5, Math.min(20, params.maxTerms ?? 10))
  const pureBrandKeywords = getPureBrandKeywords(params.brandName)

  const isDeletedCondition = db.type === 'postgres' ? 'COALESCE(c.is_deleted, FALSE) = FALSE' : 'COALESCE(c.is_deleted, 0) = 0'

  const rows = await db.query<SearchTermFeedbackAggregateRow>(
    `SELECT
       str.search_term,
       SUM(str.impressions) AS impressions,
       SUM(str.clicks) AS clicks,
       SUM(str.cost) AS cost,
       SUM(str.conversions) AS conversions
     FROM search_term_reports str
     JOIN campaigns c ON c.id = str.campaign_id
     JOIN offers o ON o.id = c.offer_id
     WHERE str.user_id = ?
       AND o.brand = ?
       AND o.id != ?
       AND o.target_country = COALESCE(?, o.target_country)
       AND ${isDeletedCondition}
     GROUP BY str.search_term
     HAVING SUM(str.clicks) >= ${HIGH_PERFORMING_MIN_CLICKS}
     ORDER BY SUM(str.clicks) DESC`,
    [params.userId, params.brandName, params.excludeOfferId, params.targetCountry || null]
  )

  const terms: string[] = []
  for (const row of rows) {
    const term = sanitizeSearchTerm(row.search_term)
    if (!isUsableSearchTerm(term)) continue
    if (!isBrandRelatedSearchTerm(term, pureBrandKeywords)) continue

    const impressions = Number(row.impressions || 0)
    const clicks = Number(row.clicks || 0)
    const conversions = Number(row.conversions || 0)
    const ctr = impressions > 0 ? clicks / impressions : 0
    const conversionRate = clicks > 0 ? conversions / clicks : 0

    const highByCtr = clicks >= HIGH_PERFORMING_MIN_CLICKS && ctr >= HIGH_PERFORMING_MIN_CTR
    const highByConversion = conversions >= HIGH_PERFORMING_MIN_CONVERSIONS && conversionRate >= HIGH_PERFORMING_MIN_CONVERSION_RATE

    if (highByCtr || highByConversion) {
      terms.push(term)
      if (terms.length >= maxTerms) break
    }
  }

  return terms
}

/**
 * 🆕 阶段2: 获取全局品牌级别高性能搜索词
 * 从所有用户的同品牌 Offer 中聚合高性能搜索词（k-匿名性保护）
 */
async function getGlobalBrandLevelHighPerformingTerms(params: {
  brandName: string
  targetCountry?: string
  maxTerms?: number
  minUsers?: number
}): Promise<Array<{
  term: string
  userCount: number
  avgCtr: number
  totalClicks: number
}>> {
  const db = await getDatabase()
  const maxTerms = Math.max(5, Math.min(20, params.maxTerms ?? 10))
  const minUsers = Math.max(2, params.minUsers ?? 2) // k-匿名性：至少2个用户
  const pureBrandKeywords = getPureBrandKeywords(params.brandName)

  const isDeletedCondition = db.type === 'postgres' ? 'COALESCE(c.is_deleted, FALSE) = FALSE' : 'COALESCE(c.is_deleted, 0) = 0'

  // 聚合查询：计算平均 CTR 和用户数
  const avgCtrExpr = db.type === 'postgres'
    ? 'AVG(str.clicks::float / NULLIF(str.impressions, 0))'
    : 'AVG(CAST(str.clicks AS REAL) / NULLIF(str.impressions, 0))'

  const rows = await db.query<{
    search_term: string
    user_count: number
    avg_ctr: number
    total_clicks: number
    total_conversions: number
  }>(
    `SELECT
       str.search_term,
       COUNT(DISTINCT str.user_id) AS user_count,
       ${avgCtrExpr} AS avg_ctr,
       SUM(str.clicks) AS total_clicks,
       SUM(str.conversions) AS total_conversions
     FROM search_term_reports str
     JOIN campaigns c ON c.id = str.campaign_id
     JOIN offers o ON o.id = c.offer_id
     WHERE o.brand = ?
       AND o.target_country = COALESCE(?, o.target_country)
       AND ${isDeletedCondition}
     GROUP BY str.search_term
     HAVING COUNT(DISTINCT str.user_id) >= ?
       AND SUM(str.clicks) >= 15
       AND ${avgCtrExpr} >= ${HIGH_PERFORMING_MIN_CTR}
     ORDER BY user_count DESC, avg_ctr DESC
     LIMIT ?`,
    [params.brandName, params.targetCountry || null, minUsers, maxTerms]
  )

  return rows
    .map(row => ({
      term: sanitizeSearchTerm(row.search_term),
      userCount: Number(row.user_count || 0),
      avgCtr: Number(row.avg_ctr || 0),
      totalClicks: Number(row.total_clicks || 0)
    }))
    .filter(item => isUsableSearchTerm(item.term))
    .filter(item => isBrandRelatedSearchTerm(item.term, pureBrandKeywords))
}

/**
 * Build search term feedback hints from search term reports.
 * 🆕 Now includes high-performing terms for positive reinforcement.
 * 🆕 阶段1+2: 品牌聚合策略（Offer + 用户品牌 + 全局品牌）
 * - hardNegativeTerms: clear spend waste by clicks/cost + poor efficiency (CPC/CTR)
 * - softSuppressTerms: moderate inefficiency that should be deprioritized in copy
 * - highPerformingTerms: strong CTR/conversion signals for keyword expansion
 */
export async function getSearchTermFeedbackHints(params: {
  offerId: number
  userId: number
  lookbackDays?: number
  maxTerms?: number
}): Promise<SearchTermFeedbackHints> {
  const db = await getDatabase()
  // 不做时间窗口过滤：全历史可用（0 表示 all-time，仅用于返回给上层展示）
  const lookbackDays = 0
  const maxTerms = Math.max(5, Math.min(100, params.maxTerms ?? DEFAULT_MAX_TERMS))

  const isDeletedCondition = db.type === 'postgres' ? 'COALESCE(c.is_deleted, FALSE) = FALSE' : 'COALESCE(c.is_deleted, 0) = 0'

  // 获取 Offer 信息（用于品牌级别回退）
  const offer = await db.queryOne<{ brand: string; target_country: string }>(
    'SELECT brand, target_country FROM offers WHERE id = ? AND user_id = ?',
    [params.offerId, params.userId]
  )

  if (!offer) {
    throw new Error(`Offer ${params.offerId} not found for user ${params.userId}`)
  }

  const currencyRows = await db.query<CurrencyAggregateRow>(
    `SELECT
       COALESCE(gaa.currency, 'USD') AS currency,
       COUNT(*) AS campaign_count
     FROM campaigns c
     LEFT JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
     WHERE c.user_id = ?
       AND c.offer_id = ?
       AND ${isDeletedCondition}
     GROUP BY COALESCE(gaa.currency, 'USD')
     ORDER BY COUNT(*) DESC`,
    [params.userId, params.offerId]
  )
  const dominantCurrency = String(currencyRows[0]?.currency || 'USD').trim().toUpperCase()

  // 🎯 阶段1: Offer 级别数据（最精准）
  const rows = await db.query<SearchTermFeedbackAggregateRow>(
    `SELECT
       str.search_term,
       SUM(str.impressions) AS impressions,
       SUM(str.clicks) AS clicks,
       SUM(str.cost) AS cost,
       SUM(str.conversions) AS conversions
     FROM search_term_reports str
     JOIN campaigns c ON c.id = str.campaign_id
     WHERE str.user_id = ?
       AND c.offer_id = ?
       AND ${isDeletedCondition}
     GROUP BY str.search_term
     HAVING SUM(str.clicks) > 0
     ORDER BY SUM(str.cost) DESC`,
    [params.userId, params.offerId]
  )
  const classified = classifySearchTermFeedbackTerms(rows, {
    dominantCurrency,
    maxTerms
  })

  const pureBrandKeywords = getPureBrandKeywords(offer.brand || '')
  let highPerformingTerms = filterBrandRelatedTerms(
    classified.highPerformingTerms,
    pureBrandKeywords,
    maxTerms
  )
  const offerLevelCount = highPerformingTerms.length

  // 🎯 阶段2: 用户品牌级别补充（同用户其他 Offer）
  let userBrandLevelCount = 0
  try {
    const userBrandTerms = filterBrandRelatedTerms(
      await getUserBrandLevelHighPerformingTerms({
        userId: params.userId,
        brandName: offer.brand,
        excludeOfferId: params.offerId,
        targetCountry: offer.target_country,
        maxTerms: maxTerms
      }),
      pureBrandKeywords
    )

    const merged = mergeTermsWithCap(highPerformingTerms, userBrandTerms, maxTerms)
    highPerformingTerms = merged.merged
    userBrandLevelCount = merged.addedCount

    if (userBrandLevelCount > 0) {
      console.log(`🔄 用户品牌级别补充: 添加 ${userBrandLevelCount} 个高性能词 (来自同用户其他 Offer)`)
    }
  } catch (error) {
    console.warn('⚠️ 用户品牌级别补充失败:', error)
  }

  // 🎯 阶段3: 全局品牌级别补充（所有用户聚合）
  let globalBrandLevelCount = 0
  try {
    const globalBrandTerms = filterBrandRelatedTerms(
      (
        await getGlobalBrandLevelHighPerformingTerms({
          brandName: offer.brand,
          targetCountry: offer.target_country,
          maxTerms: maxTerms,
          minUsers: 2 // k-匿名性：至少2个用户
        })
      ).map(item => item.term),
      pureBrandKeywords
    )

    const merged = mergeTermsWithCap(highPerformingTerms, globalBrandTerms, maxTerms)
    highPerformingTerms = merged.merged
    globalBrandLevelCount = merged.addedCount

    if (globalBrandLevelCount > 0) {
      console.log(`🌍 全局品牌级别补充: 添加 ${globalBrandLevelCount} 个高性能词 (跨用户聚合)`)
    }
  } catch (error) {
    console.warn('⚠️ 全局品牌级别补充失败:', error)
  }

  // 输出统计信息
  console.log(`📊 高性能搜索词来源统计:`)
  console.log(`   - Offer 级别: ${offerLevelCount} 个`)
  console.log(`   - 用户品牌级别: ${userBrandLevelCount} 个`)
  console.log(`   - 全局品牌级别: ${globalBrandLevelCount} 个`)
  console.log(`   - 总计: ${highPerformingTerms.length} 个`)

  return {
    hardNegativeTerms: classified.hardNegativeTerms,
    softSuppressTerms: classified.softSuppressTerms,
    highPerformingTerms,
    lookbackDays,
    sourceRows: classified.sourceRows
  }
}