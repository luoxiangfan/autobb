/**
 * 广告关键元素提取器
 * 需求34：从商品标题和描述中提取关键字、标题、广告描述
 *
 * 核心功能：
 * 1. 从商品标题提取"品牌名+商品名"作为关键字和广告标题
 * 2. 从商品描述提取精炼信息作为广告描述
 * 3. 支持单商品和店铺两种场景
 * 4. 整合Google搜索下拉词
 * 5. 通过Keyword Planner查询搜索量并过滤
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getKeywordSearchVolumes } from './keyword-planner'
import { getUserAuthType } from './google-ads-oauth'
import { getHighIntentKeywords } from './google-suggestions'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import { getHeadlineLanguageInstructions, getDescriptionLanguageInstructions } from './ad-elements-language-instructions'
import { loadPrompt, interpolateTemplate } from './prompt-loader'
import { classifyKeywordIntent } from './keyword-intent'
import { isInvalidKeyword } from './keyword-invalid-filter'
import type { AmazonProductData, AmazonStoreData } from './stealth-scraper'
import type {
  StoreProduct,
  EnrichedStoreProduct,
  ExtractedAdElements,
  ProductInfo,
  CategoryThreshold
} from './ad-elements/types'

// Re-export types for backward compatibility
export type { ExtractedAdElements, ProductInfo } from './ad-elements/types'

type ExtractedKeywordRow = {
  keyword: string
  source: 'product_title' | 'google_suggest' | 'brand_variant'
  searchVolume: number
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
}

function sanitizeKeywordRows(rows: ExtractedKeywordRow[], sceneLabel: string): ExtractedKeywordRow[] {
  const seen = new Set<string>()
  const sanitized: ExtractedKeywordRow[] = []
  let removedInvalid = 0
  let removedDuplicate = 0

  for (const row of rows) {
    const keyword = String(row.keyword || '').trim()
    if (!keyword || isInvalidKeyword(keyword)) {
      removedInvalid += 1
      continue
    }

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) {
      removedInvalid += 1
      continue
    }

    if (seen.has(normalized)) {
      removedDuplicate += 1
      continue
    }

    seen.add(normalized)
    sanitized.push({ ...row, keyword })
  }

  if (removedInvalid > 0 || removedDuplicate > 0) {
    console.warn(
      `  ⚠️ ${sceneLabel}关键词清洗: 移除无效${removedInvalid}个，去重${removedDuplicate}个`
    )
  }

  return sanitized
}

/**
 * 从AI响应中提取JSON（处理markdown代码块等格式）
 */
function extractJsonFromResponse(response: string): any {
  // 立即记录输入（同步日志确保显示）
  const inputLength = response?.length || 0
  console.log(`🔍 extractJsonFromResponse: 输入长度=${inputLength}`)

  if (!response || typeof response !== 'string') {
    throw new Error(`无效输入: ${typeof response}`)
  }

  let jsonText = response.trim()

  // 1. 移除markdown代码块标记（多种格式）
  jsonText = jsonText
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/gi, '')
    .replace(/^json\s*/i, '') // 移除开头的 "json" 标记

  // 2. 移除可能的thinking/reasoning块（Gemini 2.5有时会添加）
  const thinkingEnd = jsonText.search(/\{[\s\S]*"headlines"|\{[\s\S]*"descriptions"|\[/)
  if (thinkingEnd > 0) {
    jsonText = jsonText.slice(thinkingEnd)
  }

  console.log(`🔍 清理后长度=${jsonText.length}`)

  // 3. 尝试直接解析（如果整个响应就是JSON）
  try {
    const directParse = JSON.parse(jsonText)
    console.log(`✅ 直接解析成功`)
    return directParse
  } catch {
    // 继续尝试其他方法
  }

  // 4. 尝试找到JSON对象（从第一个{到匹配的最后一个}）
  const firstBrace = jsonText.indexOf('{')
  const lastBrace = jsonText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const possibleJson = jsonText.slice(firstBrace, lastBrace + 1)
    try {
      const parsed = JSON.parse(possibleJson)
      console.log(`✅ 找到JSON对象，位置: ${firstBrace}-${lastBrace}`)
      return parsed
    } catch (e) {
      console.log(`⚠️ JSON对象解析失败: ${(e as Error).message}`)
    }
  }

  // 5. 尝试找到JSON数组（从第一个[到最后一个]）
  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const possibleArray = jsonText.slice(firstBracket, lastBracket + 1)
    try {
      const parsed = JSON.parse(possibleArray)
      console.log(`✅ 找到JSON数组，位置: ${firstBracket}-${lastBracket}`)
      return parsed
    } catch (e) {
      console.log(`⚠️ JSON数组解析失败: ${(e as Error).message}`)
    }
  }

  // 6. 尝试提取headlines/descriptions数组（特殊处理AI可能返回的格式）
  const headlinesMatch = response.match(/"headlines"\s*:\s*\[([\s\S]*?)\]/i)
  if (headlinesMatch) {
    try {
      const headlinesJson = `{"headlines": [${headlinesMatch[1]}]}`
      const parsed = JSON.parse(headlinesJson)
      console.log(`✅ 使用正则提取headlines成功`)
      return parsed
    } catch {
      // 继续
    }
  }

  const descriptionsMatch = response.match(/"descriptions"\s*:\s*\[([\s\S]*?)\]/i)
  if (descriptionsMatch) {
    try {
      const descriptionsJson = `{"descriptions": [${descriptionsMatch[1]}]}`
      const parsed = JSON.parse(descriptionsJson)
      console.log(`✅ 使用正则提取descriptions成功`)
      return parsed
    } catch {
      // 继续
    }
  }

  // 7. 输出调试信息
  console.log(`❌ 未找到有效JSON，前300字符: ${response.slice(0, 300)}`)
  console.log(`❌ 未找到有效JSON，后300字符: ${response.slice(-300)}`)

  throw new Error('未找到有效的JSON结构')
}

/**
 * 从商品标题提取"品牌名+商品名"
 * @example "Teslong Inspection Camera with Light" → "Teslong Inspection Camera"
 */
function extractBrandProductName(productTitle: string, brandName: string): string {
  // 移除常见的无关词汇
  const cleanedTitle = productTitle
    .replace(/\s+with\s+.*/i, '') // 移除 "with ..."
    .replace(/\s+for\s+.*/i, '') // 移除 "for ..."
    .replace(/\s+-\s+.*/i, '') // 移除 " - ..."
    .replace(/\s+\|.*/i, '') // 移除 " | ..."
    .trim()

  // 确保包含品牌名
  if (!cleanedTitle.toLowerCase().includes(brandName.toLowerCase())) {
    return `${brandName} ${cleanedTitle}`
  }

  return cleanedTitle
}

function normalizeAdText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, ' ')
    .trim()
}

function truncateByWords(text: string, maxLength: number): string {
  const cleaned = normalizeAdText(text)
  if (cleaned.length <= maxLength) return cleaned

  const words = cleaned.split(/\s+/)
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > maxLength) break
    out = next
  }
  return out.length >= 4 ? out : cleaned.slice(0, maxLength).trim()
}

function extractAboutItemKeywordCandidates(
  aboutItems: string[] | null | undefined,
  maxCandidates: number = 12,
  targetLanguage: string = 'English'
): string[] {
  if (!Array.isArray(aboutItems) || aboutItems.length === 0) return []

  const candidates: string[] = []
  const seen = new Set<string>()

  const addCandidate = (raw: string | null | undefined, maxLen: number = 60) => {
    if (!raw) return
    const normalized = normalizeAdText(raw)
      .replace(/[^\p{L}\p{N}\s&/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 4 || normalized.length > maxLen) return

    const lower = normalized.toLowerCase()
    if (lower === 'about this item' || lower === 'product details') return
    if (seen.has(lower)) return
    if (/^[\d\s,./%-]+$/u.test(normalized)) return

    const intentInfo = classifyKeywordIntent(normalized, { language: targetLanguage })
    if (intentInfo.hardNegative) return

    seen.add(lower)
    candidates.push(normalized)
  }

  for (const rawItem of aboutItems.slice(0, 8)) {
    const item = normalizeAdText(rawItem || '')
    if (!item) continue

    // 优先提取冒号前的“卖点标题”
    const colonIndex = item.indexOf(':')
    if (colonIndex > 0) {
      const label = item.slice(0, colonIndex).trim()
      addCandidate(label, 55)
    }

    // 提取冒号后的首句（或整句前半段）作为功能短语
    const afterLabel = colonIndex > 0 ? item.slice(colonIndex + 1).trim() : item
    const firstClause = afterLabel.split(/[.!?;|]/)[0]?.trim() || ''
    if (firstClause) {
      addCandidate(truncateByWords(firstClause, 48), 55)
    }

    // 额外提取包含数字/规格的片段（如 30-day battery / 66,000 movements）
    const numericMatches = item.match(/\b[\d,.]+(?:\s*[-–]?\s*\w+){0,4}\b/g) || []
    for (const match of numericMatches.slice(0, 2)) {
      const around = truncateByWords(match, 40)
      if (!/[\p{L}]/u.test(around)) continue
      if (/^[\d\s,./%-]+$/u.test(around)) continue
      addCandidate(around, 45)
    }

    if (candidates.length >= maxCandidates) break
  }

  return candidates.slice(0, maxCandidates)
}

/**
 * 🔥 P1.2优化1：类目权重系数
 * 不同类目的评论数量基准不同，需要动态调整门槛
 */
const CATEGORY_THRESHOLDS: Record<string, CategoryThreshold> = {
  // 电子产品：竞争激烈，门槛提高 50%
  'Electronics': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '电子产品' },
  'Computers': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '计算机' },
  'Cell Phones': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '手机' },

  // 服装鞋包：评论较多，标准门槛
  'Clothing': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '服装' },
  'Shoes': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '鞋类' },
  'Handbags': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '箱包' },

  // 图书音乐：评论较少，门槛降低 20%
  'Books': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '图书' },
  'Music': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '音乐' },
  'Movies': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '影视' },

  // 家居园艺：评论中等，门槛降低 10%
  'Home': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '家居' },
  'Kitchen': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '厨具' },
  'Garden': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '园艺' },

  // 美容健康：评论较多，标准门槛
  'Beauty': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '美容' },
  'Health': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '健康' },

  // 玩具游戏：评论中等，门槛降低 10%
  'Toys': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '玩具' },
  'Games': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '游戏' },

  // 运动户外：评论较多，标准门槛
  'Sports': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '运动' },
  'Outdoors': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '户外' },

  // 汽车配件：评论较少，门槛降低 15%
  'Automotive': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.85, description: '汽车配件' },

  // 工具：评论较少，门槛降低 15%
  'Tools': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.85, description: '工具' },

  // 默认类目：标准门槛
  'default': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '默认' }
}

/**
 * 🔥 P1.2优化1：从 Sales Rank 中提取类目
 * @param salesRank - Sales Rank 字符串，如 "#123 in Electronics" 或 "#1 in Cell Phones & Accessories"
 * @returns 类目名称或 'default'
 */
function extractCategoryFromSalesRank(salesRank: string | null | undefined): string {
  if (!salesRank) return 'default'

  // 提取 "in" 后面的类目名称
  const categoryMatch = salesRank.match(/in\s+([^>]+?)(?:\s*>|$)/)
  if (!categoryMatch) return 'default'

  const category = categoryMatch[1].trim()

  // 精确匹配
  if (CATEGORY_THRESHOLDS[category]) {
    return category
  }

  // 模糊匹配（包含关键词）
  for (const [key, _] of Object.entries(CATEGORY_THRESHOLDS)) {
    if (key !== 'default' && category.includes(key)) {
      return key
    }
  }

  return 'default'
}

/**
 * 🔥 P3优化：评估品牌流行度
 * 基于评论数量、评分、Sales Rank等因素评估品牌知名度
 *
 * @param reviewCount - 评论数量（字符串，如 "1,234" 或 "1.2K"）
 * @param rating - 评分（字符串，如 "4.5" 或 null）
 * @param salesRank - 销售排名（字符串，如 "#123 in Electronics" 或 null）
 * @returns 'high' | 'medium' | 'low'
 */
function estimateBrandPopularity(
  reviewCount: string | null | undefined,
  rating: string | null | undefined,
  salesRank: string | null | undefined
): 'high' | 'medium' | 'low' {
  // 解析评论数量（处理 "1,234" 或 "1.2K" 格式）
  let numReviews = 0
  if (reviewCount) {
    const cleanCount = reviewCount.replace(/,/g, '')
    if (cleanCount.includes('K')) {
      numReviews = parseFloat(cleanCount) * 1000
    } else if (cleanCount.includes('M')) {
      numReviews = parseFloat(cleanCount) * 1000000
    } else {
      numReviews = parseFloat(cleanCount) || 0
    }
  }

  // 解析评分
  let numRating = rating ? parseFloat(rating) : 0

  // 解析Sales Rank（提取数字，如 "#123" → 123）
  let rankNum = Infinity
  if (salesRank) {
    const rankMatch = salesRank.match(/#?(\d+)/)
    if (rankMatch) {
      rankNum = parseInt(rankMatch[1], 10)
    }
  }

  // 🔥 P1.2优化1: 类目动态门槛调整
  const category = extractCategoryFromSalesRank(salesRank)
  const threshold = CATEGORY_THRESHOLDS[category]
  const multiplier = threshold.multiplier

  // 应用类目倍数调整门槛
  const highThreshold = Math.round(threshold.highReviewBase * multiplier)
  const mediumThreshold = Math.round(threshold.mediumReviewBase * multiplier)
  const mediumWithRatingThreshold = Math.round(300 * multiplier)

  if (category !== 'default') {
    console.log(`  📂 类目: ${threshold.description} (${category}) - 门槛倍数: ${multiplier}x`)
    console.log(`     High门槛: ${highThreshold}, Medium门槛: ${mediumThreshold}/${mediumWithRatingThreshold}`)
  }

  // 🔥 改进3: Sales Rank 缺失补偿 - 无 Sales Rank 时增加评分权重
  if (!salesRank && numRating >= 4.7) {
    // 评分 >= 4.7 视为高质量信号，评论数权重放大 50%
    numReviews *= 1.5
    console.log(`  📊 无Sales Rank，评分${numRating}较高，评论数权重放大: ${Math.round(numReviews / 1.5)} → ${Math.round(numReviews)}`)
  }

  // 🔥 流行度评估规则（使用动态门槛）
  // High: 评论数 >= highThreshold 或 (评论数 >= 1000 且评分 >= 4.5) 或 Sales Rank <= 100
  if (
    numReviews >= highThreshold ||
    (numReviews >= 1000 && numRating >= 4.5) ||
    rankNum <= 100
  ) {
    return 'high'
  }

  // 🔥 改进1: Medium 门槛调整 - 将 100 评论数提升至 300，避免边界误判
  // Medium: 评论数 >= mediumThreshold 或 (评论数 >= mediumWithRatingThreshold 且评分 >= 4.0) 或 Sales Rank <= 1000
  if (
    numReviews >= mediumThreshold ||
    (numReviews >= mediumWithRatingThreshold && numRating >= 4.0) ||
    rankNum <= 1000
  ) {
    return 'medium'
  }

  // Low: 其他情况
  return 'low'
}

/**
 * 🔥 P1.2优化3：品牌名标准化
 * 统一品牌名格式，去除空格、标点，统一大小写
 * @param brand - 原始品牌名，如 "Bag Smart" 或 "NIKE™"
 * @returns 标准化品牌名，如 "bagsmart" 或 "nike"
 */
function normalizeBrandName(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[™®©]/g, '')  // 移除商标符号
    .replace(/\s+/g, '')     // 移除所有空格
    .replace(/[_-]+/g, '')   // 移除下划线和连字符
    .trim()
}

/**
 * 🔥 P1.2优化2：多语言语义关键词检测
 * 检测品牌名中是否包含各语言的商店、官方、网站等关键词
 */
const SEMANTIC_KEYWORDS = {
  store: [
    'store', 'shop',           // 英语
    'geschäft', 'laden',       // 德语
    'magasin', 'boutique',     // 法语
    'tienda',                  // 西班牙语
    'negozio',                 // 意大利语
    'loja',                    // 葡萄牙语
    'sklep',                   // 波兰语
    'winkel'                   // 荷兰语
  ],
  official: [
    'official', 'authentic',   // 英语
    'offiziell', 'echt',       // 德语
    'officiel', 'authentique', // 法语
    'oficial', 'auténtico',    // 西班牙语
    'ufficiale', 'autentico',  // 意大利语
    'oficial', 'autêntico',    // 葡萄牙语
    'oficjalny'                // 波兰语
  ],
  website: [
    'website', 'site', 'web',  // 英语
    'webseite', 'seite',       // 德语
    'site web', 'site',        // 法语
    'sitio web', 'sitio',      // 西班牙语
    'sito web', 'sito',        // 意大利语
    'site', 'página'           // 葡萄牙语
  ]
}

/**
 * 检测品牌名中是否包含语义关键词
 * @param brandLower - 小写品牌名
 * @param keywords - 关键词数组
 * @returns 是否包含
 */
function containsSemanticKeyword(brandLower: string, keywords: string[]): boolean {
  return keywords.some(keyword => brandLower.includes(keyword))
}

/**
 * 动态生成品牌变体关键词
 * 仅保留品牌标准化结果，避免模板交易词（buy/reviews/store等）注入关键词池。
 *
 * @param brand - 品牌名
 * @param popularity - 品牌流行度 ('high' | 'medium' | 'low')
 * @returns 品牌变体关键词数组
 */
function generateDynamicBrandVariants(
  brand: string,
  popularity: 'high' | 'medium' | 'low'
): string[] {
  const brandNormalized = normalizeBrandName(brand)
  const brandLower = brandNormalized

  if (brandNormalized !== brand.toLowerCase()) {
    console.log(`  🔧 品牌名标准化: "${brand}" → "${brandNormalized}"`)
  }

  // 🔥 P1.2优化2: 多语言语义重复检测
  const containsStore = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.store)
  const containsOfficial = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.official)
  const containsWebsite = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.website)

  if (containsStore || containsOfficial || containsWebsite) {
    console.log(`  🌐 多语言检测: store=${containsStore}, official=${containsOfficial}, website=${containsWebsite}`)
  }

  console.log(`  ℹ️ 品牌流行度=${popularity}，品牌变体限制为证据安全模式（仅品牌词）`)
  return [brandLower]
}

/**
 * 从单个商品提取广告元素
 */
async function extractFromSingleProduct(
  product: AmazonProductData,
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log('📦 单商品场景：提取广告元素...')

  const productInfo: ProductInfo = {
    name: product.productName || '',
    description: product.productDescription || '',
    features: product.features || [],
    aboutThisItem: product.aboutThisItem || [],  // Amazon "About this item"
    brand: product.brandName || brand,
    rating: product.rating,
    reviewCount: product.reviewCount
  }
  const pureBrandKeywords = getPureBrandKeywords(brand)

  // 1. 提取关键字候选词
  const keywordCandidates: string[] = []

  // 1.1 从商品标题提取"品牌名+商品名"
  if (productInfo.name) {
    const brandProductName = extractBrandProductName(productInfo.name, brand)
    keywordCandidates.push(brandProductName)
    console.log(`  ✓ 商品标题关键字: "${brandProductName}"`)
  }

  // 1.1.1 从 About this item / features 提取核心卖点短语
  const aboutSource = productInfo.aboutThisItem?.length ? productInfo.aboutThisItem : productInfo.features
  const aboutKeywordCandidates = extractAboutItemKeywordCandidates(aboutSource, 12, targetLanguage)
  if (aboutKeywordCandidates.length > 0) {
    keywordCandidates.push(...aboutKeywordCandidates)
    console.log(`  ✓ About this item关键字: ${aboutKeywordCandidates.length}个`)
  }

  // 1.2 获取Google搜索下拉词（高购买意图）- 🔥 调整顺序：先获取Google词
  let googleKeywords: string[] = []
  try {
    googleKeywords = await getHighIntentKeywords({
      brand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true
    })
    console.log(`  ✓ Google下拉词: ${googleKeywords.length}个`)
  } catch (error: any) {
    console.warn('  ⚠️ Google下拉词获取失败:', error.message)
  }

  // 1.3 生成品牌变体关键字 - 🔥 P3优化：动态品牌变体生成
  const productTitle = productInfo.name?.toLowerCase() || ''
  const googleKeywordsLower = new Set(googleKeywords.map(k => k.toLowerCase()))

  // 🔥 P3优化：评估品牌流行度
  const brandPopularity = estimateBrandPopularity(
    productInfo.reviewCount,
    productInfo.rating,
    (product as any).salesRank // AmazonProductData可能有salesRank字段
  )

  // 🔥 P3优化：根据流行度动态生成品牌变体
  const allBrandVariants = generateDynamicBrandVariants(brand, brandPopularity)

  // 🔥 P1优化：智能过滤已存在的变体
  const brandVariants = allBrandVariants.filter(variant => {
    const variantLower = variant.toLowerCase()

    // 过滤规则1: 如果Product Title已包含该变体，跳过
    if (productTitle.includes(variantLower)) {
      console.log(`  ⊘ 跳过品牌变体 "${variant}" (已存在于Product Title)`)
      return false
    }

    // 过滤规则2: 如果Google Suggest已包含完全相同的关键词，跳过
    if (googleKeywordsLower.has(variantLower)) {
      console.log(`  ⊘ 跳过品牌变体 "${variant}" (已存在于Google下拉词)`)
      return false
    }

    return true
  })

  keywordCandidates.push(...googleKeywords)
  keywordCandidates.push(...brandVariants)
  console.log(`  ✓ 品牌变体关键字: ${brandVariants.length}个（已智能过滤${allBrandVariants.length - brandVariants.length}个重复）`)

  // ✅ 强制补齐纯品牌词（避免被后续过滤误删）
  if (pureBrandKeywords.length > 0) {
    let addedPureBrand = 0
    for (const token of pureBrandKeywords) {
      const tokenNorm = normalizeGoogleAdsKeyword(token)
      if (!tokenNorm) continue
      const exists = keywordCandidates.some(kw => normalizeGoogleAdsKeyword(kw) === tokenNorm)
      if (!exists) {
        keywordCandidates.push(token)
        addedPureBrand++
      }
    }
    if (addedPureBrand > 0) {
      console.log(`  ✓ 补充纯品牌词: ${addedPureBrand}个`)
    }
  }

  // 🔥 P1优化：去重关键词候选（大小写不敏感）
  const keywordCountBeforeDedup = keywordCandidates.length
  const uniqueKeywordsMap = new Map<string, string>()

  keywordCandidates.forEach(keyword => {
    const keywordLower = keyword.toLowerCase()
    if (!uniqueKeywordsMap.has(keywordLower)) {
      // 保留原始大小写（通常是首次出现的版本）
      uniqueKeywordsMap.set(keywordLower, keyword)
    }
  })

  const deduplicatedKeywords = Array.from(uniqueKeywordsMap.values())
  const duplicatesRemoved = keywordCountBeforeDedup - deduplicatedKeywords.length

  if (duplicatesRemoved > 0) {
    console.log(`\n🔄 关键词去重: ${keywordCountBeforeDedup}个 → ${deduplicatedKeywords.length}个（移除${duplicatesRemoved}个重复）`)
  }

  // 更新keywordCandidates为去重后的列表
  keywordCandidates.length = 0
  keywordCandidates.push(...deduplicatedKeywords)

  // 🔒 强制：最终关键词必须包含纯品牌词
  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = keywordCandidates.length
    const brandFiltered = keywordCandidates.filter(kw => containsPureBrand(kw, pureBrandKeywords))
    if (beforeBrandFilter !== brandFiltered.length) {
      console.log(`  🔒 品牌强制过滤: ${beforeBrandFilter} → ${brandFiltered.length}`)
    }
    keywordCandidates.length = 0
    keywordCandidates.push(...brandFiltered)
  }

  // 2. 查询搜索量并过滤
  console.log(`\n🔍 查询${keywordCandidates.length}个关键字的搜索量...`)
  const minSearchVolume = 500 // 最小搜索量阈值

  let keywordsWithVolume: ExtractedKeywordRow[] = []

  try {
    // 🔧 修复(2025-12-26): 支持服务账号模式
    const auth = await getUserAuthType(userId)
    const volumeData = await getKeywordSearchVolumes(
      keywordCandidates,
      targetCountry,
      targetLanguage,
      userId,
      auth.authType,
      auth.serviceAccountId
    )

    const aboutKeywordSet = new Set(aboutKeywordCandidates.map(k => k.toLowerCase()))

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.avgMonthlySearches || 0

      // 确定来源
      let source: 'product_title' | 'google_suggest' | 'brand_variant' = 'brand_variant'
      if (productInfo.name && keyword.includes(extractBrandProductName(productInfo.name, brand))) {
        source = 'product_title'
      } else if (aboutKeywordSet.has(keyword.toLowerCase())) {
        source = 'google_suggest'
      } else if (!brandVariants.includes(keyword)) {
        source = 'google_suggest'
      }

      // 确定优先级
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (source === 'product_title') {
        priority = 'HIGH'
      } else if (volume >= 1000) {
        priority = 'HIGH'
      } else if (volume >= 500) {
        priority = 'MEDIUM'
      } else {
        priority = 'LOW'
      }

      return {
        keyword,
        source,
        searchVolume: volume,
        priority
      }
    })

    const metricsUnavailable = volumeData.some((vol: any) =>
      vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )

    // 过滤搜索量过低的关键字（纯品牌词豁免）
    // ⚠️ 重要：不能过滤到“0个关键词”，否则后续关键词池与创意生成会被阻断
    const hasAnyVolume = keywordsWithVolume.some(k => k.searchVolume > 0)
    const filteredKeywordsCandidate = metricsUnavailable
      ? keywordsWithVolume
      : keywordsWithVolume.filter(k =>
          k.searchVolume >= minSearchVolume ||
          isPureBrandKeyword(k.keyword, pureBrandKeywords)
        )

    const filteredKeywords = filteredKeywordsCandidate.length > 0
      ? filteredKeywordsCandidate
      : keywordsWithVolume

    if (!metricsUnavailable && filteredKeywordsCandidate.length === 0 && keywordsWithVolume.length > 0) {
      console.warn(`  ⚠️ 所有关键词搜索量均低于阈值(${minSearchVolume})，保留全部${keywordsWithVolume.length}个关键词以保证流程可用`)
    }

    const volumeNote = metricsUnavailable
      ? '，搜索量不可用'
      : (!hasAnyVolume ? '，搜索量全为0' : '')
    console.log(`  ✓ 过滤后剩余${filteredKeywords.length}个关键字（搜索量>=${minSearchVolume}${volumeNote}）`)

    // 按优先级和搜索量排序
    filteredKeywords.sort((a, b) => {
      const priorityWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.searchVolume - a.searchVolume
    })

    keywordsWithVolume = filteredKeywords
  } catch (error: any) {
    console.error('  ❌ 搜索量查询失败:', error.message)
    // 失败时仍返回候选关键字，搜索量设为0
    keywordsWithVolume = keywordCandidates.map(keyword => ({
      keyword,
      source: 'brand_variant' as const,
      searchVolume: 0,
      priority: 'MEDIUM' as const
    }))
  }

  keywordsWithVolume = sanitizeKeywordRows(keywordsWithVolume, '单商品')
  if (keywordsWithVolume.length === 0 && pureBrandKeywords.length > 0) {
    console.warn('  ⚠️ 单商品关键词清洗后为空，回退为纯品牌词')
    keywordsWithVolume = pureBrandKeywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => ({
        keyword,
        source: 'brand_variant' as const,
        searchVolume: 0,
        priority: 'MEDIUM' as const,
      }))
  }

  // 3 & 4. 🔥 P1优化: 并行生成标题和描述（节省20-30秒）
  console.log('\n📝 并行生成广告标题和描述（优化耗时）...')
  const [headlines, descriptions] = await Promise.all([
    generateHeadlines(productInfo, keywordsWithVolume.slice(0, 10), targetLanguage, userId),
    generateDescriptions(productInfo, targetLanguage, userId)
  ])
  console.log('✅ 标题和描述生成完成')

  return {
    keywords: keywordsWithVolume,
    headlines,
    descriptions,
    sources: {
      productCount: 1,
      keywordSources: {
        product_title: keywordsWithVolume.filter(k => k.source === 'product_title').length,
        google_suggest: keywordsWithVolume.filter(k => k.source === 'google_suggest').length,
        brand_variant: keywordsWithVolume.filter(k => k.source === 'brand_variant').length
      },
      topProducts: [{
        name: productInfo.name,
        rating: productInfo.rating ?? null,
        reviewCount: productInfo.reviewCount ?? null
      }]
    }
  }
}

/**
 * 从店铺多个热销商品提取广告元素
 */
async function extractFromStore(
  products: StoreProduct[],
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log(`🏪 店铺场景：从${products.length}个热销商品提取广告元素...`)
  const pureBrandKeywords = getPureBrandKeywords(brand)

  // 按热销分数排序，取前5个
  const topProducts = products
    .filter(p => p.hotScore && p.hotScore > 0)
    .sort((a, b) => (b.hotScore || 0) - (a.hotScore || 0))
    .slice(0, 5)

  console.log(`  → 筛选TOP 5热销商品`)
  topProducts.forEach((p, i) => {
    console.log(`    ${i + 1}. ${p.name} (评分${p.rating}, ${p.reviewCount}评论, 热度${p.hotScore?.toFixed(2)})`)
  })

  // 1. 从每个热销商品提取"品牌名+商品名"作为关键字
  const keywordCandidates: string[] = []

  topProducts.forEach(product => {
    const brandProductName = extractBrandProductName(product.name, brand)
    keywordCandidates.push(brandProductName)
  })
  console.log(`  ✓ 商品标题关键字: ${keywordCandidates.length}个`)

  // 1.2 生成品牌变体关键字（证据安全：仅品牌词）
  const brandVariants = [normalizeBrandName(brand)]
  keywordCandidates.push(...brandVariants)
  console.log(`  ✓ 品牌变体关键字: ${brandVariants.length}个`)

  // 1.3 获取Google搜索下拉词
  try {
    const googleKeywords = await getHighIntentKeywords({
      brand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true
    })
    keywordCandidates.push(...googleKeywords)
    console.log(`  ✓ Google下拉词: ${googleKeywords.length}个`)
  } catch (error: any) {
    console.warn('  ⚠️ Google下拉词获取失败:', error.message)
  }

  // ✅ 强制补齐纯品牌词（避免被后续过滤误删）
  if (pureBrandKeywords.length > 0) {
    let addedPureBrand = 0
    for (const token of pureBrandKeywords) {
      const tokenNorm = normalizeGoogleAdsKeyword(token)
      if (!tokenNorm) continue
      const exists = keywordCandidates.some(kw => normalizeGoogleAdsKeyword(kw) === tokenNorm)
      if (!exists) {
        keywordCandidates.push(token)
        addedPureBrand++
      }
    }
    if (addedPureBrand > 0) {
      console.log(`  ✓ 补充纯品牌词: ${addedPureBrand}个`)
    }
  }

  // 🔒 强制：最终关键词必须包含纯品牌词
  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = keywordCandidates.length
    const brandFiltered = keywordCandidates.filter(kw => containsPureBrand(kw, pureBrandKeywords))
    if (beforeBrandFilter !== brandFiltered.length) {
      console.log(`  🔒 品牌强制过滤: ${beforeBrandFilter} → ${brandFiltered.length}`)
    }
    keywordCandidates.length = 0
    keywordCandidates.push(...brandFiltered)
  }

  // 2. 查询搜索量并过滤
  console.log(`\n🔍 查询${keywordCandidates.length}个关键字的搜索量...`)
  const minSearchVolume = 500

  let keywordsWithVolume: ExtractedKeywordRow[] = []

  try {
    // 🔧 修复(2025-12-26): 支持服务账号模式
    const auth = await getUserAuthType(userId)
    const volumeData = await getKeywordSearchVolumes(
      keywordCandidates,
      targetCountry,
      targetLanguage,
      userId,
      auth.authType,
      auth.serviceAccountId
    )

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.avgMonthlySearches || 0

      // 确定来源
      let source: 'product_title' | 'google_suggest' | 'brand_variant' = 'brand_variant'
      const isFromProduct = topProducts.some(p =>
        keyword.includes(extractBrandProductName(p.name, brand))
      )
      if (isFromProduct) {
        source = 'product_title'
      } else if (!brandVariants.includes(keyword)) {
        source = 'google_suggest'
      }

      // 确定优先级
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (source === 'product_title') {
        priority = 'HIGH'
      } else if (volume >= 1000) {
        priority = 'HIGH'
      } else if (volume >= 500) {
        priority = 'MEDIUM'
      } else {
        priority = 'LOW'
      }

      return {
        keyword,
        source,
        searchVolume: volume,
        priority
      }
    })

    const metricsUnavailable = volumeData.some((vol: any) =>
      vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )
    const hasAnyVolume = keywordsWithVolume.some(k => k.searchVolume > 0)
    const filteredKeywords = metricsUnavailable
      ? keywordsWithVolume
      : keywordsWithVolume.filter(k =>
          k.searchVolume >= minSearchVolume ||
          isPureBrandKeyword(k.keyword, pureBrandKeywords)
        )
    const volumeNote = metricsUnavailable
      ? '，搜索量不可用'
      : (!hasAnyVolume ? '，搜索量全为0' : '')
    console.log(`  ✓ 过滤后剩余${filteredKeywords.length}个关键字（搜索量>=${minSearchVolume}${volumeNote}）`)

    // 排序
    filteredKeywords.sort((a, b) => {
      const priorityWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.searchVolume - a.searchVolume
    })

    keywordsWithVolume = filteredKeywords
  } catch (error: any) {
    console.error('  ❌ 搜索量查询失败:', error.message)
    keywordsWithVolume = keywordCandidates.map(keyword => ({
      keyword,
      source: 'brand_variant' as const,
      searchVolume: 0,
      priority: 'MEDIUM' as const
    }))
  }

  keywordsWithVolume = sanitizeKeywordRows(keywordsWithVolume, '店铺')
  if (keywordsWithVolume.length === 0 && pureBrandKeywords.length > 0) {
    console.warn('  ⚠️ 店铺关键词清洗后为空，回退为纯品牌词')
    keywordsWithVolume = pureBrandKeywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => ({
        keyword,
        source: 'brand_variant' as const,
        searchVolume: 0,
        priority: 'MEDIUM' as const,
      }))
  }

  // 3. 从多个热销商品生成15个广告标题
  console.log('\n📝 从TOP 5热销商品生成15个广告标题...')
  // 🔥 传递完整的EnrichedStoreProduct数据（包含深度分析字段）
  const headlines = await generateHeadlinesFromMultipleProducts(topProducts, keywordsWithVolume.slice(0, 10), targetLanguage, userId, brand)

  // 4. 从多个热销商品生成4个广告描述
  console.log('\n📝 从TOP 5热销商品生成4个广告描述...')
  const descriptions = await generateDescriptionsFromMultipleProducts(
    topProducts.map(p => ({
      name: p.name,
      brand: brand,
      rating: p.rating,
      reviewCount: p.reviewCount
    })),
    targetLanguage,
    userId
  )

  return {
    keywords: keywordsWithVolume,
    headlines,
    descriptions,
    sources: {
      productCount: topProducts.length,
      keywordSources: {
        product_title: keywordsWithVolume.filter(k => k.source === 'product_title').length,
        google_suggest: keywordsWithVolume.filter(k => k.source === 'google_suggest').length,
        brand_variant: keywordsWithVolume.filter(k => k.source === 'brand_variant').length
      },
      topProducts: topProducts.map(p => ({
        name: p.name,
        rating: p.rating,
        reviewCount: p.reviewCount
      }))
    }
  }
}
/**
 * 生成广告标题的提示词（从数据库加载版本管理）
 * 🔥 Enhanced to utilize productInfo deep analysis fields
 * 🎯 P1修复: 添加缺失的变量 (price, productCategories, reviewPositives, reviewUseCases, promotionInfo)
 */
async function getHeadlinePrompt(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string
): Promise<string> {
  // 📦 从数据库加载prompt模板 (版本管理)
  const promptTemplate = await loadPrompt('ad_elements_headlines')

  // 🎨 准备模板变量
  const aboutThisItemText = product.aboutThisItem?.slice(0, 5).join('; ') || 'Not provided'
  const featuresText = product.features?.slice(0, 5).join('; ') || 'Not provided'
  const topKeywordsText = topKeywords.map(k => `- ${k.keyword} (Search Volume: ${k.searchVolume})`).join('\n')

  // 🔥 Add deep analysis fields if available
  const uniqueSellingPointsText = product.uniqueSellingPoints || 'Not provided'
  const targetAudienceText = product.targetAudience || 'Not provided'
  const productHighlightsText = product.productHighlights || 'Not provided'
  const brandDescriptionText = product.brandDescription || 'Not provided'

  // 🎯 P1修复: 添加缺失的变量
  const priceText = product.pricing?.current || 'Not provided'
  const productCategoriesText = product.category || 'Not provided'
  const reviewPositivesText = product.reviews?.positives?.slice(0, 5).join(', ') || 'Not provided'
  const reviewUseCasesText = product.reviews?.useCases?.slice(0, 3).join(', ') || 'Not provided'

  // 构建促销信息
  let promotionInfoText = 'No active promotions'
  if (product.promotions?.active) {
    const promoTypes = product.promotions.types?.join(', ') || ''
    const urgency = product.promotions.urgency || ''
    promotionInfoText = `Active: ${promoTypes}${urgency ? ` | ${urgency}` : ''}`
    if (product.promotions.freeShipping) {
      promotionInfoText += ' | Free Shipping'
    }
  }

  // 🔥 v3.2新增：准备深度数据变量
  const userLanguagePatternsText = product.userLanguagePatterns?.slice(0, 6).join(', ') || ''
  const storeAggregatedFeaturesText = product.storeDeepData?.aggregatedFeatures?.slice(0, 8).join(' | ') || ''
  const storeUserVoicesText = product.storeDeepData?.aggregatedReviews?.slice(0, 5).join(' | ') || ''
  const trustBadgesText = product.storeDeepData?.hotBadges?.join(', ') ||
                          product.competitiveEdges?.badges?.join(', ') || ''
  const competitorFeaturesText = product.competitorFeatures?.slice(0, 8).join(' | ') || ''
  const topReviewQuotesText = product.topReviewQuotes?.slice(0, 3).join(' | ') || ''

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{product.name}}', product.name)
    .replace('{{product.brand}}', product.brand || 'Unknown')
    .replace('{{product.rating}}', product.rating?.toString() || 'N/A')
    .replace('{{product.reviewCount}}', product.reviewCount?.toString() || 'N/A')
    .replace('{{product.aboutThisItem}}', aboutThisItemText)
    .replace('{{product.features}}', featuresText)
    .replace('{{topKeywords}}', topKeywordsText)
    // 🔥 Add new template variables for deep analysis
    .replace('{{product.uniqueSellingPoints}}', uniqueSellingPointsText)
    .replace('{{product.targetAudience}}', targetAudienceText)
    .replace('{{product.productHighlights}}', productHighlightsText)
    .replace('{{product.brandDescription}}', brandDescriptionText)
    // 🎯 P1修复: 添加缺失的变量
    .replace('{{product.price}}', priceText)
    .replace('{{productCategories}}', productCategoriesText)
    .replace('{{reviewPositives}}', reviewPositivesText)
    .replace('{{reviewUseCases}}', reviewUseCasesText)
    .replace('{{promotionInfo}}', promotionInfoText)
    // 🔥 v3.2新增: 深度数据变量
    .replace('{{userLanguagePatterns}}', userLanguagePatternsText)
    .replace('{{storeHotFeatures}}', storeAggregatedFeaturesText)
    .replace('{{storeUserVoices}}', storeUserVoicesText)
    .replace('{{trustBadges}}', trustBadgesText)
    .replace('{{competitorFeatures}}', competitorFeaturesText)
    .replace('{{topReviewQuotes}}', topReviewQuotesText)

  return prompt
}

/**
 * 使用AI从单个商品生成15个广告标题
 */
async function generateHeadlines(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = await getHeadlinePrompt(product, topKeywords, targetLanguage)

  // 🆕 Token优化：定义结构化JSON schema（确保AI输出符合预期格式）
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      headlines: {
        type: 'ARRAY' as const,
        description: '15个广告标题数组，每个标题最多30字符',
        items: {
          type: 'STRING' as const
        }
      }
    },
    required: ['headlines']
  }

  try {
    // 智能模型选择：单个产品标题提取使用Flash模型（简单提取任务）
    const response = await generateContent({
      operationType: 'ad_headline_extraction_single',
      prompt,
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5+思考过程消耗~6K tokens，需要16384确保输出完整
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
    }, userId)

    // 记录token使用
    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: response.model,
        operationType: 'ad_headline_extraction_single',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType
      })
    }

    const parsed = extractJsonFromResponse(response.text)

    if (!parsed.headlines || !Array.isArray(parsed.headlines)) {
      throw new Error('AI响应格式错误：缺少headlines字段')
    }

    // 验证数量和长度
    const validHeadlines = parsed.headlines
      .filter((h: string) => h && h.length <= 30)
      .slice(0, 15)

    if (validHeadlines.length < 15) {
      console.warn(`  ⚠️ AI生成的标题不足15个，当前${validHeadlines.length}个`)
      // 补齐到15个（使用前面的标题变体）
      while (validHeadlines.length < 15) {
        const baseHeadline = validHeadlines[validHeadlines.length % validHeadlines.length]
        validHeadlines.push(baseHeadline)
      }
    }

    console.log(`  ✓ 成功生成${validHeadlines.length}个广告标题`)
    return validHeadlines
  } catch (error: any) {
    console.error('  ❌ AI生成标题失败:', error.message)
    // 降级方案：手动生成基础标题
    return generateFallbackHeadlines(product, topKeywords)
  }
}

function parsePromptJsonObject(value: unknown): Record<string, any> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    return null
  }

  return null
}

function toPromptText(value: unknown, maxItems: number = 3): string | null {
  if (Array.isArray(value)) {
    const values = value
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, maxItems)
    return values.length > 0 ? values.join(', ') : null
  }

  const text = String(value || '').trim()
  return text ? text : null
}

function buildStoreProductEvidence(
  products: Array<{
    name?: string
    brand?: string
    rating?: string | number | null
    reviewCount?: string | number | null
    productInfo?: unknown
    reviewAnalysis?: unknown
    competitorAnalysis?: unknown
    features?: string[]
    uniqueSellingPoints?: string
    productHighlights?: string
  }>
): string {
  return products.map((product, index) => {
    const lines = [
      `${index + 1}. Product: ${product.name || 'Unknown Product'}`,
      `   - Brand: ${product.brand || 'Unknown'}`,
      `   - Rating: ${product.rating ?? 'N/A'} (${product.reviewCount ?? 'N/A'} reviews)`,
    ]

    const features = toPromptText(product.features, 3)
    if (features) {
      lines.push(`   - Features: ${features}`)
    }

    const directSellingPoints = toPromptText(product.uniqueSellingPoints || product.productHighlights, 2)
    if (directSellingPoints) {
      lines.push(`   - Selling Points: ${directSellingPoints}`)
    }

    const productInfo = parsePromptJsonObject(product.productInfo)
    const infoSellingPoints = toPromptText(productInfo?.uniqueSellingPoints, 2)
    if (infoSellingPoints) {
      lines.push(`   - Verified Selling Points: ${infoSellingPoints}`)
    }
    const targetAudience = toPromptText(productInfo?.targetAudience, 1)
    if (targetAudience) {
      lines.push(`   - Target Audience: ${targetAudience}`)
    }

    const reviewAnalysis = parsePromptJsonObject(product.reviewAnalysis)
    const customerPraise = toPromptText(reviewAnalysis?.topPositiveKeywords, 3)
    if (customerPraise) {
      lines.push(`   - Customer Praise: ${customerPraise}`)
    }
    const realUseCases = toPromptText(reviewAnalysis?.realUseCases, 2)
    if (realUseCases) {
      lines.push(`   - Use Cases: ${realUseCases}`)
    }

    const competitorAnalysis = parsePromptJsonObject(product.competitorAnalysis)
    const competitiveEdge = toPromptText(competitorAnalysis?.uniqueSellingPoints, 2)
    if (competitiveEdge) {
      lines.push(`   - Competitive Edge: ${competitiveEdge}`)
    }

    return lines.join('\n')
  }).join('\n\n')
}

/**
 * 生成提示词（Headline生成 - 多商品店铺，Prompt版本管理）
 */
async function getMultipleProductHeadlinePrompt(
  products: EnrichedStoreProduct[],
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string,
  brand: string
): Promise<string> {
  const promptTemplate = await loadPrompt('ad_elements_headlines_store')
  const topProductsText = buildStoreProductEvidence(products)
  const topKeywordsText = topKeywords.length > 0
    ? topKeywords.map(k => `- ${k.keyword} (search volume: ${k.searchVolume})`).join('\n')
    : '- none'

  return interpolateTemplate(promptTemplate, {
    targetLanguage,
    brand,
    topProducts: topProductsText,
    topKeywords: topKeywordsText,
  })
}

/**
 * 使用AI从多个商品生成15个广告标题（店铺场景）
 */
async function generateHeadlinesFromMultipleProducts(
  products: EnrichedStoreProduct[],  // 🔥 Changed from ProductInfo[] to utilize deep analysis
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string,
  userId: number,
  brand: string  // 🔥 New parameter for brand context
): Promise<string[]> {
  const prompt = await getMultipleProductHeadlinePrompt(products, topKeywords, targetLanguage, brand)

  // 🆕 Token优化：定义结构化JSON schema
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      headlines: {
        type: 'ARRAY' as const,
        description: '15个广告标题数组，每个标题最多30字符',
        items: {
          type: 'STRING' as const
        }
      }
    },
    required: ['headlines']
  }

  try {
    // 智能模型选择：商店标题提取使用Flash模型（简单提取任务）
    const response = await generateContent({
      operationType: 'ad_headline_extraction_store',
      prompt,
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5+思考过程消耗~6K tokens，需要16384确保输出完整
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
    }, userId)

    // 记录token使用
    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: response.model,
        operationType: 'ad_headline_extraction_store',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType
      })
    }

    const parsed = extractJsonFromResponse(response.text)
    const validHeadlines = parsed.headlines
      .filter((h: string) => h && h.length <= 30)
      .slice(0, 15)

    if (validHeadlines.length < 15) {
      console.warn(`  ⚠️ 标题不足，补齐到15个`)
      while (validHeadlines.length < 15) {
        validHeadlines.push(validHeadlines[validHeadlines.length % validHeadlines.length])
      }
    }

    console.log(`  ✓ 成功生成${validHeadlines.length}个广告标题`)
    return validHeadlines
  } catch (error: any) {
    console.error('  ❌ AI生成标题失败:', error.message)
    return generateFallbackHeadlinesFromMultiple(products, topKeywords)
  }
}

/**
 * 生成广告描述的提示词（从数据库加载版本管理）
 * 🔥 Enhanced to utilize productInfo deep analysis fields
 * 🎯 P1修复: 修复变量命名不一致和添加缺失变量
 */
async function getDescriptionPrompt(product: ProductInfo, targetLanguage: string): Promise<string> {
  // 📦 从数据库加载prompt模板 (版本管理)
  const promptTemplate = await loadPrompt('ad_elements_descriptions')

  // 🎨 准备模板变量
  const featuresText = product.features?.slice(0, 10).join('; ') || 'Not provided'
  const sellingPointsText = product.uniqueSellingPoints || product.productHighlights || 'Not provided'

  // 🎯 P1修复: 添加缺失的变量
  const priceText = product.pricing?.current || 'Not provided'
  const productCategoriesText = product.category || 'Not provided'
  const reviewPositivesText = product.reviews?.positives?.slice(0, 5).join(', ') || 'Not provided'
  const purchaseReasonsText = product.reviews?.useCases?.slice(0, 3).join(', ') || 'Not provided'

  // 构建促销信息
  let promotionInfoText = 'No active promotions'
  if (product.promotions?.active) {
    const promoTypes = product.promotions.types?.join(', ') || ''
    const urgency = product.promotions.urgency || ''
    promotionInfoText = `Active: ${promoTypes}${urgency ? ` | ${urgency}` : ''}`
    if (product.promotions.freeShipping) {
      promotionInfoText += ' | Free Shipping'
    }
  }

  // 🔥 v3.2新增：准备深度数据变量
  const userLanguagePatternsText = product.userLanguagePatterns?.slice(0, 6).join(', ') || ''
  const storeAggregatedFeaturesText = product.storeDeepData?.aggregatedFeatures?.slice(0, 8).join(' | ') || ''
  const storeUserVoicesText = product.storeDeepData?.aggregatedReviews?.slice(0, 5).join(' | ') || ''
  const trustBadgesText = product.storeDeepData?.hotBadges?.join(', ') ||
                          product.competitiveEdges?.badges?.join(', ') || ''
  const competitorFeaturesText = product.competitorFeatures?.slice(0, 8).join(' | ') || ''
  const topReviewQuotesText = product.topReviewQuotes?.slice(0, 3).join(' | ') || ''

  // 🎨 插值替换模板变量 - 匹配prompt模板中的变量名
  const prompt = promptTemplate
    .replace('{{productName}}', product.name)
    .replace('{{brand}}', product.brand || 'Unknown')
    .replace('{{price}}', priceText)
    .replace('{{rating}}', product.rating?.toString() || 'N/A')
    .replace('{{reviewCount}}', product.reviewCount?.toString() || 'N/A')
    .replace('{{features}}', featuresText)
    .replace('{{sellingPoints}}', sellingPointsText)
    .replace('{{productCategories}}', productCategoriesText)
    .replace('{{reviewPositives}}', reviewPositivesText)
    .replace('{{purchaseReasons}}', purchaseReasonsText)
    .replace('{{promotionInfo}}', promotionInfoText)
    // 🔥 v3.2新增：深度数据增强变量
    .replace('{{userLanguagePatterns}}', userLanguagePatternsText)
    .replace('{{storeHotFeatures}}', storeAggregatedFeaturesText)
    .replace('{{storeUserVoices}}', storeUserVoicesText)
    .replace('{{trustBadges}}', trustBadgesText)
    .replace('{{competitorFeatures}}', competitorFeaturesText)
    .replace('{{topReviewQuotes}}', topReviewQuotesText)

  return prompt
}


/**
 * 使用AI从单个商品生成4个广告描述
 */
async function generateDescriptions(
  product: ProductInfo,
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = await getDescriptionPrompt(product, targetLanguage)

  // 🆕 Token优化：定义结构化JSON schema
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      descriptions: {
        type: 'ARRAY' as const,
        description: '4个广告描述数组，每个描述最多90字符',
        items: {
          type: 'STRING' as const
        }
      }
    },
    required: ['descriptions']
  }

  try {
    // 智能模型选择：单个产品描述提取使用Flash模型（简单提取任务）
    const response = await generateContent({
      operationType: 'ad_description_extraction_single',
      prompt,
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5+思考过程消耗~6K tokens，需要16384确保输出完整
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
    }, userId)

    // 记录token使用
    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: response.model,
        operationType: 'ad_description_extraction_single',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType
      })
    }

    const parsed = extractJsonFromResponse(response.text)
    const validDescriptions = parsed.descriptions
      .filter((d: string) => d && d.length <= 90)
      .slice(0, 4)

    if (validDescriptions.length < 4) {
      console.warn(`  ⚠️ 描述不足4个，补齐`)
      while (validDescriptions.length < 4) {
        validDescriptions.push(validDescriptions[validDescriptions.length % validDescriptions.length])
      }
    }

    console.log(`  ✓ 成功生成${validDescriptions.length}个广告描述`)
    return validDescriptions
  } catch (error: any) {
    console.error('  ❌ AI生成描述失败:', error.message)
    return generateFallbackDescriptions(product)
  }
}

/**
 * 生成提示词（Description生成 - 多商品店铺，Prompt版本管理）
 */
async function getMultipleProductDescriptionPrompt(products: ProductInfo[], targetLanguage: string): Promise<string> {
  const promptTemplate = await loadPrompt('ad_elements_descriptions_store')
  const topProductsText = buildStoreProductEvidence(products)
  const brand = products[0]?.brand || 'Unknown'

  return interpolateTemplate(promptTemplate, {
    targetLanguage,
    brand,
    topProducts: topProductsText,
  })
}

/**
 * 使用AI从多个商品生成4个广告描述（店铺场景）
 */
async function generateDescriptionsFromMultipleProducts(
  products: ProductInfo[],
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = await getMultipleProductDescriptionPrompt(products, targetLanguage)

  // 🆕 Token优化：定义结构化JSON schema
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      descriptions: {
        type: 'ARRAY' as const,
        description: '4个广告描述数组，每个描述最多90字符',
        items: {
          type: 'STRING' as const
        }
      }
    },
    required: ['descriptions']
  }

  try {
    // 智能模型选择：商店描述提取使用Flash模型（简单提取任务）
    const response = await generateContent({
      operationType: 'ad_description_extraction_store',
      prompt,
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5+思考过程消耗~6K tokens，需要16384确保输出完整
      responseSchema,  // 🆕 传递JSON schema约束
      responseMimeType: 'application/json'  // 🆕 强制JSON输出
    }, userId)

    // 记录token使用
    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: response.model,
        operationType: 'ad_description_extraction_store',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType
      })
    }

    const parsed = extractJsonFromResponse(response.text)
    const validDescriptions = parsed.descriptions
      .filter((d: string) => d && d.length <= 90)
      .slice(0, 4)

    if (validDescriptions.length < 4) {
      while (validDescriptions.length < 4) {
        validDescriptions.push(validDescriptions[validDescriptions.length % validDescriptions.length])
      }
    }

    console.log(`  ✓ 成功生成${validDescriptions.length}个广告描述`)
    return validDescriptions
  } catch (error: any) {
    console.error('  ❌ AI生成描述失败:', error.message)
    return generateFallbackDescriptionsFromMultiple(products)
  }
}

/**
 * 降级方案：手动生成基础标题（单商品）
 */
function normalizeFallbackCopyText(text: string, maxLength: number): string | null {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (/\b(buy|shop|sale|discount|deal|coupon|promo|official|store|amazon)\b/i.test(normalized)) {
    return null
  }
  return normalized.slice(0, maxLength)
}

function dedupeFallbackCopyTexts(candidates: string[], maxLength: number): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const candidate of candidates) {
    const normalized = normalizeFallbackCopyText(candidate, maxLength)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function collectFallbackFeaturePhrases(values: Array<string | null | undefined>, limit: number): string[] {
  const phrases: string[] = []
  for (const raw of values) {
    const normalized = normalizeGoogleAdsKeyword(raw || '')
    if (!normalized) continue
    const tokens = normalized
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 3 || /\d/.test(token))
      .filter((token) => !/^(buy|shop|sale|discount|deal|official|store|review|reviews|amazon|free|shipping)$/i.test(token))
      .slice(0, 4)
    if (tokens.length === 0) continue
    phrases.push(tokens.join(' '))
    if (phrases.length >= limit) break
  }
  return phrases
}

function generateFallbackHeadlines(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string }>
): string[] {
  const brand = product.brand || 'Brand'
  const productName = product.name || 'Product'
  const brandProductName = extractBrandProductName(productName, brand)
  const featureSource = product.aboutThisItem?.length ? product.aboutThisItem : product.features
  const featurePhrases = collectFallbackFeaturePhrases(featureSource || [], 6)
  const headlineCandidates = [
    brandProductName,
    ...topKeywords.slice(0, 8).map((item) => item.keyword),
    ...featurePhrases.map((phrase) => `${brand} ${phrase}`),
    brand,
  ]

  const headlines = dedupeFallbackCopyTexts(headlineCandidates, 30)
  if (headlines.length === 0) {
    headlines.push((brandProductName || brand || 'Product').slice(0, 30))
  }
  while (headlines.length < 15) {
    headlines.push(headlines[headlines.length % headlines.length])
  }
  return headlines.slice(0, 15)
}

/**
 * 降级方案：手动生成基础标题（多商品）
 */
function generateFallbackHeadlinesFromMultiple(
  products: EnrichedStoreProduct[],  // 🔥 Updated to match main function signature
  topKeywords: Array<{ keyword: string }>
): string[] {
  // Extract brand from first product or enriched data
  const brand = products[0]?.productInfo
    ? (typeof products[0].productInfo === 'string'
        ? JSON.parse(products[0].productInfo).brandDescription?.split(' ')[0]
        : products[0].productInfo.brandDescription?.split(' ')[0]) || 'Brand'
    : 'Brand'

  const productHeadlineSeeds = products
    .slice(0, 6)
    .map((product) => extractBrandProductName(product.name, brand))
  const headlines = dedupeFallbackCopyTexts([
    ...productHeadlineSeeds,
    ...topKeywords.slice(0, 6).map((item) => item.keyword),
    `${brand} product lineup`,
    `${brand} product details`,
    brand,
  ], 30)

  if (headlines.length === 0) {
    headlines.push((brand || 'Brand').slice(0, 30))
  }
  while (headlines.length < 15) {
    headlines.push(headlines[headlines.length % headlines.length])
  }
  return headlines.slice(0, 15)
}

/**
 * 降级方案：手动生成基础描述（单商品）
 */
function generateFallbackDescriptions(product: ProductInfo): string[] {
  const brand = product.brand || 'Brand'
  const productName = extractBrandProductName(product.name || brand, brand)
  const featureSource = product.aboutThisItem?.length ? product.aboutThisItem : product.features
  const featurePhrases = collectFallbackFeaturePhrases(featureSource || [], 4)
  const ratingSummary = product.rating
    ? `${brand} rating ${product.rating}${product.reviewCount ? ` (${product.reviewCount} reviews)` : ''}`
    : `${brand} listing data available`

  const descriptionCandidates = [
    `${productName} ${featurePhrases[0] || 'detailed specifications available'}`,
    `${brand} features: ${featurePhrases.slice(0, 2).join(', ') || 'see product details and compatibility'}`,
    ratingSummary,
    `${brand} model details and use scenarios are ready for review`,
  ]

  const descriptions = dedupeFallbackCopyTexts(descriptionCandidates, 90)
  if (descriptions.length === 0) {
    descriptions.push(`${brand} product details available`.slice(0, 90))
  }
  while (descriptions.length < 4) {
    descriptions.push(descriptions[descriptions.length % descriptions.length])
  }
  return descriptions.slice(0, 4)
}

/**
 * 降级方案：手动生成基础描述（多商品）
 */
function generateFallbackDescriptionsFromMultiple(products: ProductInfo[]): string[] {
  const brand = products[0]?.brand || 'Brand'
  const topNames = products
    .slice(0, 3)
    .map((item) => extractBrandProductName(item.name || '', brand))
    .filter(Boolean)
    .join(', ')

  const ratedProducts = products.filter((item) => typeof item.rating === 'number')
  const avgRating = ratedProducts.length > 0
    ? (ratedProducts.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratedProducts.length).toFixed(1)
    : null

  const descriptionCandidates = [
    `${brand} includes ${products.length} listed products with structured details`,
    topNames ? `Top products: ${topNames}` : `${brand} product lineup covers multiple models`,
    avgRating ? `${brand} average rating ${avgRating} across sampled products` : `${brand} product metadata collected`,
    `${brand} supports model comparison by features and compatibility`,
  ]

  const descriptions = dedupeFallbackCopyTexts(descriptionCandidates, 90)
  if (descriptions.length === 0) {
    descriptions.push(`${brand} product details available`.slice(0, 90))
  }
  while (descriptions.length < 4) {
    descriptions.push(descriptions[descriptions.length % descriptions.length])
  }
  return descriptions.slice(0, 4)
}

/**
 * 🔥 Helper Function: Expand Product Data for Prompt Inclusion
 *
 * Formats deep analysis data (productInfo, reviewAnalysis, competitorAnalysis)
 * into structured text for AI prompt context enrichment.
 *
 * @param product - EnrichedStoreProduct with deep analysis fields
 * @returns Formatted multi-line string with all available analysis data
 */
function expandProductDataForPrompt(product: EnrichedStoreProduct): string {
  const parts = []

  // Basic information
  parts.push(`Product: ${product.name}`)
  if (product.rating) parts.push(`Rating: ${product.rating}⭐ (${product.reviewCount || 'N/A'} reviews)`)
  if (product.price) parts.push(`Price: ${product.price}`)

  // AI product analysis (productInfo)
  if (product.productInfo) {
    const info = typeof product.productInfo === 'string' ? JSON.parse(product.productInfo) : product.productInfo
    parts.push(`\nProduct Analysis:`)
    if (info.brandDescription) parts.push(`- Brand: ${info.brandDescription}`)
    if (info.uniqueSellingPoints) parts.push(`- USP: ${info.uniqueSellingPoints}`)
    if (info.targetAudience) parts.push(`- Target: ${info.targetAudience}`)
    if (info.productHighlights) parts.push(`- Highlights: ${info.productHighlights}`)
    if (info.category) parts.push(`- Category: ${info.category}`)
  }

  // Review analysis (reviewAnalysis)
  if (product.reviewAnalysis) {
    const analysis = typeof product.reviewAnalysis === 'string' ? JSON.parse(product.reviewAnalysis) : product.reviewAnalysis
    parts.push(`\nCustomer Insights:`)
    if (analysis.sentimentDistribution) {
      parts.push(`- Sentiment: Positive ${analysis.sentimentDistribution.positive}%, Neutral ${analysis.sentimentDistribution.neutral}%, Negative ${analysis.sentimentDistribution.negative}%`)
    }
    if (analysis.topPositiveKeywords && analysis.topPositiveKeywords.length > 0) {
      parts.push(`- Praise: ${analysis.topPositiveKeywords.slice(0, 5).join(', ')}`)
    }
    if (analysis.topNegativeKeywords && analysis.topNegativeKeywords.length > 0) {
      parts.push(`- Complaints: ${analysis.topNegativeKeywords.slice(0, 3).join(', ')}`)
    }
    if (analysis.realUseCases && analysis.realUseCases.length > 0) {
      parts.push(`- Use Cases: ${analysis.realUseCases.slice(0, 3).join(', ')}`)
    }
  }

  // Competitive analysis (competitorAnalysis)
  if (product.competitorAnalysis) {
    const compAnalysis = typeof product.competitorAnalysis === 'string' ? JSON.parse(product.competitorAnalysis) : product.competitorAnalysis
    parts.push(`\nCompetitive Position:`)
    if (compAnalysis.pricePosition) parts.push(`- Price: ${compAnalysis.pricePosition}`)
    if (compAnalysis.ratingPosition) parts.push(`- Rating: ${compAnalysis.ratingPosition}`)
    if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
      parts.push(`- Advantages: ${compAnalysis.uniqueSellingPoints.slice(0, 3).join(', ')}`)
    }
    if (compAnalysis.overallCompetitiveness !== undefined) {
      parts.push(`- Competitiveness Score: ${compAnalysis.overallCompetitiveness}/100`)
    }
  }

  return parts.join('\n')
}

/**
 * 主入口：提取广告元素
 *
 * @param scraped - 爬虫数据（单商品或店铺）
 * @param brand - 品牌名称
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param userId - 用户ID
 */
export async function extractAdElements(
  scraped: {
    pageType: 'product' | 'store' | 'unknown'
    product?: AmazonProductData
    storeProducts?: (StoreProduct | EnrichedStoreProduct)[]  // 🔥 支持普通和深度产品数据
    hasDeepData?: boolean  // 🔥 标记是否包含深度数据
  },
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log('\n🎯 开始提取广告关键元素...')
  console.log(`  - 场景类型: ${scraped.pageType}`)
  console.log(`  - 品牌: ${brand}`)
  console.log(`  - 目标国家: ${targetCountry}`)
  console.log(`  - 目标语言: ${targetLanguage}`)

  if (scraped.pageType === 'product' && scraped.product) {
    return await extractFromSingleProduct(
      scraped.product,
      brand,
      targetCountry,
      targetLanguage,
      userId
    )
  } else if (scraped.pageType === 'store' && scraped.storeProducts && scraped.storeProducts.length > 0) {
    return await extractFromStore(
      scraped.storeProducts.map(p => ({
        ...p,
        price: p.price ?? null
      })) as StoreProduct[],
      brand,
      targetCountry,
      targetLanguage,
      userId
    )
  } else {
    throw new Error(`无法提取广告元素：pageType=${scraped.pageType}, 商品数据=${scraped.product ? '有' : '无'}, 店铺商品=${scraped.storeProducts?.length || 0}个`)
  }
}
