import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
  PRODUCT_WORD_PATTERNS,
} from './brand/brand-keyword-utils'
const BRAND_CONNECTOR_TOKENS = new Set(['and', 'plus'])

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

// 品牌词匹配策略

/**
 * 品牌词匹配策略说明
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 场景1: 关键词过滤（保留包含品牌词的关键词） │
 * │ → shouldKeepByBrand() - 部分匹配（"reolink argus" ） │
 * │ │
 * │ 场景2: 匹配类型分配（判断是否"纯品牌词"用 EXACT） │
 * │ → shouldUseExactMatch() - 精确匹配（"reolink" , "reolink argus" ）│
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
    const brandTokens = normalizeGoogleAdsKeyword(brand || '')
      .split(/\s+/)
      .filter(Boolean)
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

// 品牌变体词检测

/**
 * 检测是否为品牌变体词
 *
 * 品牌变体词特征
 * 品牌名 + 3个以上无意义字母后缀
 * 例如：eureka + ddl = eurekaddl
 *
 *
 * 包含数字的后缀不是变体词（产品型号，如 j15, x20）
 * 后缀完全等于常见产品词的不是变体词（如 pro, ultra, max）
 * 后缀以"产品词+"开头的（如 pro-）的不是变体词
 * 纯品牌词（后缀为空）豁免
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

  // 关键仅把“品牌名后直接拼接的后缀”视为变体词
  // 例如：eurekaddl（brand+ddl）
  // 例如：auxito led / auxito-led / auxito_led （这是正常的品牌+产品词组合）
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
  const hasProductWordPrefix = PRODUCT_WORD_PATTERNS.some(
    (pattern) => suffix.startsWith(pattern + '-') || suffix.startsWith(pattern + ' ')
  )
  if (hasProductWordPrefix) {
    return false
  }

  // 4. 检查后缀长度：3-10个字母后缀认为是变体词
  const suffixLength = suffix.length
  return suffixLength >= 3 && suffixLength <= 10
}

// 品牌无关词检测

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
 * 品牌无关词特征
 * 包含企业类型后缀（unito, gmbh, inc等）
 * 不包含纯品牌词
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
  return BRAND_IRRELEVANT_PATTERNS.some((pattern) => pattern.test(keyword))
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
