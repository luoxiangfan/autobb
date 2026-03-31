/**
 * P0高级优化：竞品对比分析
 *
 * 功能：
 * 1. 智能识别竞品（从多个来源）
 * 2. 提取竞品数据（价格、评分、特性）
 * 3. AI分析竞争定位（价格优势、评分优势、功能对比）
 * 4. 识别独特卖点（USP）和竞品优势
 * 5. 为广告创意生成提供差异化洞察
 *
 * 预期效果：
 * - 差异化定位显著提升
 * - 转化率提升: +15-20%（明确价值主张）
 * - 广告质量分数: +20%（相关性和独特性）
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getLanguageNameForCountry } from './language-country-codes'
import { compressCompetitors, type CompetitorInfo as CompressorCompetitorInfo } from './competitor-compressor'
import { withCache, type CacheOptions } from './ai-cache'
import { loadPrompt } from './prompt-loader'
import { parsePrice } from './pricing-utils'

// ==================== 数据结构定义 ====================

/**
 * 单个竞品的基础信息
 */
export interface CompetitorProduct {
  asin: string | null
  name: string
  brand: string | null
  price: number | null              // 数值价格（便于计算）
  priceText: string | null          // 原始价格文本
  rating: number | null
  reviewCount: number | null
  imageUrl: string | null
  // 🔥 新增：商品链接（用于前端展示可点击链接）
  productUrl?: string | null

  // 竞品来源
  source: 'amazon_compare' | 'amazon_also_viewed' | 'amazon_similar' | 'same_category' | 'related_products'

  // 相似度评分（0-100）
  similarityScore?: number

  // 关键特性（从页面提取）
  features?: string[]
}

/**
 * 价格竞争力分析
 */
export interface PricePosition {
  ourPrice: number
  avgCompetitorPrice: number
  minCompetitorPrice: number
  maxCompetitorPrice: number
  pricePercentile: number         // 在竞品中的价格百分位（0-100）
  priceAdvantage: 'lowest' | 'below_average' | 'average' | 'above_average' | 'premium'
  savingsVsAvg: string | null     // "Save $20 vs average competitor"
  savingsVsMin: string | null     // "Only $5 more than cheapest"
}

/**
 * 评分竞争力分析
 */
export interface RatingPosition {
  ourRating: number
  avgCompetitorRating: number
  maxCompetitorRating: number
  minCompetitorRating: number
  ratingPercentile: number
  ratingAdvantage: 'top_rated' | 'above_average' | 'average' | 'below_average'
}

/**
 * 功能对比项
 */
export interface FeatureComparison {
  feature: string              // "4K Resolution", "Night Vision"
  weHave: boolean
  competitorsHave: number      // 有此功能的竞品数量
  ourAdvantage: boolean        // 我们有而大多数竞品没有
}

/**
 * 独特卖点（USP）
 */
export interface UniqueSellingPoint {
  usp: string                  // "Only camera with solar panel option"
  differentiator: string       // 差异化说明
  competitorCount: number      // 有此功能的竞品数量（越少越独特）
  significance: 'high' | 'medium' | 'low'  // 差异化重要性
}

/**
 * 竞品优势（需要应对的）
 */
export interface CompetitorAdvantage {
  advantage: string            // "Longer warranty", "More storage options"
  competitor: string           // 竞品名称
  howToCounter: string         // AI建议的应对策略
}

/**
 * 🔥 v3.2新增：竞品弱点（可转化为我们的卖点）
 * 从竞品的负面评论、用户抱怨中提取
 */
export interface CompetitorWeakness {
  weakness: string             // "Short battery life", "Difficult setup"
  competitor: string           // 竞品名称或 "Multiple competitors"
  frequency: 'high' | 'medium' | 'low'  // 该弱点的普遍程度
  ourAdvantage: string         // 我们如何避免这个问题或做得更好
  adCopy: string               // 可直接用于广告的文案（如 "Unlike others, 8-hour battery life"）
}

/**
 * 完整的竞品分析结果
 */
export interface CompetitorAnalysisResult {
  // 识别的竞品
  competitors: CompetitorProduct[]
  totalCompetitors: number

  // 价格竞争力
  pricePosition: PricePosition | null

  // 评分竞争力
  ratingPosition: RatingPosition | null

  // 功能对比
  featureComparison: FeatureComparison[]

  // 独特卖点
  uniqueSellingPoints: UniqueSellingPoint[]

  // 竞品优势
  competitorAdvantages: CompetitorAdvantage[]

  // 🔥 v3.2新增：竞品弱点（可转化为我们的卖点）
  competitorWeaknesses?: CompetitorWeakness[]

  // 综合竞争力评分（0-100）
  overallCompetitiveness: number

  // 分析时间
  analyzedAt: string
}

// ==================== AI驱动的竞品发现逻辑 ====================

/**
 * 从产品名称中提取核心产品类型关键词
 * 用于品类验证，确保推断的竞品与原产品在同一类目
 */
function extractCoreProductType(productNameLower: string): string[] {
  const keywords: string[] = []

  // 常见产品类型关键词（按优先级排序）
  const productTypes = [
    // 家电类
    'robot vacuum', 'vacuum cleaner', 'air purifier', 'humidifier', 'dehumidifier',
    'robot aspirapolvere', 'aspirapolvere', 'purificatore', 'umidificatore',

    // 电子产品
    'wireless earbuds', 'earbuds', 'headphones', 'speaker', 'soundbar',
    'auricolari', 'cuffie', 'altoparlante',

    // 智能设备
    'video conferencing camera', 'conference camera', 'conference webcam', 'webcam', 'ptz camera',
    'security camera', 'smart camera', 'doorbell', 'smart lock', 'smart display',
    'videocamera', 'telecamera', 'citofono', 'serratura intelligente',

    // 健康美容
    'electric toothbrush', 'hair dryer', 'trimmer', 'shaver',
    'spazzolino elettrico', 'asciugacapelli', 'rasoio',

    // 厨房电器
    'coffee maker', 'blender', 'air fryer', 'microwave',
    'macchina caffè', 'frullatore', 'friggitrice',
  ]

  // 提取匹配的产品类型关键词
  for (const type of productTypes) {
    if (productNameLower.includes(type)) {
      keywords.push(type)
    }
  }

  // 如果没有匹配到预定义类型，尝试提取核心名词短语
  if (keywords.length === 0) {
    // 提取最后2-3个有意义的词作为产品类型
    const words = productNameLower.split(/\s+/)
    const meaningfulWords = words.filter(w =>
      w.length > 3 &&
      !['with', 'and', 'the', 'for', 'con', 'per', 'alla'].includes(w)
    )

    if (meaningfulWords.length >= 2) {
      // 取最后2-3个词作为产品类型
      const lastWords = meaningfulWords.slice(-3).join(' ')
      keywords.push(lastWords)
    }
  }

  return keywords
}

/**
 * 使用AI推断竞品搜索关键词
 *
 * @param productInfo 产品基本信息（增强版：包含features、sellingPoints等）
 * @param userId 用户ID（用于token计费）
 * @returns 竞品搜索关键词数组
 */
export async function inferCompetitorKeywords(
  productInfo: {
    name: string
    brand: string | null
    category: string
    price: number | null
    targetCountry: string
    // 🆕 增强字段：提供更多上下文帮助AI推断更准确的搜索词
    features?: string[]           // 产品特性列表
    aboutThisItem?: string[]      // 关于此商品
    sellingPoints?: string[]      // 卖点
    productDescription?: string   // 产品描述
  },
  userId: number
): Promise<string[]> {
  console.log(`🤖 AI推断竞品搜索关键词...`)

  // 根据目标国家确定分析语言
  const langName = getLanguageNameForCountry(productInfo.targetCountry)

  // 📦 从数据库加载prompt模板 (版本管理)
  const promptTemplate = await loadPrompt('competitor_keyword_inference')

  // 🆕 构建产品特性文本（用于AI更好地理解产品类型）
  const featuresText = [
    ...(productInfo.features || []),
    ...(productInfo.aboutThisItem || []),
    ...(productInfo.sellingPoints || [])
  ].slice(0, 10).join('\n- ') || 'Not provided'

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{productInfo.name}}', productInfo.name)
    .replace('{{productInfo.brand}}', productInfo.brand || 'Unknown')
    .replace('{{productInfo.category}}', productInfo.category)
    .replace('{{productInfo.features}}', featuresText)
    .replace('{{productInfo.description}}', productInfo.productDescription || 'Not provided')
    .replace('{{productInfo.price}}', productInfo.price ? `Around $${productInfo.price}` : 'Not specified')
    .replace('{{productInfo.targetCountry}}', productInfo.targetCountry)

  try {
    const aiResponse = await generateContent({
      operationType: 'competitor_summary',
      prompt,
      temperature: 0.3,  // 低温度保证稳定输出
      maxOutputTokens: 8192,  // ✅ 修复：增加到8192，确保复杂产品的JSON输出完整
    }, userId)

    // 记录token使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'competitor_keyword_inference',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 提取JSON
    let jsonText = aiResponse.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.warn('⚠️ AI返回格式错误，使用智能降级方案')
      console.warn(`   AI原始返回: ${aiResponse.text.substring(0, 200)}...`)

      // ✅ 改进降级方案：结合产品名称和品类生成搜索词
      const fallbackTerms = []

      // 1. 如果有产品名称（不是Unknown），使用产品名称的核心词
      if (productInfo.name && productInfo.name !== 'Unknown Product') {
        // 移除品牌名，提取产品类型词
        const nameWithoutBrand = productInfo.brand
          ? productInfo.name.replace(new RegExp(productInfo.brand, 'gi'), '').trim()
          : productInfo.name
        if (nameWithoutBrand.length > 2) {
          fallbackTerms.push(nameWithoutBrand)
        }
      }

      // 2. 如果有品类（不是Unknown），使用品类词
      if (productInfo.category && productInfo.category !== 'Unknown' && productInfo.category !== 'Dati non disponibili') {
        fallbackTerms.push(productInfo.category)
      }

      // 3. 如果前两个都失败，至少返回一个通用搜索词
      if (fallbackTerms.length === 0) {
        fallbackTerms.push(`products ${productInfo.targetCountry}`)
      }

      console.warn(`   降级搜索词: ${fallbackTerms.join(', ')}`)
      return fallbackTerms.slice(0, 3)  // 最多返回3个
    }

    const result = JSON.parse(jsonMatch[0])
    let searchTerms = result.searchTerms || []

    // ✅ 修复: 确保searchTerms是字符串数组，处理AI返回对象的情况
    if (!Array.isArray(searchTerms)) {
      console.warn(`⚠️ AI返回的searchTerms不是数组，尝试修复...`)
      searchTerms = []
    }

    // 过滤并转换为字符串数组
    searchTerms = searchTerms
      .map((term: any) => {
        // 如果是对象（例如 {term: "xxx", type: "xxx"}），提取term字段
        if (typeof term === 'object' && term !== null) {
          return term.term || term.value || term.name || String(term)
        }
        // 如果是字符串，直接使用
        if (typeof term === 'string') {
          return term
        }
        // 其他类型转换为字符串
        return String(term)
      })
      .filter((term: string) => term && term.trim().length > 0)  // 过滤空字符串

    console.log(`🔍 AI返回了${searchTerms.length}个搜索词，类型检查通过`)

    // 🔍 品类验证：提取产品名称中的核心类型关键词
    const productNameLower = productInfo.name.toLowerCase()
    const coreTypeKeywords = extractCoreProductType(productNameLower)

    if (coreTypeKeywords.length > 0 && searchTerms.length > 0) {
      // 验证每个搜索词是否包含核心类型关键词
      const validatedTerms = searchTerms.filter((term: string) => {
        const termLower = term.toLowerCase()
        // 检查是否至少包含一个核心类型关键词
        return coreTypeKeywords.some(keyword => termLower.includes(keyword))
      })

      if (validatedTerms.length < searchTerms.length) {
        console.warn(`⚠️ 品类验证：过滤掉${searchTerms.length - validatedTerms.length}个跨品类搜索词`)
        console.warn(`   原始搜索词: ${searchTerms.join(', ')}`)
        console.warn(`   核心类型: ${coreTypeKeywords.join(', ')}`)
        console.warn(`   验证后: ${validatedTerms.join(', ')}`)
      }

      searchTerms = validatedTerms.length > 0 ? validatedTerms : searchTerms
    }

    console.log(`✅ AI推断了${searchTerms.length}个搜索词: ${searchTerms.join(', ')}`)
    return searchTerms

  } catch (error: any) {
    console.error('❌ AI推断失败:', error.message)
    // 降级方案
    return [`${productInfo.category} ${productInfo.targetCountry}`]
  }
}

/**
 * 🔥 优化：从长搜索词中提取简短版本
 * "Hikvision telecamera di sorveglianza bullet" → ["Hikvision", "Hikvision camera"]
 */
function generateSearchVariants(term: string): string[] {
  // ✅ 修复: 确保term是字符串
  if (typeof term !== 'string' || !term) {
    console.warn(`⚠️ generateSearchVariants收到非字符串参数: ${typeof term}`)
    return []
  }

  const variants: string[] = [term]  // 原始搜索词

  // 提取品牌名（通常是第一个单词）
  const words = term.trim().split(/\s+/)
  if (words.length > 0) {
    const brand = words[0]

    // 品牌名单独作为搜索词
    if (brand.length >= 3 && brand.length <= 20) {
      variants.push(brand)
    }

    // 品牌+通用类型关键词（camera, vacuum等）
    const genericTypes = [
      'camera', 'telecamera', 'videocamera',  // 摄像机
      'vacuum', 'aspirapolvere',               // 吸尘器
      'earbuds', 'auricolari', 'cuffie',      // 耳机
      'speaker', 'altoparlante',               // 音箱
      'router', 'modem',                       // 路由器
      'watch', 'orologio',                     // 手表
      'phone', 'telefono',                     // 手机
    ]

    const termLower = term.toLowerCase()
    for (const type of genericTypes) {
      if (termLower.includes(type)) {
        variants.push(`${brand} ${type}`)
        break
      }
    }
  }

  // 去重并返回
  return [...new Set(variants)]
}

/**
 * 🔥 优化：执行单次Amazon搜索，提取结果
 *
 * @param page Playwright页面对象
 * @param searchTerm 搜索关键词
 * @param domain Amazon域名（如amazon.it）
 * @param limit 提取产品数量上限
 * @param maxRetries 最大重试次数（默认2）
 * @returns 竞品产品数组
 */
async function executeAmazonSearch(
  page: any,
  searchTerm: string,
  domain: string,
  limit: number,
  maxRetries: number = 2
): Promise<CompetitorProduct[]> {
  const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(searchTerm)}`

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`     ↳ 重试 ${attempt}/${maxRetries}...`)
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
      }

      // 🔥 修复：使用动态超时，国际站点需要更长时间
      // Amazon搜索页面复杂度较高，统一使用60秒超时
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

      // 等待搜索结果加载（增加超时时间）
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 10000 })
        .catch(() => null)

      // 提取搜索结果
      const results = await page.evaluate((maxItems: number) => {
        const items: any[] = []
        const resultElements = document.querySelectorAll('[data-component-type="s-search-result"]')

        // 在evaluate内部定义价格解析函数（支持欧洲和美国格式）
        function parsePriceInBrowser(text: string): number | null {
          if (!text) return null

          // 移除货币符号和空格
          const cleaned = text.replace(/[€$£¥₹\s]/g, '').trim()
          if (!cleaned) return null

          const lastCommaIndex = cleaned.lastIndexOf(',')
          const lastDotIndex = cleaned.lastIndexOf('.')

          let normalized: string

          if (lastCommaIndex > lastDotIndex) {
            // 欧洲格式: 逗号在后面是小数点 "1.299,99" → "1299.99"
            normalized = cleaned.replace(/\./g, '').replace(',', '.')
          } else if (lastDotIndex > lastCommaIndex) {
            // 美国格式: 点在后面是小数点 "1,299.99" → "1299.99"
            normalized = cleaned.replace(/,/g, '')
          } else if (lastCommaIndex !== -1 && lastDotIndex === -1) {
            // 只有逗号: 判断是欧洲小数点还是千位分隔符
            const afterComma = cleaned.split(',')[1]
            if (afterComma && afterComma.length <= 2) {
              // 逗号后1-2位数字，是欧洲小数点 "319,00" → "319.00"
              normalized = cleaned.replace(',', '.')
            } else {
              // 逗号后超过2位，是千位分隔符 "1,000,000" → "1000000"
              normalized = cleaned.replace(/,/g, '')
            }
          } else {
            // 没有逗号也没有点
            normalized = cleaned
          }

          const price = parseFloat(normalized)
          return isNaN(price) ? null : price
        }

        for (let i = 0; i < Math.min(maxItems, resultElements.length); i++) {
          const el = resultElements[i]

          let asin = el.getAttribute('data-asin')
          if (!asin) continue

          // 🔧 修复: 清理ASIN中的deal标识符后缀 (如 :amzn1.deal.xxx)
          // Amazon搜索结果的data-asin有时包含deal参数，需要移除
          if (asin.includes(':')) {
            asin = asin.split(':')[0]
          }

          const nameEl = el.querySelector('h2 a span, h2 span')
          const name = nameEl?.textContent?.trim() || ''

          const priceEl = el.querySelector('.a-price .a-offscreen')
          const priceText = priceEl?.textContent?.trim() || null

          const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt')
          const ratingText = ratingEl?.textContent?.trim() || null
          const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

          const reviewEl = el.querySelector('[aria-label*="stars"]')
          const reviewText = reviewEl?.getAttribute('aria-label') || null
          const reviewCount = reviewText ? parseInt(reviewText.replace(/\D/g, '')) : null

          const imageEl = el.querySelector('.s-image') as HTMLImageElement | null
          const imageUrl = imageEl?.src || null

          if (name && priceText) {
            items.push({
              asin,
              name,
              brand: null,
              priceText,
              price: parsePriceInBrowser(priceText || ''),
              rating,
              reviewCount,
              imageUrl,
              source: 'amazon_search'
            })
          }
        }

        return items
      }, limit)

      // 成功提取结果，返回
      return results

    } catch (error: any) {
      lastError = error
      console.warn(`     ✗ 搜索失败 (尝试 ${attempt + 1}/${maxRetries + 1}): ${error.message?.substring(0, 100)}`)

      // 如果不是最后一次重试，继续
      if (attempt < maxRetries) {
        continue
      }
    }
  }

  // 所有重试都失败，抛出最后的错误
  throw lastError || new Error('Amazon搜索失败：已用尽所有重试')
}

/**
 * 在Amazon上搜索验证竞品
 *
 * 🔥 优化：智能搜索策略
 * 1. 先尝试完整搜索词
 * 2. 如果无结果，自动降级到简短搜索词（仅品牌名或品牌+通用类型）
 * 3. 记录搜索效果，用于后续优化
 *
 * @param searchTerms AI推断的搜索关键词
 * @param page Playwright页面对象
 * @param targetCountry 目标国家
 * @param limit 每个搜索词提取的产品数量
 * @returns 验证后的真实竞品数组
 */
export async function searchCompetitorsOnAmazon(
  searchTerms: string[],
  page: any,
  targetCountry: string,
  limit: number = 2
): Promise<CompetitorProduct[]> {
  console.log(`🔍 开始Amazon搜索验证竞品，搜索词数量: ${searchTerms.length}`)

  const competitors: CompetitorProduct[] = []
  const domain = getAmazonDomain(targetCountry)
  const searchStats = { total: 0, success: 0, fallback: 0 }

  for (const term of searchTerms.slice(0, 5)) { // 最多搜索5次
    searchStats.total++
    console.log(`   搜索: "${term}"`)

    try {
      // 🔥 生成搜索变体（原始词 + 简短版本）
      const variants = generateSearchVariants(term)
      let foundResults = false

      for (const variant of variants) {
        const isOriginal = variant === term
        if (!isOriginal) {
          console.log(`     ↳ 降级搜索: "${variant}"`)
        }

        const results = await executeAmazonSearch(page, variant, domain, limit)

        if (results.length > 0) {
          console.log(`   ✅ 找到${results.length}个产品${!isOriginal ? ' (简短搜索词)' : ''}`)
          competitors.push(...results)
          foundResults = true
          searchStats.success++
          if (!isOriginal) searchStats.fallback++
          break  // 找到结果就停止尝试变体
        }
      }

      if (!foundResults) {
        console.log(`   ⚠️ 未找到结果（已尝试${variants.length}个变体）`)
      }

      // 达到目标数量就停止
      if (competitors.length >= 10) {
        console.log(`   已收集足够竞品，停止搜索`)
        break
      }

    } catch (error: any) {
      console.warn(`   ⚠️ 搜索"${term}"失败: ${error.message}`)
      continue
    }
  }

  // 去重
  const uniqueCompetitors = deduplicateCompetitors(competitors)
  console.log(`✅ 搜索验证完成，共找到${uniqueCompetitors.length}个真实竞品`)
  console.log(`   📊 搜索统计: ${searchStats.success}/${searchStats.total}成功，${searchStats.fallback}次使用降级搜索`)

  return uniqueCompetitors
}

/**
 * 根据国家代码获取Amazon域名
 */
function getAmazonDomain(countryCode: string): string {
  const domainMap: Record<string, string> = {
    'US': 'amazon.com',
    'UK': 'amazon.co.uk',
    'DE': 'amazon.de',
    'FR': 'amazon.fr',
    'IT': 'amazon.it',
    'ES': 'amazon.es',
    'JP': 'amazon.co.jp',
    'CA': 'amazon.ca',
    'AU': 'amazon.com.au',
    'IN': 'amazon.in',
    'MX': 'amazon.com.mx',
    'BR': 'amazon.com.br',
  }
  return domainMap[countryCode] || 'amazon.com'
}

// ==================== 竞品抓取逻辑（保留作为补充数据源）====================

/**
 * 从Playwright页面对象中抓取Amazon竞品信息
 *
 * 策略：
 * 1. 优先从"Compare with similar items"区域抓取（最相关）
 * 2. 如果没有，从"Customers also viewed"抓取
 * 3. 如果还是没有，从"Similar items"抓取
 *
 * @param page Playwright页面对象
 * @param limit 抓取竞品数量上限（默认10）
 * @returns 竞品数组
 */
export async function scrapeAmazonCompetitors(
  page: any,
  limit: number = 10
): Promise<CompetitorProduct[]> {
  console.log(`🔍 开始抓取竞品信息，目标数量: ${limit}`)

  const competitors: CompetitorProduct[] = []

  try {
    // 🔥 2025-12-13 KISS优化：快速检测竞品区域是否存在
    const debugContainers = await page.evaluate(() => {
      return {
        compareTable: !!document.querySelector('[data-component-type="comparison-table"], .comparison-table, #HLCXComparisonTable'),
        relatedItems: !!document.querySelector('[data-component-type="related-items"], [data-csa-c-slot-id*="related"]'),
        alsoViewed: !!document.querySelector('[data-component-type="customers-also-viewed"], [data-a-carousel-options*="also_viewed"]'),
        similarItems: !!document.querySelector('#sp_detail, #sp_detail2, [data-component-type="similar-items"]'),
        simsCarousel: !!document.querySelector('[data-csa-c-slot-id*="sims"], [class*="sims-carousel"]')
      }
    }).catch(() => ({}))
    console.log(`📊 竞品区域检测: ${JSON.stringify(debugContainers)}`)

    // 如果所有区域都不存在，快速返回
    const hasAnyContainer = Object.values(debugContainers).some(v => v)
    if (!hasAnyContainer) {
      console.log('⚠️ 未检测到任何竞品区域，快速跳过')
      return []
    }

    // 策略1: 从"Compare with similar items"表格抓取
    const compareTableCompetitors = await scrapeCompareTable(page, limit)
    if (compareTableCompetitors.length > 0) {
      console.log(`✅ 从Compare Table抓取到${compareTableCompetitors.length}个竞品`)
      competitors.push(...compareTableCompetitors)
    }

    // 策略2: 如果数量不足，从"Related to items you've viewed"抓取
    if (competitors.length < limit) {
      const relatedCompetitors = await scrapeRelatedToItemsYouViewed(page, limit - competitors.length)
      if (relatedCompetitors.length > 0) {
        console.log(`✅ 从Related to items you've viewed抓取到${relatedCompetitors.length}个竞品`)
        competitors.push(...relatedCompetitors)
      }
    }

    // 策略3: 如果数量不足，从"Customers also viewed"抓取
    if (competitors.length < limit) {
      const alsoViewedCompetitors = await scrapeAlsoViewed(page, limit - competitors.length)
      if (alsoViewedCompetitors.length > 0) {
        console.log(`✅ 从Also Viewed抓取到${alsoViewedCompetitors.length}个竞品`)
        competitors.push(...alsoViewedCompetitors)
      }
    }

    // 策略4: 如果还是不足，从"Similar items"抓取
    if (competitors.length < limit) {
      const similarCompetitors = await scrapeSimilarItems(page, limit - competitors.length)
      if (similarCompetitors.length > 0) {
        console.log(`✅ 从Similar Items抓取到${similarCompetitors.length}个竞品`)
        competitors.push(...similarCompetitors)
      }
    }

    // 去重（基于ASIN）
    const uniqueCompetitors = deduplicateCompetitors(competitors)
    console.log(`✅ 竞品抓取完成，共${uniqueCompetitors.length}个（去重后）`)

    return uniqueCompetitors

  } catch (error: any) {
    console.error('❌ 竞品抓取失败:', error.message)
    return []
  }
}

/**
 * 从"Compare with similar items"表格抓取竞品
 */
async function scrapeCompareTable(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    await page.waitForSelector('[data-component-type="comparison-table"], .comparison-table, #HLCXComparisonTable', { timeout: 3000 })
      .catch(() => null)

    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // 在evaluate内部定义价格解析函数
      function parsePriceInBrowser(text: string): number | null {
        if (!text) return null
        const cleaned = text.replace(/[^\d.,]/g, '')
        const normalized = cleaned.replace(',', '.')
        const num = parseFloat(normalized)
        return isNaN(num) ? null : num
      }

      // 多种选择器策略
      const selectors = [
        '[data-component-type="comparison-table"] .comparison-item',
        '.comparison-table .comparison-item',
        '#HLCXComparisonTable .comparison-item',
        '[cel_widget_id*="comparison"] .comparison-item'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const asin = el.querySelector('[data-asin]')?.getAttribute('data-asin') ||
                        el.getAttribute('data-asin')

            const nameEl = el.querySelector('.product-title, .a-link-normal[title], h3')
            const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('title') || 'Unknown'

            const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole')
            const priceText = priceEl?.textContent?.trim() || null

            const ratingEl = el.querySelector('.a-icon-star, [class*="star-rating"]')
            const ratingText = ratingEl?.textContent?.trim() || ratingEl?.getAttribute('aria-label') || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('.a-size-small[href*="customerReviews"]')
            const reviewText = reviewEl?.textContent?.trim() || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            items.push({
              asin,
              name,
              brand: null,
              priceText,
              price: parsePriceInBrowser(priceText || ''),
              rating,
              reviewCount,
              imageUrl,
              source: 'amazon_compare'
            })
          })
          break
        }
      }

      return items
    }, limit)

    return competitors.filter((c: any) => c.name && c.name !== 'Unknown')

  } catch (error) {
    return []
  }
}

/**
 * 从"Related to items you've viewed"区域抓取竞品
 *
 * 这是Amazon产品页上常见的竞品推荐区域，通常包含相关竞品
 */
async function scrapeRelatedToItemsYouViewed(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // 在evaluate内部定义价格解析函数
      function parsePriceInBrowser(text: string): number | null {
        if (!text) return null
        const cleaned = text.replace(/[^\d.,]/g, '')
        const normalized = cleaned.replace(',', '.')
        const num = parseFloat(normalized)
        return isNaN(num) ? null : num
      }

      // "Related to items you've viewed" 区域选择器
      // 这个区域通常使用不同的carousel widget ID
      const selectors = [
        '[cel_widget_id*="AVD"] .a-carousel-card',
        '[cel_widget_id*="AVD-desktop"] .a-carousel-card',
        '[data-a-carousel-options*="AVD"] .a-carousel-card',
        '#rhf .a-carousel-card',
        '[aria-label*="Related to items you"] .a-carousel-card',
        '[aria-label*="Related"] .a-carousel-card',
        // 备选：通用carousel，如果上面的都找不到
        '.a-carousel-container .a-carousel-card'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          console.log(`✅ 找到Related区域: ${selector}, 共${elements.length}个商品`)

          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const linkEl = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
            const asin = linkEl?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null

            // 策略1：从产品链接的aria-label或title属性获取名称
            let name = linkEl?.getAttribute('aria-label')?.trim() ||
                      linkEl?.getAttribute('title')?.trim() ||
                      linkEl?.querySelector('img')?.getAttribute('alt')?.trim() || ''

            // 策略2：如果没有，尝试从文本元素获取（排除<style>标签）
            if (!name || name === 'Unknown') {
              const textElements = el.querySelectorAll('.a-truncate-full, .p13n-sc-truncated, .a-link-normal')
              for (const textEl of Array.from(textElements)) {
                const text = textEl.textContent?.trim() || ''
                // 排除包含CSS代码的文本
                if (text && !text.includes('{') && !text.includes('position:') && text.length > 5) {
                  name = text
                  break
                }
              }
            }

            // 策略3：清理名称中的CSS/JS代码
            if (name && (name.includes('{') || name.includes('position:'))) {
              // 尝试提取实际产品名（通常在CSS代码之后）
              const cleanMatch = name.match(/([A-Z][A-Za-z\s\d,.()+-]+?)(?:,\s*\.\.\.|$)/);
              if (cleanMatch) {
                name = cleanMatch[1].trim();
              } else {
                name = 'Unknown';
              }
            }

            if (!name) name = 'Unknown'

            // 🔧 修复：精确提取价格，排除CSS样式代码
            const priceEl = el.querySelector('.a-price .a-offscreen')
            let priceText = priceEl?.textContent?.trim() || null

            // 清理价格文本中的CSS代码
            if (priceText && (priceText.includes('{') || priceText.includes('font-weight') || priceText.includes('color:'))) {
              // 尝试从混乱文本中提取实际价格（如 S$409.46）
              const priceMatch = priceText.match(/([S$£€¥₹]\$?[\d,]+\.?\d*)/g)
              if (priceMatch && priceMatch.length > 0) {
                // 取最后一个匹配的价格（通常是实际价格）
                priceText = priceMatch[priceMatch.length - 1]
              } else {
                priceText = null
              }
            }

            const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt')
            const ratingText = ratingEl?.textContent?.trim() || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('[aria-label*="ratings"]')
            const reviewText = reviewEl?.getAttribute('aria-label') || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            if (name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: parsePrice(priceText),
                rating,
                reviewCount,
                imageUrl,
                source: 'amazon_also_viewed'  // 使用相同source标识
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    return []
  }
}

/**
 * 从"Customers also viewed"区域抓取竞品
 */
async function scrapeAlsoViewed(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // 在evaluate内部定义价格解析函数
      function parsePriceInBrowser(text: string): number | null {
        if (!text) return null
        const cleaned = text.replace(/[^\d.,]/g, '')
        const normalized = cleaned.replace(',', '.')
        const num = parseFloat(normalized)
        return isNaN(num) ? null : num
      }

      // "Customers also viewed" 区域选择器
      const selectors = [
        '[data-a-carousel-options*="also_viewed"] .a-carousel-card',
        '#similarities_feature_div .a-carousel-card',
        '[cel_widget_id*="also_viewed"] .a-carousel-card',
        '#dp-pod-similars .a-carousel-card'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const linkEl = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
            const asin = linkEl?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null

            const nameEl = el.querySelector('.a-truncate-full, .p13n-sc-truncated')
            const name = nameEl?.textContent?.trim() || 'Unknown'

            // 🔧 修复：精确提取价格，排除CSS样式代码
            const priceEl = el.querySelector('.a-price .a-offscreen')
            let priceText = priceEl?.textContent?.trim() || null

            // 清理价格文本中的CSS代码
            if (priceText && (priceText.includes('{') || priceText.includes('font-weight') || priceText.includes('color:'))) {
              const priceMatch = priceText.match(/([S$£€¥₹]\$?[\d,]+\.?\d*)/g)
              if (priceMatch && priceMatch.length > 0) {
                priceText = priceMatch[priceMatch.length - 1]
              } else {
                priceText = null
              }
            }

            const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt')
            const ratingText = ratingEl?.textContent?.trim() || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('[aria-label*="ratings"]')
            const reviewText = reviewEl?.getAttribute('aria-label') || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            if (name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: parsePrice(priceText),
                rating,
                reviewCount,
                imageUrl,
                source: 'amazon_also_viewed'
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    return []
  }
}

/**
 * 从"Similar items"/"Products related to this item"区域抓取竞品
 *
 * 🔥 2025-12-10修复：支持Amazon赞助商品(Sponsored Products)的新DOM结构
 * - 旧结构: a[href*="/dp/"] 直接链接
 * - 新结构: id="sp_detail_B0DZ321NP2" 或 /sspa/click?...url=%2Fdp%2F... URL编码链接
 */
async function scrapeSimilarItems(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // 在evaluate内部定义价格解析函数
      function parsePriceInBrowser(text: string): number | null {
        if (!text) return null
        const cleaned = text.replace(/[^\d.,]/g, '')
        const normalized = cleaned.replace(',', '.')
        const num = parseFloat(normalized)
        return isNaN(num) ? null : num
      }

      // 🔥 新增：从多种来源提取ASIN
      function extractAsin(el: Element): string | null {
        // 方法1: 从 id="sp_detail_B0DZ321NP2" 格式提取 (赞助商品)
        const spDetailDiv = el.querySelector('[id^="sp_detail_"]')
        if (spDetailDiv) {
          const match = spDetailDiv.id.match(/sp_detail_([A-Z0-9]{10})/)
          if (match) return match[1]
        }

        // 方法2: 从 data-adfeedbackdetails JSON 提取
        const feedbackEl = el.querySelector('[data-adfeedbackdetails]')
        if (feedbackEl) {
          try {
            const feedbackData = JSON.parse(feedbackEl.getAttribute('data-adfeedbackdetails') || '{}')
            if (feedbackData.asin) return feedbackData.asin
          } catch {}
        }

        // 方法3: 从 /sspa/click?...url=%2Fdp%2FXXXX... URL解码提取
        const sspaLink = el.querySelector('a[href*="/sspa/click"]') as HTMLAnchorElement | null
        if (sspaLink) {
          const urlMatch = sspaLink.href.match(/url=%2Fdp%2F([A-Z0-9]{10})/)
          if (urlMatch) return urlMatch[1]
          // 尝试解码URL
          try {
            const decoded = decodeURIComponent(sspaLink.href)
            const decodedMatch = decoded.match(/\/dp\/([A-Z0-9]{10})/)
            if (decodedMatch) return decodedMatch[1]
          } catch {}
        }

        // 方法4: 传统方式 - 直接 /dp/ 链接
        const directLink = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
        if (directLink) {
          const match = directLink.href.match(/\/dp\/([A-Z0-9]{10})/)
          if (match) return match[1]
        }

        // 方法5: 从 data-asin 属性提取
        const asinEl = el.querySelector('[data-asin]')
        if (asinEl) {
          const asin = asinEl.getAttribute('data-asin')
          if (asin && /^[A-Z0-9]{10}$/.test(asin)) return asin
        }

        return null
      }

      // 🔥 新增：从赞助商品提取商品名称
      function extractName(el: Element): string {
        // 尝试从 data-adfeedbackdetails 提取标题
        const feedbackEl = el.querySelector('[data-adfeedbackdetails]')
        if (feedbackEl) {
          try {
            const feedbackData = JSON.parse(feedbackEl.getAttribute('data-adfeedbackdetails') || '{}')
            if (feedbackData.title) return feedbackData.title
          } catch {}
        }

        // 传统选择器
        const nameEl = el.querySelector('.a-truncate-full, .p13n-sc-truncated, .a-link-normal[title], [class*="truncate"]')
        if (nameEl) {
          const text = nameEl.textContent?.trim()
          if (text && text !== 'Unknown') return text
          const title = nameEl.getAttribute('title')
          if (title) return title
        }

        // 从图片alt属性
        const imgEl = el.querySelector('img[alt]')
        if (imgEl) {
          const alt = imgEl.getAttribute('alt')
          if (alt && alt.length > 5) return alt
        }

        return 'Unknown'
      }

      // "Similar items" / "Products related to this item" 区域选择器
      const selectors = [
        '#sp_detail .a-carousel-card',                              // 🔥 赞助商品优先
        '[data-a-carousel-options*="sims"] .a-carousel-card',       // 赞助商品变体
        '[cel_widget_id*="sims"] .a-carousel-card',                 // 赞助商品变体
        '[data-a-carousel-options*="similar"] .a-carousel-card',    // 传统similar
        '[cel_widget_id*="similar"] .a-carousel-card'               // 传统similar
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          console.log(`✅ 找到Related/Similar区域: ${selector}, 共${elements.length}个商品`)

          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const asin = extractAsin(el)
            const name = extractName(el)

            // 🔧 修复：精确提取价格，排除CSS样式代码
            const priceEl = el.querySelector('.a-price .a-offscreen')
            let priceText = priceEl?.textContent?.trim() || null

            // 清理价格文本中的CSS代码
            if (priceText && (priceText.includes('{') || priceText.includes('font-weight') || priceText.includes('color:'))) {
              // 尝试从混乱文本中提取实际价格（如 S$409.46）
              const priceMatch = priceText.match(/([S$£€¥₹]\$?[\d,]+\.?\d*)/g)
              if (priceMatch && priceMatch.length > 0) {
                // 取最后一个匹配的价格（通常是实际价格）
                priceText = priceMatch[priceMatch.length - 1]
              } else {
                priceText = null
              }
            }

            const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt')
            const ratingText = ratingEl?.textContent?.trim() || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            // 🔥 改进：即使name是Unknown，只要有ASIN也保留
            if (asin || name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: parsePriceInBrowser(priceText || ''),
                rating,
                reviewCount: null,
                imageUrl,
                source: 'amazon_similar'
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    console.error('❌ scrapeSimilarItems失败:', error)
    return []
  }
}

/**
 * 去重竞品（基于ASIN）
 */
function deduplicateCompetitors(competitors: CompetitorProduct[]): CompetitorProduct[] {
  const seen = new Set<string>()
  const unique: CompetitorProduct[] = []

  for (const competitor of competitors) {
    const key = competitor.asin || competitor.name
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(competitor)
    }
  }

  return unique
}

// ==================== AI竞品分析逻辑 ====================

/**
 * 使用AI分析竞品对比，识别竞争优势和劣势
 *
 * @param ourProduct 我们的产品信息
 * @param competitors 竞品数组
 * @param targetCountry 目标国家（用于语言适配）
 * @param userId 用户ID（用于API配额管理）
 * @param options 优化选项（可选）
 * @returns 竞品分析结果
 */
export async function analyzeCompetitorsWithAI(
  ourProduct: {
    name: string
    brand?: string | null           // 🆕 品牌名
    price: number | null
    rating: number | null
    reviewCount: number | null
    features: string[]
    sellingPoints?: string          // 🆕 卖点描述
  },
  competitors: CompetitorProduct[],
  targetCountry: string = 'US',
  userId?: number,
  options?: {
    enableCompression?: boolean  // 启用竞品数据压缩（默认false，零破坏性）
    enableCache?: boolean        // 启用缓存（默认false，零破坏性）
    cacheKey?: string            // 自定义缓存键（默认使用产品名+竞品数量）
  }
): Promise<CompetitorAnalysisResult> {

  if (competitors.length === 0) {
    console.log('⚠️ 无竞品数据，返回空分析结果')
    return getEmptyCompetitorAnalysis()
  }

  console.log(`🤖 开始AI竞品分析,我们的产品vs ${competitors.length}个竞品...`)

  // 根据目标国家确定分析语言(使用全局语言映射)
  const langName = getLanguageNameForCountry(targetCountry)

  // 计算基础竞争力指标
  const pricePosition = calculatePricePosition(ourProduct, competitors)
  const ratingPosition = calculateRatingPosition(ourProduct, competitors)

  // 准备竞品数据(支持压缩优化)
  let competitorSummaries: string
  let compressionStats: any = null

  if (options?.enableCompression) {
    // 🆕 Token优化:使用压缩格式(40-50%减少)
    console.log('🗜️ 启用竞品数据压缩优化...')
    const compressorInput: CompressorCompetitorInfo[] = competitors.slice(0, 10).map(c => ({
      name: c.name,
      brand: c.brand || undefined,
      price: c.priceText || undefined,
      rating: c.rating ? `${c.rating} stars` : undefined,
      reviewCount: c.reviewCount || undefined,
      usp: undefined,
      keyFeatures: c.features,
      url: undefined,
    }))

    const compressed = compressCompetitors(compressorInput, 20)
    competitorSummaries = compressed.compressed
    compressionStats = compressed.stats
    console.log(`   压缩率: ${compressionStats.compressionRatio}(${compressionStats.originalChars} → ${compressionStats.compressedChars}字符)`)
  } else {
    // 原始格式(保持向后兼容)
    competitorSummaries = competitors.slice(0, 10).map((c, idx) => {
      return `Competitor ${idx + 1}:
- Name: ${c.name}
- Brand: ${c.brand || 'Unknown'}
- Price: ${c.priceText || 'N/A'}
- Rating: ${c.rating || 'N/A'} stars
- Reviews: ${c.reviewCount || 'N/A'}
- Source: ${c.source}`
    }).join('\n\n')
  }

  // 📦 从数据库加载prompt模板(版本管理)
  const promptTemplate = await loadPrompt('competitor_analysis')

  // 🎨 准备模板变量（匹配 prompt 模板中的变量名）
  const productName = ourProduct.name
  const brand = ourProduct.brand || 'Unknown'
  const price = ourProduct.price ? `$${ourProduct.price.toFixed(2)}` : 'N/A'
  const rating = `${ourProduct.rating || 'N/A'}`
  const reviewCount = `${ourProduct.reviewCount || 0}`
  const features = ourProduct.features.slice(0, 10).join('; ') || 'Not specified'
  const sellingPoints = ourProduct.sellingPoints || 'Not specified'

  // 🎨 插值替换模板变量（✅ 修复：变量名与 prompt 模板一致）
  const prompt = promptTemplate
    .replace('{{productName}}', productName)
    .replace('{{brand}}', brand)
    .replace('{{price}}', price)
    .replace('{{rating}}', rating)
    .replace('{{reviewCount}}', reviewCount)
    .replace('{{features}}', features)
    .replace('{{sellingPoints}}', sellingPoints)
    .replace('{{competitorsList}}', competitorSummaries)

  try {
    // 使用Gemini AI进行分析
    if (!userId) {
      throw new Error('竞品分析需要用户ID,请确保已登录')
    }

    // 🆕 Token优化：支持缓存（3天TTL）
    const cacheKey = options?.cacheKey || `${ourProduct.name}:${competitors.length}competitors`
    const performAnalysis = async () => {
      // 智能模型选择：竞品分析使用Pro模型（复杂分析任务）
      const aiResponse = await generateContent({
        operationType: 'competitor_analysis',
        prompt,
        temperature: 0.6,  // 平衡创造性和准确性
        maxOutputTokens: 8192,  // 恢复原始值，确保JSON不被截断
      }, userId!)

      // 记录token使用
      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId: userId!,
          model: aiResponse.model,
          operationType: 'competitor_analysis',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType
        })
      }

      return aiResponse.text
    }

    // 使用缓存包装器（如果启用）
    const text = options?.enableCache
      ? await withCache('competitor_analysis', cacheKey, performAnalysis)
      : await performAnalysis()

    // 提取JSON内容
    let jsonText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('❌ AI返回格式错误，未找到JSON')
      return getEmptyCompetitorAnalysis()
    }

    const analysisData = JSON.parse(jsonMatch[0])

    // 构建完整结果
    const result: CompetitorAnalysisResult = {
      competitors,
      totalCompetitors: competitors.length,
      pricePosition,
      ratingPosition,
      featureComparison: analysisData.featureComparison || [],
      uniqueSellingPoints: analysisData.uniqueSellingPoints || [],
      competitorAdvantages: analysisData.competitorAdvantages || [],
      // 🔥 v3.2新增：竞品弱点
      competitorWeaknesses: analysisData.competitorWeaknesses || [],
      overallCompetitiveness: analysisData.overallCompetitiveness || 50,
      analyzedAt: new Date().toISOString(),
    }

    console.log('✅ AI竞品分析完成')
    console.log(`   - 识别${result.uniqueSellingPoints.length}个独特卖点`)
    console.log(`   - 发现${result.competitorAdvantages.length}个竞品优势需应对`)
    // 🔥 v3.2新增
    console.log(`   - 挖掘${result.competitorWeaknesses?.length || 0}个竞品弱点可利用`)
    console.log(`   - 综合竞争力: ${result.overallCompetitiveness}/100`)

    return result

  } catch (error: any) {
    console.error('❌ AI竞品分析失败:', error.message)
    return getEmptyCompetitorAnalysis()
  }
}

/**
 * 计算价格竞争力
 */
function calculatePricePosition(
  ourProduct: { price: number | null },
  competitors: CompetitorProduct[]
): PricePosition | null {
  const ourPrice = ourProduct.price
  if (!ourPrice) return null

  const competitorPrices = competitors
    .map(c => c.price)
    .filter((p): p is number => p !== null && p > 0)

  if (competitorPrices.length === 0) return null

  const avgPrice = competitorPrices.reduce((sum, p) => sum + p, 0) / competitorPrices.length
  const minPrice = Math.min(...competitorPrices)
  const maxPrice = Math.max(...competitorPrices)

  // 计算价格百分位
  const lowerCount = competitorPrices.filter(p => p < ourPrice).length
  const pricePercentile = Math.round((lowerCount / competitorPrices.length) * 100)

  // 判断价格优势
  let priceAdvantage: PricePosition['priceAdvantage']
  if (ourPrice <= minPrice) {
    priceAdvantage = 'lowest'
  } else if (ourPrice < avgPrice * 0.9) {
    priceAdvantage = 'below_average'
  } else if (ourPrice <= avgPrice * 1.1) {
    priceAdvantage = 'average'
  } else if (ourPrice <= avgPrice * 1.3) {
    priceAdvantage = 'above_average'
  } else {
    priceAdvantage = 'premium'
  }

  // 计算节省金额
  const savingsVsAvg = ourPrice < avgPrice
    ? `Save $${(avgPrice - ourPrice).toFixed(2)} vs average competitor`
    : null

  const savingsVsMin = ourPrice > minPrice
    ? `Only $${(ourPrice - minPrice).toFixed(2)} more than cheapest`
    : null

  return {
    ourPrice,
    avgCompetitorPrice: parseFloat(avgPrice.toFixed(2)),
    minCompetitorPrice: minPrice,
    maxCompetitorPrice: maxPrice,
    pricePercentile,
    priceAdvantage,
    savingsVsAvg,
    savingsVsMin,
  }
}

/**
 * 计算评分竞争力
 */
function calculateRatingPosition(
  ourProduct: { rating: number | null },
  competitors: CompetitorProduct[]
): RatingPosition | null {
  const ourRating = ourProduct.rating
  if (!ourRating) return null

  const competitorRatings = competitors
    .map(c => c.rating)
    .filter((r): r is number => r !== null && r > 0)

  if (competitorRatings.length === 0) return null

  const avgRating = competitorRatings.reduce((sum, r) => sum + r, 0) / competitorRatings.length
  const minRating = Math.min(...competitorRatings)
  const maxRating = Math.max(...competitorRatings)

  // 计算评分百分位
  const lowerCount = competitorRatings.filter(r => r < ourRating).length
  const ratingPercentile = Math.round((lowerCount / competitorRatings.length) * 100)

  // 判断评分优势
  let ratingAdvantage: RatingPosition['ratingAdvantage']
  if (ourRating >= maxRating - 0.1) {
    ratingAdvantage = 'top_rated'
  } else if (ourRating >= avgRating + 0.2) {
    ratingAdvantage = 'above_average'
  } else if (ourRating >= avgRating - 0.2) {
    ratingAdvantage = 'average'
  } else {
    ratingAdvantage = 'below_average'
  }

  return {
    ourRating,
    avgCompetitorRating: parseFloat(avgRating.toFixed(1)),
    maxCompetitorRating: maxRating,
    minCompetitorRating: minRating,
    ratingPercentile,
    ratingAdvantage,
  }
}

/**
 * 获取空的竞品分析结果（当无竞品或分析失败时使用）
 */
function getEmptyCompetitorAnalysis(): CompetitorAnalysisResult {
  return {
    competitors: [],
    totalCompetitors: 0,
    pricePosition: null,
    ratingPosition: null,
    featureComparison: [],
    uniqueSellingPoints: [],
    competitorAdvantages: [],
    overallCompetitiveness: 50,
    analyzedAt: new Date().toISOString(),
  }
}

// ==================== 辅助函数 ====================

/**
 * 提取竞品分析中最有价值的洞察（用于广告创意生成）
 *
 * @param analysis 竞品分析结果
 * @returns 结构化的洞察摘要
 */
export function extractCompetitiveInsights(analysis: CompetitorAnalysisResult): {
  headlineSuggestions: string[]     // 适合用作广告标题的优势
  descriptionHighlights: string[]   // 适合用作广告描述的差异化点
  calloutSuggestions: string[]      // 适合用作Callouts的对比优势
  sitelinkSuggestions: string[]     // 适合用作Sitelinks的对比主题
} {
  const insights = {
    headlineSuggestions: [] as string[],
    descriptionHighlights: [] as string[],
    calloutSuggestions: [] as string[],
    sitelinkSuggestions: [] as string[],
  }

  // 从价格优势提取标题建议
  if (analysis.pricePosition) {
    const pp = analysis.pricePosition
    if (pp.priceAdvantage === 'lowest') {
      insights.headlineSuggestions.push('Lowest Price Guaranteed')
      insights.calloutSuggestions.push('Best Value')
    } else if (pp.priceAdvantage === 'below_average' && pp.savingsVsAvg) {
      insights.headlineSuggestions.push(pp.savingsVsAvg)
      insights.calloutSuggestions.push('Better Price')
    }
  }

  // 从评分优势提取标题建议
  if (analysis.ratingPosition) {
    const rp = analysis.ratingPosition
    if (rp.ratingAdvantage === 'top_rated') {
      insights.headlineSuggestions.push(`Top Rated - ${rp.ourRating}★`)
      insights.calloutSuggestions.push('Highest Rating')
    } else if (rp.ratingAdvantage === 'above_average') {
      insights.headlineSuggestions.push(`${rp.ourRating}★ Rated`)
      insights.calloutSuggestions.push('Above Average Rating')
    }
  }

  // 从独特卖点提取描述亮点和Callouts
  analysis.uniqueSellingPoints
    .filter(usp => usp.significance === 'high' || usp.significance === 'medium')
    .slice(0, 3)
    .forEach(usp => {
      insights.descriptionHighlights.push(usp.usp)
      insights.calloutSuggestions.push(usp.usp.substring(0, 25)) // Callouts限制25字符
    })

  // 从竞品优势提取Sitelink主题
  insights.sitelinkSuggestions.push('Why Choose Us')
  insights.sitelinkSuggestions.push('vs Competitors')

  if (analysis.pricePosition) {
    insights.sitelinkSuggestions.push('Price Comparison')
  }

  if (analysis.uniqueSellingPoints.length > 0) {
    insights.sitelinkSuggestions.push('Unique Features')
  }

  return insights
}
