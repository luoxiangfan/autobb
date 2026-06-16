import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { loadPrompt } from './prompt-loader'
import { logger } from '../common/server'

export interface ProductInfo {
  brandDescription: string
  uniqueSellingPoints: string
  productHighlights: string
  targetAudience: string
  category?: string
  // 🆕 增强字段：用于竞品搜索词推断
  sellingPoints?: string[] // 产品卖点列表
  productDescription?: string // 产品描述（完整文本）

  // 🎯 P0优化（2025-12-07）：存储AI返回的完整数据，提升广告创意质量20-30%
  keywords?: string[] // AI生成的关键词列表

  pricing?: {
    current?: string // 当前价格
    original?: string // 原价
    discount?: string // 折扣百分比
    competitiveness?: 'Premium' | 'Competitive' | 'Budget' // 价格竞争力
    valueAssessment?: string // 性价比评估
  }

  reviews?: {
    rating?: number // 评分
    count?: number // 评论数
    sentiment?: 'Positive' | 'Mixed' | 'Negative' // 情感倾向
    positives?: string[] // 用户好评要点
    concerns?: string[] // 用户关注点/缺点
    useCases?: string[] // 真实使用场景
  }

  promotions?: {
    active?: boolean // 是否有促销
    types?: string[] // 促销类型（Coupon, Deal, Lightning Deal）
    urgency?: string | null // 紧迫性文案
    activeDeals?: string[] // 活跃促销（兼容旧字段）
    urgencyIndicators?: string[] // 紧迫性指标（兼容旧字段）
    freeShipping?: boolean // 免邮
  }

  competitiveEdges?: {
    badges?: string[] // 徽章（Amazon's Choice, Best Seller）
    primeEligible?: boolean // Prime资格
    stockStatus?: string // 库存状态
    salesRank?: string // 销售排名
  }

  // 🎯 v3.3优化（2025-12-08）：店铺/单品差异化分析字段
  // 店铺分析专用字段
  storeQualityLevel?: 'Premium' | 'Standard' | 'Budget' | 'Unknown'
  categoryDiversification?: {
    level: 'Focused' | 'Moderate' | 'Diverse'
    categories?: string[]
    primaryCategory?: string
  }
  hotInsights?: {
    avgRating?: number
    avgReviews?: number
    topProductsCount?: number
    bestSeller?: string
    priceRange?: { min: number; max: number }
  }
  // 单品分析专用字段
  marketFit?: {
    score: number // 0-100
    level: 'Excellent' | 'Good' | 'Average' | 'Poor'
    strengths?: string[]
    gaps?: string[]
  }
  credibilityLevel?: {
    score: number // 0-100
    level: 'High' | 'Medium' | 'Low'
    factors?: string[]
  }
  categoryPosition?: {
    rank?: string
    percentile?: number
    competitors?: number
  }
  // 页面类型标识
  pageType?: 'store' | 'product'
}

function ensureStorePromptHasOutputSchema(prompt: string): string {
  const hasCoreFields =
    /"brandDescription"\s*:/.test(prompt) &&
    /"uniqueSellingPoints"\s*:/.test(prompt) &&
    /"productHighlights"\s*:/.test(prompt) &&
    /"targetAudience"\s*:/.test(prompt)

  if (hasCoreFields) return prompt

  return `${prompt}

=== REQUIRED OUTPUT JSON SCHEMA (MUST FOLLOW) ===
Return a SINGLE JSON object with these fields:
{
  "brandDescription": "1-3 paragraphs summarizing the brand/store value proposition",
  "uniqueSellingPoints": ["3-6 bullets", "specific, non-navigation", "customer-facing"],
  "productHighlights": ["3-6 bullets", "top categories / flagship products / key benefits"],
  "targetAudience": "1-2 sentences describing ideal customers",
  "category": "ONE category in {{langName}} (examples: {{categoryExamples}})",
  "keywords": ["12-25 high-intent keywords"],
  "pageType": "store"
}`
}

/**
 * 使用Gemini AI分析网页内容，提取产品信息
 */
export async function analyzeProductPage(
  pageData: {
    url: string
    brand: string
    title: string
    description: string
    text: string
    targetCountry?: string
    pageType?: 'product' | 'store' // 新增：页面类型
    // 🎯 P1优化：新增字段用于增强AI分析
    technicalDetails?: Record<string, string> // 技术规格
    reviewHighlights?: string[] // 评论摘要
    // 🔥 2026-01-04新增：独立站增强数据字段（用于AI分析）
    reviews?: Array<{
      rating: number
      date: string
      author: string
      title: string
      body: string
      verifiedBuyer: boolean
      images?: string[]
    }>
    faqs?: Array<{ question: string; answer: string }>
    specifications?: Record<string, string>
    packages?: Array<{ name: string; price: string | null; includes: string[] }>
    socialProof?: Array<{ metric: string; value: string }>
    coreFeatures?: string[]
    secondaryFeatures?: string[]
  },
  userId?: number
): Promise<ProductInfo> {
  try {
    // 根据推广国家确定分析语言
    const targetCountry = pageData.targetCountry || 'US'
    const languageConfig: Record<string, { name: string; examples: string }> = {
      US: { name: 'English', examples: 'Security Cameras, Smart Home, Electronics' },
      CN: { name: '中文', examples: '安防监控、智能家居、电子产品' },
      JP: { name: '日本語', examples: 'セキュリティカメラ、スマートホーム、電子機器' },
      KR: { name: '한국어', examples: '보안카메라, 스마트홈, 전자제품' },
      DE: { name: 'Deutsch', examples: 'Sicherheitskameras, Smart Home, Elektronik' },
      FR: { name: 'Français', examples: 'Caméras de sécurité, Maison intelligente, Électronique' },
      ES: { name: 'Español', examples: 'Cámaras de seguridad, Hogar inteligente, Electrónica' },
      IT: { name: 'Italiano', examples: 'Telecamere di sicurezza, Casa intelligente, Elettronica' },
      SE: { name: 'Svenska', examples: 'Säkerhetskameror, Smart hem, Elektronik' },
      CH: { name: 'Deutsch', examples: 'Sicherheitskameras, Smart Home, Elektronik' },
    }

    const lang = languageConfig[targetCountry] || languageConfig.US
    const langName = lang.name
    const categoryExamples = lang.examples
    const pageType = pageData.pageType || 'product' // 默认为单品页面

    // 根据页面类型选择不同的prompt
    let prompt: string

    if (pageType === 'store') {
      // 店铺页面专用prompt(从数据库加载)
      // 📦 从数据库加载prompt模板(版本管理)
      const promptTemplate = await loadPrompt('brand_analysis_store')

      // 🎨 准备模板变量
      const pageDataUrl = pageData.url
      const pageDataBrand = pageData.brand
      const pageDataTitle = pageData.title
      const pageDataDescription = pageData.description
      const pageDataText = pageData.text.slice(0, 10000)

      // 🔥 2026-01-21：店铺prompt也可能引用增强数据占位符（例如 v4.16）
      // 生产环境中若不替换，会让模型看到原样 {{reviews}} 等占位符，导致输出不稳定。
      const reviewsText =
        pageData.reviews && pageData.reviews.length > 0
          ? pageData.reviews
              .slice(0, 10)
              .map(
                (r, i) =>
                  `Review ${i + 1}:\n` +
                  `  Rating: ${r.rating}/5\n` +
                  `  Author: ${r.author} ${r.verifiedBuyer ? '(Verified)' : ''}\n` +
                  `  Date: ${r.date}\n` +
                  `  Title: ${r.title}\n` +
                  `  Body: ${r.body.substring(0, 200)}${r.body.length > 200 ? '...' : ''}`
              )
              .join('\n\n')
          : 'Not available (store page)'

      const faqsText =
        pageData.faqs && pageData.faqs.length > 0
          ? pageData.faqs
              .slice(0, 10)
              .map((faq, i) => `Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`)
              .join('\n\n')
          : 'Not available (store page)'

      const specificationsText =
        pageData.specifications && Object.keys(pageData.specifications).length > 0
          ? Object.entries(pageData.specifications)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : 'Not available (store page)'

      const socialProofText =
        pageData.socialProof && pageData.socialProof.length > 0
          ? pageData.socialProof.map((sp) => `${sp.metric}: ${sp.value}`).join('\n')
          : 'Not available (store page)'

      const coreFeaturesText =
        pageData.coreFeatures && pageData.coreFeatures.length > 0
          ? '- ' + pageData.coreFeatures.join('\n- ')
          : 'Not available (store page)'

      // 🎯 P1优化: 格式化technicalDetails和reviewHighlights供AI使用（店铺页面通常无单品数据）
      const technicalDetailsText =
        pageData.technicalDetails && Object.keys(pageData.technicalDetails).length > 0
          ? Object.entries(pageData.technicalDetails)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : 'Not available (store page)'

      const reviewHighlightsText =
        pageData.reviewHighlights && pageData.reviewHighlights.length > 0
          ? '- ' + pageData.reviewHighlights.join('\n- ')
          : 'Not available (store page)'

      // 🎨 插值替换模板变量
      prompt = ensureStorePromptHasOutputSchema(promptTemplate)
        .replace(/\{\{pageData\.url\}\}/g, pageDataUrl)
        .replace(/\{\{pageData\.brand\}\}/g, pageDataBrand)
        .replace('{{pageData.title}}', pageDataTitle)
        .replace('{{pageData.description}}', pageDataDescription)
        .replace('{{pageData.text}}', pageDataText)
        .replace('{{technicalDetails}}', technicalDetailsText)
        .replace('{{reviewHighlights}}', reviewHighlightsText)
        .replace('{{reviews}}', reviewsText)
        .replace('{{faqs}}', faqsText)
        .replace('{{specifications}}', specificationsText)
        .replace('{{socialProof}}', socialProofText)
        .replace('{{coreFeatures}}', coreFeaturesText)
        .replace(/\{\{langName\}\}/g, langName)
        .replace(/\{\{categoryExamples\}\}/g, categoryExamples)
    } else {
      // 单品页面专用prompt(从数据库加载)
      // 📦 从数据库加载prompt模板(版本管理)
      const promptTemplate = await loadPrompt('product_analysis_single')

      // 🎨 准备模板变量
      const pageDataUrl = pageData.url
      const pageDataBrand = pageData.brand
      const pageDataTitle = pageData.title
      const pageDataDescription = pageData.description
      const pageDataText = pageData.text.slice(0, 10000)

      // 🎯 P1优化: 格式化technicalDetails和reviewHighlights供AI使用
      const technicalDetailsText =
        pageData.technicalDetails && Object.keys(pageData.technicalDetails).length > 0
          ? Object.entries(pageData.technicalDetails)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : 'Not available'

      const reviewHighlightsText =
        pageData.reviewHighlights && pageData.reviewHighlights.length > 0
          ? '- ' + pageData.reviewHighlights.join('\n- ')
          : 'Not available'

      // 🔥 2026-01-04新增：格式化独立站增强数据供AI使用
      const reviewsText =
        pageData.reviews && pageData.reviews.length > 0
          ? pageData.reviews
              .slice(0, 10)
              .map(
                (r, i) =>
                  `Review ${i + 1}:\n` +
                  `  Rating: ${r.rating}/5\n` +
                  `  Author: ${r.author} ${r.verifiedBuyer ? '(Verified)' : ''}\n` +
                  `  Date: ${r.date}\n` +
                  `  Title: ${r.title}\n` +
                  `  Body: ${r.body.substring(0, 200)}${r.body.length > 200 ? '...' : ''}`
              )
              .join('\n\n')
          : 'Not available'

      const faqsText =
        pageData.faqs && pageData.faqs.length > 0
          ? pageData.faqs
              .slice(0, 10)
              .map((faq, i) => `Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`)
              .join('\n\n')
          : 'Not available'

      const specificationsText =
        pageData.specifications && Object.keys(pageData.specifications).length > 0
          ? Object.entries(pageData.specifications)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : 'Not available'

      const packagesText =
        pageData.packages && pageData.packages.length > 0
          ? pageData.packages
              .map(
                (pkg, i) =>
                  `Package ${i + 1}: ${pkg.name}\n` +
                  `  Price: ${pkg.price || 'N/A'}\n` +
                  `  Includes: ${pkg.includes.join(', ')}`
              )
              .join('\n\n')
          : 'Not available'

      const socialProofText =
        pageData.socialProof && pageData.socialProof.length > 0
          ? pageData.socialProof.map((sp) => `${sp.metric}: ${sp.value}`).join('\n')
          : 'Not available'

      const coreFeaturesText =
        pageData.coreFeatures && pageData.coreFeatures.length > 0
          ? '- ' + pageData.coreFeatures.join('\n- ')
          : 'Not available'

      const secondaryFeaturesText =
        pageData.secondaryFeatures && pageData.secondaryFeatures.length > 0
          ? '- ' + pageData.secondaryFeatures.join('\n- ')
          : 'Not available'

      // 🎨 插值替换模板变量
      prompt = promptTemplate
        .replace('{{pageData.url}}', pageDataUrl)
        .replace('{{pageData.brand}}', pageDataBrand)
        .replace('{{pageData.title}}', pageDataTitle)
        .replace('{{pageData.description}}', pageDataDescription)
        .replace('{{pageData.text}}', pageDataText)
        .replace('{{technicalDetails}}', technicalDetailsText)
        .replace('{{reviewHighlights}}', reviewHighlightsText)
        .replace('{{reviews}}', reviewsText)
        .replace('{{faqs}}', faqsText)
        .replace('{{specifications}}', specificationsText)
        .replace('{{packages}}', packagesText)
        .replace('{{socialProof}}', socialProofText)
        .replace('{{coreFeatures}}', coreFeaturesText)
        .replace('{{secondaryFeatures}}', secondaryFeaturesText)
        .replace(/\{\{langName\}\}/g, langName)
        .replace('{{categoryExamples}}', categoryExamples)
    }

    // 需求12：使用Gemini 2.5 Pro稳定版模型（优先Vertex AI，带代理支持 + 自动降级）
    // 增加maxOutputTokens以确保完整返回所有字段（包括增强的pricing、reviews、promotions、competitiveEdges）
    if (!userId) {
      throw new Error('分析产品页面需要用户ID，请确保已登录')
    }
    const geminiResult = await generateContent(
      {
        operationType: 'product_page_analysis',
        prompt,
        temperature: 0.7,
        maxOutputTokens: 6144, // 增加到6144以容纳更丰富的数据维度
      },
      userId
    )

    const text = geminiResult.text

    // 记录token使用
    if (geminiResult.usage) {
      const cost = estimateTokenCost(
        geminiResult.model,
        geminiResult.usage.inputTokens,
        geminiResult.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: geminiResult.model,
        operationType: 'product_analysis',
        inputTokens: geminiResult.usage.inputTokens,
        outputTokens: geminiResult.usage.outputTokens,
        totalTokens: geminiResult.usage.totalTokens,
        cost,
        apiType: geminiResult.apiType,
      })
    }

    // 提取JSON内容（改进版：处理markdown代码块和格式问题）
    let jsonText = text
    logger.debug('🔍 AI原始返回长度:', text.length, '字符')

    // 1. 移除markdown代码块标记
    jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    logger.debug('🔍 移除markdown后长度:', jsonText.length, '字符')

    // 2. 尝试找到JSON对象
    let jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    // 如果没有找到完整的 {...}，尝试找到截断的JSON（只有开头的 {）
    if (!jsonMatch) {
      logger.debug('⚠️ 未找到完整JSON对象，尝试匹配截断的JSON...')
      const truncatedMatch = jsonText.match(/\{[\s\S]*/)
      if (truncatedMatch) {
        logger.debug('✅ 检测到截断的JSON，长度:', truncatedMatch[0].length)
        jsonMatch = truncatedMatch
      } else {
        logger.error('❌ 无法找到任何JSON结构')
        logger.error('AI原始返回:', text.substring(0, 500))
        throw new Error('AI返回格式错误，未找到JSON')
      }
    } else {
      logger.debug('✅ 找到完整JSON对象，长度:', jsonMatch[0].length)
    }

    let jsonStr = jsonMatch[0]

    // 3. 修复常见的JSON格式问题
    // 修复尾部逗号
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')

    // 修复字符串中的实际换行符（使用状态机方式处理）
    let cleanedJsonStr = ''
    let inString = false
    let escape = false
    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i]

      if (escape) {
        cleanedJsonStr += char
        escape = false
        continue
      }

      if (char === '\\') {
        escape = true
        cleanedJsonStr += char
        continue
      }

      if (char === '"') {
        inString = !inString
        cleanedJsonStr += char
        continue
      }

      if (inString) {
        // 在字符串内部，转义控制字符
        if (char === '\n') {
          cleanedJsonStr += '\\n'
        } else if (char === '\r') {
          cleanedJsonStr += '\\r'
        } else if (char === '\t') {
          cleanedJsonStr += '\\t'
        } else {
          cleanedJsonStr += char
        }
      } else {
        cleanedJsonStr += char
      }
    }
    jsonStr = cleanedJsonStr

    // 4. 尝试修复截断的JSON
    let productInfo: ProductInfo
    try {
      productInfo = JSON.parse(jsonStr) as ProductInfo
    } catch (parseError: any) {
      logger.debug('首次解析失败，尝试修复截断的JSON...', parseError.message)
      logger.debug('原始JSON前200字符:', jsonStr.substring(0, 200))
      logger.debug('原始JSON后200字符:', jsonStr.substring(Math.max(0, jsonStr.length - 200)))

      // 更激进的JSON修复策略
      let repairedJson = jsonStr

      // 策略1: 找到最后一个完整的属性值对
      // 完整的属性模式: "key": "value", 或 "key": [...], 或 "key": {...}
      const lastCompletePatterns = [
        /"[^"]+"\s*:\s*"[^"]*"\s*,/g, // "key": "value",
        /"[^"]+"\s*:\s*\[[^\]]*\]\s*,/g, // "key": [...],
        /"[^"]+"\s*:\s*\{[^}]*\}\s*,/g, // "key": {...},
        /"[^"]+"\s*:\s*"[^"]*"\s*$/g, // "key": "value" (最后一个，无逗号)
        /"[^"]+"\s*:\s*\[[^\]]*\]\s*$/g, // "key": [...] (最后一个)
      ]

      let lastCompleteIndex = -1
      for (const pattern of lastCompletePatterns) {
        let match
        while ((match = pattern.exec(repairedJson)) !== null) {
          const endIndex = match.index + match[0].length
          if (endIndex > lastCompleteIndex) {
            lastCompleteIndex = endIndex
          }
        }
      }

      // 如果找到完整的属性，截断到那里
      if (lastCompleteIndex > 0 && lastCompleteIndex < repairedJson.length) {
        logger.debug(`截断JSON到最后一个完整属性位置: ${lastCompleteIndex}`)
        repairedJson = repairedJson.substring(0, lastCompleteIndex)

        // 移除尾部逗号
        repairedJson = repairedJson.replace(/,\s*$/, '')
      }

      // 策略2: 计算并添加缺失的闭合括号
      let openBraces = 0
      let openBrackets = 0
      let inString = false
      let escaped = false

      for (let i = 0; i < repairedJson.length; i++) {
        const char = repairedJson[i]

        if (escaped) {
          escaped = false
          continue
        }

        if (char === '\\') {
          escaped = true
          continue
        }

        if (char === '"') {
          inString = !inString
          continue
        }

        if (!inString) {
          if (char === '{') openBraces++
          else if (char === '}') openBraces--
          else if (char === '[') openBrackets++
          else if (char === ']') openBrackets--
        }
      }

      // 如果还在字符串内，说明字符串被截断了，关闭它
      if (inString) {
        logger.debug('检测到未关闭的字符串，添加闭合引号')
        repairedJson += '"'
      }

      // 添加缺失的闭合括号
      logger.debug(`需要添加: ${openBrackets}个], ${openBraces}个}`)

      for (let i = 0; i < openBrackets; i++) {
        repairedJson += ']'
      }
      for (let i = 0; i < openBraces; i++) {
        repairedJson += '}'
      }

      logger.debug('修复后的JSON长度:', repairedJson.length)
      logger.debug(
        '修复后的JSON末尾:',
        repairedJson.substring(Math.max(0, repairedJson.length - 100))
      )

      try {
        productInfo = JSON.parse(repairedJson) as ProductInfo
        logger.debug('✅ JSON修复成功')
      } catch (repairError: any) {
        // 最后尝试: 使用正则提取各字段
        logger.debug('⚠️ JSON修复失败，尝试正则提取字段...')
        logger.debug('修复后仍失败:', repairError.message)

        // 更强大的字段提取函数，支持多种格式
        const extractStringField = (fieldName: string, source: string): string => {
          // 尝试匹配 "field": "value" 格式（处理转义和多行）
          const patterns = [
            new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's'),
            new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)`), // 截断的字符串
          ]
          for (const pattern of patterns) {
            const match = source.match(pattern)
            if (match && match[1]) {
              // 清理转义字符
              return match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
            }
          }
          return ''
        }

        // 提取数组字段（如 uniqueSellingPoints）
        const extractArrayField = (fieldName: string, source: string): string => {
          const arrayMatch = source.match(new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]`))
          if (arrayMatch) {
            // 提取数组中的字符串值
            const items: string[] = []
            const itemMatches = arrayMatch[1].matchAll(/"((?:[^"\\\\]|\\\\.)*)"/g)
            for (const m of itemMatches) {
              items.push(m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim())
            }
            return items.join('\n')
          }
          return ''
        }

        productInfo = {
          brandDescription: extractStringField('brandDescription', repairedJson),
          uniqueSellingPoints:
            extractArrayField('uniqueSellingPoints', repairedJson) ||
            extractStringField('uniqueSellingPoints', repairedJson),
          productHighlights:
            extractArrayField('productHighlights', repairedJson) ||
            extractStringField('productHighlights', repairedJson),
          targetAudience: extractStringField('targetAudience', repairedJson),
          category: extractStringField('category', repairedJson),
        }

        logger.debug('📋 提取到的字段:')
        logger.debug(
          '  - brandDescription:',
          productInfo.brandDescription ? `${productInfo.brandDescription.length}字符` : '无'
        )
        logger.debug(
          '  - uniqueSellingPoints:',
          productInfo.uniqueSellingPoints ? `${productInfo.uniqueSellingPoints.length}字符` : '无'
        )
        logger.debug(
          '  - productHighlights:',
          productInfo.productHighlights ? `${productInfo.productHighlights.length}字符` : '无'
        )
        logger.debug(
          '  - targetAudience:',
          productInfo.targetAudience ? `${productInfo.targetAudience.length}字符` : '无'
        )
        logger.debug('  - category:', productInfo.category || '无')

        // 如果所有字段都为空，则抛出错误
        if (!productInfo.brandDescription && !productInfo.uniqueSellingPoints) {
          logger.error('❌ 无法提取任何有效字段')
          logger.error('尝试解析的JSON:', jsonStr.substring(0, 500))
          throw new Error(`AI返回格式错误: ${parseError.message}`)
        }

        logger.debug('✅ 使用正则提取的字段')
      }
    }

    // 🔧 修复：确保数组字段转换为字符串（AI可能返回数组或字符串）
    const ensureString = (value: any): string => {
      if (!value) return ''
      if (Array.isArray(value)) {
        return value
          .map((item: any) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join('\n')
      }
      return String(value)
    }

    // 🎯 P0优化（2025-12-07）：提取完整AI返回数据，包括 pricing, reviews, competitiveEdges, keywords
    logger.debug('🎯 P0优化: 提取完整AI数据...')

    // 🔧 P0修复：字段名映射兼容（Prompt返回字段名 → 代码期望字段名）
    // Prompt返回: productDescription, sellingPoints, productHighlights
    // 代码期望: brandDescription, uniqueSellingPoints, productHighlights
    const pi = productInfo as any

    // 构建完整的ProductInfo对象，包含所有新增字段
    const enhancedProductInfo: ProductInfo = {
      // 基础字段
      brandDescription: ensureString(pi.brandDescription || pi.productDescription),
      uniqueSellingPoints: ensureString(pi.uniqueSellingPoints || pi.sellingPoints),
      productHighlights: ensureString(pi.productHighlights),
      targetAudience: ensureString(pi.targetAudience),
      category: pi.category,

      // 🆕 完整数据提取
      keywords: pi.keywords || undefined,
      sellingPoints: pi.sellingPoints || undefined,
      productDescription: pi.productDescription || undefined,

      // 定价信息
      pricing: pi.pricing
        ? {
            current: pi.pricing.current || undefined,
            original: pi.pricing.original || undefined,
            discount: pi.pricing.discount || undefined,
            competitiveness: pi.pricing.competitiveness || undefined,
            valueAssessment: pi.pricing.valueAssessment || undefined,
          }
        : undefined,

      // 评论洞察
      reviews: pi.reviews
        ? {
            rating: typeof pi.reviews.rating === 'number' ? pi.reviews.rating : undefined,
            count: typeof pi.reviews.count === 'number' ? pi.reviews.count : undefined,
            sentiment: pi.reviews.sentiment || undefined,
            positives: pi.reviews.positives || undefined,
            concerns: pi.reviews.concerns || undefined,
            useCases: pi.reviews.useCases || undefined,
          }
        : undefined,

      // 促销信息
      promotions: pi.promotions
        ? {
            active: typeof pi.promotions.active === 'boolean' ? pi.promotions.active : undefined,
            types: pi.promotions.types || undefined,
            urgency: pi.promotions.urgency !== undefined ? pi.promotions.urgency : undefined,
            freeShipping:
              typeof pi.promotions.freeShipping === 'boolean'
                ? pi.promotions.freeShipping
                : undefined,
          }
        : undefined,

      // 竞争优势
      competitiveEdges: pi.competitiveEdges
        ? {
            badges: pi.competitiveEdges.badges || undefined,
            primeEligible:
              typeof pi.competitiveEdges.primeEligible === 'boolean'
                ? pi.competitiveEdges.primeEligible
                : undefined,
            stockStatus: pi.competitiveEdges.stockStatus || undefined,
            salesRank: pi.competitiveEdges.salesRank || undefined,
          }
        : undefined,

      // 🎯 v3.3优化（2025-12-08）：店铺/单品差异化分析字段
      // 店铺分析专用字段
      storeQualityLevel: pi.storeQualityLevel || undefined,
      categoryDiversification: pi.categoryDiversification
        ? {
            level: pi.categoryDiversification.level || 'Focused',
            categories: pi.categoryDiversification.categories || undefined,
            primaryCategory: pi.categoryDiversification.primaryCategory || undefined,
          }
        : undefined,
      hotInsights: pi.hotInsights
        ? {
            avgRating:
              typeof pi.hotInsights.avgRating === 'number' ? pi.hotInsights.avgRating : undefined,
            avgReviews:
              typeof pi.hotInsights.avgReviews === 'number' ? pi.hotInsights.avgReviews : undefined,
            topProductsCount:
              typeof pi.hotInsights.topProductsCount === 'number'
                ? pi.hotInsights.topProductsCount
                : undefined,
            bestSeller: pi.hotInsights.bestSeller || undefined,
            priceRange: pi.hotInsights.priceRange || undefined,
          }
        : undefined,
      // 单品分析专用字段
      marketFit: pi.marketFit
        ? {
            score: typeof pi.marketFit.score === 'number' ? pi.marketFit.score : 0,
            level: pi.marketFit.level || 'Average',
            strengths: pi.marketFit.strengths || undefined,
            gaps: pi.marketFit.gaps || undefined,
          }
        : undefined,
      credibilityLevel: pi.credibilityLevel
        ? {
            score: typeof pi.credibilityLevel.score === 'number' ? pi.credibilityLevel.score : 0,
            level: pi.credibilityLevel.level || 'Medium',
            factors: pi.credibilityLevel.factors || undefined,
          }
        : undefined,
      categoryPosition: pi.categoryPosition
        ? {
            rank: pi.categoryPosition.rank || undefined,
            percentile:
              typeof pi.categoryPosition.percentile === 'number'
                ? pi.categoryPosition.percentile
                : undefined,
            competitors:
              typeof pi.categoryPosition.competitors === 'number'
                ? pi.categoryPosition.competitors
                : undefined,
          }
        : undefined,
      // 页面类型标识
      pageType: pi.pageType || pageType,
    }

    // 更新productInfo为增强版本
    productInfo = enhancedProductInfo

    // 🔥 修复（2025-12-13）：店铺场景整合热销商品的产品亮点
    // 问题：店铺场景AI返回的是 hotProducts 数组，每个产品有 productHighlights
    // 解决：使用AI智能整合提炼热销商品的产品亮点，而不是简单汇总
    if (pageType === 'store' && pi.hotProducts && Array.isArray(pi.hotProducts)) {
      try {
        // 收集所有热销商品的产品亮点
        const allProductHighlights: Array<{ productName: string; highlights: string[] }> = []

        pi.hotProducts.forEach((product: any) => {
          if (
            product.productHighlights &&
            Array.isArray(product.productHighlights) &&
            product.productHighlights.length > 0
          ) {
            allProductHighlights.push({
              productName: product.name || 'Unknown Product',
              highlights: product.productHighlights,
            })
          }
        })

        if (allProductHighlights.length > 0) {
          // 📦 从数据库加载prompt模板(版本管理)
          const promptTemplate = await loadPrompt('store_highlights_synthesis')

          // 🎨 准备模板变量
          const productCount = allProductHighlights.length.toString()
          const productHighlightsText = allProductHighlights
            .map(
              (p, i) => `
Product ${i + 1}: ${p.productName}
${p.highlights.map((h) => `- ${h}`).join('\n')}
`
            )
            .join('\n')

          // 🎨 插值替换模板变量
          const synthesisPrompt = promptTemplate
            .replace('{{productCount}}', productCount)
            .replace('{{productHighlights}}', productHighlightsText)
            .replace('{{langName}}', langName)

          const synthesisResult = await generateContent(
            {
              operationType: 'store_highlights_synthesis',
              prompt: synthesisPrompt,
              temperature: 0.7,
              maxOutputTokens: 4096, // 🔥 提升到4096，避免店铺产品亮点整合被截断
            },
            userId
          )

          // 记录token使用
          if (synthesisResult.usage) {
            const cost = estimateTokenCost(
              synthesisResult.model,
              synthesisResult.usage.inputTokens,
              synthesisResult.usage.outputTokens
            )
            await recordTokenUsage({
              userId,
              model: synthesisResult.model,
              operationType: 'store_highlights_synthesis',
              inputTokens: synthesisResult.usage.inputTokens,
              outputTokens: synthesisResult.usage.outputTokens,
              totalTokens: synthesisResult.usage.totalTokens,
              cost,
              apiType: synthesisResult.apiType,
            })
          }

          // 解析AI返回的整合亮点
          const synthesisText = synthesisResult.text
          const jsonMatch = synthesisText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const synthesisData = JSON.parse(jsonMatch[0])
            if (synthesisData.storeHighlights && Array.isArray(synthesisData.storeHighlights)) {
              productInfo.productHighlights = synthesisData.storeHighlights.join('\n')
              logger.debug(
                `✅ [STORE] AI整合提炼了 ${allProductHighlights.length} 个热销商品的产品亮点 → ${synthesisData.storeHighlights.length} 条店铺级亮点`
              )
            }
          }
        } else {
          logger.debug(`⚠️ [STORE] 未能从 hotProducts 中提取产品亮点`)
        }
      } catch (error: any) {
        logger.error(`❌ [STORE] AI整合产品亮点失败: ${error.message}`)
        // 降级方案：简单汇总
        const allHighlights: string[] = []
        pi.hotProducts.forEach((product: any) => {
          if (product.productHighlights && Array.isArray(product.productHighlights)) {
            product.productHighlights.forEach((highlight: string) => {
              allHighlights.push(`• ${highlight}`)
            })
          }
        })
        if (allHighlights.length > 0) {
          productInfo.productHighlights = allHighlights.slice(0, 10).join('\n')
          logger.debug(`⚠️ [STORE] 降级为简单汇总: ${allHighlights.length} 条亮点`)
        }
      }
    }

    // 📊 数据提取统计
    logger.debug('📊 AI数据提取统计:')
    logger.debug(
      `  - 基础字段: brandDescription(${productInfo.brandDescription?.length || 0}), uniqueSellingPoints(${productInfo.uniqueSellingPoints?.length || 0})`
    )
    logger.debug(`  - keywords: ${productInfo.keywords?.length || 0}个`)
    logger.debug(`  - pricing: ${productInfo.pricing ? 'YES' : 'NO'}`)
    logger.debug(`  - reviews: ${productInfo.reviews ? 'YES' : 'NO'}`)
    logger.debug(`  - promotions: ${productInfo.promotions ? 'YES' : 'NO'}`)
    logger.debug(`  - competitiveEdges: ${productInfo.competitiveEdges ? 'YES' : 'NO'}`)
    // 🎯 v3.3优化：新增字段统计
    logger.debug(`  - pageType: ${productInfo.pageType || 'unknown'}`)
    logger.debug(`  - storeQualityLevel: ${productInfo.storeQualityLevel || 'N/A'}`)
    logger.debug(
      `  - categoryDiversification: ${productInfo.categoryDiversification?.level || 'N/A'}`
    )
    logger.debug(`  - hotInsights: ${productInfo.hotInsights ? 'YES' : 'NO'}`)
    logger.debug(
      `  - marketFit: ${productInfo.marketFit ? `${productInfo.marketFit.score}/100 (${productInfo.marketFit.level})` : 'N/A'}`
    )
    logger.debug(
      `  - credibilityLevel: ${productInfo.credibilityLevel ? `${productInfo.credibilityLevel.score}/100 (${productInfo.credibilityLevel.level})` : 'N/A'}`
    )
    logger.debug(`  - categoryPosition: ${productInfo.categoryPosition?.rank || 'N/A'}`)

    return productInfo
  } catch (error: any) {
    logger.error('AI分析失败:', error)
    throw new Error(`AI分析失败: ${error.message}`)
  }
}
