/**
 * 关键词质量过滤模块 (v2.0)
 *
 * 职责：过滤低质量关键词，确保关键词与产品相关
 *
 * 过滤规则：
 * 1. 品牌变体词过滤：品牌名 + 随机字符后缀（如 eurekaddl）
 * 2. 语义查询词过滤：非购买意图的查询词（如 significato、serie）
 * 3. 品牌无关词过滤：多语言企业类型后缀（如 unito, gmbh, inc）
 * 4. 纯品牌词检测：支持多单词品牌（eufy security → eufy + eufy security）
 *
 * 🔥 2025-12-29 优化：
 * - 新增纯品牌词检测函数
 * - 新增多语言品牌无关词过滤
 * - 支持OAuth和服务账号两种模式
 */

import type { PoolKeywordData } from './offer-keyword-pool'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
  PRODUCT_WORD_PATTERNS,
} from './brand-keyword-utils'
import {
  normalizePlannerNonBrandPolicy,
  shouldAllowPlannerNonBrandKeyword,
  type PlannerNonBrandPolicy,
} from './planner-non-brand-policy'
import {
  buildKeywordIntegrityAnchors,
  getSplitAnchorDistortionReason,
  isKeywordLanguageMismatch,
} from './keyword-validity'

export { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword }

const BRAND_CONNECTOR_TOKENS = new Set([
  'and',
  'plus',
])

/**
 * 判断是否为“品牌拼接词”（无空格直接拼接）
 * 例如: swansonvitamin / drmercola
 * 用于在有真实搜索量时放宽过滤规则。
 */
export function isBrandConcatenation(keyword: string, brandName: string): boolean {
  if (!keyword || !brandName) return false

  const kwNorm = normalizeGoogleAdsKeyword(keyword)
  const brandNorm = normalizeGoogleAdsKeyword(brandName)
  if (!kwNorm || !brandNorm) return false
  if (!kwNorm.startsWith(brandNorm)) return false
  if (kwNorm === brandNorm) return false

  const nextChar = kwNorm.charAt(brandNorm.length)
  if (!nextChar) return false
  return nextChar !== ' '
}

// ============================================
// 品牌词匹配策略（🔥 2026-01-05 新增：明确用途，避免混用）
// ============================================

/**
 * 品牌词匹配策略说明
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  场景1: 关键词过滤（保留包含品牌词的关键词）                      │
 * │  → shouldKeepByBrand() - 部分匹配（"reolink argus" ✅）          │
 * │                                                                 │
 * │  场景2: 匹配类型分配（判断是否"纯品牌词"用 EXACT）                │
 * │  → shouldUseExactMatch() - 精确匹配（"reolink" ✅, "reolink argus" ❌）│
 * └─────────────────────────────────────────────────────────────────┘
 */

/**
 * 判断关键词是否应该保留（用于质量过滤）
 *
 * 规则：只要包含品牌词就保留
 * 用途：filterKeywordQuality() 的 mustContainBrand 检查
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否应该保留
 *
 * @example
 * shouldKeepByBrand("reolink argus", ["reolink"]) → true
 * shouldKeepByBrand("security camera", ["reolink"]) → false
 */
export function shouldKeepByBrand(keyword: string, pureBrandKeywords: string[]): boolean {
  if (containsPureBrand(keyword, pureBrandKeywords)) return true

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return false
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length < 3) return false

  for (const brand of pureBrandKeywords) {
    const brandTokens = normalizeGoogleAdsKeyword(brand || '').split(/\s+/).filter(Boolean)
    if (brandTokens.length < 2) continue

    for (let start = 0; start < keywordTokens.length; start += 1) {
      if (keywordTokens[start] !== brandTokens[0]) continue
      let cursor = start + 1
      let matched = 1

      while (matched < brandTokens.length && cursor < keywordTokens.length) {
        while (cursor < keywordTokens.length && BRAND_CONNECTOR_TOKENS.has(keywordTokens[cursor])) {
          cursor += 1
        }
        if (cursor >= keywordTokens.length) break
        if (keywordTokens[cursor] !== brandTokens[matched]) break
        matched += 1
        cursor += 1
      }

      if (matched === brandTokens.length) return true
    }
  }

  return false
}

/**
 * 判断关键词是否应该使用 EXACT 匹配类型
 *
 * 规则：必须是纯品牌词本身（无修饰词）
 * 用途：ad-creative-generator.ts 的匹配类型分配
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否应该使用 EXACT 匹配
 *
 * @example
 * shouldUseExactMatch("reolink", ["reolink"]) → true
 * shouldUseExactMatch("reolink argus", ["reolink"]) → false
 */
export function shouldUseExactMatch(keyword: string, pureBrandKeywords: string[]): boolean {
  return isPureBrandKeyword(keyword, pureBrandKeywords)
}

// ============================================
// 语义查询词列表（需要过滤的关键词类型）
// ============================================

/**
 * 语义查询词模式（不区分大小写）
 * 这些词通常表示用户在进行信息查询，而非购买意图
 */
const SEMANTIC_QUERY_PATTERNS = [
  // 语义查询类（meaning, definition, what is...）
  'significato', 'meaning', 'definition', 'what is', 'cosa significa',
  'translate', 'translation', 'traduzione',

  // 媒体/娱乐类（TV series, shows...）
  'serie', 'series', 'tv', 'television', 'show', 'episode',
  'stagione', 'stagioni', 'netflix', 'streaming',

  // 历史/百科类
  'history', 'storia', 'wikipedia', 'wiki',

  // 地点/地名类
  'palace', 'hotel', 'spa', 'resort', 'restaurant',
  'location', 'where to', 'near me',

  // 教育/教程类
  'how to', 'tutorial', 'guide', 'manual', 'instructions',

  // 价格比较类（保留price/cost用于产品搜索，但过滤compare/review）
  'compare', 'comparison', 'versus', 'vs ',
  'review', 'reviews', 'rating', 'ratings',
  'test', 'testing',  // test/testing=测试/评测，低转化意图

  // 低转化意图词
  'free', 'cheap', 'cheapest', 'discount', 'coupon', 'code',
  'job', 'jobs', 'career', 'salary', 'employment', 'hiring',

  // 下载/软件类
  'download', 'software', 'app', 'apk', 'pdf', 'ebook', 'digital',

  // 二手/维修类
  'used', 'refurbished', 'repair', 'fix', 'broken', 'replacement',
  'parts', 'spare parts', 'manual', 'instructions',

  // 素材/尺寸查询类（低购买意图，且容易污染广告文案）
  'gif', 'meme', 'emoji', 'sticker', 'drawing', 'image', 'images',
  'logo', 'png', 'jpg', 'jpeg', 'svg', 'icon', 'clipart', 'wallpaper',
  'size chart', 'size guide', 'sizing',

  // DIY/自制类
  'diy', 'homemade', 'handmade', 'build your own', 'make your own',

  // 竞品平台（🔥 2025-12-29 扩充：防止跨平台关键词浪费）
  // 主流电商平台
  'ebay', 'amazon', 'walmart', 'target', 'bestbuy', 'best buy',
  'costco', 'sams club', 'sams', 'kroger', 'walgreens',
  // 国际电商平台
  'alibaba', 'aliexpress', 'wish', 'temu', 'shein',
  'craigslist', 'mercari', 'poshmark', 'etsy',
  // 品牌官网/直销平台
  'official site', 'official website', 'direct', 'manufacturer',
]

const LOW_INTENT_SUPPORT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bany\s+good\b/i, label: '评价疑问' },
  { pattern: /\bbest\s+sellers?\s+rank\b/i, label: '平台排名噪音' },
  { pattern: /\bsee\s+top\b/i, label: '平台排名噪音' },
  { pattern: /\bworth\s+it\b/i, label: '评价疑问' },
  { pattern: /\bhow\s+long\b/i, label: '支持查询' },
  { pattern: /\bcustomer\s+support\b/i, label: '支持查询' },
  { pattern: /\bphone\s+number\b/i, label: '支持查询' },
  { pattern: /\bassembly\b/i, label: '安装售后' },
  { pattern: /\bsetup\b/i, label: '安装售后' },
  { pattern: /\binstallation\b/i, label: '安装售后' },
  { pattern: /\btroubleshoot(?:ing)?\b/i, label: '支持查询' },
  { pattern: /\bfiberglass\b/i, label: '问题担忧' },
  { pattern: /\blegit\b/i, label: '可信度疑问' },
  { pattern: /\bproblem(?:s)?\b/i, label: '问题查询' },
  { pattern: /\bloading\b/i, label: '问题查询' },
  { pattern: /\bwebsite\b/i, label: '品牌导航' },
]

// ============================================
// 平台检测（🔥 2025-12-29 新增）
// ============================================

/**
 * 电商平台域名映射
 */
const PLATFORM_DOMAINS: Record<string, string[]> = {
  amazon: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.jp', 'amzn.to'],
  walmart: ['walmart.com', 'walmart.ca'],
  ebay: ['ebay.com', 'ebay.co.uk', 'ebay.de'],
  target: ['target.com'],
  bestbuy: ['bestbuy.com'],
  costco: ['costco.com'],
  aliexpress: ['aliexpress.com'],
  alibaba: ['alibaba.com'],
  etsy: ['etsy.com'],
  wish: ['wish.com'],
  temu: ['temu.com'],
  shein: ['shein.com'],
}

/**
 * 平台关键词模式（包含常见拼写错误）
 */
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  amazon: ['amazon', 'amazone', 'amzn', 'amazn'],  // amazone是常见拼写错误
  walmart: ['walmart', 'wal mart', 'wal-mart', 'walmat'],
  ebay: ['ebay', 'e bay', 'e-bay'],
  target: ['target'],
  bestbuy: ['best buy', 'bestbuy', 'bestbuy'],
  costco: ['costco'],
  sams: ['sams club', 'sams', "sam's club"],
  aliexpress: ['aliexpress', 'ali express'],
  alibaba: ['alibaba'],
  etsy: ['etsy'],
  wish: ['wish'],
  temu: ['temu'],
  shein: ['shein'],
}

/**
 * 从URL提取平台名称
 *
 * @param url - 产品URL
 * @returns 平台名称（小写）或null
 *
 * @example
 * extractPlatformFromUrl('https://www.amazon.com/dp/B123') → 'amazon'
 * extractPlatformFromUrl('https://www.walmart.com/ip/456') → 'walmart'
 */
export function extractPlatformFromUrl(url: string): string | null {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查每个平台的域名列表
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      if (domains.some(domain => hostname.includes(domain))) {
        return platform
      }
    }
  } catch {
    // URL解析失败
  }

  return null
}

/**
 * 检测关键词中包含的平台名称
 *
 * @param keyword - 关键词
 * @returns 检测到的平台名称数组
 *
 * @example
 * detectPlatformsInKeyword('anker power bank walmart') → ['walmart']
 * detectPlatformsInKeyword('amazon best buy comparison') → ['amazon', 'bestbuy']
 */
export function detectPlatformsInKeyword(keyword: string): string[] {
  if (!keyword) return []

  const kwLower = keyword.toLowerCase()
  const detectedPlatforms: string[] = []

  for (const [platform, patterns] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const pattern of patterns) {
      // 使用单词边界匹配，避免误匹配
      const regex = new RegExp(`\\b${pattern}\\b`, 'i')
      if (regex.test(kwLower)) {
        detectedPlatforms.push(platform)
        break // 找到一个匹配即可，跳出当前平台的模式循环
      }
    }
  }

  return [...new Set(detectedPlatforms)]
}

/**
 * 检测关键词平台是否与URL平台冲突
 *
 * @param keyword - 关键词
 * @param productUrl - 产品URL
 * @returns 是否冲突
 *
 * @example
 * isPlatformMismatch('anker walmart', 'https://amazon.com/...') → true
 * isPlatformMismatch('anker charger', 'https://amazon.com/...') → false
 * isPlatformMismatch('anker amazon', 'https://amazon.com/...') → false
 */
export function isPlatformMismatch(keyword: string, productUrl: string): boolean {
  const urlPlatform = extractPlatformFromUrl(productUrl)
  if (!urlPlatform) {
    // 无法识别URL平台，不过滤
    return false
  }

  const keywordPlatforms = detectPlatformsInKeyword(keyword)
  if (keywordPlatforms.length === 0) {
    // 关键词不包含平台名，不过滤
    return false
  }

  // 如果关键词包含平台名，但与URL平台不匹配，则视为冲突
  return !keywordPlatforms.includes(urlPlatform)
}

// ============================================
// 品牌变体词检测
// ============================================

/**
 * 检测是否为品牌变体词
 *
 * 品牌变体词特征：
 * - 品牌名 + 3个以上无意义字母后缀
 * - 例如：eureka + ddl = eurekaddl
 *
 * 🔥 2026-01-02 优化：
 * - 包含数字的后缀不是变体词（产品型号，如 j15, x20）
 * - 后缀完全等于常见产品词的不是变体词（如 pro, ultra, max）
 * - 后缀以"产品词+"开头的（如 pro-）的不是变体词
 * - 纯品牌词（后缀为空）豁免
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称
 * @returns 是否为品牌变体词
 */
export function isBrandVariant(keyword: string, brandName: string): boolean {
  if (!keyword || !brandName) return false

  const normalized = keyword.toLowerCase().trim()
  const brand = brandName.toLowerCase().trim()

  // 检查是否以品牌名开头
  if (!normalized.startsWith(brand)) {
    return false
  }

  // 🔧 关键修复：仅把“品牌名后直接拼接的后缀”视为变体词
  // 例如：eurekaddl（brand+ddl）✅
  // 例如：auxito led / auxito-led / auxito_led ❌（这是正常的品牌+产品词组合）
  const boundaryChar = normalized.charAt(brand.length)
  if (boundaryChar && !/[a-z0-9]/.test(boundaryChar)) {
    return false
  }

  // 提取品牌名后面的部分
  const suffix = normalized.slice(brand.length).trim()

  // 如果后面没有内容，不是变体词（纯品牌词）
  if (!suffix) {
    return false
  }

  // 1. 检查后缀是否包含数字（如果包含数字，不是变体词，是产品型号）
  if (/\d/.test(suffix)) {
    // 包含数字，如 "j15", "x20", "e20s" - 这些是产品型号，不是变体词
    return false
  }

  // 2. 检查后缀是否等于常见产品词（或产品词+空格后缀）
  // 只排除单个产品词（如 "pro", "ultra"），不排除连写词（如 "camerabundle"）
  const isExactProductWord = PRODUCT_WORD_PATTERNS.includes(suffix)
  if (isExactProductWord) {
    return false
  }

  // 3. 检查后缀是否以"产品词-"开头（如 "pro-bundle", "ultra-s"）
  const hasProductWordPrefix = PRODUCT_WORD_PATTERNS.some(pattern =>
    suffix.startsWith(pattern + '-') || suffix.startsWith(pattern + ' ')
  )
  if (hasProductWordPrefix) {
    return false
  }

  // 4. 检查后缀长度：3-10个字母后缀认为是变体词
  const suffixLength = suffix.length
  return suffixLength >= 3 && suffixLength <= 10
}

/**
 * 从关键词中提取有效的品牌组合
 *
 * 例如：
 * - eurekaddl → eureka
 * - eureka-j15 → eureka, j15
 * - eureka j15 pro → eureka, j15
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称
 * @returns 有效的品牌相关词组
 */
export function extractValidBrandTerms(keyword: string, brandName: string): string[] {
  const normalized = keyword.toLowerCase().trim()
  const brand = brandName.toLowerCase().trim()
  const terms: string[] = []

  // 1. 检查是否包含品牌名（避免子串误匹配，如 "rove" 命中 "rover"）
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  if (pureBrandKeywords.length > 0 && containsPureBrand(normalized, pureBrandKeywords)) {
    terms.push(brand)
  }

  // 2. 提取产品型号（常见的模式）
  // 例如：j15, j15 pro, j20, ne20s, e20s 等
  const modelPatterns = [
    /([a-z]?\d{1,2}[a-z]*(?:\s+(?:pro|ultra|max|plus))?)/gi,
    /([a-z]{1,2}\d{2}[a-z]*)/gi,
  ]

  for (const pattern of modelPatterns) {
    const matches = keyword.match(pattern)
    if (matches) {
      for (const match of matches) {
        const cleaned = match.toLowerCase().trim()
        if (cleaned.length >= 2 && cleaned !== brand && !terms.includes(cleaned)) {
          terms.push(cleaned)
        }
      }
    }
  }

  return [...new Set(terms)]
}

// ============================================
// 品牌无关词检测（🔥 2025-12-29 新增：多语言支持）
// ============================================

/**
 * 多语言企业类型后缀模式
 * 用于检测与品牌无关的商业实体关键词
 * 匹配格式: "品牌 商业后缀" (如 "eureka unito")
 */
const BRAND_IRRELEVANT_PATTERNS: RegExp[] = [
  // 意大利语 - 匹配 "word suffix" 格式
  /\b\w+\s+(unito|srl|sa|scarl)\b/i,
  // 德语（前置词必须包含字母，避免把 "10 kg" 这类重量单位误判为公司后缀 KG）
  /\b[\p{L}\p{N}_]*[\p{L}][\p{L}\p{N}_]*\s+(gmbh|ag|kg|mbh)\b/iu,
  // 英语
  /\b\w+\s+(inc|ltd|llc|corp|corporation|limited)\b/i,
  // 法语
  /\b\w+\s+(sa|sas|eurl|sarl)\b/i,
  // 西班牙语
  /\b\w+\s+(sa|srl|sl)\b/i,
  // 中文（不使用 \b，改用捕获组）
  /(有限公司|股份有限公司|有限责任公司)/,
  // 日语（不使用 \b，改用捕获组）
  /(株式会社|有限会社)/,
  // 韩语（不使用 \b，改用捕获组）
  /(주식회사|유한회사)/,
  // 荷兰语
  /\b\w+\s+(bv)\b/i,
  // 波兰语
  /\b\w+\s+(sp|sp\.?o\.?|z\.?o\.?o\.?)\b/i,
]

/**
 * 检测关键词是否为品牌无关词
 *
 * 品牌无关词特征：
 * - 包含企业类型后缀（unito, gmbh, inc等）
 * - 不包含纯品牌词
 *
 * @param keyword - 要检测的关键词
 * @param brandName - 品牌名称
 * @returns 是否为品牌无关词
 *
 * @example
 * isBrandIrrelevant("eureka unito", "eureka") → true (意大利语企业)
 * isBrandIrrelevant("eureka gmbh", "eureka") → true (德语企业)
 * isBrandIrrelevant("eureka security camera", "eureka") → false (包含品牌词)
 * isBrandIrrelevant("eureka unito") → true (无品牌名时只检查公司后缀)
 */
export function isBrandIrrelevant(keyword: string, brandName?: string): boolean {
  if (!keyword) return false

  const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []

  // 如果提供了品牌名，检查关键词是否包含品牌词
  // 如果不包含品牌词，不认为是品牌无关（完全不相关）
  if (pureBrandKeywords.length > 0 && !containsPureBrand(keyword, pureBrandKeywords)) {
    return false
  }

  // 检查是否匹配任一品牌无关模式
  return BRAND_IRRELEVANT_PATTERNS.some(pattern => pattern.test(keyword))
}

/**
 * 获取匹配的品牌无关词模式
 *
 * @param keyword - 要检测的关键词
 * @returns 匹配的模式（如果没有匹配返回null）
 */
export function getMatchedIrrelevantPattern(keyword: string): string | null {
  if (!keyword) return null

  for (const pattern of BRAND_IRRELEVANT_PATTERNS) {
    const match = keyword.match(pattern)
    if (match) {
      return match[0] || pattern.source
    }
  }

  return null
}

// ============================================
// 语义查询词检测
// ============================================

/**
 * 检测是否为语义查询词
 *
 * @param keyword - 关键词
 * @returns 是否为语义查询词
 */
export function isSemanticQuery(keyword: string): boolean {
  if (!keyword) return false

  const normalized = keyword.toLowerCase()

  // 检查是否匹配任一语义查询模式
  return SEMANTIC_QUERY_PATTERNS.some(pattern => {
    // 完整词匹配或边界匹配
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    return regex.test(normalized)
  })
}

/**
 * 检查关键词中是否包含需要过滤的模式
 *
 * @param keyword - 关键词
 * @returns 匹配的过滤模式（如果没有匹配返回null）
 */
export function getMatchedFilterPattern(keyword: string): string | null {
  if (!keyword) return null

  const normalized = keyword.toLowerCase()

  for (const pattern of SEMANTIC_QUERY_PATTERNS) {
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    if (regex.test(normalized)) {
      return pattern
    }
  }

  return null
}

function getLowIntentSupportReason(keyword: string): string | null {
  if (!keyword) return null

  for (const rule of LOW_INTENT_SUPPORT_PATTERNS) {
    if (rule.pattern.test(keyword)) {
      return `低意图支持查询词: "${keyword}" (${rule.label})`
    }
  }

  return null
}

const WEAK_TRAILING_FRAGMENT_TOKENS = new Set([
  'there',
  'was',
  'were',
  'being',
  'been',
  'featuring',
  'feature',
  'features',
  'including',
  'include',
  'includes',
])

const TRAILING_BRIDGE_FRAGMENT_TOKENS = new Set([
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'to',
  'with',
  'without',
  'and',
  'or',
])

const TRAILING_BRIDGE_ALLOWED_BIGRAMS = new Set([
  'check in',
  'log in',
  'sign in',
])

const SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS = new Set([
  'gen',
  'mark',
  'mk',
  'series',
  'ver',
  'version',
])

function getWeakTrailingFragmentReason(keyword: string, pureBrandKeywords: string[]): string | null {
  if (!keyword) return null

  const brandTokens = new Set(
    pureBrandKeywords.flatMap((brand) => normalizeRelevanceTokens(brand))
  )
  const residualTokens = normalizeKeywordWords(keyword)
    .map(token => normalizeRelevanceToken(token))
    .filter(Boolean)
    .filter(token => !brandTokens.has(token))

  if (residualTokens.length === 0 || residualTokens.length > 2) return null
  if (!residualTokens.every(token => WEAK_TRAILING_FRAGMENT_TOKENS.has(token))) return null

  return `弱语义残片词: "${keyword}"`
}

function getTrailingBridgeFragmentReason(keyword: string): string | null {
  const words = normalizeKeywordWords(keyword)
  if (words.length < 2) return null

  const lastToken = words[words.length - 1] || ''
  if (!TRAILING_BRIDGE_FRAGMENT_TOKENS.has(lastToken)) return null

  const lastBigram = words.slice(-2).join(' ')
  if (TRAILING_BRIDGE_ALLOWED_BIGRAMS.has(lastBigram)) return null

  return `尾部连接残片词: "${keyword}"`
}

function getBrandShortNumericFragmentReason(params: {
  keyword: string
  sourceType?: string
  pureBrandKeywords: string[]
}): string | null {
  const sourceType = String(params.sourceType || '').trim().toUpperCase()
  if (sourceType !== 'BUILDER_NON_EMPTY_RESCUE') return null

  const words = normalizeKeywordWords(params.keyword)
  if (words.length !== 2) return null
  if (!/^\d{1,2}$/.test(words[1] || '')) return null
  if (!containsPureBrand(params.keyword, params.pureBrandKeywords)) return null

  return `品牌短数字残片词: "${params.keyword}"`
}

function getTrailingShortNumericFragmentReason(params: {
  keyword: string
  sourceType?: string
}): string | null {
  const sourceType = String(params.sourceType || '').trim().toUpperCase()
  if (sourceType !== 'BUILDER_NON_EMPTY_RESCUE') return null

  const words = normalizeKeywordWords(params.keyword)
  if (words.length < 3) return null

  const lastToken = words[words.length - 1] || ''
  if (!/^\d{1,2}$/.test(lastToken)) return null

  const penultimateToken = words[words.length - 2] || ''
  if (SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS.has(penultimateToken)) return null

  const hasPriorNumericAnchor = words
    .slice(0, -1)
    .some(word => /\d/.test(word) && !/^\d{1,2}$/.test(word))
  if (!hasPriorNumericAnchor) return null

  return `尾部短数字残片词: "${params.keyword}"`
}

// ============================================
// 低意图关键词过滤（🔥 2025-12-29 新增）
// ============================================

/**
 * 过滤低购买意图关键词
 *
 * 低意图关键词特征：
 * - 信息查询类（what is, how to, meaning...）
 * - 评测比较类（review, comparison, versus...）
 * - 免费/二手类（free, used, repair...）
 *
 * @param keywords - 关键词数组
 * @returns 过滤后的关键词
 *
 * @example
 * filterLowIntentKeywords(['what is eufy', 'eufy camera price']) → ['eufy camera price']
 */
export function filterLowIntentKeywords(keywords: string[]): string[] {
  if (!keywords || keywords.length === 0) return []

  return keywords.filter(kw => {
    const lowerKw = kw.toLowerCase()

    // 跳过空字符串
    if (!lowerKw.trim()) return false

    // 检查是否匹配低意图模式
    for (const pattern of SEMANTIC_QUERY_PATTERNS) {
      if (lowerKw.includes(pattern.toLowerCase())) {
        return false
      }
    }

    return true
  })
}

const COUNTRY_CODE_ALIASES: Record<string, string[]> = {
  GB: ['uk', 'united kingdom', 'great britain', 'britain', 'england'],
  US: ['usa', 'united states', 'united states of america', 'america'],
  CA: ['canada'],
  AU: ['australia'],
  DE: ['germany', 'deutschland'],
  FR: ['france'],
  IT: ['italy'],
  ES: ['spain'],
  MX: ['mexico'],
  IN: ['india'],
  PK: ['pakistan'],
  BD: ['bangladesh'],
  JP: ['japan'],
  KR: ['korea', 'south korea'],
  BR: ['brazil'],
  TR: ['turkey'],
  ID: ['indonesia'],
  MY: ['malaysia'],
  TH: ['thailand'],
  VN: ['vietnam'],
  PH: ['philippines'],
  SG: ['singapore'],
  HK: ['hong kong'],
  TW: ['taiwan'],
  CN: ['china'],
  RU: ['russia'],
  AE: ['uae', 'united arab emirates'],
  SA: ['saudi arabia'],
}

const COUNTRY_CODE_EQUIVALENTS: Record<string, string[]> = {
  GB: ['GB', 'UK'],
  UK: ['GB', 'UK'],
}

function normalizeGeoCountryCode(value: string | undefined | null): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return ''
  if (normalized === 'UK') return 'GB'
  return normalized
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildCountryAliasPattern(alias: string): RegExp {
  const escaped = escapeRegExp(alias.trim()).replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

function detectKeywordCountryHints(keyword: string): string[] {
  const text = String(keyword || '').trim().toLowerCase()
  if (!text) return []

  const detected: string[] = []
  for (const [countryCode, aliases] of Object.entries(COUNTRY_CODE_ALIASES)) {
    if (aliases.some((alias) => buildCountryAliasPattern(alias).test(text))) {
      detected.push(countryCode)
    }
  }

  return detected
}

function resolveGeoMismatch(params: {
  keyword: string
  targetCountry?: string
}): {
  mismatch: boolean
  detectedCountries: string[]
  targetCountryCode: string
} {
  const targetCountryCode = normalizeGeoCountryCode(params.targetCountry)
  if (!targetCountryCode) {
    return { mismatch: false, detectedCountries: [], targetCountryCode }
  }

  const detectedCountries = detectKeywordCountryHints(params.keyword)
  if (detectedCountries.length === 0) {
    return { mismatch: false, detectedCountries, targetCountryCode }
  }

  const accepted = new Set([
    targetCountryCode,
    ...(COUNTRY_CODE_EQUIVALENTS[targetCountryCode] || []),
  ])
  const mismatch = detectedCountries.some((code) => !accepted.has(code))
  return { mismatch, detectedCountries, targetCountryCode }
}

/**
 * 过滤地理不匹配关键词（🔥 2025-12-29 新增）
 *
 * @param keywords - 关键词数组
 * @param targetCountry - 目标国家
 * @returns 过滤后的关键词
 */
export function filterMismatchedGeoKeywords(keywords: string[], _targetCountry: string): string[] {
  const targetCountryCode = normalizeGeoCountryCode(_targetCountry)
  if (!targetCountryCode) return keywords
  if (!keywords || keywords.length === 0) return []
  return keywords.filter((kw) => {
    const keyword = String(kw || '').trim()
    if (!keyword) return false
    return !resolveGeoMismatch({
      keyword,
      targetCountry: targetCountryCode,
    }).mismatch
  })
}

// ============================================
// 搜索量阈值计算（🔥 2025-12-29 新增）
// ============================================

/**
 * 计算搜索量阈值
 *
 * 阈值计算逻辑：
 * - 如果有足够数据（>=5个关键词），取中位数的10%作为阈值
 * - 如果数据不足，返回最小阈值50
 * - 如果所有搜索量都很低（最大值<500），阈值设为0（不过滤）
 *
 * @param searchVolumes - 搜索量数组
 * @param minThreshold - 最小阈值（默认50）
 * @returns 计算后的阈值
 */
export function calculateSearchVolumeThreshold(
  searchVolumes: number[],
  minThreshold: number = 50
): number {
  if (!searchVolumes || searchVolumes.length === 0) {
    return 0
  }

  // 过滤掉0值
  const validVolumes = searchVolumes.filter(v => v > 0)

  if (validVolumes.length === 0) {
    return 0
  }

  // 如果最大值很小（<500），不设置阈值
  const maxVolume = Math.max(...validVolumes)
  if (maxVolume < 500) {
    return 0
  }

  // 计算中位数
  const sorted = [...validVolumes].sort((a, b) => a - b)
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  // 阈值 = 中位数的10%
  const threshold = Math.floor(median * 0.1)

  // 返回最大值（阈值和最小阈值比较）
  return Math.max(threshold, minThreshold)
}

// ============================================
// 主过滤函数
// ============================================

/**
 * 关键词质量过滤选项（🔥 2025-12-29 更新）
 */
export interface KeywordQualityFilterOptions {
  brandName: string
  category?: string
  productName?: string
  targetCountry?: string
  targetLanguage?: string
  minWordCount?: number  // 最少单词数
  maxWordCount?: number  // 最多单词数
  productUrl?: string  // 🔥 新增：产品URL，用于平台冲突检测
  /**
   * 是否必须包含纯品牌词
   * @default true
   */
  mustContainBrand?: boolean
  /**
   * 允许来自 Keyword Planner 的非品牌词通过品牌门禁
   * 仅在品牌词过于宽泛或店铺页需要更广泛覆盖时使用
   * @default false
   */
  allowNonBrandFromPlanner?: boolean | PlannerNonBrandPolicy
  /**
   * 与商品/品类相关性过滤（防歧义品牌误入无关主题）
   * - 当品牌词有歧义（如 "Rove"）时，Keyword Planner 可能返回包含品牌但主题无关的关键词（如 rove beetle, rove concept）。
   * - 启用后：除“纯品牌词”/“型号词”外，关键词必须命中至少 N 个来自 category/productName 的 token 才保留。
   *
   * @default 0 (关闭)
   */
  minContextTokenMatches?: number
  /**
   * 相关性不匹配处理方式
   * hard: 直接过滤
   * soft: 不直接过滤，只在评分中降级
   *
   * @default 'hard'
   */
  contextMismatchMode?: 'hard' | 'soft'
}

const RELEVANCE_PHRASE_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  // Normalize common multi-word product forms to a single token to improve context matching.
  { pattern: /\brobot(?:ic)?\s+vacuum(?:s)?\b/giu, replacement: ' vacuum ' },
  { pattern: /\brobo[\s-]?vac(?:s)?\b/giu, replacement: ' vacuum ' },
  { pattern: /\bsound[\s-]?bar(?:s)?\b/giu, replacement: ' speaker ' },
  { pattern: /\bdash[\s-]?cam(?:s)?\b/giu, replacement: ' camera ' },
  { pattern: /\bpower[\s-]?bank(?:s)?\b/giu, replacement: ' powerbank ' },
]

const RELEVANCE_TOKEN_EQUIVALENCE_GROUPS: string[][] = [
  ['audio', 'speaker', 'speakers', 'soundbar', 'soundbars', 'subwoofer', 'subwoofers', 'stereo', 'homeaudio', 'loudspeaker', 'loudspeakers', 'amp', 'amps', 'amplifier', 'amplifiers', 'receiver', 'receivers', 'headphone', 'headphones', 'earbud', 'earbuds'],
  ['vacuum', 'vacuums', 'robovac', 'robovacs', 'robotvacuum', 'roboticvacuum'],
  ['charge', 'charger', 'chargers', 'charging', 'charged', 'adapter', 'adapters', 'powerbank', 'powerbanks'],
  ['camera', 'cameras', 'cam', 'cams', 'dashcam', 'dashcams', 'dashcamera', 'dashcameras'],
]

const RELEVANCE_TOKEN_CANONICAL_MAP = new Map<string, string>()
for (const group of RELEVANCE_TOKEN_EQUIVALENCE_GROUPS) {
  const canonical = group[0]
  for (const alias of group) {
    RELEVANCE_TOKEN_CANONICAL_MAP.set(alias, canonical)
  }
}

const COMMERCIAL_CONTEXT_SIGNAL_TOKENS = new Set([
  ...PRODUCT_WORD_PATTERNS,
  'speaker',
  'soundbar',
  'audio',
  'vacuum',
  'robovac',
  'charger',
  'charge',
  'adapter',
  'camera',
  'timer',
  'controller',
  'furniture',
  'mattress',
  'desk',
  'chair',
  'table',
  'sofa',
  'dresser',
  'frame',
  'trundle',
  'bunk',
])

const CONTEXT_PLACEHOLDER_PHRASES = new Set([
  'data not available',
  'not available',
  'unknown',
  'n a',
  'na',
  'none',
  'null',
  'no data',
  'not applicable',
])

const GENERIC_MARKETPLACE_TAXONOMY_TOKENS = new Set([
  'home',
  'kitchen',
  'bedroom',
  'department',
  'departments',
  'product',
  'products',
  'detail',
  'details',
  'seller',
  'sellers',
  'rank',
  'ranking',
  'top',
  'see',
])

const BROAD_CONTEXT_MATCH_TOKENS = new Set([
  'bed',
  'office',
  'room',
  'rooms',
])

const CONTEXT_MATCH_BRIDGE_RULES: Array<{
  targetToken: string
  contextFamily: Set<string>
}> = [
  {
    targetToken: 'furniture',
    contextFamily: new Set([
      'bed',
      'beds',
      'frame',
      'frames',
      'bunk',
      'trundle',
      'loft',
      'furniture',
    ]),
  },
]

function applyContextMatchBridgeRules(params: {
  keywordTokens: string[]
  usableContext: string[]
  matchedTokenSet: Set<string>
}): void {
  const { keywordTokens, usableContext, matchedTokenSet } = params
  if (keywordTokens.length === 0 || usableContext.length === 0) return

  for (const rule of CONTEXT_MATCH_BRIDGE_RULES) {
    if (!keywordTokens.includes(rule.targetToken)) continue
    if (!usableContext.some(token => rule.contextFamily.has(token))) continue
    matchedTokenSet.add(rule.targetToken)
  }
}

function sanitizeContextInput(input?: string): string {
  if (!input) return ''

  const normalized = input
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

  if (!normalized) return ''
  if (CONTEXT_PLACEHOLDER_PHRASES.has(normalized)) return ''
  return input
}

function normalizeRelevanceToken(token: string): string {
  const raw = (token || '').toLowerCase().trim()
  if (!raw) return ''

  const directAlias = RELEVANCE_TOKEN_CANONICAL_MAP.get(raw)
  if (directAlias) return directAlias

  let stemmed = raw
  if (stemmed.endsWith('ies') && stemmed.length > 4) {
    stemmed = `${stemmed.slice(0, -3)}y`
  } else if (stemmed.endsWith('es') && stemmed.length > 4) {
    stemmed = stemmed.slice(0, -2)
  } else if (stemmed.endsWith('s') && stemmed.length > 3 && !stemmed.endsWith('ss')) {
    stemmed = stemmed.slice(0, -1)
  }

  return RELEVANCE_TOKEN_CANONICAL_MAP.get(stemmed) || stemmed
}

function hasCommercialContextSignal(keyword: string): boolean {
  const tokens = normalizeRelevanceTokens(keyword)
  if (hasModelLikeToken(tokens)) return true
  return tokens.some(token => COMMERCIAL_CONTEXT_SIGNAL_TOKENS.has(token))
}

const CONTEXT_RESTORE_BLOCKED_PATTERNS = [
  /\b(gif|meme|emoji|sticker|drawing|image|images|logo|png|jpg|jpeg|svg|icon|clipart|wallpaper)\b/i,
  /\b(size chart|size guide|sizing)\b/i,
]

const TRANSACTIONAL_MATRIX_TOKENS = new Set([
  'buy', 'purchase', 'order', 'shop', 'price', 'pricing', 'cost',
  'deal', 'deals', 'discount', 'sale', 'offer', 'coupon', 'promo', 'store'
])

const SOURCE_TRUST_SCORE_RULES: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /^SEARCH_TERM_HIGH_PERFORMING$/i, score: 20 },
  { pattern: /^KEYWORD_PLANNER/i, score: 16 },
  { pattern: /^SEARCH_TERM_/i, score: 14 },
  { pattern: /^GOOGLE_SUGGEST$/i, score: 12 },
  { pattern: /^ENHANCED_EXTRACT$/i, score: 12 },
  { pattern: /^OFFER_EXTRACTED_KEYWORDS$/i, score: 10 },
  { pattern: /^SCORING_SUGGESTION$/i, score: 9 },
  { pattern: /^GLOBAL_CORE$/i, score: 7 },
  { pattern: /^GLOBAL_CATEGORY_BRANDED$/i, score: 6 },
  { pattern: /^GLOBAL_KEYWORDS$/i, score: 3 },
]

type ScriptFamily =
  | 'latin'
  | 'han'
  | 'hiragana'
  | 'katakana'
  | 'hangul'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'thai'

const SCRIPT_FAMILY_PATTERNS: Array<{ family: ScriptFamily; pattern: RegExp }> = [
  { family: 'latin', pattern: /[A-Za-z]/u },
  { family: 'han', pattern: /\p{Script=Han}/u },
  { family: 'hiragana', pattern: /\p{Script=Hiragana}/u },
  { family: 'katakana', pattern: /\p{Script=Katakana}/u },
  { family: 'hangul', pattern: /\p{Script=Hangul}/u },
  { family: 'cyrillic', pattern: /\p{Script=Cyrillic}/u },
  { family: 'arabic', pattern: /\p{Script=Arabic}/u },
  { family: 'hebrew', pattern: /\p{Script=Hebrew}/u },
  { family: 'thai', pattern: /\p{Script=Thai}/u },
]

const CYRILLIC_LANGUAGE_CODES = new Set(['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ky', 'uz'])
const DEFAULT_ALLOWED_SCRIPT_FAMILIES = new Set<ScriptFamily>(['latin'])
const HIGH_PERFORMING_INFO_QUERY_PATTERN = /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
const HIGH_PERFORMING_REVIEW_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs)\b/i
const HIGH_PERFORMING_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu)\b/i

function normalizeTargetLanguageCode(targetLanguage?: string): string {
  const normalized = String(targetLanguage || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (!normalized) return ''
  const base = normalized.split('-')[0]
  return base || normalized
}

function resolveAllowedScriptFamilies(targetLanguage?: string): Set<ScriptFamily> {
  const lang = normalizeTargetLanguageCode(targetLanguage)
  if (!lang) return DEFAULT_ALLOWED_SCRIPT_FAMILIES
  if (lang === 'zh') return new Set<ScriptFamily>(['han', 'latin'])
  if (lang === 'ja') return new Set<ScriptFamily>(['han', 'hiragana', 'katakana', 'latin'])
  if (lang === 'ko') return new Set<ScriptFamily>(['hangul', 'latin'])
  if (lang === 'ar') return new Set<ScriptFamily>(['arabic', 'latin'])
  if (lang === 'he') return new Set<ScriptFamily>(['hebrew', 'latin'])
  if (lang === 'th') return new Set<ScriptFamily>(['thai', 'latin'])
  if (CYRILLIC_LANGUAGE_CODES.has(lang)) return new Set<ScriptFamily>(['cyrillic', 'latin'])
  return DEFAULT_ALLOWED_SCRIPT_FAMILIES
}

function detectKeywordScriptFamilies(keyword: string): Set<ScriptFamily> {
  const families = new Set<ScriptFamily>()
  const text = String(keyword || '')
  if (!text) return families
  for (const { family, pattern } of SCRIPT_FAMILY_PATTERNS) {
    if (pattern.test(text)) families.add(family)
  }
  return families
}

function hasOnlyLatinLetters(families: Set<ScriptFamily>): boolean {
  return families.size > 0 && Array.from(families).every(family => family === 'latin')
}

function hasAnyNonLatinFamily(families: Set<ScriptFamily>): boolean {
  return Array.from(families).some(family => family !== 'latin')
}

function isLanguageScriptMismatch(params: {
  keyword: string
  targetLanguage?: string
  pureBrandKeywords: string[]
}): boolean {
  return isKeywordLanguageMismatch(params)
}

function getKeywordAnchorDistortionReason(params: {
  keyword: string
  pureBrandKeywords: string[]
  productName?: string
}): string | null {
  return getSplitAnchorDistortionReason({
    keyword: params.keyword,
    pureBrandKeywords: params.pureBrandKeywords,
    anchorTerms: buildKeywordIntegrityAnchors({
      pureBrandKeywords: params.pureBrandKeywords,
      productName: params.productName,
    }),
  })
}

function getHighPerformingHardBlockReason(params: {
  keyword: string
  brandName: string
  pureBrandKeywords: string[]
  productUrl?: string
  targetLanguage?: string
}): string | null {
  const { keyword, brandName, pureBrandKeywords, productUrl, targetLanguage } = params
  const templateGarbageReason = getTemplateGarbageReason(keyword)
  if (templateGarbageReason) {
    return templateGarbageReason
  }

  if (isBrandVariant(keyword, brandName)) {
    return `高表现Search Term命中品牌变体词: "${keyword}"`
  }

  if (isBrandIrrelevant(keyword, brandName)) {
    return `高表现Search Term命中品牌无关词: "${keyword}"`
  }

  if (productUrl && isPlatformMismatch(keyword, productUrl)) {
    return `高表现Search Term平台冲突: "${keyword}"`
  }

  if (HIGH_PERFORMING_PLATFORM_PATTERN.test(keyword)) {
    return `高表现Search Term命中平台词: "${keyword}"`
  }

  if (HIGH_PERFORMING_INFO_QUERY_PATTERN.test(keyword)) {
    return `高表现Search Term命中信息查询词: "${keyword}"`
  }

  if (HIGH_PERFORMING_REVIEW_COMPARE_PATTERN.test(keyword)) {
    return `高表现Search Term命中评测对比词: "${keyword}"`
  }

  if (isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
    return `语言脚本错配: "${keyword}"`
  }

  return null
}

function shouldBlockContextRestore(keyword: string): boolean {
  const normalized = String(keyword || '').trim().toLowerCase()
  if (!normalized) return false
  return CONTEXT_RESTORE_BLOCKED_PATTERNS.some(pattern => pattern.test(normalized))
}

function normalizeKeywordWords(keyword: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword) || String(keyword || '').toLowerCase().trim()
  if (!normalized) return []
  return normalized.split(/\s+/).filter(Boolean)
}

function findRepeatedAdjacentWord(words: string[]): string | null {
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) return words[i]
  }
  return null
}

function getTransactionalModifierHits(words: string[]): string[] {
  return words.filter(word => TRANSACTIONAL_MATRIX_TOKENS.has(word))
}

export function getTemplateGarbageReason(keyword: string): string | null {
  const words = normalizeKeywordWords(keyword)
  if (words.length === 0) return null

  if (words.some((word) => /^0{3,}\d*$/.test(word))) {
    return `模板垃圾词: 数字残片 "${keyword}"`
  }

  const repeatedWord = findRepeatedAdjacentWord(words)
  if (repeatedWord) {
    return `模板垃圾词: 连续重复词 "${repeatedWord}"`
  }

  const transactionalHits = getTransactionalModifierHits(words)
  const uniqueTransactionalHits = Array.from(new Set(transactionalHits))
  if (uniqueTransactionalHits.length >= 2) {
    return `模板垃圾词: 交易修饰词矩阵叠加 (${uniqueTransactionalHits.join('+')})`
  }

  return null
}

function normalizeRelevanceTokens(input: string): string[] {
  let normalized = (input || '').toLowerCase().normalize('NFKC')
  for (const rule of RELEVANCE_PHRASE_NORMALIZERS) {
    normalized = normalized.replace(rule.pattern, rule.replacement)
  }

  const rawTokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map(t => normalizeRelevanceToken(t))
    .filter(Boolean)

  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'by',
    'official', 'store', 'shop', 'website', 'site', 'online',
    'set', 'sets', 'pack', 'packs', 'bundle', 'bundles',
    'size', 'sizes', 'king', 'queen', 'twin', 'full', 'xl', 'california', 'cal',
    ...GENERIC_MARKETPLACE_TAXONOMY_TOKENS,
  ])

  return Array.from(
    new Set(
      rawTokens
        .filter(t => t.length >= 2) // keep short but meaningful tokens like "4k", "5g"
        .filter(t => !stop.has(t))
    )
  )
}

function getSourceTrustScore(source?: string): number {
  const normalized = String(source || '').trim()
  if (!normalized) return 5

  for (const rule of SOURCE_TRUST_SCORE_RULES) {
    if (rule.pattern.test(normalized)) return rule.score
  }

  return 5
}

function resolveKeywordDataSourceTrustScore(keywordData: PoolKeywordData): number {
  const signals = [
    keywordData.sourceSubtype,
    keywordData.sourceType,
    keywordData.source,
    keywordData.rawSource,
  ]

  let bestScore = 0
  for (const signal of signals) {
    bestScore = Math.max(bestScore, getSourceTrustScore(signal))
  }

  return bestScore
}

function computeContextMatchCount(params: {
  keywordTokens: string[]
  pureBrandKeywords: string[]
  category?: string
  productName?: string
}): number {
  const { effectiveMatchCount } = computeContextMatchDetails(params)
  return effectiveMatchCount
}

function computeContextMatchDetails(params: {
  keywordTokens: string[]
  pureBrandKeywords: string[]
  category?: string
  productName?: string
}): {
  usableContext: string[]
  matchedTokens: string[]
  specificMatchedTokens: string[]
  effectiveMatchCount: number
} {
  const { keywordTokens, pureBrandKeywords, category, productName } = params
  const safeCategory = sanitizeContextInput(category)
  const safeProductName = sanitizeContextInput(productName)
  const contextTokens = [
    ...normalizeRelevanceTokens(safeCategory),
    ...normalizeRelevanceTokens(safeProductName),
  ]

  const brandTokens = new Set(
    pureBrandKeywords.flatMap(b => normalizeRelevanceTokens(b))
  )
  const usableContext = Array.from(new Set(contextTokens)).filter(t => !brandTokens.has(t))
  if (usableContext.length === 0) {
    return {
      usableContext: [],
      matchedTokens: [],
      specificMatchedTokens: [],
      effectiveMatchCount: 0,
    }
  }

  const contextSet = new Set(usableContext)
  const matchedTokenSet = new Set(keywordTokens.filter(t => contextSet.has(t)))
  applyContextMatchBridgeRules({
    keywordTokens,
    usableContext,
    matchedTokenSet,
  })
  const matchedTokens = Array.from(matchedTokenSet)
  const specificMatchedTokens = matchedTokens.filter(t => !BROAD_CONTEXT_MATCH_TOKENS.has(t))

  return {
    usableContext,
    matchedTokens,
    specificMatchedTokens,
    effectiveMatchCount: specificMatchedTokens.length > 0 ? matchedTokens.length : 0,
  }
}

function inferQualityTier(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 70) return 'HIGH'
  if (score >= 45) return 'MEDIUM'
  return 'LOW'
}

function computeKeywordRelevanceScore(params: {
  keyword: string
  source?: string
  pureBrandKeywords: string[]
  category?: string
  productName?: string
  relevance: { ok: boolean; mode: RelevanceMode; keywordTokens?: string[] }
}): number {
  const { keyword, source, pureBrandKeywords, category, productName, relevance } = params
  const keywordTokens = relevance.keywordTokens || normalizeRelevanceTokens(keyword)
  const words = normalizeKeywordWords(keyword)
  const repeatedWord = findRepeatedAdjacentWord(words)
  const transactionalHits = getTransactionalModifierHits(words)
  const uniqueTransactionalHits = new Set(transactionalHits).size

  let score = 35

  if (containsPureBrand(keyword, pureBrandKeywords)) {
    score += 25
  }

  if (relevance.mode === 'pure_brand') {
    score += 15
  } else {
    const contextMatchCount = computeContextMatchCount({
      keywordTokens,
      pureBrandKeywords,
      category,
      productName,
    })

    if (contextMatchCount >= 2) {
      score += 18
    } else if (contextMatchCount === 1) {
      score += 10
    } else if (relevance.mode === 'context_mismatch') {
      score -= 15
    } else {
      score -= 6
    }
  }

  score += getSourceTrustScore(source)

  if (repeatedWord) score -= 40
  if (uniqueTransactionalHits >= 2) score -= 24
  if (keywordTokens.length === 0 || keywordTokens.length > 8) score -= 6
  if (hasModelLikeToken(keywordTokens)) score += 4

  return Math.max(0, Math.min(100, score))
}

function hasModelLikeToken(keywordTokens: string[]): boolean {
  for (const token of keywordTokens) {
    if (!token) continue

    // Exclude pure years (e.g. 2024)
    if (/^\d{4}$/.test(token)) {
      const year = Number(token)
      if (year >= 1990 && year <= 2100) continue
    }

    // alpha-numeric mix (e.g. r2, r2-4k -> r2 + 4k)
    if (/[a-z]/i.test(token) && /\d/.test(token)) return true

    // numeric + unit letters (e.g. 2160p, 4k, 5g)
    if (/^\d{1,5}[a-z]{1,2}$/i.test(token)) return true
  }
  return false
}

type RelevanceMode =
  | 'disabled'
  | 'pure_brand'
  | 'model_like'
  | 'insufficient_context'
  | 'context_match'
  | 'context_mismatch'

function isRelevantToOfferContext(params: {
  keyword: string
  pureBrandKeywords: string[]
  category?: string
  productName?: string
  minContextTokenMatches: number
}): { ok: boolean; reason?: string; mode: RelevanceMode; keywordTokens?: string[] } {
  const { keyword, pureBrandKeywords, category, productName, minContextTokenMatches } = params

  if (minContextTokenMatches <= 0) return { ok: true, mode: 'disabled' }

  // Pure brand keywords are always allowed (used for brand campaigns / navigation intent).
  if (isPureBrandKeyword(keyword, pureBrandKeywords)) return { ok: true, mode: 'pure_brand' }

  const keywordTokens = normalizeRelevanceTokens(keyword)
  if (hasModelLikeToken(keywordTokens)) return { ok: true, mode: 'model_like', keywordTokens }

  const safeCategory = sanitizeContextInput(category)
  const safeProductName = sanitizeContextInput(productName)
  const contextTokens = [
    ...normalizeRelevanceTokens(safeCategory),
    ...normalizeRelevanceTokens(safeProductName),
  ]

  // Remove brand tokens from context to avoid tautology ("rove ..." always matches).
  const brandTokens = new Set(
    pureBrandKeywords.flatMap(b => normalizeRelevanceTokens(b))
  )
  const usableContext = Array.from(new Set(contextTokens)).filter(t => !brandTokens.has(t))

  // If we don't have enough context to judge, don't filter to avoid false positives.
  if (usableContext.length < 3) return { ok: true, mode: 'insufficient_context', keywordTokens }

  const { effectiveMatchCount: matchCount } = computeContextMatchDetails({
    keywordTokens,
    pureBrandKeywords,
    category,
    productName,
  })

  if (matchCount >= minContextTokenMatches) return { ok: true, mode: 'context_match', keywordTokens }
  return { ok: false, mode: 'context_mismatch', reason: `与商品无关: "${keyword}" (未命中品类/商品token)`, keywordTokens }
}

/**
 * 过滤低质量关键词（🔥 2025-12-29 增强）
 *
 * @param keywords - 关键词数组（PoolKeywordData[]）
 * @param options - 过滤选项
 * @returns 过滤后的关键词和被过滤的关键词
 */
export function filterKeywordQuality(
  keywords: PoolKeywordData[],
  options: KeywordQualityFilterOptions
): {
  filtered: PoolKeywordData[]
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
} {
  const {
    brandName,
    category,
    productName,
    targetCountry,
    targetLanguage,
    minWordCount = 1,
    maxWordCount = 8,
    mustContainBrand = false,
    allowNonBrandFromPlanner = false,
    productUrl,  // 🔥 新增：用于平台冲突检测
    minContextTokenMatches = 0,
    contextMismatchMode = 'hard',
  } = options

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const brandContextTokens = new Set(
    pureBrandKeywords.flatMap(b => normalizeRelevanceTokens(b))
  )
  const plannerNonBrandPolicy = normalizePlannerNonBrandPolicy(allowNonBrandFromPlanner)
  const contextSupportTokenCounts = new Map<string, number>()
  const removed: Array<{ keyword: PoolKeywordData; reason: string }> = []
  const filtered: PoolKeywordData[] = []

  for (const kw of keywords) {
    const keywordData: PoolKeywordData = typeof kw === 'string'
      ? { keyword: kw, searchVolume: 0, source: 'FILTERED' }
      : kw
    const keyword = keywordData.keyword
    const searchVolume = typeof keywordData.searchVolume === 'number'
      ? keywordData.searchVolume
      : Number(keywordData.searchVolume) || 0
    const wordCount = keyword.trim().split(/\s+/).length
    const isConcatenatedBrandWithVolume = searchVolume > 0 && isBrandConcatenation(keyword, brandName)
    const allowPlannerNonBrand = shouldAllowPlannerNonBrandKeyword(keywordData, plannerNonBrandPolicy)

    // 🆕 高性能搜索词豁免：基于真实表现数据，跳过质量过滤
    const isHighPerformingSearchTerm = typeof keywordData.source === 'string' && keywordData.source === 'SEARCH_TERM_HIGH_PERFORMING'

    // 🆕 2026-03-13: 评分建议关键词豁免：基于AI评分分析识别的行业标准关键词
    const isScoringGapKeyword = typeof keywordData.source === 'string' && keywordData.source === 'SCORING_SUGGESTION'

    let removeReason: string | null = null

    // 高性能搜索词优先保留，但仍需通过硬风险门禁（防止劣化污染）
    if (isHighPerformingSearchTerm) {
      if (mustContainBrand && !shouldKeepByBrand(keyword, pureBrandKeywords) && !isConcatenatedBrandWithVolume) {
        removeReason = `高表现Search Term不含品牌词: "${keyword}"`
      } else {
        const hardBlockReason = getHighPerformingHardBlockReason({
          keyword,
          brandName,
          pureBrandKeywords,
          productUrl,
          targetLanguage,
        })
        if (!hardBlockReason) {
          filtered.push({
            ...keywordData,
            relevanceScore: 95,
            qualityTier: 'HIGH',
          })
          continue
        }
        removeReason = hardBlockReason
      }
    }

    // 🔥 修复(2026-03-13): 评分建议关键词保留品牌包含检查（防御性编程）
    // 虽然品牌化处理已确保包含品牌，但作为最后一道防线仍需检查
    if (isScoringGapKeyword) {
      // 🛡️ 防御性检查：确保品牌化处理成功
      if (mustContainBrand && !shouldKeepByBrand(keyword, pureBrandKeywords)) {
        removeReason = `SCORING_SUGGESTION 不含品牌词（品牌化失败）: "${keyword}"`
      } else if (isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
        removeReason = `SCORING_SUGGESTION 语言脚本错配: "${keyword}"`
      } else {
        // 通过品牌检查，豁免其他质量过滤
        const relevance = isRelevantToOfferContext({
          keyword,
          pureBrandKeywords,
          category,
          productName,
          minContextTokenMatches,
        })
        const relevanceScore = Math.max(
          80,
          computeKeywordRelevanceScore({
            keyword,
            source: keywordData.source,
            pureBrandKeywords,
            category,
            productName,
            relevance,
          })
        )
        filtered.push({
          ...keywordData,
          relevanceScore,
          qualityTier: inferQualityTier(relevanceScore),
        })
        continue
      }
    }

    const templateGarbageReason = getTemplateGarbageReason(keyword)
    const geoMismatch = targetCountry
      ? resolveGeoMismatch({
        keyword,
        targetCountry,
      })
      : null

    // A. 仅硬过滤明显模板垃圾词（重复词 / 交易词矩阵）
    if (templateGarbageReason) {
      removeReason = templateGarbageReason
    }
    // 🔧 修复(2026-01-21): 过滤搜索量为0且来源为CLUSTERED的关键词
    // 这些是模板化生成的关键词，没有真实搜索量
    // 注意：isPureBrand 标记的纯品牌词豁免此过滤（品牌词可能搜索量为0但仍需保留）
    else if (keywordData.searchVolume === 0 && keywordData.source === 'CLUSTERED' && !keywordData.isPureBrand) {
      removeReason = `无搜索量的模板化关键词: "${keyword}" (source: CLUSTERED)`
    }
    // 1. 检查是否必须包含纯品牌词（使用策略函数）
    // 🔥 2026-01-05 使用 shouldKeepByBrand 策略函数，明确用途
    else if (mustContainBrand && !shouldKeepByBrand(keyword, pureBrandKeywords) && !isConcatenatedBrandWithVolume && !allowPlannerNonBrand) {
      removeReason = `不含纯品牌词: "${keyword}"`
    }
    // 2. 检查品牌变体词
    else if (isBrandVariant(keyword, brandName) && !isConcatenatedBrandWithVolume) {
      removeReason = `品牌变体词: "${keyword}"`
    }
    // 3. 检查品牌无关词（🔥 2025-12-29 新增）
    else if (isBrandIrrelevant(keyword, brandName)) {
      const pattern = getMatchedIrrelevantPattern(keyword)
      removeReason = pattern
        ? `品牌无关词: "${keyword}" (包含: ${pattern})`
        : `品牌无关词: "${keyword}"`
    }
    // 4. 🔥 新增：检查平台冲突（2025-12-29）
    else if (productUrl && isPlatformMismatch(keyword, productUrl)) {
      const urlPlatform = extractPlatformFromUrl(productUrl)
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      removeReason = `平台冲突: "${keyword}" (包含 ${kwPlatforms.join('/')}，但URL是 ${urlPlatform})`
    }
    // 5. 目标国家不匹配（仅当关键词出现明确国家词时触发）
    else if (geoMismatch?.mismatch) {
      removeReason = `国家不匹配: "${keyword}" (包含 ${geoMismatch.detectedCountries.join('/')}，目标 ${geoMismatch.targetCountryCode})`
    }
    // 5. 检查语义查询词（🔥 2025-12-29 优化：如果关键词平台与URL平台匹配，允许通过）
    else if (isSemanticQuery(keyword)) {
      // 🔥 特殊处理：如果关键词包含的平台名与URL平台匹配，则不过滤
      // 例如：对于Amazon URL，"anker amazon"应该被保留而不是被语义查询词过滤
      const urlPlatform = productUrl ? extractPlatformFromUrl(productUrl) : null
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      const isMatchingPlatform = urlPlatform && kwPlatforms.length > 0 && kwPlatforms.includes(urlPlatform)

      if (!isMatchingPlatform) {
        const pattern = getMatchedFilterPattern(keyword)
        removeReason = pattern
          ? `语义查询词: "${keyword}" (包含: ${pattern})`
          : `语义查询词: "${keyword}"`
      }
    }
    else {
      const lowIntentSupportReason = getLowIntentSupportReason(keyword)
      if (lowIntentSupportReason) {
        removeReason = lowIntentSupportReason
      } else {
        const weakTrailingFragmentReason = getWeakTrailingFragmentReason(keyword, pureBrandKeywords)
        if (weakTrailingFragmentReason) {
          removeReason = weakTrailingFragmentReason
        } else {
          const trailingBridgeFragmentReason = getTrailingBridgeFragmentReason(keyword)
          if (trailingBridgeFragmentReason) {
            removeReason = trailingBridgeFragmentReason
          } else {
            const brandShortNumericFragmentReason = getBrandShortNumericFragmentReason({
              keyword,
              sourceType: keywordData.sourceType,
              pureBrandKeywords,
            })
            if (brandShortNumericFragmentReason) {
              removeReason = brandShortNumericFragmentReason
            } else {
              const trailingShortNumericFragmentReason = getTrailingShortNumericFragmentReason({
                keyword,
                sourceType: keywordData.sourceType,
              })
              if (trailingShortNumericFragmentReason) {
                removeReason = trailingShortNumericFragmentReason
              } else {
                const keywordAnchorDistortionReason = getKeywordAnchorDistortionReason({
                  keyword,
                  pureBrandKeywords,
                  productName,
                })
                if (keywordAnchorDistortionReason) {
                  removeReason = keywordAnchorDistortionReason
                }
              }
            }
          }
        }
      }
    }
    // 6. 语言脚本错配（避免非目标脚本关键词污染）
    if (!removeReason && isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
      removeReason = `语言脚本错配: "${keyword}"`
    }
    // 6. 检查单词数
    else if (!removeReason && (wordCount < minWordCount || wordCount > maxWordCount)) {
      removeReason = `单词数不匹配: ${wordCount} (范围: ${minWordCount}-${maxWordCount})`
    }
    // 7. 与商品/品类相关性过滤（可选，避免歧义品牌误入无关主题）
    else if (!removeReason) {
      const relevance = isRelevantToOfferContext({
        keyword,
        pureBrandKeywords,
        category,
        productName,
        minContextTokenMatches,
      })
      if (!relevance.ok && contextMismatchMode === 'hard') {
        removeReason = relevance.reason || `与商品无关: "${keyword}"`
      } else if (relevance.mode === 'context_match' && contextMismatchMode === 'hard') {
        const nonBrandTokens = (relevance.keywordTokens || normalizeRelevanceTokens(keyword))
          .filter(token => !brandContextTokens.has(token))
        for (const token of new Set(nonBrandTokens)) {
          contextSupportTokenCounts.set(token, (contextSupportTokenCounts.get(token) || 0) + 1)
        }
      }
    }

    if (removeReason) {
      removed.push({ keyword: keywordData, reason: removeReason })
    } else {
      const relevance = isRelevantToOfferContext({
        keyword,
        pureBrandKeywords,
        category,
        productName,
        minContextTokenMatches,
      })
      const relevanceScore = computeKeywordRelevanceScore({
        keyword,
        source: keywordData.source,
        pureBrandKeywords,
        category,
        productName,
        relevance,
      })
      filtered.push({
        ...keywordData,
        relevanceScore,
        qualityTier: inferQualityTier(relevanceScore),
      })
    }
  }

  if (contextMismatchMode === 'hard' && minContextTokenMatches > 0 && contextSupportTokenCounts.size > 0) {
    const supportRestores = removed.filter(item => {
      if (!item.reason.includes('与商品无关')) return false

      const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      if (!shouldKeepByBrand(text, pureBrandKeywords) || isPureBrandKeyword(text, pureBrandKeywords)) return false
      if (shouldBlockContextRestore(text)) return false

      const nonBrandTokens = normalizeRelevanceTokens(text).filter(token => !brandContextTokens.has(token))
      if (nonBrandTokens.length === 0 || nonBrandTokens.length > 2) return false

      if (nonBrandTokens.length === 1) {
        return (contextSupportTokenCounts.get(nonBrandTokens[0]) || 0) >= 2
      }

      return nonBrandTokens.every(token => (contextSupportTokenCounts.get(token) || 0) >= 2)
    })

    supportRestores.sort((a, b) => {
      const aVol = typeof a.keyword === 'string' ? 0 : (Number(a.keyword.searchVolume) || 0)
      const bVol = typeof b.keyword === 'string' ? 0 : (Number(b.keyword.searchVolume) || 0)
      return bVol - aVol
    })

    for (const item of supportRestores) {
      const restoredKeyword = typeof item.keyword === 'string'
        ? { keyword: item.keyword, searchVolume: 0, source: 'FILTERED' }
        : item.keyword
      filtered.push(restoredKeyword)

      const index = removed.indexOf(item)
      if (index >= 0) removed.splice(index, 1)
    }
  }

  if (contextMismatchMode === 'hard' && minContextTokenMatches > 0) {
    let contextMismatchSafetyRestoreApplied = false
    const keptContextCandidates = filtered.filter(item =>
      shouldKeepByBrand(item.keyword, pureBrandKeywords) && !isPureBrandKeyword(item.keyword, pureBrandKeywords)
    )
    const contextRemovedCandidates = removed.filter(item => {
      const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      return item.reason.includes('与商品无关')
        && shouldKeepByBrand(text, pureBrandKeywords)
        && !isPureBrandKeyword(text, pureBrandKeywords)
    })

    const totalContextCandidates = keptContextCandidates.length + contextRemovedCandidates.length
    const removedRatio = totalContextCandidates > 0
      ? contextRemovedCandidates.length / totalContextCandidates
      : 0

    // Safety net: if context gate removes almost all brand-containing candidates,
    // restore a tiny number of strongest commercial-intent terms.
    if (
      totalContextCandidates >= 4
      && keptContextCandidates.length === 0
      && contextRemovedCandidates.length >= 3
      && removedRatio >= 0.85
    ) {
      const restoreLimit = Math.min(2, Math.max(1, Math.floor(contextRemovedCandidates.length * 0.2)))
      const restoreCandidates = contextRemovedCandidates
        .filter(item => {
          const text = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
          return hasCommercialContextSignal(text) && !shouldBlockContextRestore(text)
        })
        .sort((a, b) => {
          const aVol = typeof a.keyword === 'string' ? 0 : (Number(a.keyword.searchVolume) || 0)
          const bVol = typeof b.keyword === 'string' ? 0 : (Number(b.keyword.searchVolume) || 0)
          return bVol - aVol
        })
        .slice(0, restoreLimit)

      for (const item of restoreCandidates) {
        const restoredKeyword = typeof item.keyword === 'string'
          ? { keyword: item.keyword, searchVolume: 0, source: 'FILTERED' }
          : item.keyword
        filtered.push(restoredKeyword)

        const index = removed.indexOf(item)
        if (index >= 0) removed.splice(index, 1)
      }
      if (restoreCandidates.length > 0) {
        contextMismatchSafetyRestoreApplied = true
      }
    }

    const contextRemovedAllCandidates = removed.filter(item => item.reason.includes('与商品无关'))
    const contextRemovedAllRatio = (
      contextRemovedAllCandidates.length + filtered.length > 0
        ? contextRemovedAllCandidates.length / (contextRemovedAllCandidates.length + filtered.length)
        : 0
    )
    if (
      !contextMismatchSafetyRestoreApplied
      &&
      contextRemovedAllCandidates.length >= 3
      && contextRemovedAllRatio >= 0.6
    ) {
      const existingFilteredKeys = new Set(
        filtered.map(item => normalizeGoogleAdsKeyword(item.keyword) || item.keyword.toLowerCase().trim())
      )
      const trustedContextRestoreCandidates = contextRemovedAllCandidates
        .map((item) => {
          const keywordData = typeof item.keyword === 'string'
            ? { keyword: item.keyword, searchVolume: 0, source: 'FILTERED' } as PoolKeywordData
            : item.keyword
          const text = keywordData.keyword
          if (shouldBlockContextRestore(text)) return null
          if (!hasCommercialContextSignal(text)) return null
          if (isPureBrandKeyword(text, pureBrandKeywords)) return null

          const sourceTrustScore = resolveKeywordDataSourceTrustScore(keywordData)
          if (sourceTrustScore < 12) return null

          return {
            item,
            keywordData,
            sourceTrustScore,
          }
        })
        .filter((entry): entry is {
          item: { keyword: PoolKeywordData; reason: string }
          keywordData: PoolKeywordData
          sourceTrustScore: number
        } => entry !== null)
        .sort((a, b) => {
          const trustDiff = b.sourceTrustScore - a.sourceTrustScore
          if (trustDiff !== 0) return trustDiff
          const aVol = Number(a.keywordData.searchVolume || 0)
          const bVol = Number(b.keywordData.searchVolume || 0)
          return bVol - aVol
        })

      const restoreLimit = Math.min(
        3,
        Math.max(1, Math.floor(trustedContextRestoreCandidates.length * 0.3))
      )
      for (const restoreCandidate of trustedContextRestoreCandidates.slice(0, restoreLimit)) {
        const restoreKey = normalizeGoogleAdsKeyword(restoreCandidate.keywordData.keyword)
          || restoreCandidate.keywordData.keyword.toLowerCase().trim()
        if (!restoreKey || existingFilteredKeys.has(restoreKey)) continue

        filtered.push(restoreCandidate.keywordData)
        existingFilteredKeys.add(restoreKey)

        const index = removed.indexOf(restoreCandidate.item)
        if (index >= 0) removed.splice(index, 1)
      }
    }
  }

  return { filtered, removed }
}

/**
 * 简单关键词过滤（字符串数组版本）
 *
 * @param keywords - 关键词字符串数组
 * @param brandName - 品牌名称
 * @returns 过滤后的关键词
 */
export function filterKeywordsSimple(
  keywords: string[],
  brandName: string
): string[] {
  const poolKeywords: PoolKeywordData[] = keywords.map(kw => ({
    keyword: kw,
    searchVolume: 0,
    source: 'FILTERED',
  }))

  const result = filterKeywordQuality(poolKeywords, { brandName })
  return result.filtered.map(kw => typeof kw === 'string' ? kw : kw.keyword)
}

// ============================================
// 统计报告
// ============================================

/**
 * 生成过滤统计报告
 */
export function generateFilterReport(
  originalCount: number,
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
): string {
  if (removed.length === 0) {
    return `✅ 所有 ${originalCount} 个关键词通过质量检查`
  }

  const filteredCount = originalCount - removed.length
  const removalRate = ((removed.length / originalCount) * 100).toFixed(1)

  // 按原因分组统计
  const reasonGroups: Record<string, number> = {}
  for (const item of removed) {
    // 提取主要原因类别
    let category = '其他'
    if (item.reason.includes('品牌变体词')) {
      category = '品牌变体词'
    } else if (item.reason.includes('语义查询词')) {
      category = '语义查询词'
    } else if (item.reason.includes('单词数')) {
      category = '单词数不匹配'
    }
    reasonGroups[category] = (reasonGroups[category] || 0) + 1
  }

  let report = `📊 关键词质量过滤报告:\n`
  report += `   原始: ${originalCount} 个 → 过滤后: ${filteredCount} 个\n`
  report += `   移除: ${removed.length} 个 (${removalRate}%)\n`

  for (const [category, count] of Object.entries(reasonGroups)) {
    report += `   - ${category}: ${count} 个\n`
  }

  // 显示被移除的关键词示例（最多5个）
  if (removed.length > 0) {
    const examples = removed.slice(0, 5).map(item => {
      const keyword = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      return `     - "${keyword}": ${item.reason}`
    })
    report += `   示例:\n${examples.join('\n')}`
  }

  return report
}
