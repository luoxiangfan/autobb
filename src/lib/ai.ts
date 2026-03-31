import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { loadPrompt } from './prompt-loader'
import { logger } from './logger'

export interface ProductInfo {
  brandDescription: string
  uniqueSellingPoints: string
  productHighlights: string
  targetAudience: string
  category?: string
  // 🆕 增强字段：用于竞品搜索词推断
  sellingPoints?: string[]           // 产品卖点列表
  productDescription?: string        // 产品描述（完整文本）

  // 🎯 P0优化（2025-12-07）：存储AI返回的完整数据，提升广告创意质量20-30%
  keywords?: string[]                 // AI生成的关键词列表

  pricing?: {
    current?: string                  // 当前价格
    original?: string                 // 原价
    discount?: string                 // 折扣百分比
    competitiveness?: 'Premium' | 'Competitive' | 'Budget'  // 价格竞争力
    valueAssessment?: string          // 性价比评估
  }

  reviews?: {
    rating?: number                   // 评分
    count?: number                    // 评论数
    sentiment?: 'Positive' | 'Mixed' | 'Negative'  // 情感倾向
    positives?: string[]              // 用户好评要点
    concerns?: string[]               // 用户关注点/缺点
    useCases?: string[]               // 真实使用场景
  }

  promotions?: {
    active?: boolean                  // 是否有促销
    types?: string[]                  // 促销类型（Coupon, Deal, Lightning Deal）
    urgency?: string | null           // 紧迫性文案
    activeDeals?: string[]            // 活跃促销（兼容旧字段）
    urgencyIndicators?: string[]      // 紧迫性指标（兼容旧字段）
    freeShipping?: boolean            // 免邮
  }

  competitiveEdges?: {
    badges?: string[]                 // 徽章（Amazon's Choice, Best Seller）
    primeEligible?: boolean           // Prime资格
    stockStatus?: string              // 库存状态
    salesRank?: string                // 销售排名
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
    pageType?: 'product' | 'store'  // 新增：页面类型
    // 🎯 P1优化：新增字段用于增强AI分析
    technicalDetails?: Record<string, string>  // 技术规格
    reviewHighlights?: string[]  // 评论摘要
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
    const pageType = pageData.pageType || 'product'  // 默认为单品页面

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
      const reviewsText = pageData.reviews && pageData.reviews.length > 0
        ? pageData.reviews.slice(0, 10).map((r, i) =>
            `Review ${i + 1}:\n` +
            `  Rating: ${r.rating}/5\n` +
            `  Author: ${r.author} ${r.verifiedBuyer ? '(Verified)' : ''}\n` +
            `  Date: ${r.date}\n` +
            `  Title: ${r.title}\n` +
            `  Body: ${r.body.substring(0, 200)}${r.body.length > 200 ? '...' : ''}`
          ).join('\n\n')
        : 'Not available (store page)'

      const faqsText = pageData.faqs && pageData.faqs.length > 0
        ? pageData.faqs.slice(0, 10).map((faq, i) =>
            `Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`
          ).join('\n\n')
        : 'Not available (store page)'

      const specificationsText = pageData.specifications && Object.keys(pageData.specifications).length > 0
        ? Object.entries(pageData.specifications)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        : 'Not available (store page)'

      const socialProofText = pageData.socialProof && pageData.socialProof.length > 0
        ? pageData.socialProof.map(sp => `${sp.metric}: ${sp.value}`).join('\n')
        : 'Not available (store page)'

      const coreFeaturesText = pageData.coreFeatures && pageData.coreFeatures.length > 0
        ? '- ' + pageData.coreFeatures.join('\n- ')
        : 'Not available (store page)'

      // 🎯 P1优化: 格式化technicalDetails和reviewHighlights供AI使用（店铺页面通常无单品数据）
      const technicalDetailsText = pageData.technicalDetails && Object.keys(pageData.technicalDetails).length > 0
        ? Object.entries(pageData.technicalDetails)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        : 'Not available (store page)'

      const reviewHighlightsText = pageData.reviewHighlights && pageData.reviewHighlights.length > 0
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
      const technicalDetailsText = pageData.technicalDetails && Object.keys(pageData.technicalDetails).length > 0
        ? Object.entries(pageData.technicalDetails)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        : 'Not available'

      const reviewHighlightsText = pageData.reviewHighlights && pageData.reviewHighlights.length > 0
        ? '- ' + pageData.reviewHighlights.join('\n- ')
        : 'Not available'

      // 🔥 2026-01-04新增：格式化独立站增强数据供AI使用
      const reviewsText = pageData.reviews && pageData.reviews.length > 0
        ? pageData.reviews.slice(0, 10).map((r, i) =>
            `Review ${i + 1}:\n` +
            `  Rating: ${r.rating}/5\n` +
            `  Author: ${r.author} ${r.verifiedBuyer ? '(Verified)' : ''}\n` +
            `  Date: ${r.date}\n` +
            `  Title: ${r.title}\n` +
            `  Body: ${r.body.substring(0, 200)}${r.body.length > 200 ? '...' : ''}`
          ).join('\n\n')
        : 'Not available'

      const faqsText = pageData.faqs && pageData.faqs.length > 0
        ? pageData.faqs.slice(0, 10).map((faq, i) =>
            `Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`
          ).join('\n\n')
        : 'Not available'

      const specificationsText = pageData.specifications && Object.keys(pageData.specifications).length > 0
        ? Object.entries(pageData.specifications)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        : 'Not available'

      const packagesText = pageData.packages && pageData.packages.length > 0
        ? pageData.packages.map((pkg, i) =>
            `Package ${i + 1}: ${pkg.name}\n` +
            `  Price: ${pkg.price || 'N/A'}\n` +
            `  Includes: ${pkg.includes.join(', ')}`
          ).join('\n\n')
        : 'Not available'

      const socialProofText = pageData.socialProof && pageData.socialProof.length > 0
        ? pageData.socialProof.map(sp => `${sp.metric}: ${sp.value}`).join('\n')
        : 'Not available'

      const coreFeaturesText = pageData.coreFeatures && pageData.coreFeatures.length > 0
        ? '- ' + pageData.coreFeatures.join('\n- ')
        : 'Not available'

      const secondaryFeaturesText = pageData.secondaryFeatures && pageData.secondaryFeatures.length > 0
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
    const geminiResult = await generateContent({
      operationType: 'product_page_analysis',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 6144,  // 增加到6144以容纳更丰富的数据维度
    }, userId)

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
        apiType: geminiResult.apiType
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
        /"[^"]+"\s*:\s*"[^"]*"\s*,/g,  // "key": "value",
        /"[^"]+"\s*:\s*\[[^\]]*\]\s*,/g,  // "key": [...],
        /"[^"]+"\s*:\s*\{[^}]*\}\s*,/g,  // "key": {...},
        /"[^"]+"\s*:\s*"[^"]*"\s*$/g,  // "key": "value" (最后一个，无逗号)
        /"[^"]+"\s*:\s*\[[^\]]*\]\s*$/g,  // "key": [...] (最后一个)
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
      logger.debug('修复后的JSON末尾:', repairedJson.substring(Math.max(0, repairedJson.length - 100)))

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
            new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)`),  // 截断的字符串
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
          uniqueSellingPoints: extractArrayField('uniqueSellingPoints', repairedJson) || extractStringField('uniqueSellingPoints', repairedJson),
          productHighlights: extractArrayField('productHighlights', repairedJson) || extractStringField('productHighlights', repairedJson),
          targetAudience: extractStringField('targetAudience', repairedJson),
          category: extractStringField('category', repairedJson),
        }

        logger.debug('📋 提取到的字段:')
        logger.debug('  - brandDescription:', productInfo.brandDescription ? `${productInfo.brandDescription.length}字符` : '无')
        logger.debug('  - uniqueSellingPoints:', productInfo.uniqueSellingPoints ? `${productInfo.uniqueSellingPoints.length}字符` : '无')
        logger.debug('  - productHighlights:', productInfo.productHighlights ? `${productInfo.productHighlights.length}字符` : '无')
        logger.debug('  - targetAudience:', productInfo.targetAudience ? `${productInfo.targetAudience.length}字符` : '无')
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
        return value.map((item: any) =>
          typeof item === 'string' ? item : JSON.stringify(item)
        ).join('\n')
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
      pricing: pi.pricing ? {
        current: pi.pricing.current || undefined,
        original: pi.pricing.original || undefined,
        discount: pi.pricing.discount || undefined,
        competitiveness: pi.pricing.competitiveness || undefined,
        valueAssessment: pi.pricing.valueAssessment || undefined,
      } : undefined,

      // 评论洞察
      reviews: pi.reviews ? {
        rating: typeof pi.reviews.rating === 'number' ? pi.reviews.rating : undefined,
        count: typeof pi.reviews.count === 'number' ? pi.reviews.count : undefined,
        sentiment: pi.reviews.sentiment || undefined,
        positives: pi.reviews.positives || undefined,
        concerns: pi.reviews.concerns || undefined,
        useCases: pi.reviews.useCases || undefined,
      } : undefined,

      // 促销信息
      promotions: pi.promotions ? {
        active: typeof pi.promotions.active === 'boolean' ? pi.promotions.active : undefined,
        types: pi.promotions.types || undefined,
        urgency: pi.promotions.urgency !== undefined ? pi.promotions.urgency : undefined,
        freeShipping: typeof pi.promotions.freeShipping === 'boolean' ? pi.promotions.freeShipping : undefined,
      } : undefined,

      // 竞争优势
      competitiveEdges: pi.competitiveEdges ? {
        badges: pi.competitiveEdges.badges || undefined,
        primeEligible: typeof pi.competitiveEdges.primeEligible === 'boolean' ? pi.competitiveEdges.primeEligible : undefined,
        stockStatus: pi.competitiveEdges.stockStatus || undefined,
        salesRank: pi.competitiveEdges.salesRank || undefined,
      } : undefined,

      // 🎯 v3.3优化（2025-12-08）：店铺/单品差异化分析字段
      // 店铺分析专用字段
      storeQualityLevel: pi.storeQualityLevel || undefined,
      categoryDiversification: pi.categoryDiversification ? {
        level: pi.categoryDiversification.level || 'Focused',
        categories: pi.categoryDiversification.categories || undefined,
        primaryCategory: pi.categoryDiversification.primaryCategory || undefined,
      } : undefined,
      hotInsights: pi.hotInsights ? {
        avgRating: typeof pi.hotInsights.avgRating === 'number' ? pi.hotInsights.avgRating : undefined,
        avgReviews: typeof pi.hotInsights.avgReviews === 'number' ? pi.hotInsights.avgReviews : undefined,
        topProductsCount: typeof pi.hotInsights.topProductsCount === 'number' ? pi.hotInsights.topProductsCount : undefined,
        bestSeller: pi.hotInsights.bestSeller || undefined,
        priceRange: pi.hotInsights.priceRange || undefined,
      } : undefined,
      // 单品分析专用字段
      marketFit: pi.marketFit ? {
        score: typeof pi.marketFit.score === 'number' ? pi.marketFit.score : 0,
        level: pi.marketFit.level || 'Average',
        strengths: pi.marketFit.strengths || undefined,
        gaps: pi.marketFit.gaps || undefined,
      } : undefined,
      credibilityLevel: pi.credibilityLevel ? {
        score: typeof pi.credibilityLevel.score === 'number' ? pi.credibilityLevel.score : 0,
        level: pi.credibilityLevel.level || 'Medium',
        factors: pi.credibilityLevel.factors || undefined,
      } : undefined,
      categoryPosition: pi.categoryPosition ? {
        rank: pi.categoryPosition.rank || undefined,
        percentile: typeof pi.categoryPosition.percentile === 'number' ? pi.categoryPosition.percentile : undefined,
        competitors: typeof pi.categoryPosition.competitors === 'number' ? pi.categoryPosition.competitors : undefined,
      } : undefined,
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
          if (product.productHighlights && Array.isArray(product.productHighlights) && product.productHighlights.length > 0) {
            allProductHighlights.push({
              productName: product.name || 'Unknown Product',
              highlights: product.productHighlights
            })
          }
        })

        if (allProductHighlights.length > 0) {
          // 📦 从数据库加载prompt模板(版本管理)
          const promptTemplate = await loadPrompt('store_highlights_synthesis')

          // 🎨 准备模板变量
          const productCount = allProductHighlights.length.toString()
          const productHighlightsText = allProductHighlights.map((p, i) => `
Product ${i + 1}: ${p.productName}
${p.highlights.map(h => `- ${h}`).join('\n')}
`).join('\n')

          // 🎨 插值替换模板变量
          const synthesisPrompt = promptTemplate
            .replace('{{productCount}}', productCount)
            .replace('{{productHighlights}}', productHighlightsText)
            .replace('{{langName}}', langName)

          const synthesisResult = await generateContent({
            operationType: 'store_highlights_synthesis',
            prompt: synthesisPrompt,
            temperature: 0.7,
            maxOutputTokens: 4096,  // 🔥 提升到4096，避免店铺产品亮点整合被截断
          }, userId)

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
              apiType: synthesisResult.apiType
            })
          }

          // 解析AI返回的整合亮点
          const synthesisText = synthesisResult.text
          const jsonMatch = synthesisText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const synthesisData = JSON.parse(jsonMatch[0])
            if (synthesisData.storeHighlights && Array.isArray(synthesisData.storeHighlights)) {
              productInfo.productHighlights = synthesisData.storeHighlights.join('\n')
              logger.debug(`✅ [STORE] AI整合提炼了 ${allProductHighlights.length} 个热销商品的产品亮点 → ${synthesisData.storeHighlights.length} 条店铺级亮点`)
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
    logger.debug(`  - 基础字段: brandDescription(${productInfo.brandDescription?.length || 0}), uniqueSellingPoints(${productInfo.uniqueSellingPoints?.length || 0})`)
    logger.debug(`  - keywords: ${productInfo.keywords?.length || 0}个`)
    logger.debug(`  - pricing: ${productInfo.pricing ? 'YES' : 'NO'}`)
    logger.debug(`  - reviews: ${productInfo.reviews ? 'YES' : 'NO'}`)
    logger.debug(`  - promotions: ${productInfo.promotions ? 'YES' : 'NO'}`)
    logger.debug(`  - competitiveEdges: ${productInfo.competitiveEdges ? 'YES' : 'NO'}`)
    // 🎯 v3.3优化：新增字段统计
    logger.debug(`  - pageType: ${productInfo.pageType || 'unknown'}`)
    logger.debug(`  - storeQualityLevel: ${productInfo.storeQualityLevel || 'N/A'}`)
    logger.debug(`  - categoryDiversification: ${productInfo.categoryDiversification?.level || 'N/A'}`)
    logger.debug(`  - hotInsights: ${productInfo.hotInsights ? 'YES' : 'NO'}`)
    logger.debug(`  - marketFit: ${productInfo.marketFit ? `${productInfo.marketFit.score}/100 (${productInfo.marketFit.level})` : 'N/A'}`)
    logger.debug(`  - credibilityLevel: ${productInfo.credibilityLevel ? `${productInfo.credibilityLevel.score}/100 (${productInfo.credibilityLevel.level})` : 'N/A'}`)
    logger.debug(`  - categoryPosition: ${productInfo.categoryPosition?.rank || 'N/A'}`)

    return productInfo
  } catch (error: any) {
    logger.error('AI分析失败:', error)
    throw new Error(`AI分析失败: ${error.message}`)
  }
}

/**
 * 生成广告创意（支持从历史创意学习）
 * 增强版：支持广告导向（brand/product/promo）和更丰富的广告元素
 * P0-2优化：集成品牌真实服务验证
 */
export async function generateAdCreatives(
  productInfo: {
    brand: string
    brandDescription: string
    uniqueSellingPoints: string
    productHighlights: string
    targetAudience: string
    targetCountry: string
    websiteUrl?: string // P0-2: 用于提取真实服务
    reviewAnalysis?: any // 🎯 P0优化: 用户评论深度分析结果
    competitorAnalysis?: any // 🎯 P0优化: 竞品对比分析结果
    visualAnalysis?: any // 🎯 P1优化: 视觉元素智能分析结果
  },
  options?: {
    userId?: number
    orientation?: 'brand' | 'product' | 'promo'
    validateServices?: boolean // P0-2: 是否验证服务真实性
    applyOptimizations?: boolean // 是否应用基于投放数据的优化
  }
): Promise<{
  headlines: string[]
  descriptions: string[]
  callouts: string[]
  sitelinks: Array<{ title: string; description?: string }>
  usedLearning: boolean
  usedOptimizations: boolean // 是否应用了投放数据优化
  servicesValidated?: boolean // P0-2: 是否进行了服务验证
  validationResults?: { validCallouts: string[]; invalidCallouts: string[] } // P0-2: 验证结果
  reviewInsightsUsed?: boolean // 🎯 P0优化: 是否使用了评论洞察
  competitiveInsightsUsed?: boolean // 🎯 P0优化: 是否使用了竞品对比洞察
  visualInsightsUsed?: boolean // 🎯 P1优化: 是否使用了视觉洞察
  prompt: string // 实际使用的AI Prompt
}> {
  try {
    // P1-3优化：为三种广告导向创建差异化Prompt模板
    const orientationConfig = {
      brand: {
        guidance: '重点突出品牌知名度、品牌价值和信任度',
        headlineStrategy: '标题应强调品牌名称、品牌历史、品牌荣誉、官方认证等信任要素',
        descriptionStrategy: '描述应突出品牌故事、品牌承诺、品牌优势、行业地位等建立信任的内容',
        calloutStrategy: '宣传信息应体现品牌权威性，如"官方旗舰店"、"行业领先"、"百万用户信赖"、"品牌保障"等',
        sitelinkStrategy: '附加链接应引导至品牌介绍、品牌历史、客户评价、品牌承诺等建立信任的页面',
        examples: {
          headline: '${productInfo.brand}官方旗舰店 | 品质保证',
          callout: '官方认证、品牌保障、行业领先、百万用户'
        }
      },
      product: {
        guidance: '重点突出产品功能、特性和差异化优势',
        headlineStrategy: '标题应强调产品功能、技术参数、独特特性、产品优势等具体卖点',
        descriptionStrategy: '描述应详细说明产品特性、使用场景、技术优势、与竞品的差异化等',
        calloutStrategy: '宣传信息应体现产品特性，如"高性能"、"智能控制"、"长续航"、"轻薄便携"等',
        sitelinkStrategy: '附加链接应引导至产品详情、技术规格、使用指南、产品对比等功能介绍页面',
        examples: {
          headline: '${productInfo.productHighlights}的最佳选择',
          callout: '高性能、智能化、长续航、轻薄设计'
        }
      },
      promo: {
        guidance: '重点突出优惠、折扣和限时促销信息',
        headlineStrategy: '标题应强调折扣力度、限时优惠、促销活动、赠品福利等吸引点击的元素',
        descriptionStrategy: '描述应详细说明优惠详情、活动时间、优惠条件、额外福利等促销信息',
        calloutStrategy: '宣传信息应体现促销吸引力，如"限时折扣"、"满减优惠"、"免费赠品"、"新客专享"等',
        sitelinkStrategy: '附加链接应引导至促销活动页、优惠券领取、限时特价、会员专享等优惠页面',
        examples: {
          headline: '限时优惠！立享8折 | ${productInfo.brand}',
          callout: '限时折扣、满减优惠、免费赠品、新客专享'
        }
      }
    }

    const currentOrientation = options?.orientation || 'brand'
    const config = orientationConfig[currentOrientation]
    const guidance = config.guidance

    // P0-2: 提取品牌真实服务（如果提供了websiteUrl且开启验证）
    let realServices: string[] = []
    let servicesValidated = false

    if (options?.validateServices && productInfo.websiteUrl) {
      try {
        const { extractBrandServices, servicesToWhitelist, generateCalloutSuggestions, generateSitelinkSuggestions } =
          await import('./brand-services-extractor')

        const services = await extractBrandServices(
          productInfo.websiteUrl,
          productInfo.targetCountry
        )

        realServices = servicesToWhitelist(services)
        servicesValidated = realServices.length > 0

        logger.debug(`✅ 提取到${realServices.length}个真实服务:`, realServices)
      } catch (error) {
        logger.warn('提取品牌服务失败，使用通用生成:', error)
        // 继续使用通用生成，不中断流程
      }
    }

    // 🎯 P0优化：提取评论洞察（如果有）
    let reviewInsightsUsed = false
    let reviewInsightsSection = ''

    if (productInfo.reviewAnalysis) {
      const analysis = productInfo.reviewAnalysis
      reviewInsightsUsed = true

      // 提取最有价值的洞察
      const topPositives = analysis.topPositiveKeywords?.slice(0, 5).map((kw: any) => kw.keyword).join(', ') || ''
      const topUseCases = analysis.realUseCases?.slice(0, 3).map((uc: any) => uc.scenario).join(', ') || ''
      const majorPainPoints = analysis.commonPainPoints?.filter((pp: any) => pp.severity === 'critical' || pp.severity === 'moderate')
        .slice(0, 3).map((pp: any) => pp.issue).join(', ') || ''
      const sentiment = analysis.sentimentDistribution || {}

      reviewInsightsSection = `

## 🎯 用户评论洞察（P0优化 - 基于${analysis.totalReviews || 0}条真实评论）

### 情感分布
- 正面评价: ${sentiment.positive || 0}% (${sentiment.positive >= 75 ? '优秀' : sentiment.positive >= 60 ? '良好' : '需改进'})
- 中性评价: ${sentiment.neutral || 0}%
- 负面评价: ${sentiment.negative || 0}%

### 用户最喜爱的特性（高频正面关键词）
${topPositives || '无'}

### 真实使用场景（用户实际使用情况）
${topUseCases || '无'}

${majorPainPoints ? `### 需要在广告中解决的痛点
${majorPainPoints}` : ''}

💡 **创意生成指导**:
1. 标题应包含用户最喜爱的特性关键词（如: ${topPositives.split(',')[0] || '产品核心特性'}）
2. 描述应突出真实使用场景（如: ${topUseCases.split(',')[0] || '主要应用场景'}）
${majorPainPoints ? `3. 通过差异化解决用户痛点（如: 解决"${majorPainPoints.split(',')[0]}"问题）` : '3. 强调产品独特优势'}
4. 使用用户真实语言风格，提高广告相关性和点击率
`
    }

    // 🎯 P0优化：提取竞品对比洞察（如果有）
    let competitiveInsightsUsed = false
    let competitiveInsightsSection = ''

    if (productInfo.competitorAnalysis) {
      const analysis = productInfo.competitorAnalysis
      competitiveInsightsUsed = true

      // 提取最有价值的竞争洞察
      const priceAdv = (analysis.pricePosition?.priceAdvantage || 'unknown') as string
      const ratingAdv = (analysis.ratingPosition?.ratingAdvantage || 'unknown') as string
      const usps = analysis.uniqueSellingPoints?.slice(0, 3).map((usp: any) => usp.feature).join(', ') || ''
      const competitorAdvs = analysis.competitorAdvantages?.slice(0, 3).map((adv: any) => adv.advantage).join('; ') || ''
      const competitiveness = analysis.overallCompetitiveness || 0

      // 价格优势描述
      const priceAdvText = {
        'lowest': `最低价（比竞品平均便宜${analysis.pricePosition?.savingsPercent || 0}%）`,
        'below_average': '价格优势（低于市场平均）',
        'average': '市场平均价格',
        'above_average': '定位较高（高于市场平均）',
        'premium': '高端定位（溢价产品）',
        'unknown': '价格定位未知'
      }[priceAdv] || '价格定位未知'

      // 评分优势描述
      const ratingAdvText = {
        'top_rated': `最高评分（${analysis.ratingPosition?.ourRating || 0}⭐，高于${analysis.ratingPosition?.percentile || 0}%竞品）`,
        'above_average': '评分优势（高于市场平均）',
        'average': '市场平均评分',
        'below_average': '评分低于平均（需强调其他优势）',
        'unknown': '评分数据未知'
      }[ratingAdv] || '评分数据未知'

      competitiveInsightsSection = `

## 🏆 竞品对比洞察（P0优化 - 基于${analysis.totalCompetitors || 0}个竞品分析）

### 竞争力概况
- 整体竞争力评分: ${competitiveness}/100 (${competitiveness >= 80 ? '优秀' : competitiveness >= 60 ? '良好' : competitiveness >= 40 ? '中等' : '需改进'})

### 价格竞争力
${priceAdvText}
${priceAdv === 'lowest' || priceAdv === 'below_average' ? '💡 **广告策略**: 标题/描述中突出价格优势，如"超值价格"、"性价比之选"' : ''}
${priceAdv === 'premium' || priceAdv === 'above_average' ? '💡 **广告策略**: 避免提及价格，强调品质、技术、服务等高价值因素' : ''}

### 评分竞争力
${ratingAdvText}
${ratingAdv === 'top_rated' || ratingAdv === 'above_average' ? '💡 **广告策略**: 标题中突出高评分，如"4.8星好评"、"用户认可"' : ''}
${ratingAdv === 'below_average' ? '💡 **广告策略**: 避免提及评分，强调产品功能、创新特性、售后服务' : ''}

${usps ? `### 独特卖点（竞品较少拥有）
${usps}
💡 **广告策略**: 这些是差异化优势，应在标题和描述中重点突出` : ''}

${competitorAdvs ? `### 竞品优势（需要应对的弱点）
${competitorAdvs}
💡 **广告策略**: 通过强调我们的其他优势来弱化这些弱点，或直接提供解决方案` : ''}

💡 **总体创意策略**:
1. ${priceAdv === 'lowest' || priceAdv === 'below_average' ? '标题突出价格优势' : '标题避免价格，强调价值'}
2. ${ratingAdv === 'top_rated' || ratingAdv === 'above_average' ? '描述中加入高评分和用户认可' : '描述中强调产品功能和独特性'}
3. ${usps ? `宣传信息（Callouts）重点展示独特卖点: ${usps.split(',')[0]}等` : '宣传信息强调核心优势'}
4. ${competitorAdvs ? '通过附加链接（Sitelinks）提供详细信息来应对竞品优势' : '附加链接展示全面的产品/服务信息'}
`
    }

    // 🎯 P1优化：提取视觉洞察（如果有）
    let visualInsightsUsed = false
    let visualInsightsSection = ''

    if (productInfo.visualAnalysis) {
      const analysis = productInfo.visualAnalysis
      visualInsightsUsed = true

      // 提取视觉质量和场景
      const imageQuality = analysis.imageQuality || {}
      const scenarios = analysis.identifiedScenarios?.slice(0, 3).map((s: any) => s.adCopyIdea).join(', ') || ''
      const highlights = analysis.visualHighlights?.slice(0, 3).map((h: any) => h.adCopyIdea).join(', ') || ''
      const hasLifestyle = imageQuality.hasLifestyleImages || false
      const hasInfographics = imageQuality.hasInfographics || false

      // 计算整体质量评分（基于多个因素）
      const totalImages = imageQuality.totalImages || 0
      const highQualityRatio = imageQuality.highQualityRatio || 0
      const qualityLevel = highQualityRatio >= 0.7 ? '优秀' : highQualityRatio >= 0.5 ? '良好' : '一般'

      visualInsightsSection = `

## 📸 视觉元素洞察（P1优化 - 基于${totalImages}张产品图片分析）

### 图片质量评估
- 图片总数: ${totalImages}
- 高质量占比: ${Math.round(highQualityRatio * 100)}% (${qualityLevel})
- 生活场景图: ${hasLifestyle ? '✅ 有' : '❌ 无'}
- 信息图/特性展示: ${hasInfographics ? '✅ 有' : '❌ 无'}

${scenarios ? `### 识别的使用场景
${scenarios}
💡 **广告策略**: 广告文案应体现这些真实使用场景，提高用户共鸣` : ''}

${highlights ? `### 视觉亮点
${highlights}
💡 **广告策略**: 在标题和描述中突出这些视觉优势，增强吸引力` : ''}

💡 **视觉营销策略**:
1. ${hasLifestyle ? '利用生活场景图增强真实感，描述中加入场景化表述' : '强调产品功能和技术参数（缺少场景图）'}
2. ${hasInfographics ? '信息图展示功能优势，可在Callouts中提炼关键特性' : '需要通过文字详细说明产品特性'}
3. ${scenarios ? `场景化标题: "${scenarios.split(',')[0] || '产品核心场景'}"` : '产品特性标题'}
4. ${highlights ? `视觉亮点强化: "${highlights.split(',')[0] || '产品核心优势'}"` : '强调功能优势'}
`
    }

    // P1-3优化：根据广告导向生成差异化Prompt
    let basePrompt = `你是一个专业的Google Ads广告文案撰写专家。请根据以下产品信息，生成高质量的Google搜索广告文案。

## 产品信息
品牌名称: ${productInfo.brand}
品牌描述: ${productInfo.brandDescription}
独特卖点: ${productInfo.uniqueSellingPoints}
产品亮点: ${productInfo.productHighlights}
目标受众: ${productInfo.targetAudience}
目标国家: ${productInfo.targetCountry}
${reviewInsightsSection}
${competitiveInsightsSection}
${visualInsightsSection}
## 广告导向（P1-3优化）
类型: ${currentOrientation === 'brand' ? '品牌导向' : currentOrientation === 'product' ? '产品导向' : '促销导向'}
策略: ${guidance}

### 标题策略
${config.headlineStrategy}

### 描述策略
${config.descriptionStrategy}

### 宣传信息策略
${config.calloutStrategy}

### 附加链接策略
${config.sitelinkStrategy}

### 参考示例
${currentOrientation === 'brand' ? `
标题示例: "${productInfo.brand}官方旗舰店 | 品质保证"
宣传信息示例: "官方认证、品牌保障、行业领先、百万用户信赖"
` : currentOrientation === 'product' ? `
标题示例: "${productInfo.productHighlights} | 专业之选"
宣传信息示例: "高性能、智能化、长续航、轻薄设计"
` : `
标题示例: "限时优惠！立享8折 | ${productInfo.brand}"
宣传信息示例: "限时折扣、满减优惠、免费赠品、新客专享"
`}

## 输出格式
请以JSON格式返回完整的广告创意元素：
{
  "headlines": [
    "标题1（最多30个字符）",
    "标题2（最多30个字符）",
    "标题3（最多30个字符）"
  ],
  "descriptions": [
    "描述1（最多90个字符）",
    "描述2（最多90个字符）"
  ],
  "callouts": [
    "宣传信息1（最多25个字符）",
    "宣传信息2（最多25个字符）",
    "宣传信息3（最多25个字符）",
    "宣传信息4（最多25个字符）"
  ],
  "sitelinks": [
    { "title": "链接文字1（最多25个字符）", "description": "链接描述1（最多35个字符）" },
    { "title": "链接文字2（最多25个字符）", "description": "链接描述2（最多35个字符）" },
    { "title": "链接文字3（最多25个字符）", "description": "链接描述3（最多35个字符）" },
    { "title": "链接文字4（最多25个字符）", "description": "链接描述4（最多35个字符）" }
  ]
}

## 质量要求
1. 标题必须在30个字符以内
2. 描述必须在90个字符以内
3. 宣传信息（Callouts）每条最多25个字符，必须基于品牌描述和产品亮点中的真实信息
4. 附加链接（Sitelinks）标题最多25个字符，描述最多35个字符，必须基于真实的品牌信息
5. 突出产品的独特价值和优势
6. 使用吸引人的行动号召语
7. 严格遵守上述${currentOrientation === 'brand' ? '品牌导向' : currentOrientation === 'product' ? '产品导向' : '促销导向'}策略
8. 符合Google Ads政策
9. 只返回JSON，不要其他文字
10. Callouts和Sitelinks必须真实可信，不要编造不存在的服务或承诺`

    // P0-2: 如果提取到真实服务，添加白名单约束
    if (realServices.length > 0) {
      basePrompt += `

## ⚠️ 重要：真实服务白名单（必须遵守）

我们从品牌官网提取到以下真实服务和承诺，生成的Callouts和Sitelinks必须基于这些真实信息：

可用服务列表：${realServices.join(', ')}

要求：
1. Callouts必须从上述真实服务中选择，不要编造不存在的服务
2. Sitelinks的描述也要基于这些真实服务
3. 如果某个服务不在列表中，绝对不要使用
4. 可以使用同义词或简化表达，但核心承诺必须真实`
    }

    let usedLearning = false
    let usedOptimizations = false

    // 如果提供userId，使用历史创意学习优化Prompt
    if (options?.userId) {
      try {
        const { getUserOptimizedPrompt } = await import('./creative-learning')
        const optimizedPrompt = await getUserOptimizedPrompt(options.userId, basePrompt)
        if (optimizedPrompt !== basePrompt) {
          basePrompt = optimizedPrompt
          usedLearning = true
        }
      } catch (learningError) {
        logger.warn('创意学习模块加载失败，使用基础Prompt:', learningError)
        // 继续使用基础Prompt
      }
    }

    // 如果启用了优化，应用基于投放数据的优化规则
    if (options?.applyOptimizations) {
      try {
        const { applyOptimizationsToPrompt } = await import('./prompt-optimizer')
        const optimizedPrompt = applyOptimizationsToPrompt(basePrompt, currentOrientation)
        if (optimizedPrompt !== basePrompt) {
          basePrompt = optimizedPrompt
          usedOptimizations = true
          logger.debug('✅ 已应用投放数据优化规则')
        }
      } catch (optimizationError) {
        logger.warn('优化规则应用失败:', optimizationError)
        // 继续使用基础Prompt
      }
    }

    // 需求12：使用Gemini 2.5 Pro实验版模型（带代理支持 + 自动降级）
    // 传递userId以使用用户级AI配置（优先Vertex AI）
    if (!options?.userId) {
      throw new Error('AI页面分析需要用户ID，请确保已登录')
    }
    const result = await generateContent({
      operationType: 'ad_creative_generation_main',
      prompt: basePrompt,
      temperature: 0.7,
      maxOutputTokens: 32768,  // 保持较高值以防截断
    }, options.userId)

    const text = result.text

    // 记录token使用
    if (result.usage) {
      const cost = estimateTokenCost(
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens
      )
      await recordTokenUsage({
        userId: options.userId,
        model: result.model,
        operationType: 'ad_creative_generation',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cost,
        apiType: result.apiType
      })
    }

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const creatives = JSON.parse(jsonMatch[0])

    // P0-2: 验证生成的Callouts（如果开启了服务验证）
    let validationResults
    let finalCallouts = creatives.callouts || []

    if (servicesValidated && realServices.length > 0) {
      const { validateAgainstWhitelist } = await import('./brand-services-extractor')
      const validation = validateAgainstWhitelist(finalCallouts, realServices)

      validationResults = {
        validCallouts: validation.valid,
        invalidCallouts: validation.invalid
      }

      // 如果有无效的callout，记录警告（但不阻止流程）
      if (validation.invalid.length > 0) {
        logger.warn('⚠️ 发现无法验证的Callouts:', validation.invalid)
        // 可以选择过滤掉无效callouts，或保留（这里保留，让用户决定）
      }

      logger.debug('✅ Callouts验证通过:', validation.valid)
    }

    return {
      headlines: creatives.headlines || [],
      descriptions: creatives.descriptions || [],
      callouts: finalCallouts,
      sitelinks: creatives.sitelinks || [],
      usedLearning,
      usedOptimizations,
      servicesValidated,
      validationResults,
      reviewInsightsUsed, // 🎯 P0优化: 是否使用了评论洞察
      competitiveInsightsUsed, // 🎯 P0优化: 是否使用了竞品对比洞察
      visualInsightsUsed, // 🎯 P1优化: 是否使用了视觉洞察
      prompt: basePrompt // 返回实际使用的Prompt
    }
  } catch (error: any) {
    logger.error('生成广告创意失败:', error)
    throw new Error(`生成广告创意失败: ${error.message}`)
  }
}

/**
 * 🎯 新增：从产品内容中智能提取品牌名
 * 专门用于当Scraper无法提取品牌名时的AI fallback
 */
export async function extractBrandFromContent(
  pageData: {
    title: string
    description: string
    text: string
    url: string
  },
  userId?: number
): Promise<string> {
  try {
    // 📦 从数据库加载prompt模板(版本管理)
    const promptTemplate = await loadPrompt('brand_name_extraction')

    // 🎨 准备模板变量
    const pageDataUrl = pageData.url
    const pageDataTitle = pageData.title
    const pageDataDescription = pageData.description
    const pageDataTextPreview = pageData.text.substring(0, 500)

    // 🎨 插值替换模板变量
    const prompt = promptTemplate
      .replace('{{pageData.url}}', pageDataUrl)
      .replace('{{pageData.title}}', pageDataTitle)
      .replace('{{pageData.description}}', pageDataDescription)
      .replace('{{pageData.textPreview}}', pageDataTextPreview)
      .trim()

    if (!userId) {
      throw new Error('userId is required for brand extraction')
    }

    const result = await generateContent({
      operationType: 'brand_extraction',
      prompt,
    }, userId)
    const brandName = result.text

    // 记录token使用
    if (result.usage) {
      const cost = estimateTokenCost(
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: result.model,
        operationType: 'brand_extraction',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cost,
        apiType: result.apiType
      })
    }

    // 验证和清洗AI返回的品牌名
    const cleanedBrand = brandName
      .trim()
      .replace(/^["']|["']$/g, '') // 移除引号
      .replace(/^Brand:\s*/i, '') // 移除"Brand:"前缀
      .replace(/\s+(Store|Shop|Official|Brand)$/i, '') // 移除常见后缀
      .trim()

    // 验证品牌名合理性
    if (cleanedBrand.length < 2 || cleanedBrand.length > 30) {
      throw new Error(`品牌名长度不合理: ${cleanedBrand.length}字符`)
    }

    // 验证不包含常见的无效词汇
    const invalidWords = ['unknown', 'n/a', 'none', 'null', 'undefined', 'product']
    if (invalidWords.some(word => cleanedBrand.toLowerCase().includes(word))) {
      throw new Error(`品牌名包含无效词汇: ${cleanedBrand}`)
    }

    logger.debug(`✅ AI品牌提取: "${brandName}" → 清洗后: "${cleanedBrand}"`)
    return cleanedBrand

  } catch (error: any) {
    logger.error('AI品牌提取失败:', error)
    throw new Error(`AI品牌提取失败: ${error.message}`)
  }
}
