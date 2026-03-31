/**
 * P0高级优化：用户评论深度分析
 *
 * 功能：
 * 1. 抓取Amazon产品评论（30-50条）
 * 2. AI智能分析：情感分布、高频关键词、真实场景、痛点挖掘
 * 3. 为广告创意生成提供真实用户洞察
 *
 * 预期效果：
 * - CTR提升: +20-30%（使用用户真实语言）
 * - 转化率提升: +15-25%（解决用户痛点）
 * - 广告相关性评分: +25%（匹配用户搜索意图）
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getLanguageNameForCountry } from './language-country-codes'
import { compressReviews, type RawReview as CompressorRawReview } from './review-compressor'
import { withCache, type CacheOptions } from './ai-cache'
import { loadPrompt } from './prompt-loader'

// ==================== 数据结构定义 ====================

/**
 * 单条评论原始数据
 */
export interface RawReview {
  rating: string | null           // "5.0 out of 5 stars"
  title: string | null             // 评论标题
  body: string | null              // 评论正文
  helpful: string | null           // "125 people found this helpful"
  verified: boolean                // 是否为认证购买
  date?: string | null             // 评论日期
  author?: string | null           // 评论者
}

/**
 * 情感分布
 */
export interface SentimentDistribution {
  positive: number    // 正面评论占比 (4-5星) 0-100
  neutral: number     // 中性评论占比 (3星) 0-100
  negative: number    // 负面评论占比 (1-2星) 0-100
}

/**
 * 高频关键词
 */
export interface KeywordInsight {
  keyword: string          // "easy setup", "clear image"
  frequency: number        // 出现次数
  sentiment: 'positive' | 'negative'
  context?: string         // 上下文说明
}

/**
 * 真实使用场景
 */
export interface UseCase {
  scenario: string         // "monitoring backyard", "baby monitor"
  mentions: number         // 被提及次数
  examples?: string[]      // 具体评论片段
}

/**
 * 购买动机
 */
export interface PurchaseReason {
  reason: string           // "replace old camera", "home security upgrade"
  frequency: number        // 频次
}

/**
 * 用户画像
 */
export interface UserProfile {
  profile: string          // "tech-savvy homeowner", "small business owner"
  indicators: string[]     // 判断依据
}

/**
 * 痛点分析
 */
export interface PainPoint {
  issue: string            // "difficult installation", "subscription required"
  severity: 'critical' | 'moderate' | 'minor'
  affectedUsers: number    // 受影响用户数
  workarounds?: string[]   // 用户提到的解决方法
}

/**
 * 🔥 v3.2新增：量化数据亮点（评论中提到的具体数字）
 * 这些数字是广告创意的黄金素材！
 */
export interface QuantitativeHighlight {
  metric: string           // "Battery Life", "Suction Power", "Coverage Area"
  value: string            // "8 hours", "2000Pa", "2000 sq ft"
  source: string           // "multiple reviews", "verified purchase"
  adCopy: string           // 适合用于广告的文案格式 "8-Hour Battery Life"
}

/**
 * 🔥 v3.2新增：用户提及的竞品
 */
export interface CompetitorMention {
  brand: string            // "Roomba", "Dyson", "iRobot"
  comparison: string       // "cheaper than", "better than", "similar to"
  sentiment: 'positive' | 'neutral' | 'negative'
}

/**
 * 完整的评论分析结果
 */
export interface ReviewAnalysisResult {
  // 基础数据
  totalReviews: number
  averageRating: number

  // 情感分析
  sentimentDistribution: SentimentDistribution

  // 关键词洞察
  topPositiveKeywords: KeywordInsight[]
  topNegativeKeywords: KeywordInsight[]

  // 使用场景
  realUseCases: UseCase[]

  // 购买动机
  purchaseReasons: PurchaseReason[]

  // 用户画像
  userProfiles: UserProfile[]

  // 痛点挖掘
  commonPainPoints: PainPoint[]

  // 🔥 v3.2新增：量化数据亮点
  quantitativeHighlights?: QuantitativeHighlight[]

  // 🔥 v3.2新增：用户提及的竞品
  competitorMentions?: CompetitorMention[]

  // 原始数据统计
  analyzedReviewCount: number      // 实际分析的评论数
  verifiedReviewCount: number      // 认证购买评论数
}

// ==================== 评论抓取逻辑 ====================

/**
 * 从Playwright页面对象中抓取Amazon产品评论
 *
 * @param page Playwright页面对象
 * @param limit 抓取评论数量上限（默认50）
 * @returns 评论数组
 */
export async function scrapeAmazonReviews(
  page: any,
  limit: number = 50
): Promise<RawReview[]> {
  console.log(`📝 开始抓取评论，目标数量: ${limit}`)

  try {
    // 导航到评论区域（使用#customer-reviews_feature_div锚点直接定位到评论）
    const currentUrl = page.url()
    const isProductPage = currentUrl.includes('/dp/') || currentUrl.includes('/product/')

    if (isProductPage && !currentUrl.includes('#customer-reviews_feature_div')) {
      try {
        // 直接在URL后添加#customer-reviews_feature_div锚点，浏览器会自动滚动到评论区域
        const reviewsUrl = currentUrl.split('#')[0] + '#customer-reviews_feature_div'
        console.log(`🔗 导航到评论区域: ${reviewsUrl}`)
        // 🔧 优化(2025-12-11): 使用networkidle等待，确保动态内容加载完成
        await page.goto(reviewsUrl, { waitUntil: 'networkidle', timeout: 15000 })
        console.log('✅ 已导航到评论区域')
      } catch (navError) {
        console.log('⚠️ 导航到评论区域失败，在当前页面抓取评论:', navError)
      }
    }

    // 🔥 2025-12-13 KISS优化v2：评论区在页面底部(~9945px)，必须先深度滚动触发懒加载
    // 顺序：深度滚动 → 检测容器 → 快速失败
    console.log('📜 开始深度滚动到页面底部触发评论区懒加载...')
    try {
      // 第一步：滚动到页面80%位置（评论区通常在底部）
      await page.evaluate(() => {
        const scrollHeight = document.body.scrollHeight
        window.scrollTo(0, scrollHeight * 0.8)
      })
      await page.waitForTimeout(1500)

      // 第二步：尝试直接滚动到评论区
      await page.evaluate(() => {
        const reviewSection = document.querySelector('#customer-reviews_feature_div') ||
                              document.querySelector('#reviews-medley-footer')
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: 'instant', block: 'start' })
        } else {
          // 没找到则继续滚动到更深位置
          window.scrollTo(0, document.body.scrollHeight * 0.9)
        }
      })
      await page.waitForTimeout(2000)
      console.log('✅ 深度滚动完成')
    } catch (scrollError) {
      console.log('⚠️ 深度滚动失败:', scrollError)
    }

    // 滚动后再检查评论容器是否存在
    const hasReviewContainer = await page.evaluate(() => {
      const containers = [
        '#customer-reviews_feature_div',
        '#reviews-medley-footer',
        '#cm-cr-dp-review-list',
        '[data-hook="review"]'
      ]
      for (const selector of containers) {
        if (document.querySelector(selector)) return selector
      }
      return null
    }).catch(() => null)

    if (!hasReviewContainer) {
      console.log('⚠️ 深度滚动后评论容器仍不存在，快速跳过评论抓取')
      return []
    }
    console.log(`✅ 发现评论容器: ${hasReviewContainer}`)

    // 🔧 优化(2025-12-11): 优先等待实际评论元素，而非容器
    // 评论容器可能存在但内部评论元素是懒加载的
    const reviewElementSelectors = [
      '[data-hook="review"]',                        // 标准评论元素（最可靠）
      '#cm-cr-dp-review-list [data-hook="review"]',  // 详情页评论列表
      '.review.aok-relative',                        // Amazon UK/EU 布局
      'li.review[data-hook="review"]',               // 列表形式的评论
      '[id^="customer_review-"]',                    // 以customer_review-开头的ID
    ]

    let reviewSelectorFound = false
    let foundSelector = ''

    // 🔧 优化(2025-12-11): 增加重试机制，每次等待更长时间
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`🔄 尝试第${attempt}次查找评论元素...`)

      for (const selector of reviewElementSelectors) {
        try {
          // 增加等待时间：第1次3秒，第2次5秒，第3次8秒
          const timeout = attempt === 1 ? 3000 : (attempt === 2 ? 5000 : 8000)
          await page.waitForSelector(selector, { timeout })
          console.log(`✅ 找到评论选择器: ${selector}`)
          reviewSelectorFound = true
          foundSelector = selector
          break
        } catch {
          // 继续尝试下一个选择器
        }
      }

      if (reviewSelectorFound) break

      // 如果没找到，滚动页面触发更多懒加载
      if (attempt < 3) {
        console.log(`⚠️ 第${attempt}次未找到评论，滚动页面后重试...`)
        await page.evaluate(() => {
          window.scrollBy(0, 500)
        })
        await page.waitForTimeout(1500)
      }
    }

    if (!reviewSelectorFound) {
      console.log('⚠️ 所有评论选择器均未找到，尝试通用抓取')
      // 🔧 优化(2025-12-11): 输出调试信息帮助诊断
      const debugInfo = await page.evaluate(() => {
        return {
          hasReviewContainer: !!document.querySelector('#customer-reviews_feature_div'),
          containerInnerLength: document.querySelector('#customer-reviews_feature_div')?.innerHTML?.length || 0,
          reviewElementCount: document.querySelectorAll('[data-hook="review"]').length,
          pageUrl: window.location.href
        }
      })
      console.log('📊 调试信息:', JSON.stringify(debugInfo))
    }

    // 抓取评论 - 使用增强的选择器组合
    const reviews: RawReview[] = await page.evaluate((maxReviews: number) => {
      console.log('🔍 [Browser Context] 开始查找评论元素...')

      // 🔧 优化(2025-12-11): 添加更多Amazon国际站点的选择器fallback
      const selectorGroups = [
        // 优先级1: 产品评论区域内的标准评论（最常见）
        '#customer-reviews_feature_div [data-hook="review"]',
        '#customer-reviews_feature_div div[data-hook="review"]',

        // 优先级2: Reviews with Images区域（Amazon新版布局）
        '#reviews-medley-footer [data-hook="review"]',
        'div[data-hook="reviews-medley-footer"] [data-hook="review"]',

        // 优先级3: CR Review List（传统布局）
        '#cm-cr-dp-review-list [data-hook="review"]',
        '#cm_cr-review_list [data-hook="review"]',

        // 优先级4: 通用data-hook选择器（跨站点兼容）
        '[data-hook="review"]',
        'div[data-hook="review"]',

        // 优先级5: 基于类名的fallback（老版本Amazon）
        '.review.aok-relative',
        '.review',
        '.cr-review-item',

        // 优先级6: 基于ID的fallback
        '[id^="customer_review-"]',

        // 优先级7: 桌面版评论列表
        '[data-component-type="s-customer-reviews-list-desktop"] [data-hook="review"]',

        // 优先级8: 通用testid
        '[data-testid="review"]'
      ]

      let reviewElements: NodeListOf<Element> | null = null
      let usedSelector = ''

      for (const selector of selectorGroups) {
        try {
          const elements = document.querySelectorAll(selector)
          if (elements.length > 0) {
            reviewElements = elements
            usedSelector = selector
            console.log(`✅ [Browser Context] 找到${elements.length}个评论元素，使用选择器: ${selector}`)
            break
          }
        } catch (error) {
          console.warn(`⚠️ [Browser Context] 选择器失败: ${selector}`, error)
        }
      }

      if (!reviewElements || reviewElements.length === 0) {
        console.log('❌ [Browser Context] 所有选择器都未找到评论元素')
        // 🔍 调试信息：输出页面中的可能评论容器
        const debugContainers = [
          '#customer-reviews_feature_div',
          '#reviews-medley-footer',
          '#cm-cr-dp-review-list'
        ]
        debugContainers.forEach(container => {
          const el = document.querySelector(container)
          if (el) {
            console.log(`📦 [Browser Context] 找到容器: ${container}, innerHTML长度: ${el.innerHTML.length}`)
          }
        })
        return []
      }

      const results: RawReview[] = []

      reviewElements.forEach((el, index) => {
        if (index >= maxReviews) return

        // 🔧 优化(2025-12-11): 增强评分提取，支持更多格式
        const ratingEl = el.querySelector(
          '[data-hook="review-star-rating"], ' +
          '[data-hook="cmps-review-star-rating"], ' +
          '.a-icon-star, ' +
          '.review-rating, ' +
          '[class*="a-star"]'
        )
        const rating = ratingEl?.textContent?.trim() ||
                       ratingEl?.getAttribute('aria-label') ||
                       ratingEl?.getAttribute('title') ||
                       null

        // 🔧 优化(2025-12-11): 增强标题提取
        const titleEl = el.querySelector(
          '[data-hook="review-title"], ' +
          '[data-hook="review-title-content"], ' +
          '.review-title, ' +
          '.review-title-content, ' +
          '[class*="review-title"], ' +
          'a[data-hook="review-title"], ' +
          '[data-testid="review-title"]'
        )
        let title = titleEl?.textContent?.trim() || null
        // 清理标题中的评分文字（如"5.0 out of 5 stars Great product"）
        if (title && /^\d+(\.\d+)?\s+out of\s+\d+\s+stars/i.test(title)) {
          title = title.replace(/^\d+(\.\d+)?\s+out of\s+\d+\s+stars\s*/i, '').trim()
        }

        // 🔧 优化(2025-12-11): 增强正文提取
        const bodyEl = el.querySelector(
          '[data-hook="review-body"], ' +
          '[data-hook="review-collapsed-text"], ' +
          '.review-text, ' +
          '.review-text-content, ' +
          '[class*="review-text"]'
        )
        let body = bodyEl?.textContent?.trim() || null
        // 清理正文中的"Read more"按钮文字
        if (body) {
          body = body.replace(/Read more$/i, '').trim()
        }

        // 有用投票
        const helpfulEl = el.querySelector(
          '[data-hook="helpful-vote-statement"], ' +
          '[data-hook="review-votes"], ' +
          '.review-votes, ' +
          '[class*="helpful"]'
        )
        const helpful = helpfulEl?.textContent?.trim() || null

        // 🔧 优化(2025-12-11): 增强认证购买检测
        const verifiedEl = el.querySelector(
          '[data-hook="avp-badge"], ' +
          '[data-hook="avp-badge-linkless"], ' +
          '.avp-badge, ' +
          '[class*="verified-purchase"]'
        )
        const verified = verifiedEl !== null ||
                        (el.textContent?.includes('Verified Purchase') ?? false) ||
                        (el.textContent?.includes('Verified purchase') ?? false)

        // 日期
        const dateEl = el.querySelector(
          '[data-hook="review-date"], ' +
          '.review-date, ' +
          '[class*="review-date"]'
        )
        const date = dateEl?.textContent?.trim() || null

        // 作者
        const authorEl = el.querySelector(
          '[data-hook="genome-widget"], ' +
          '.a-profile-name, ' +
          '.review-author, ' +
          '[class*="author"]'
        )
        const author = authorEl?.textContent?.trim() || null

        // 只添加有实际内容的评论（标题或正文至少有一个）
        if (title || body) {
          results.push({
            rating,
            title,
            body,
            helpful,
            verified,
            date,
            author
          })
          console.log(`✓ [Browser Context] 评论${index + 1}: ${title?.substring(0, 30) || body?.substring(0, 30) || 'N/A'}...`)
        }
      })

      console.log(`✅ [Browser Context] 成功提取${results.length}条评论`)
      return results
    }, limit)

    console.log(`✅ 成功抓取${reviews.length}条评论`)
    return reviews

  } catch (error: any) {
    console.error('❌ 评论抓取失败:', error.message)
    return []
  }
}

// ==================== AI分析逻辑 ====================

/**
 * 使用AI分析评论数据，提取深度洞察
 *
 * @param reviews 原始评论数组
 * @param productName 产品名称
 * @param targetCountry 目标国家（用于语言适配）
 * @param userId 用户ID（用于API配额管理）
 * @param options 优化选项（可选）
 * @returns 分析结果
 */
export async function analyzeReviewsWithAI(
  reviews: RawReview[],
  productName: string,
  targetCountry: string = 'US',
  userId?: number,
  options?: {
    enableCompression?: boolean  // 启用评论压缩（默认false，零破坏性）
    enableCache?: boolean        // 启用缓存（默认false，零破坏性）
    cacheKey?: string            // 自定义缓存键（必须包含URL以避免不同offer共享缓存）
  }
): Promise<ReviewAnalysisResult> {

  if (reviews.length === 0) {
    console.log('⚠️ 无评论数据，返回空分析结果')
    return getEmptyAnalysisResult()
  }

  // 🔧 P1优化: 评论数量少（<5条）时，直接使用简化分析而非调用AI（节省API成本+避免超时）
  if (reviews.length < 5) {
    console.log(`⚠️ 评论数量较少(${reviews.length}条)，使用简化分析...`)
    return generateSimplifiedAnalysis(reviews)
  }

  console.log(`🤖 开始AI分析${reviews.length}条评论...`)

  // 根据目标国家确定分析语言（使用全局语言映射）
  const langName = getLanguageNameForCountry(targetCountry)

  // 计算基础统计
  const verifiedCount = reviews.filter(r => r.verified).length
  const ratingsArray = reviews
    .map(r => parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0'))
    .filter(rating => rating > 0)
  const avgRating = ratingsArray.length > 0
    ? ratingsArray.reduce((sum, r) => sum + r, 0) / ratingsArray.length
    : 0

  // 准备评论文本（支持压缩优化）
  let reviewTexts: string
  let compressionStats: any = null

  if (options?.enableCompression) {
    // 🆕 Token优化：使用压缩评论（60-70%减少）
    console.log('🗜️ 启用评论压缩优化...')
    const compressed = compressReviews(reviews as CompressorRawReview[], 40)
    reviewTexts = compressed.compressed
    compressionStats = compressed.stats
    console.log(`   压缩率: ${compressionStats.compressionRatio}（${compressionStats.originalChars} → ${compressionStats.compressedChars}字符）`)
  } else {
    // 原始格式（保持向后兼容）
    reviewTexts = reviews.slice(0, 50).map((r, idx) => {
      const ratingNum = parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0')
      const parts = [
        `Review ${idx + 1}:`,
        `Rating: ${ratingNum} stars`,
        r.verified ? '[Verified Purchase]' : '',
        `Title: ${r.title || 'N/A'}`,
        `Body: ${(r.body || '').substring(0, 500)}`, // 限制每条评论最多500字符
      ]
      return parts.filter(p => p).join('\n')
    }).join('\n\n---\n\n')
  }

  // 📦 从数据库加载prompt模板(版本管理)
  const promptTemplate = await loadPrompt('review_analysis')

  // 🎨 准备模板变量
  const productNameVar = productName
  const totalReviewsVar = reviews.length.toString()

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{productName}}', productNameVar)
    .replace('{{totalReviews}}', totalReviewsVar)
    .replace(/\{\{langName\}\}/g, langName)
    .replace('{{reviewTexts}}', reviewTexts)

  // 🔥 2025-12-13修复：强制追加语言指令，确保AI输出目标语言
  // 即使评论是其他语言（如Amazon.com上的意大利语评论），输出也必须是targetCountry语言
  const languageEnforcedPrompt = prompt + `\n\n⚠️ CRITICAL LANGUAGE REQUIREMENT: Even if some reviews are written in other languages (e.g., Italian, Spanish, French), you MUST translate and output ALL content in ${langName} ONLY. Do NOT preserve the original language of reviews in your output.`

  try {
    // 使用Gemini AI进行分析
    if (!userId) {
      throw new Error('评论分析需要用户ID，请确保已登录')
    }

    // 🆕 Token优化：支持缓存（7天TTL）
    // 🔥 2025-12-16修复：cacheKey必须包含URL，避免不同offer共享缓存
    // 如果未提供cacheKey，使用productName+targetCountry作为fallback（但强烈建议传入URL）
    const cacheKey = options?.cacheKey || `${productName}_${targetCountry}`
    if (!options?.cacheKey) {
      console.warn('⚠️ 未提供cacheKey，使用productName作为fallback。建议传入URL以避免缓存冲突。')
    }
    const performAnalysis = async () => {
      const aiResponse = await generateContent({
        operationType: 'review_analysis',
        prompt: languageEnforcedPrompt,  // 🔥 使用强制语言指令的prompt
        temperature: 0.5,  // 降低温度确保更准确的提取
        maxOutputTokens: 8192,  // 增加到8192以避免评论分析被截断
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
          operationType: 'review_analysis',
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
      ? await withCache('review_analysis', cacheKey, performAnalysis)
      : await performAnalysis()

    // 提取JSON内容
    let jsonText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('❌ AI返回格式错误，未找到JSON')
      return getEmptyAnalysisResult()
    }

    const analysisData = JSON.parse(jsonMatch[0])

    // 构建完整结果
    const result: ReviewAnalysisResult = {
      totalReviews: reviews.length,
      averageRating: parseFloat(avgRating.toFixed(1)),
      sentimentDistribution: analysisData.sentimentDistribution || { positive: 0, neutral: 0, negative: 0 },
      topPositiveKeywords: analysisData.topPositiveKeywords || [],
      topNegativeKeywords: analysisData.topNegativeKeywords || [],
      realUseCases: analysisData.realUseCases || [],
      purchaseReasons: analysisData.purchaseReasons || [],
      userProfiles: analysisData.userProfiles || [],
      commonPainPoints: analysisData.commonPainPoints || [],
      // 🔥 v3.2新增字段
      quantitativeHighlights: analysisData.quantitativeHighlights || [],
      competitorMentions: analysisData.competitorMentions || [],
      analyzedReviewCount: reviews.length,
      verifiedReviewCount: verifiedCount,
    }

    console.log('✅ AI评论分析完成')
    console.log(`   - 正面关键词: ${result.topPositiveKeywords.length}个`)
    console.log(`   - 负面关键词: ${result.topNegativeKeywords.length}个`)
    console.log(`   - 使用场景: ${result.realUseCases.length}个`)
    console.log(`   - 痛点: ${result.commonPainPoints.length}个`)
    // 🔥 v3.2新增日志
    if (result.quantitativeHighlights && result.quantitativeHighlights.length > 0) {
      console.log(`   - 量化数据: ${result.quantitativeHighlights.length}个 (${result.quantitativeHighlights.map(q => q.adCopy).join(', ')})`)
    }
    if (result.competitorMentions && result.competitorMentions.length > 0) {
      console.log(`   - 竞品提及: ${result.competitorMentions.map(c => c.brand).join(', ')}`)
    }

    return result

  } catch (error: any) {
    console.error('❌ AI评论分析失败:', error.message)
    return getEmptyAnalysisResult()
  }
}

/**
 * 获取空的分析结果（当无评论或分析失败时使用）
 */
function getEmptyAnalysisResult(): ReviewAnalysisResult {
  return {
    totalReviews: 0,
    averageRating: 0,
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
    topPositiveKeywords: [],
    topNegativeKeywords: [],
    realUseCases: [],
    purchaseReasons: [],
    userProfiles: [],
    commonPainPoints: [],
    analyzedReviewCount: 0,
    verifiedReviewCount: 0,
  }
}

/**
 * 🔧 P1优化: 为评论数量少（<5条）的产品生成简化分析
 * 直接从原始评论中提取基础统计，而非调用AI
 *
 * 优势：
 * - 节省AI API成本
 * - 避免超时问题
 * - 仍能提供有价值的基础洞察
 */
function generateSimplifiedAnalysis(reviews: RawReview[]): ReviewAnalysisResult {
  // 计算基础统计
  const verifiedCount = reviews.filter(r => r.verified).length
  const ratingsArray = reviews
    .map(r => parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0'))
    .filter(rating => rating > 0)
  const avgRating = ratingsArray.length > 0
    ? ratingsArray.reduce((sum, r) => sum + r, 0) / ratingsArray.length
    : 0

  // 计算情感分布
  const positiveCount = ratingsArray.filter(r => r >= 4).length
  const neutralCount = ratingsArray.filter(r => r === 3).length
  const negativeCount = ratingsArray.filter(r => r <= 2).length
  const total = ratingsArray.length || 1

  // 从评论标题提取关键词（简化版）
  const positiveTitles = reviews
    .filter(r => parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0') >= 4 && r.title)
    .map(r => r.title!)

  const negativeTitles = reviews
    .filter(r => parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0') <= 2 && r.title)
    .map(r => r.title!)

  console.log(`✅ 简化分析完成: ${reviews.length}条评论, 平均评分${avgRating.toFixed(1)}星`)

  return {
    totalReviews: reviews.length,
    averageRating: parseFloat(avgRating.toFixed(1)),
    sentimentDistribution: {
      positive: Math.round((positiveCount / total) * 100),
      neutral: Math.round((neutralCount / total) * 100),
      negative: Math.round((negativeCount / total) * 100),
    },
    topPositiveKeywords: positiveTitles.slice(0, 3).map(title => ({
      keyword: title.substring(0, 50),
      frequency: 1,
      sentiment: 'positive' as const,
    })),
    topNegativeKeywords: negativeTitles.slice(0, 3).map(title => ({
      keyword: title.substring(0, 50),
      frequency: 1,
      sentiment: 'negative' as const,
    })),
    realUseCases: [],  // 需要AI分析才能提取
    purchaseReasons: [], // 需要AI分析才能提取
    userProfiles: [], // 需要AI分析才能提取
    commonPainPoints: [], // 需要AI分析才能提取
    analyzedReviewCount: reviews.length,
    verifiedReviewCount: verifiedCount,
  }
}

// ==================== 辅助函数 ====================

/**
 * 提取评论分析中最有价值的洞察（用于广告创意生成）
 *
 * @param analysis 评论分析结果
 * @returns 结构化的洞察摘要
 */
export function extractAdCreativeInsights(analysis: ReviewAnalysisResult): {
  headlineSuggestions: string[]     // 适合用作广告标题的关键词
  descriptionHighlights: string[]   // 适合用作广告描述的卖点
  painPointAddressing: string[]     // 需要在广告中解决的痛点
  targetAudienceHints: string[]     // 目标受众描述
} {
  const insights = {
    headlineSuggestions: [] as string[],
    descriptionHighlights: [] as string[],
    painPointAddressing: [] as string[],
    targetAudienceHints: [] as string[],
  }

  // 从正面关键词提取标题建议（高频 + 情感积极）
  insights.headlineSuggestions = analysis.topPositiveKeywords
    .filter(kw => kw.frequency >= 5)  // 至少被提及5次
    .slice(0, 5)
    .map(kw => kw.keyword)

  // 从使用场景和正面关键词提取描述亮点
  insights.descriptionHighlights = [
    ...analysis.realUseCases
      .filter(uc => uc.mentions >= 3)
      .slice(0, 3)
      .map(uc => uc.scenario),
    ...analysis.topPositiveKeywords
      .slice(0, 3)
      .map(kw => kw.keyword)
  ]

  // 从痛点提取需要解决的问题（用于差异化广告）
  insights.painPointAddressing = analysis.commonPainPoints
    .filter(pp => pp.severity === 'critical' || pp.severity === 'moderate')
    .slice(0, 3)
    .map(pp => pp.issue)

  // 从用户画像提取目标受众提示
  insights.targetAudienceHints = analysis.userProfiles
    .slice(0, 3)
    .map(up => up.profile)

  return insights
}
